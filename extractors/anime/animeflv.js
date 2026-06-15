'use strict'
// ─── extractors/anime/animeflv.js ────────────────────────────────────────────
// Fuente: www4.animeflv.net

const axios   = require('axios')
const cheerio = require('cheerio')

const BASE = 'https://www4.animeflv.net'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': 'https://www4.animeflv.net/',
}

const _img = s => {
  if (!s) return ''
  if (s.startsWith('/')) return BASE + s
  return s.replace(/^\/\//, 'https://')
}

async function _fetch(url) {
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000 })
  return data
}

// Extrae variable JS embebida contando brackets (soporta arrays anidados)
function _jsVar(html, name) {
  // Buscar con o sin espacio antes del = y con/sin let/const
  let idx = html.indexOf(`var ${name} =`)
  if (idx === -1) idx = html.indexOf(`var ${name}=`)
  if (idx === -1) idx = html.indexOf(`let ${name} =`)
  if (idx === -1) idx = html.indexOf(`let ${name}=`)
  if (idx === -1) idx = html.indexOf(`const ${name} =`)
  if (idx === -1) idx = html.indexOf(`const ${name}=`)
  if (idx === -1) return null
  const startIdx = html.indexOf('[', idx)
  const startObj = html.indexOf('{', idx)
  let start = -1
  if (startIdx === -1 && startObj === -1) return null
  if (startIdx === -1) start = startObj
  else if (startObj === -1) start = startIdx
  else start = Math.min(startIdx, startObj)
  const open = html[start], close = open === '[' ? ']' : '}'
  let depth = 0, end = start
  for (; end < html.length; end++) {
    if (html[end] === open) depth++
    else if (html[end] === close) { depth--; if (depth === 0) break }
  }
  try { return JSON.parse(html.slice(start, end + 1)) } catch(e) { return null }
}

async function getRecientes() {
  const html = await _fetch(BASE + '/')
  const $ = cheerio.load(html)

  const lista = []
  $('ul.ListEpisodios li').each((_, el) => {
    const a     = $(el).find('a').first()
    const href  = a.attr('href') || ''
    const link  = href.startsWith('http') ? href : BASE + href
    const img   = $(el).find('img').first()
    const imagen = _img(img.attr('data-src') || img.attr('src') || '')
    const titulo = $(el).find('.Title').first().text().trim()
    const capi   = $(el).find('.Capi').text().trim()
    const ep     = capi.replace(/episodio\s*/i, '').trim()
    if (titulo && link) lista.push({ titulo, link, ep: ep ? `Ep ${ep}` : '', imagen, fecha: '', idioma: '' })
  })

  const slider = []
  $('ul.ListAnimes li').slice(0, 10).each((_, el) => {
    const a    = $(el).find('a').first()
    const href = a.attr('href') || ''
    const link = href.startsWith('http') ? href : BASE + href
    const img  = $(el).find('img').first()
    const imagen = _img(img.attr('data-src') || img.attr('src') || '')
    const titulo = $(el).find('.Title').first().text().trim()
    const desc   = $(el).find('p').first().text().trim().slice(0, 150)
    if (titulo && link) slider.push({ titulo, imagen, link, desc, idioma: '' })
  })

  return { slider, lista, series: slider.slice(0, 8) }
}

async function buscar(query, filtros = {}) {
  const params = new URLSearchParams({ q: query })
  if (filtros.genero) params.set('genre', filtros.genero)
  if (filtros.tipo)   params.set('type',  filtros.tipo.toLowerCase())
  const qs = params.toString()
  const html = await _fetch(`${BASE}/browse${qs ? '?' + qs : ''}`)
  const $ = cheerio.load(html)

  const resultados = []
  $('ul.ListAnimes li').each((_, el) => {
    const a    = $(el).find('a').first()
    const href = a.attr('href') || ''
    const link = href.startsWith('http') ? href : BASE + href
    const img  = $(el).find('img').first()
    const imagen = _img(img.attr('data-src') || img.attr('src') || '')
    const titulo    = $(el).find('.Title').first().text().trim()
    const categoria = $(el).find('.Type').text().trim() || 'Anime'
    if (titulo && link) resultados.push({ titulo, imagen, link, categoria, anio: '', adulto: false })
  })
  return resultados
}

