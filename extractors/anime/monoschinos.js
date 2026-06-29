'use strict'
// ─── extractors/anime/monoschinos.js ─────────────────────────────────────────
// Fuente: monoschinos.st

const axios   = require('axios')
const cheerio = require('cheerio')

const BASE = 'https://monoschinos.st'

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer':         'https://monoschinos.st/',
}

async function _fetch(url, extraHeaders = {}) {
  const { data } = await axios.get(url, {
    headers: { ...HEADERS, ...extraHeaders },
    timeout: 15000,
    maxRedirects: 5,
  })
  return data
}

async function _fetchWithHeaders(url) {
  const res = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
    maxRedirects: 5,
  })
  return { html: res.data, headers: res.headers }
}

const _img = src => {
  if (!src) return ''
  if (src.startsWith('http')) return src
  return BASE + src
}

// Extrae número de episodio desde URL tipo /ver/anime-episodio-12
function _epNum(url) {
  const m = url.match(/-episodio-(\d+)(?:\?.*)?$/)
  return m ? parseInt(m[1], 10) : null
}

// Slug del anime desde URL de episodio (/ver/anime-episodio-12 → anime)
function _slugFromEpUrl(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
    return seg.replace(/-episodio-\d+$/, '')
  } catch { return '' }
}

// ── GET RECIENTES ─────────────────────────────────────────────────────────────
async function getRecientes() {
  const html = await _fetch(BASE)
  const $ = cheerio.load(html)
  const lista = []

  // Últimos capítulos: cada item es un <a> apuntando a /ver/
  $('a[href*="/ver/"]').each((_, el) => {
    const link = $(el).attr('href') || ''
    if (!link.includes('-episodio-')) return
    const fullLink = link.startsWith('http') ? link : BASE + link
    const num = _epNum(fullLink)
    if (!num) return

    // Imagen: puede estar en data-src o src
    const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || ''

    // Título: texto del anchor o del primer h3/h2
    let titulo = $(el).find('h3, h2, .titulo, .title').first().text().trim()
    if (!titulo) titulo = $(el).text().replace(/\d+/g, '').trim()
    if (!titulo) return

    // Evitar duplicados
    if (lista.find(x => x.link === fullLink)) return

    lista.push({
      titulo: `${titulo} - Ep ${num}`,
      link: fullLink,
      imagen: _img(img),
      num,
    })
  })

  return { slider: [], lista: lista.slice(0, 24), series: [] }
}

// ── BUSCAR ────────────────────────────────────────────────────────────────────
async function buscar(query, filtros = {}, page = 1) {
  const q = (query || '').trim()
  if (!q) return { lista: [], hayMas: false, page: 1 }

  const url = `${BASE}/animes?buscar=${encodeURIComponent(q)}&genero=all&categoria=all&estado=all&orden=default&p=${page}`
  const html = await _fetch(url)
  const $ = cheerio.load(html)
  const lista = []

  $('a[href*="/anime/"]').each((_, el) => {
    const link = $(el).attr('href') || ''
    if (!link.includes('-sub-espanol')) return
    const fullLink = link.startsWith('http') ? link : BASE + link

    const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || ''
    let titulo = $(el).find('h3, h2, .titulo, .title').first().text().trim()
    if (!titulo) titulo = $(el).attr('title') || $(el).text().trim()
    if (!titulo) return
    if (lista.find(x => x.link === fullLink)) return

    lista.push({ titulo, link: fullLink, imagen: _img(img) })
  })

  // Detectar si hay página siguiente
  const hayMas = !!$(`a[href*="p=${page + 1}"]`).length

  return { lista, hayMas, page }
}

// ── BIBLIOTECA ────────────────────────────────────────────────────────────────
async function getBiblioteca({ query = '', genero = '', tipo = '', estado = '', page = 1 } = {}) {
  const params = new URLSearchParams({
    genero:    genero  || 'all',
    categoria: tipo    || 'all',
    estado:    estado  || 'all',
    orden:     'default',
    p:         String(page),
  })
  if (query) params.set('buscar', query)

  const url = `${BASE}/animes?${params}`
  const html = await _fetch(url)
  const $ = cheerio.load(html)
  const lista = []

  $('a[href*="/anime/"]').each((_, el) => {
    const link = $(el).attr('href') || ''
    if (!link.includes('-sub-espanol') && !link.includes('/anime/')) return
    const fullLink = link.startsWith('http') ? link : BASE + link

    const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || ''
    let titulo = $(el).find('h3, h2, .titulo, .title').first().text().trim()
    if (!titulo) titulo = $(el).attr('title') || $(el).text().trim()
    if (!titulo) return
    if (lista.find(x => x.link === fullLink)) return

    lista.push({ titulo, link: fullLink, imagen: _img(img) })
  })

  const hayMas = !!$(`a[href*="p=${page + 1}"]`).length
  return { lista, hayMas }
}

