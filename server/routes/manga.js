'use strict'
// ── server/routes/manga.js ────────────────────────────────────────────────────
const express = require('express')
const axios   = require('axios')
const cheerio = require('cheerio')
const { browserGetHTML, browserCapture, browserEvalJS, UA } = require('../browser')
const router  = express.Router()

const MANGA_BASE = 'https://zonatmo.org'
const MANGA_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'es-ES,es;q=0.9',
  'Referer': 'https://zonatmo.org/',
}

// Cache en memoria
const coverCache   = new Map()
const detailCache  = new Map()
const buscarCache  = new Map()
const BUSCAR_TTL   = 5 * 60 * 1000
const DETAIL_TTL   = 10 * 60 * 1000

// ── Helper: parsear links de zonatmo ──────────────────────────────────────────
function parsearLinksZona($, aEls, limite = 24) {
  const lista = [], vistos = new Set()
  aEls.each((i, el) => {
    if (lista.length >= limite) return false
    const href = $(el).attr('href') || ''
    if (!href.match(/\/library\/(manga|manhwa|manhua)\/\d+\//)) return
    const link = href.startsWith('http') ? href : MANGA_BASE + href
    if (vistos.has(link)) return
    vistos.add(link)
    const textoRaw = $(el).text().replace(/\s+/g, ' ').trim()
    const tipoMatch = textoRaw.match(/\s+(MANGA|MANHWA|MANHUA)\s+/)
    let titulo = '', tipo = 'MANGA', rating = 0, demografia = ''
    if (tipoMatch) {
      titulo = textoRaw.slice(0, tipoMatch.index).trim()
      tipo   = tipoMatch[1]
      const resto = textoRaw.slice(tipoMatch.index + tipoMatch[0].length).trim()
      const rm = resto.match(/^(\d+(?:\.\d+)?)\s*(.*)$/)
      if (rm) { rating = parseFloat(rm[1]) || 0; demografia = rm[2].trim() }
    } else {
      titulo = textoRaw
    }
    if (!titulo || titulo.length < 2 || titulo.length > 150) return
    const imagen = coverCache.get(link) || ''
    lista.push({ titulo: titulo.trim(), link, imagen, cap: '', tipo,
      rating: rating > 0 ? rating : undefined,
      demografia: demografia || undefined })
  })
  return lista
}

function extraerMangasZona($, limite = 60) {
  return parsearLinksZona($, $('a[href*="/library/"]'), limite)
}

// ── GET /manga/tendencias ─────────────────────────────────────────────────────
router.get('/tendencias', async (req, res) => {
  const src  = req.query.source || 'zonatmo'
  const empty = { pop:{general:[],seinen:[],josei:[]}, trend:{general:[],seinen:[],josei:[]}, nuevos:[] }

  if (src === 'novelcool') {
    // NovelCool tendencias via browser
    try {
      const ncResult = await _ncTendencias()
      return res.json(ncResult || empty)
    } catch(e) {
      return res.json(empty)
    }
  }

  // ZonaTMO
  for (let intento = 0; intento < 2; intento++) {
    try {
      const { data: html } = await axios.get(MANGA_BASE, { headers: MANGA_HEADERS, timeout: 15000 })
      const $ = cheerio.load(html)

      const markers = {
        popGeneral:   html.search(/id="pills-populars"/),
        popSein:      html.search(/id="pills-populars-boys"/),
        popJosei:     html.search(/id="pills-populars-girls"/),
        trendGeneral: html.search(/id="pills-trending"/),
        trendSein:    html.search(/id="pills-trending-boys"/),
        trendJosei:   html.search(/id="pills-trending-girls"/),
      }

      const parseSlice = (from, to, lim = 18) => {
        if (from < 0) return []
        const slice = to > 0 ? html.slice(from, to) : html.slice(from)
        return parsearLinksZona(cheerio.load(slice), cheerio.load(slice)('a[href*="/library/"]'), lim)
      }

      const pop = {
        general: parseSlice(markers.popGeneral,  markers.popSein  > 0 ? markers.popSein  : markers.trendGeneral, 18),
        seinen:  parseSlice(markers.popSein  > 0 ? markers.popSein   : markers.popGeneral, markers.popJosei > 0 ? markers.popJosei : markers.trendGeneral, 18),
        josei:   parseSlice(markers.popJosei > 0 ? markers.popJosei  : markers.popGeneral, markers.trendGeneral > 0 ? markers.trendGeneral : html.length, 18),
      }
      const trend = {
        general: parseSlice(markers.trendGeneral > 0 ? markers.trendGeneral : html.length * 0.6, markers.trendSein  > 0 ? markers.trendSein  : html.length, 18),
        seinen:  parseSlice(markers.trendSein  > 0 ? markers.trendSein  : html.length * 0.7, markers.trendJosei > 0 ? markers.trendJosei : html.length, 18),
        josei:   parseSlice(markers.trendJosei > 0 ? markers.trendJosei : html.length * 0.8, html.length, 18),
      }

      if (!pop.general.length && !trend.general.length) {
        const todos = extraerMangasZona($, 54)
        pop.general   = todos.slice(0, 18)
        trend.general = todos.slice(18, 36)
        return res.json({ pop, trend, nuevos: todos.slice(36, 54) })
      }

      let nuevos = []
      try {
        const { data: bHtml } = await axios.get(
          MANGA_BASE + '/biblioteca?order_item=creation&order_dir=desc&_pg=1',
          { headers: MANGA_HEADERS, timeout: 8000 }
        )
        nuevos = extraerMangasZona(cheerio.load(bHtml), 18)
      } catch(e) {}

      return res.json({ pop, trend, nuevos })
    } catch(e) {
      if (intento === 0) await new Promise(r => setTimeout(r, 2000))
    }
  }
  res.json(empty)
})

// ── GET /manga/buscar?q=...&source=... ────────────────────────────────────────
router.get('/buscar', async (req, res) => {
  const q   = (req.query.q || '').trim()
  const src = req.query.source || 'zonatmo'
  if (!q) return res.json([])

  const cacheKey = `${src}::${q}`
  const hit = buscarCache.get(cacheKey)
  if (hit && Date.now() - hit.ts < BUSCAR_TTL) return res.json(hit.data)

  try {
    let results = []
    if (src === 'zonatmo') {
      const url = `${MANGA_BASE}/biblioteca?_pg=1&title=${encodeURIComponent(q)}`
      const html = await browserGetHTML(url, { waitMs: 2500, referer: MANGA_BASE + '/' })
      const $ = cheerio.load(html)
      results = extraerMangasZona($, 30)
    } else {
      // NovelCool buscar
      results = await _ncBuscar(q)
    }
    buscarCache.set(cacheKey, { data: results, ts: Date.now() })
    res.json(results)
  } catch(e) {
    res.status(500).json([])
  }
})

// ── GET /manga/detalle?url=...&source=... ─────────────────────────────────────
router.get('/detalle', async (req, res) => {
  const url = req.query.url
  const src = req.query.source || 'zonatmo'
  if (!url) return res.status(400).json(null)

  const hit = detailCache.get(url)
  if (hit && Date.now() - hit.ts < DETAIL_TTL) return res.json(hit.data)

  try {
    let detalle = null
    if (src === 'zonatmo') {
      const { data: html } = await axios.get(url, { headers: MANGA_HEADERS, timeout: 12000 })
      const $ = cheerio.load(html)
      const titulo    = $('h1.element-title, h2.card-title, h1').first().text().trim()
      const imagen    = $('img.book-thumbnail, .thumbnail img, img.rounded').first().attr('src') || ''
      const sinopsis  = $('p.element-description, .sinopsis p, .description').first().text().trim()
      const generos   = $('a.element-tag').map((_,el) => $(el).text().trim()).get()
      const estado    = $('span.book-status, .status').first().text().trim()
      const capitulos = []
      const vistos    = new Set()
      $('a[href*="/view_uploads/"]').each((_, el) => {
        const link = $(el).attr('href') || ''
        if (vistos.has(link)) return
        vistos.add(link)
        const num  = parseFloat($(el).text().replace(/[^\d.]/g, '')) || 0
        const full = link.startsWith('http') ? link : 'https://zonatmo.org' + link
        capitulos.push({ num, link: full })
      })
      capitulos.sort((a, b) => a.num - b.num)
      detalle = { titulo, imagen, sinopsis, generos, estado, capitulos }
    } else {
      detalle = await _ncDetalle(url)
    }
    if (detalle) detailCache.set(url, { data: detalle, ts: Date.now() })
    res.json(detalle)
  } catch(e) {
    res.status(500).json(null)
  }
})

// ── GET /manga/paginas?url=...&source=...&sourceIdx=0 ─────────────────────────
router.get('/paginas', async (req, res) => {
  const url       = req.query.url
  const src       = req.query.source || 'zonatmo'
  const sourceIdx = parseInt(req.query.sourceIdx) || 0
  if (!url) return res.status(400).json([])

  try {
    let paginas = []
    if (src === 'zonatmo') {
      // Capturar imágenes del lector de zonatmo via browser
      const html = await browserGetHTML(url, { waitMs: 4500, referer: MANGA_BASE + '/' })
      const $ = cheerio.load(html)
      // Intentar window.chapter_pages primero via JS eval
      try {
        const imgs = await browserEvalJS(url, `
          (function(){
            if(window.chapter_pages) return window.chapter_pages.map(function(p){ return typeof p==='string'?p:(p.url||p.page_url||JSON.stringify(p)); });
            if(window.pages) return window.pages.map(function(p){ return typeof p==='string'?p:(p.url||p.img||JSON.stringify(p)); });
            var imgs=[];
            document.querySelectorAll('img.viewer-img,img[class*="viewer"],img[class*="chapter"],img[data-src],.chapter-content img').forEach(function(img){
              var src=img.getAttribute('data-src')||img.src||'';
              if(src&&src.length>10&&!src.includes('data:'))imgs.push(src);
            });
            return imgs;
          })()
        `, { waitMs: 4500, referer: MANGA_BASE + '/' })
        if (Array.isArray(imgs) && imgs.length > 0) paginas = imgs
      } catch(e) {}

      if (!paginas.length) {
        // Fallback: scrape img tags del HTML estático
        $('img.viewer-img, img[data-src], .chapter-content img').each((_, el) => {
          const src = $(el).attr('data-src') || $(el).attr('src') || ''
          if (src && src.length > 10 && !src.includes('data:')) paginas.push(src)
        })
      }
    } else {
      paginas = await _ncPaginas(url, sourceIdx)
    }
    res.json(paginas)
  } catch(e) {
    res.status(500).json([])
  }
})

// ── GET /manga/portada?url=... ────────────────────────────────────────────────
router.get('/portada', async (req, res) => {
  const url = req.query.url
  if (!url) return res.json('')
  const cached = coverCache.get(url)
  if (cached) return res.json(cached)
  try {
    const { data: html } = await axios.get(url, { headers: MANGA_HEADERS, timeout: 8000 })
    const $ = cheerio.load(html)
    const img = $('img.book-thumbnail, .thumbnail img, img.rounded').first().attr('src') || ''
    if (img) coverCache.set(url, img)
    res.json(img)
  } catch(e) { res.json('') }
})

// ── NovelCool stubs (implementar con Playwright) ───────────────────────────────
async function _ncTendencias() {
  // TODO: implementar con Playwright navegando es.novelcool.com
  return null
}
async function _ncBuscar(q) {
  const url  = `https://es.novelcool.com/search/?wd=${encodeURIComponent(q)}`
  const html = await browserGetHTML(url, { waitMs: 3000 })
  const $ = cheerio.load(html)
  const results = []
  $('a.book-item-title, .book-item a').each((_, el) => {
    const titulo = $(el).text().trim()
    const link   = $(el).attr('href') || ''
    const imagen = $(el).closest('.book-item, li').find('img').attr('src') || ''
    if (titulo && link) results.push({ titulo, link, imagen, cap: '', tipo: 'MANGA' })
  })
  return results.slice(0, 30)
}
async function _ncDetalle(url) {
  const html = await browserGetHTML(url, { waitMs: 3000 })
  const $ = cheerio.load(html)
  const titulo   = $('h1, .book-name').first().text().trim()
  const imagen   = $('img.book-thumbnail, .thumbnail img').first().attr('src') || ''
  const sinopsis = $('.book-intro, .description').first().text().trim()
  const capitulos = []
  $('a[href*="/chapter/"]').each((_, el) => {
    const link = $(el).attr('href') || ''
    const num  = parseFloat($(el).text().replace(/[^\d.]/g, '')) || 0
    if (link) capitulos.push({ num, link })
  })
  capitulos.sort((a, b) => a.num - b.num)
  return { titulo, imagen, sinopsis, generos: [], estado: '', capitulos }
}
async function _ncPaginas(url, sourceIdx) {
  const html = await browserGetHTML(url, { waitMs: 4000 })
  const $ = cheerio.load(html)
  const imgs = []
  $('img[src*="novelcool"], img[data-src], .chapter-container img').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src') || ''
    if (src && !src.includes('data:')) imgs.push(src)
  })
  return imgs
}

module.exports = router
