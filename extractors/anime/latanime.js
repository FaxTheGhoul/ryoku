'use strict'
// ─── extractors/anime/latanime.js ─────────────────────────────────────────────
// Fuente: latanime.org

const axios   = require('axios')
const cheerio = require('cheerio')

const BASE = 'https://latanime.org'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': 'https://latanime.org/',
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function _extraerSinopsisHtml($) {
  // 1. Intentar selectores específicos del cuerpo
  const selectores = [
    '.sinopsis p', '.Description p', '.descripcion p',
    '.sinopsis', '.Description', '.descripcion',
    '[class*="sinopsis"]', '[class*="descripcion"]', '[class*="description"]',
    '.anime-info p', '.info-content p', '.anime-description p',
  ]
  for (const sel of selectores) {
    const textos = []
    $(sel).each((_, el) => {
      const t = $(el).text().trim()
      if (t) textos.push(t)
    })
    if (textos.length) {
      const joined = textos.join(' ').trim()
      if (joined.length > 80) return joined
    }
  }
  // 2. Fallback: párrafo más largo del cuerpo (latanime usa <p> sin clase)
  let mejor = ''
  $('p').each((_, el) => {
    if ($(el).closest('nav, footer, aside, header, .nav, .footer, .menu, .copyright, script, style').length) return
    const t = $(el).text().trim()
    if (t.length > mejor.length) mejor = t
  })
  if (mejor.length > 80) return mejor
  return ''
}

async function _getSinopsis(url) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 })
    const $ = cheerio.load(data)
    const pagina = _extraerSinopsisHtml($)
    if (pagina) return pagina
    const s = $('meta[property="og:description"]').attr('content') || ''
    return s.replace(/Todos los anime.*sin limites\./i, '').replace(/Para descargar.*sin limites\./i, '').trim()
  } catch(e) { return '' }
}

async function _getSinopsisAF(titulo) {
  try {
    const q = titulo.replace(/\s+(Latino|Castellano)$/i, '').replace(/\s+S\d+$/i, '').trim()
    const { data } = await axios.get(
      `https://www3.animeflv.net/browse?q=${encodeURIComponent(q)}`,
      { headers: HEADERS, timeout: 5000 }
    )
    const $ = cheerio.load(data)
    const link = $('ul.ListAnimes li a').first().attr('href')
    if (!link) return ''
    const { data: page } = await axios.get(`https://www3.animeflv.net${link}`, { headers: HEADERS, timeout: 5000 })
    return cheerio.load(page)('.sinopsis p, .Description p').first().text().trim() || ''
  } catch(e) { return '' }
}

