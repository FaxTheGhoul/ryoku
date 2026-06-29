'use strict'
// ── server/routes/anime.js ────────────────────────────────────────────────────
const express = require('express')
const path    = require('path')
const router  = express.Router()

// Importar extractores existentes del proyecto padre
const ROOT = path.join(__dirname, '..', '..')
const latanime     = require(path.join(ROOT, 'extractors', 'anime', 'latanime'))
const animeflv     = require(path.join(ROOT, 'extractors', 'anime', 'animeflv'))
const monoschinos  = require(path.join(ROOT, 'extractors', 'anime', 'monoschinos'))
const extIndex     = require(path.join(ROOT, 'extractors', 'anime', 'index'))

// Cache
const recientesCache = {}
const RECIENTES_TTL  = 5 * 60 * 1000
const calendarioCache = { data: null, ts: 0 }
const CALENDARIO_TTL  = 60 * 60 * 1000

// ── GET /anime/recientes?source=latanime|animeflv ─────────────────────────────
router.get('/recientes', async (req, res) => {
  const srcId  = req.query.source || 'latanime'
  const cached = recientesCache[srcId]
  if (cached && Date.now() - cached.ts < RECIENTES_TTL) return res.json(cached.data)

  try {
    const result = srcId === 'animeflv'
      ? await animeflv.getRecientes()
      : srcId === 'monoschinos'
        ? await monoschinos.getRecientes()
        : await latanime.getRecientes()
    recientesCache[srcId] = { data: result, ts: Date.now() }
    res.json(result)
  } catch(e) {
    res.json({ slider: [], lista: [], series: [] })
  }
})

// ── GET /anime/buscar?q=...&source=...&page=1 ─────────────────────────────────
router.get('/buscar', async (req, res) => {
  const q      = (req.query.q || '').trim()
  const srcId  = req.query.source || 'latanime'
  const page   = parseInt(req.query.page) || 1
  const filtros = {}
  if (req.query.tipo)    filtros.tipo    = req.query.tipo
  if (req.query.estado)  filtros.estado  = req.query.estado
  if (req.query.genero)  filtros.genero  = req.query.genero
  if (!q) return res.json({ lista: [], hayMas: false, page: 1 })

  try {
    const result = srcId === 'animeflv'
      ? await animeflv.buscar(q, filtros, page)
      : srcId === 'monoschinos'
        ? await monoschinos.buscar(q, filtros, page)
        : await latanime.buscar(q, filtros, page)
    res.json(result)
  } catch(e) {
    res.json({ lista: [], hayMas: false, page: 1 })
  }
})

// ── GET /anime/detalle?url=...&source=... ─────────────────────────────────────
router.get('/detalle', async (req, res) => {
  const url   = req.query.url
  const srcId = req.query.source || 'latanime'
  if (!url) return res.status(400).json(null)

  try {
    const result = srcId === 'animeflv'
      ? await animeflv.getAnime(url)
      : srcId === 'monoschinos'
        ? await monoschinos.getAnime(url)
        : await latanime.getAnime(url)
    res.json(result)
  } catch(e) {
    res.status(500).json(null)
  }
})

// ── GET /anime/servidores?url=...&source=... ──────────────────────────────────
router.get('/servidores', async (req, res) => {
  const url   = req.query.url
  const srcId = req.query.source || 'latanime'
  if (!url) return res.status(400).json([])

  try {
    const result = srcId === 'animeflv'
      ? await animeflv.getServidores(url)
      : srcId === 'monoschinos'
        ? await monoschinos.getServidores(url)
        : await latanime.getServidores(url)
    res.json(result || [])
  } catch(e) {
    res.json([])
  }
})