// ── GET ANIME ─────────────────────────────────────────────────────────────────
async function getAnime(url) {
  const { html, headers } = await _fetchWithHeaders(url)
  const $ = cheerio.load(html)

  const titulo    = $('h1').first().text().trim() || $('h2').first().text().trim()
  const imagen    = _img($('img.lazy').attr('data-src') || $('img').first().attr('src') || '')
  const sinopsis  = $('p').filter((_, el) => $(el).text().length > 80).first().text().trim() || ''
  const generos   = []
  $('a[href*="/genero/"]').each((_, el) => {
    const g = $(el).text().trim()
    if (g && !generos.includes(g)) generos.push(g)
  })

  // Estado
  let estado = ''
  $('p, span, div').each((_, el) => {
    const t = $(el).text().toLowerCase()
    if (t.includes('finalizado')) { estado = 'Finalizado'; return false }
    if (t.includes('en emisión') || t.includes('en emision')) { estado = 'En emisión'; return false }
  })

  const episodios = []

  // Intento 1: AJAX pagination (el método que usa el site para cargar episodios)
  const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/i)
  const axMatch   = html.match(/(https?:\/\/[^\s"'<>]+\/ajax_pagination\/\d+)/i)

  if (csrfMatch && axMatch) {
    try {
      const csrfToken = csrfMatch[1]
      const axUrl     = axMatch[1]
      const cookie    = (headers['set-cookie'] || []).join('; ')
      const ajaxHeaders = {
        ...HEADERS,
        'X-CSRF-TOKEN': csrfToken,
        'Cookie':       cookie,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      }

      const axRes  = await axios.post(axUrl, null, { headers: ajaxHeaders, timeout: 15000 })
      const pData  = axRes.data

      if (pData && pData.paginate_url && Array.isArray(pData.eps)) {
        const perPage   = pData.perpage || 50
        const totalPages = Math.ceil(pData.eps.length / perPage)

        for (let p = 1; p <= totalPages; p++) {
          const epUrl  = `${pData.paginate_url}?p=${p}`
          const epRes  = await axios.post(epUrl, null, { headers: ajaxHeaders, timeout: 15000 })
          const epData = epRes.data
          if (epData && Array.isArray(epData.caps)) {
            for (const cap of epData.caps) {
              const num = parseInt(cap.episodio, 10)
              if (!cap.url || !num) continue
              const epLink = cap.url.startsWith('http') ? cap.url : BASE + cap.url
              episodios.push({ num, link: epLink, titulo: `Episodio ${num}` })
            }
          }
        }
      }
    } catch(e) { /* silenciar, usar fallback */ }
  }

  // Fallback: parsear links /ver/ presentes en el HTML
  if (!episodios.length) {
    $('a[href*="/ver/"]').each((_, el) => {
      const href = $(el).attr('href') || ''
      if (!href.includes('-episodio-')) return
      const fullLink = href.startsWith('http') ? href : BASE + href
      const num = _epNum(fullLink)
      if (!num) return
      if (episodios.find(e => e.num === num)) return
      episodios.push({ num, link: fullLink, titulo: `Episodio ${num}` })
    })
  }

  episodios.sort((a, b) => a.num - b.num)

  return {
    titulo,
    imagen,
    sinopsis,
    generos,
    estado,
    episodios,
  }
}

// ── GET SERVIDORES ────────────────────────────────────────────────────────────
async function getServidores(url) {
  const html = await _fetch(url)
  const $ = cheerio.load(html)
  const servidores = []

  // Método principal: .play-video con data-player en base64
  $('.play-video').each((_, el) => {
    const nombre     = $(el).text().trim().toLowerCase() || 'server'
    const dataPlayer = $(el).attr('data-player')
    if (!dataPlayer) return
    try {
      const decoded = Buffer.from(dataPlayer, 'base64').toString('utf-8')
      if (decoded.startsWith('http')) {
        servidores.push({ nombre, url: decoded })
      }
    } catch(e) {}
  })

  // Fallback: links de descarga → convertir a embed cuando es posible
  if (!servidores.length) {
    $('a[href]').each((_, el) => {
      const href  = $(el).attr('href') || ''
      const texto = $(el).text().trim().toLowerCase()
      if (!href.startsWith('http')) return

      let embedUrl = null
      if (href.includes('filemoon.sx'))  embedUrl = href.replace('/d/', '/e/')
      else if (href.includes('voe.sx'))  embedUrl = href
      else if (href.includes('mp4upload.com')) {
        const m = href.match(/mp4upload\.com\/([^.]+)\.html/)
        if (m) embedUrl = `https://www.mp4upload.com/embed-${m[1]}.html`
      }
      else if (href.includes('doodstream.com') || href.includes('dood.')) {
        embedUrl = href.replace('/d/', '/e/')
      }

      if (embedUrl && !servidores.find(s => s.url === embedUrl)) {
        servidores.push({ nombre: texto || 'server', url: embedUrl })
      }
    })
  }

  return servidores
}

module.exports = { BASE, getRecientes, buscar, getBiblioteca, getAnime, getServidores }