async function _getImagenAnilist(titulo) {
  try {
    const query = `query ($s: String) { Media(search: $s, type: ANIME) { coverImage { large } } }`
    const { data } = await axios.post(
      'https://graphql.anilist.co',
      { query, variables: { s: titulo } },
      { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
    )
    return data?.data?.Media?.coverImage?.large || ''
  } catch(e) { return '' }
}

const CATS = [
  'Latino Sin Censura','Castellano Sin Censura','Sin Censura',
  'Pelicula Latino','Pelicula Castellano','Ova Latino','Ova Castellano',
  'Live Action','Donghua','Cartoon','Aenime',
  'Latino','Castellano','Anime','Ova','Película','Especial'
]
const ADULTO_SLUGS = [
  'sin-censura','uncensored','hentai','overflow-','desbordandose',
  'venida-de-altura','gran-jefe-latino','grande-jefe-latino',
  'souryo-to-majiwaru','ane-naru-mono','tropical-kiss','secret-journey',
  'aki-sora','oni-chichi','nuki-doki','yariman','erotica','eroge',
  'namaiki','gakuen-de-jikan','ane-to-boin','oppai-no-ouja','majuu-jouka',
]
function _esAdulto(titulo, link) {
  const t = (titulo || '').toLowerCase(), l = (link || '').toLowerCase()
  if (t.includes('hentai') || l.includes('hentai')) return true
  if (l.includes('sin-censura') || t.includes('sin censura')) return true
  return ADULTO_SLUGS.some(s => l.includes(s))
}

function _extraerAnimes($) {
  const lista = [], vistos = new Set()
  $('a[href*="/anime/"]').each((i, el) => {
    if (lista.length >= 96) return false
    const link = $(el).attr('href')
    if (!link || vistos.has(link)) return
    vistos.add(link)
    const img    = $(el).find('img').first()
    const imagen = img.attr('data-src') || img.attr('src') || ''
    let titulo   = $(el).find('h3,h2,.title').first().text().trim() || img.attr('alt')?.trim() || ''
    const txt    = $(el).text()
    let categoria = ''
    for (const cat of CATS) { if (txt.includes(cat)) { categoria = cat; break } }
    if (!categoria) {
      if (link.toLowerCase().includes('-castellano')) categoria = 'Castellano'
      else if (link.toLowerCase().includes('-latino')) categoria = 'Latino'
    }
    const anioMatch = txt.match(/\b(19[89]\d|20[0-3]\d)\b/)
    const adulto = categoria.includes('Sin Censura') || _esAdulto(titulo, link)
    if (titulo && link) lista.push({ titulo, imagen, link, categoria, anio: anioMatch?.[1] || '', adulto })
  })
  return lista
}

// ─── API pública ──────────────────────────────────────────────────────────────

async function getRecientes() {
  const { data } = await axios.get(BASE, { headers: HEADERS })
  const $ = cheerio.load(data)

  // Slider
  const slider = [], sliderVistos = new Set()
  $('a[href*="/anime/"]').each((i, el) => {
    if (slider.length >= 17) return false
    const link = $(el).attr('href') || ''
    if (!link.includes('/anime/') || sliderVistos.has(link)) return
    sliderVistos.add(link)
    const img    = $(el).find('img').first()
    let imagen = img.attr('data-src') || img.attr('src') || ''
    if (imagen && imagen.startsWith('/')) imagen = BASE + imagen
    if (!imagen || imagen.includes('logito') || imagen.includes('web.jpg') || imagen.includes('monitos')) return
    const slug = link.split('/anime/')[1] || ''
    let idioma = slug.includes('-latino') ? 'Latino' : slug.includes('-castellano') ? 'Castellano' : ''
    let titulo = img.attr('alt')?.trim() || $(el).find('h2, h3').first().text().trim() || ''
    if (titulo) {
      const words = titulo.split(' ')
      const halfLen = Math.ceil(words.length / 2)
      const firstHalf = words.slice(0, halfLen).join(' ')
      if (words.slice(halfLen).join(' ').startsWith(firstHalf.slice(0, 20))) titulo = firstHalf
    }
    if (titulo.length > 65) titulo = titulo.slice(0, 65).trimEnd() + '…'
    let desc = ''
    $(el).find('p').each((_, p) => {
      const t = $(p).text().trim()
      if (t && !titulo.toLowerCase().startsWith(t.toLowerCase().slice(0, 15))) { desc = t.slice(0, 150); return false }
    })
    if (titulo) slider.push({ titulo, imagen, link, idioma, desc })
  })

  // Lista recientes (episodios)
  const lista = [], vistos = new Set()
  $('a[href*="/ver/"]').each((i, el) => {
    if (lista.length >= 40) return false
    const link = $(el).attr('href') || ''
    if (!link || vistos.has(link)) return
    vistos.add(link)
    const slug     = link.split('/ver/')[1] || ''
    const epMatch  = slug.match(/-episodio-(\d+)$/)
    const epNum    = epMatch ? epMatch[1] : ''
    const nombreSlug = slug.replace(/-episodio-\d+$/, '').replace(/-/g, ' ')
    let idioma = nombreSlug.includes(' latino') ? 'Latino' : nombreSlug.includes(' castellano') ? 'Castellano' : nombreSlug.includes(' sub') ? 'Sub' : ''
    const titulo = nombreSlug
      .replace(/ latino$/, '').replace(/ castellano$/, '').replace(/ sub$/, '')
      .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').trim()
    const fecha  = $(el).find('time, .date, span').last().text().trim()
    const img    = $(el).find('img').first()
    const imagen = img.attr('data-src') || img.attr('src') || ''
    if (titulo) lista.push({ titulo, link, ep: epNum ? `Ep ${epNum}` : '', idioma, imagen, fecha })
  })

  // Series recientes (últimos 12 links /anime/ únicos)
  const todosAnimeLinks = []
  $('a[href*="/anime/"]').each((i, el) => {
    const link = $(el).attr('href') || ''
    if (!link.includes('/anime/')) return
    const img    = $(el).find('img').first()
    const imagen = img.attr('data-src') || img.attr('src') || ''
    const tituloEl = $(el).find('h2, h3, .title, p, span').first()
    let titulo = tituloEl.text().trim() || img.attr('alt')?.trim() || ''
    const mitad = Math.ceil(titulo.length / 2)
    if (titulo.slice(0, mitad).trim() === titulo.slice(mitad).trim()) titulo = titulo.slice(0, mitad).trim()
    if (titulo.length > 60) titulo = titulo.slice(0, 60).trimEnd() + '…'
    const slug = link.split('/anime/')[1] || ''
    const idioma = slug.includes('-latino') ? 'Latino' : slug.includes('-castellano') ? 'Castellano' : ''
    if (titulo) todosAnimeLinks.push({ titulo, imagen, link, idioma })
  })
  const series = [], setParaSeries = new Set()
  for (const s of [...todosAnimeLinks].reverse()) {
    if (setParaSeries.has(s.link)) continue
    setParaSeries.add(s.link)
    series.unshift(s)
    if (series.length >= 12) break
  }

  return { slider, lista, series }
}

async function buscar(query, filtros = {}) {
  const { categoria, emision, genero } = filtros
  let resultados = []
  if (emision) {
    const res = await axios.get(`${BASE}/emision`, { headers: HEADERS })
    resultados = _extraerAnimes(cheerio.load(res.data))
  } else if (genero) {
    const slug = genero.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,'-')
    const res  = await axios.get(`${BASE}/genero/${slug}`, { headers: HEADERS, timeout: 10000 })
    resultados = _extraerAnimes(cheerio.load(res.data))
  } else if (query?.trim()) {
    const res  = await axios.get(`${BASE}/buscar`, { params: { q: query.trim() }, headers: { ...HEADERS, 'Accept-Encoding': 'identity' } })
    resultados = _extraerAnimes(cheerio.load(res.data))
  } else {
    const res  = await axios.get(`${BASE}/animes`, { headers: HEADERS })
    resultados = _extraerAnimes(cheerio.load(res.data))
  }
  if (categoria) {
    const cat = categoria.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    resultados = resultados.filter(r => (r.titulo + ' ' + (r.categoria||'')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').includes(cat))
  }
  return resultados.slice(0, 48)
}

async function getBiblioteca({ query, categoria, genero, emision, page } = {}) {
  const p = Math.max(1, parseInt(page) || 1)
  let url, params = {}
  if (emision) {
    url = `${BASE}/emision`
  } else if (genero?.trim()) {
    url = `${BASE}/genero/${encodeURIComponent(genero.trim())}`
    if (p > 1) params.p = p
  } else if (query?.trim()) {
    url = `${BASE}/buscar`; params = { q: query.trim() }
    if (p > 1) params.p = p
  } else {
    url = `${BASE}/animes`
    if (p > 1) params.p = p
  }
  const res = await axios.get(url, { params, headers: { ...HEADERS, 'Accept-Encoding': 'identity' }, timeout: 12000 })
  let resultados = _extraerAnimes(cheerio.load(res.data))
  if (categoria) {
    const cat = categoria.toLowerCase().replace(/[áéíóú]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u'}[c]))
    resultados = resultados.filter(r => (r.titulo + ' ' + (r.categoria||'')).toLowerCase().replace(/[áéíóú]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u'}[c])).includes(cat))
  }
  return { lista: resultados, hayMas: resultados.length >= 24 && !emision, page: p }
}

async function getAnime(url, { coverCache, jikanBuscar } = {}) {
  const slugBase  = url.split('/anime/')[1]?.replace(/-(latino|castellano)$/, '') || ''
  const cacheKey  = slugBase
  const cachedImg = coverCache?.get(cacheKey)

  const urlsAProbar = [
    `${BASE}/anime/${slugBase}-latino`,
    `${BASE}/anime/${slugBase}-castellano`,
    url
  ]

  let html = null
  for (const u of urlsAProbar) {
    try {
      const res = await axios.get(u, { headers: HEADERS, timeout: 8000 })
      if (res.status === 200) { html = res.data; break }
    } catch(e) { continue }
  }
  if (!html) return null

  const $ = cheerio.load(html)
  let titulo = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || ''
  titulo = titulo.replace(/\s*[—–|-]\s*(Latanime|Ver Anime|Online).*/i,'').replace(/\s*\|\s*Latanime.*/i,'').trim()

  const tituloLimpio = titulo.replace(/\s+(Latino|Castellano)$/i,'').replace(/\s+S\d+$/i,'').trim()
  const slugTitulo   = slugBase.replace(/-/g,' ')

  let imagen   = cachedImg || $('meta[property="og:image"]').attr('content') || ''

  // Intentar primero selectores del cuerpo (sinopsis completa)
  let sinopsis = _extraerSinopsisHtml($)
  if (!sinopsis) {
    sinopsis = ($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '')
      .replace(/Todos los anime.*sin limites\./i,'').replace(/Para descargar.*sin limites\./i,'').trim()
  }

  if (!sinopsis || sinopsis.length < 80) {
    for (const u of urlsAProbar.slice(1)) {
      const s = await _getSinopsis(u)
      if (s && s.length > 80) { sinopsis = s; break }
    }
  }
  if (!sinopsis || sinopsis.length < 80) {
    sinopsis = await _getSinopsisAF(tituloLimpio) || await _getSinopsisAF(slugTitulo) || sinopsis
  }

  // Último recurso: sinopsis de MyAnimeList vía Jikan (ya obtenida al buscar géneros)
  if ((!sinopsis || sinopsis.length < 80) && jikanBuscar) {
    try {
      const mal = await jikanBuscar(tituloLimpio)
      if (mal?.sinopsis && mal.sinopsis.length > 80) sinopsis = mal.sinopsis
    } catch(e) {}
  }
  if (!imagen || imagen.includes('web.jpg')) {
    for (const t of [tituloLimpio, slugTitulo, titulo]) {
      const img = await _getImagenAnilist(t)
      if (img) { imagen = img; break }
    }
  }
  if (imagen && coverCache) { coverCache.set(cacheKey, imagen) }

  const episodios = [], vistos = new Set()
  $('a[href*="/ver/"]').each((i, el) => {
    const link = $(el).attr('href') || ''
    if (vistos.has(link)) return
    vistos.add(link)
    const epMatch = link.match(/-episodio-(\d+)/)
    const num     = epMatch ? parseInt(epMatch[1]) : i + 1
    const imgEl   = $(el).find('img').first()
    // Probar todos los atributos de lazy-load conocidos
    let imgSrc = imgEl.attr('data-src') || imgEl.attr('data-lazy-src') || imgEl.attr('data-lazy') ||
                 imgEl.attr('data-original') || imgEl.attr('src') || ''
    // Descartar placeholders (data URIs, SVGs genéricos, rutas de loading)
    if (imgSrc && (imgSrc.startsWith('data:') || imgSrc.includes('loading') || imgSrc.includes('placeholder'))) {
      imgSrc = ''
    }
    // Si no hay img dentro del <a>, buscar en el elemento padre
    if (!imgSrc) {
      const parentImg = $(el).parent().find('img').first()
      imgSrc = parentImg.attr('data-src') || parentImg.attr('data-lazy-src') || parentImg.attr('src') || ''
      if (imgSrc && (imgSrc.startsWith('data:') || imgSrc.includes('loading') || imgSrc.includes('placeholder'))) {
        imgSrc = ''
      }
    }
    episodios.push({ num, link, imagen: imgSrc })
  })
  episodios.sort((a, b) => a.num - b.num)

  let generos = []
  try {
    if (jikanBuscar) {
      const mal = await jikanBuscar(tituloLimpio)
      if (mal?.generos?.length) generos = mal.generos
    }
  } catch(e) {}

  return { titulo, imagen, sinopsis, episodios, generos }
}

async function getServidores(url) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 })
    const $ = cheerio.load(data)
    const servidores = []
    $('[data-player]').each((i, el) => {
      const b64    = $(el).attr('data-player')
      const nombre = $(el).text().trim() || `Servidor ${i + 1}`
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf8')
        if (decoded.startsWith('http')) servidores.push({ nombre: nombre.toLowerCase(), url: decoded })
      } catch(e) {}
    })
    if (!servidores.length) {
      $('iframe[src]').each((i, el) => {
        const src = $(el).attr('src') || ''
        if (src.startsWith('http')) servidores.push({ nombre: `servidor ${i + 1}`, url: src })
      })
    }
    const orden = ['mp4upload','dsvplay','voe','mixdrop','hexload','streamtape']
    servidores.sort((a, b) => {
      const ia = orden.findIndex(p => a.nombre.includes(p))
      const ib = orden.findIndex(p => b.nombre.includes(p))
      if (ia === -1 && ib === -1) return 0
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
    return servidores
  } catch(e) { return [] }
}

module.exports = { BASE, getRecientes, buscar, getBiblioteca, getAnime, getServidores }