// ── GET /anime/stream?url=... ─────────────────────────────────────────────────
router.get('/stream', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).json(null)

  try {
    // Solo HTTP — sin Playwright. El celular hace la extracción pesada localmente.
    // Este endpoint es solo fallback para casos donde el WebView nativo no captura nada.
    const { extraerStreamHttp } = require('../browser')
    const ul = url.toLowerCase()
    let referer = 'https://latanime.org/'
    if (ul.includes('mp4upload'))  referer = 'https://www.mp4upload.com/'
    if (ul.includes('mixdrop') || ul.includes('miixdrop')) referer = 'https://mixdrop.ag/'
    if (ul.includes('dood') || ul.includes('ds2play'))     referer = 'https://doodstream.com/'
    if (ul.includes('voe') || ul.includes('jessicayeah'))  referer = 'https://latanime.org/'
    if (ul.includes('streamtape') || ul.includes('streamta.pe')) referer = 'https://streamtape.com/'

    const streamUrl = await extraerStreamHttp(url, { referer }).catch(() => null)
    const result = streamUrl
      ? { tipo: streamUrl.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url: streamUrl }
      : null

    res.json(result)
  } catch(e) {
    console.error('[STREAM]', e.message)
    res.json(null)
  }
})

// ── GET /anime/calendario?source=... ─────────────────────────────────────────
router.get('/calendario', async (req, res) => {
  const srcId = req.query.source || 'latanime'
  if (calendarioCache.data && Date.now() - calendarioCache.ts < CALENDARIO_TTL) {
    return res.json(calendarioCache.data)
  }
  try {
    const result = srcId === 'animeflv'
      ? await animeflv.getCalendario()
      : await latanime.getCalendario()
    calendarioCache.data = result
    calendarioCache.ts   = Date.now()
    res.json(result)
  } catch(e) {
    res.json([])
  }
})

// ── GET /anime/biblioteca?source=...&genero=...&tipo=...&estado=...&page=1 ─────
router.get('/biblioteca', async (req, res) => {
  const srcId  = req.query.source || 'latanime'
  const params = {
    page:     parseInt(req.query.page) || 1,
    query:    req.query.query    || '',
    genero:   req.query.genero   || '',
    categoria:req.query.categoria|| '',
    tipo:     req.query.tipo     || '',
    estado:   req.query.estado   || '',
    emision:  req.query.emision === 'true',
  }
  try {
    const result = srcId === 'animeflv'
      ? await animeflv.getBiblioteca(params)
      : srcId === 'monoschinos'
        ? await monoschinos.getBiblioteca(params)
        : await latanime.getBiblioteca(params)
    res.json(result || { lista: [], hayMas: false })
  } catch(e) {
    res.json({ lista: [], hayMas: false })
  }
})

// ── POST /anime/check-servidores ──────────────────────────────────────────────
router.post('/check-servidores', async (req, res) => {
  const { servidores } = req.body || {}
  if (!Array.isArray(servidores)) return res.json([])
  const { default: axios } = require('axios')
  const resultados = await Promise.allSettled(
    servidores.map(async (s) => {
      try {
        await axios.head(s.url || s, { timeout: 5000 })
        return { ...s, online: true }
      } catch(e) {
        return { ...s, online: false }
      }
    })
  )
  res.json(resultados.map(r => r.value || r.reason))
})

// ── POST /anime/check-nuevos-eps ──────────────────────────────────────────────
router.post('/check-nuevos-eps', async (req, res) => {
  const { items } = req.body || {}
  if (!Array.isArray(items)) return res.json([])
  // Verificar cada anime para nuevos episodios
  const resultados = await Promise.allSettled(
    items.slice(0, 10).map(async (item) => {
      try {
        const srcId = item.source || 'latanime'
        const anime = srcId === 'animeflv'
          ? await animeflv.getAnime(item.url)
          : await latanime.getAnime(item.url)
        const ultimoEp = anime?.episodios?.slice(-1)[0]
        return { ...item, ultimoEp: ultimoEp?.num || 0, hayNuevo: ultimoEp?.num > (item.ultimoVisto || 0) }
      } catch(e) {
        return { ...item, hayNuevo: false }
      }
    })
  )
  res.json(resultados.map(r => r.value || null).filter(Boolean))
})

module.exports = router