async function getBiblioteca({ query = '', genero = '', tipo = '', estado = '', page = 1 } = {}) {
  const params = new URLSearchParams()
  if (query)  params.set('q',      query)
  if (genero) params.set('genre',  genero)
  if (tipo)   params.set('type',   tipo.toLowerCase())
  if (estado) params.set('status', estado)
  if (page > 1) params.set('page', page)

  const qs = params.toString()
  const html = await _fetch(`${BASE}/browse${qs ? '?' + qs : ''}`)
  const $ = cheerio.load(html)

  const lista = []
  $('ul.ListAnimes li').each((_, el) => {
    const a    = $(el).find('a').first()
    const href = a.attr('href') || ''
    const link = href.startsWith('http') ? href : BASE + href
    const img  = $(el).find('img').first()
    const imagen = _img(img.attr('data-src') || img.attr('src') || '')
    const titulo    = $(el).find('.Title').text().trim()
    const categoria = $(el).find('.Type').text().trim() || 'Anime'
    if (titulo && link) lista.push({ titulo, imagen, link, categoria, anio: '', adulto: false })
  })

  const hayMas = $('ul.pagination li.next a, .pagination .next').length > 0
  return { lista, hayMas, page }
}

async function getAnime(url) {
  const html = await _fetch(url)
  const $ = cheerio.load(html)

  let episodes = null, anime_info = null
  $('script:not([src])').each((_, el) => {
    const code = $(el).html() || ''
    if (code.includes('var episodes'))  episodes   = _jsVar(code, 'episodes')
    if (!anime_info && code.includes('var anime_info')) anime_info = _jsVar(code, 'anime_info')
  })

  const titulo   = $('h1.Title, h2.Title').first().text().trim() ||
                   $('meta[property="og:title"]').attr('content')?.replace(/\s*-\s*AnimeFLV.*/, '').trim() || ''
  const imagen   = _img($('meta[property="og:image"]').attr('content') ||
                   $('div.AnimeCover img, .Image img, figure img').first().attr('src') ||
                   $('div.AnimeCover img, .Image img, figure img').first().attr('data-src') || '')
  const sinopsis = $('div.Description p, .sinopsis').first().text().trim() ||
                   $('meta[property="og:description"]').attr('content') || ''
  const generos  = []
  $('nav.Nvg a, .Nvg a').each((_, el) => { const g = $(el).text().trim(); if (g) generos.push(g) })

  const slug    = url.replace(/^.*\/anime\//, '').replace(/\/$/, '')
  const animeId = Array.isArray(anime_info) ? anime_info[0] : null

  const episodios = []
  if (Array.isArray(episodes)) {
    for (const ep of episodes) {
      const num      = Array.isArray(ep) ? ep[0] : ep
      const imagen_ep = animeId ? `https://cdn.animeflv.net/screenshots/${animeId}/${num}/th_3.jpg` : ''
      episodios.push({ num, link: `${BASE}/ver/${slug}-${num}`, imagen: imagen_ep })
    }
    episodios.sort((a, b) => a.num - b.num)
  }

  return { titulo, imagen, sinopsis, episodios, generos }
}

async function getServidores(url) {
  const html = await _fetch(url)
  const $ = cheerio.load(html)

  let videos = null
  $('script:not([src])').each((_, el) => {
    const code = $(el).html() || ''
    if (!videos && code.includes('var videos')) videos = _jsVar(code, 'videos')
  })

  if (!videos) return []

  const servidores = []
  for (const [tipo, lista] of Object.entries(videos)) {
    if (!Array.isArray(lista)) continue
    for (const item of lista) {
      let serverUrl = item.url || item.code || ''
      if (serverUrl && !serverUrl.startsWith('http')) {
        try { serverUrl = Buffer.from(serverUrl, 'base64').toString('utf-8') } catch(e) {}
      }
      if (!serverUrl) continue
      servidores.push({ nombre: (item.server || item.title || tipo).toLowerCase(), url: serverUrl })
    }
  }
  return servidores
}

module.exports = { BASE, getRecientes, buscar, getBiblioteca, getAnime, getServidores }
