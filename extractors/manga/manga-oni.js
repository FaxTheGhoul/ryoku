'use strict'
// ── Fuente: MangaOni (manga-oni.com) ────────────────────────────────────────────
// A diferencia de NovelCool, esta fuente es 100% server-rendered y no tiene
// Cloudflare en ningún punto -- todo se resuelve con axios + cheerio, SIN
// BrowserWindow:
//  - Búsqueda de texto: GET /buscar?q=texto (SSR, confirmado sin protección).
//  - Catálogo con filtros: GET /directorio?genero=N&estado=N&tipo=N&filtro=X&
//    orden=Y&p=N (SSR). Un solo <select> por filtro, no se pueden combinar
//    varios géneros a la vez (limitación del propio sitio).
//  - Ficha del manga: SÍ trae <meta property="og:image"/"og:description">
//    reales (a diferencia de animeav1, aquí no hace falta ningún fallback
//    raro), géneros+demografía juntos en #categ, estado en span.estado, y la
//    lista COMPLETA de capítulos (sin paginar, confirmado con series de 400+
//    capítulos) en cada <a href="/lector/slug/ID/">.
//  - Páginas de un capítulo: la página del lector trae, en un <script>
//    inline, una variable `unicap` en base64 que al decodificar da
//    "{dir}||{JSON de nombres de archivo}||" -- UN SOLO GET alcanza para
//    tener TODAS las páginas del capítulo ya resueltas (nombres de archivo +
//    query de caché incluidos), sin adivinar el total ni pedir cada página
//    por separado. Confirmado en vivo contra varios mangas y capítulos
//    (incluyendo capítulos con 9 y con 23 páginas).

const axios = require('axios')
const cheerio = require('cheerio')

const BASE = 'https://manga-oni.com'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Referer': BASE + '/',
}

// ─── Mapas: IDs genéricos de la UI (los mismos que ya usa ZonaTMO, ver
// data-gid/data-demo en renderer/index.html) → valores propios de MangaOni ───

// Géneros: la UI manda data-gid 1-19 -- MangaOni tiene su propio
// <select name="genero"> con IDs no correlativos (1-43, confirmado en vivo).
const GID_TO_MO = {
  1: 3,   // Acción
  2: 7,   // Aventura
  3: 1,   // Comedia
  4: 2,   // Drama
  5: 12,  // Fantasía
  6: 5,   // Romance
  7: 36,  // Terror → Horror
  8: 31,  // Sci-Fi → Ciencia ficción
  9: 39,  // Slice of Life → Recuentos de la vida
  10: 18, // Sobrenatural
  11: 10, // Deportes
  12: 43, // Isekai
  13: 27, // Histórico
  14: 17, // Misterio
  15: 11, // Psicológico
  16: 6,  // Ecchi
  17: 21, // Harem
  18: 34, // Magia
  19: 4,  // Escolar
}
// Demografía: 1 Seinen, 2 Shounen, 3 Josei, 4 Shoujo (ver #drop-demo-panel)
// -- MangaOni no separa demografía de género, así que se manda como género.
const DEMO_TO_MO = { 1: 19, 2: 8, 3: 33, 4: 9 }
// Tipo: string genérico ('manga'|'manhwa'|'manhua') → <select name="tipo">
const TIPO_TO_MO = { manga: '0', manhwa: '1', manhua: '3' }
// Estado: string genérico ('updated'|'completed') → <select name="estado">
const ESTADO_TO_MO = { updated: '1', completed: '0' }

// ─── Helpers internos ──────────────────────────────────────────────────────

// Tarjetas de manga: mismo componente en home/directorio (imagen lazy con
// data-src + badge de tipo #in) y en /buscar (imagen directa en src, sin
// badge). Se maneja ambas formas con la misma función.
function _extraerTarjetas($, limite) {
  limite = limite || 60
  const lista = [], vistos = new Set()
  // MangaOni usa un prefijo de URL DISTINTO según el tipo -- /manga/slug/,
  // /manhwa/slug/ y /manhua/slug/ -- confirmado en vivo (antes solo se
  // reconocía /manga/, así que manhwas y manhuas ni aparecían en los
  // listados). El prefijo también es la forma más confiable de sacar el tipo:
  // el badge #in no está presente en /buscar, y el texto de la página completa
  // no sirve (el meta keywords de SEO trae "manhwa" en TODAS las páginas del
  // sitio, sin importar el tipo real del manga).
  const RE_TARJETA = /^\/(manga|manhwa|manhua)\/[^/]+\/?$/
  $('a[itemprop="url"]').each((i, el) => {
    if (lista.length >= limite) return false
    const $a = $(el)
    let link = $a.attr('href') || ''
    if (!link) return
    const path = link.replace(BASE, '')
    const m = path.match(RE_TARJETA)
    if (!m) return
    if (!link.startsWith('http')) link = BASE + link
    if (vistos.has(link)) return
    vistos.add(link)

    const img = $a.find('img[itemprop="image"]').first()
    let imagen = img.attr('data-src') || img.attr('src') || ''
    if (imagen.includes('default.gif')) imagen = ''

    let titulo = $a.find('span').first().text().trim() || img.attr('alt') || ''
    if (!titulo) {
      const slug = path.replace(/^\/(manga|manhwa|manhua)\//, '').replace(/\/$/, '')
      titulo = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }
    titulo = titulo.trim()
    if (!titulo || titulo.length > 180) return

    const tipo = m[1].toUpperCase()

    lista.push({ titulo, link, imagen, cap: '', tipo })
  })
  return lista
}

async function _fetchDirectorio(params, limite) {
  try {
    const { data } = await axios.get(`${BASE}/directorio`, { params, headers: HEADERS, timeout: 12000 })
    return _extraerTarjetas(cheerio.load(data), limite)
  } catch(e) { return [] }
}

// ── Búsqueda por texto: GET /buscar?q=... (SSR, sin Cloudflare) ────────────
async function _apiSearch(query) {
  const q = (query || '').trim()
  if (!q) return []
  try {
    const { data } = await axios.get(`${BASE}/buscar`, { params: { q }, headers: HEADERS, timeout: 10000 })
    return _extraerTarjetas(cheerio.load(data), 48)
  } catch(e) { return [] }
}

// ── API pública ─────────────────────────────────────────────────────────────

// HOME — devuelve { pop:{general,seinen,josei}, trend:{general,seinen,josei}, nuevos }
// MangaOni no separa por demografía en sus listados de recientes/populares
// (a diferencia de zonatmo), así que seinen/josei quedan vacíos -- igual que
// hace NovelCool. "trend" reutiliza el mismo listado que "pop" (MangaOni no
// expone una métrica de tendencia separada de "más vistas").
async function fetchTendencias() {
  try {
    const [nuevos, populares] = await Promise.all([
      _fetchDirectorio({ filtro: 'id', orden: 'desc' }, 18),
      _fetchDirectorio({ filtro: 'visitas', orden: 'desc' }, 18),
    ])
    if (!nuevos.length && !populares.length) return null
    return {
      pop:   { general: populares, seinen: [], josei: [] },
      trend: { general: populares, seinen: [], josei: [] },
      nuevos,
    }
  } catch(e) { return null }
}

// BÚSQUEDA — acepta texto plano, JSON de filtros (mismo formato que ZonaTMO:
// {title, pg, type, demography, genders[], exclude_genders[], status,
// order_item, order_dir}) o navegación "__seccion__orden:pg".
async function buscarManga(query) {
  let _pTitle = '', _filterType = '', _incGenre = null, _estadoVal = null, _pag = 1

  if (query && query.startsWith('{')) {
    let p = {}
    try { p = JSON.parse(query) } catch(e) {}
    _pag = parseInt(p.pg) || 1
    _filterType = (p.type || '').toLowerCase()
    _pTitle = (p.title || '').trim()
    // MangaOni solo permite UN género a la vez -- se usa el primero incluido.
    if (p.genders?.length && GID_TO_MO[p.genders[0]] != null) _incGenre = GID_TO_MO[p.genders[0]]
    if (_incGenre == null && p.demography && DEMO_TO_MO[p.demography] != null) _incGenre = DEMO_TO_MO[p.demography]
    if (p.status && ESTADO_TO_MO[p.status] != null) _estadoVal = ESTADO_TO_MO[p.status]
  } else if (query && query.startsWith('__seccion__')) {
    const parte = query.replace('__seccion__', '')
    const partes = parte.split(':')
    _pag = parseInt(partes[1]) || 1
  } else if (query) {
    _pTitle = query.trim()
  }

  // Texto libre: MangaOni no permite combinar título + género/tipo en la URL
  // del directorio -- se busca por texto y se filtra tipo en cliente (igual
  // que NovelCool con sus filtros combinados).
  if (_pTitle) {
    let lista = await _apiSearch(_pTitle)
    if (_filterType) lista = lista.filter(m => (m.tipo || '').toLowerCase() === _filterType)
    return lista
  }

  const params = {}
  if (_pag > 1) params.p = _pag
  if (_incGenre != null) params.genero = _incGenre
  if (_estadoVal != null) params.estado = _estadoVal
  if (_filterType && TIPO_TO_MO[_filterType] != null) params.tipo = TIPO_TO_MO[_filterType]
  // Sin ningún filtro (aparte de página): mostrar recientes por defecto en
  // vez del orden crudo del directorio.
  const soloPagina = Object.keys(params).every(k => k === 'p')
  if (soloPagina) { params.filtro = 'id'; params.orden = 'desc' }

  return _fetchDirectorio(params, 48)
}

// Alias de biblioteca (mismo formato de params que buscarManga con JSON)
async function getBiblioteca(opts) {
  return buscarManga(JSON.stringify(opts || {}))
}

// FICHA — portada/sinopsis vía meta tags reales, géneros+demografía de
// #categ, estado de span.estado, capítulos completos (sin paginar) de cada
// <a href="/lector/...">.
async function getDetalle(url, tituloFallback) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 })
    const $ = cheerio.load(data)

    let titulo = $('h1').first().text().trim()
    if (!titulo) titulo = ($('meta[property="og:title"]').attr('content') || '').trim()
    if (!titulo) titulo = tituloFallback || ''

    const imagen = $('meta[property="og:image"]').attr('content') || ''

    let sinopsis = ($('meta[property="og:description"]').attr('content') || '').trim()
    if (sinopsis.length < 20) {
      sinopsis = $('#sinopsis, [class*="sinopsis"], [class*="description"]').first().text().trim() || sinopsis
    }

    // Géneros + demografía: ambos viven juntos en #categ (ej: "Comedia
    // Acción Escolar Shōnen Fantasía Ficción") -- MangaOni no los separa.
    const DEMOS = new Set(['Shōnen', 'Shounen', 'Seinen', 'Shōjo', 'Shoujo', 'Josei'])
    const generos = [], demoTags = []
    $('#categ a').each((i, el) => {
      const g = $(el).text().trim()
      if (!g) return
      if (DEMOS.has(g)) { if (!demoTags.includes(g)) demoTags.push(g) }
      else if (!generos.includes(g)) generos.push(g)
    })

    const estado = $('span.estado').first().text().trim()

    // Tipo: se saca del propio prefijo de la URL de la ficha
    // (/manga/, /manhwa/ o /manhua/ -- confirmado en vivo que MangaOni usa un
    // prefijo distinto por tipo). NO se puede inferir buscando "manhwa"/
    // "manhua" en el HTML completo: el <meta name="keywords"> de SEO trae la
    // palabra "manhwa" en TODAS las páginas del sitio sin importar el tipo
    // real, lo que causaba falsos positivos (mangas detectados como manhwa).
    let tipo = 'MANGA'
    if (/\/manhwa\//i.test(url)) tipo = 'MANHWA'
    else if (/\/manhua\//i.test(url)) tipo = 'MANHUA'
    else {
      // Fallback por si la URL no sigue la convención (ej: venía sin el
      // prefijo correcto): el badge de la portada (a.portada > span) sí es
      // específico de esta ficha, a diferencia del texto de toda la página.
      const badge = $('a.portada span').first().text().trim().toUpperCase()
      if (badge === 'MANHWA' || badge === 'MANHUA') tipo = badge
    }

    // Capítulos: cada <a href="/lector/slug/ID/"> trae en su propio texto
    // "Hace X ... Capítulo N [— Título]" -- se recorren TODOS de una sola
    // pasada, sin paginar (confirmado con series de 400+ capítulos).
    const capitulos = [], vistos = new Set()
    $('a[href*="/lector/"]').each((i, el) => {
      const href = $(el).attr('href') || ''
      if (!href.includes('/lector/')) return
      const link = href.startsWith('http') ? href : BASE + href
      if (vistos.has(link)) return
      vistos.add(link)

      const texto = $(el).text().replace(/\s+/g, ' ').trim()
      const numMatch = texto.match(/Cap[ií]tulo\s+(\d+(?:\.\d+)?)/i)
      if (!numMatch) return
      const num = numMatch[1]

      const fechaMatch = texto.match(/^(Hace\s+.+?)\s*Cap[ií]tulo/i)
      const fecha = fechaMatch ? fechaMatch[1].trim() : ''

      const tituloCapMatch = texto.match(/—\s*(.+?)\s*(?:Reciente)?$/)
      const tituloCap = tituloCapMatch ? tituloCapMatch[1].trim() : ''

      capitulos.push({ num, link, fecha, titulo: tituloCap })
    })
    capitulos.sort((a, b) => parseFloat(b.num) - parseFloat(a.num))

    return { titulo, imagen, sinopsis, generos: generos.slice(0, 8), demografia: demoTags[0] || '', capitulos, estado, tipo }
  } catch(e) { return null }
}

// PÁGINAS — la página del lector trae, en un <script> inline, una variable
// `unicap` en base64 que al decodificar da "{dir}||{JSON de archivos}||".
// Un solo GET alcanza -- no hace falta ni el total de páginas ni pedir cada
// una por separado (a diferencia de NovelCool, que sí necesita eso).
async function getPaginas(url) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 12000 })
    const m = data.match(/var\s+unicap\s*=\s*'([^']+)'/)
    if (!m) return []
    let decoded = ''
    try { decoded = Buffer.from(m[1], 'base64').toString('utf8') } catch(e) { return [] }
    const partes = decoded.split('||')
    const dir = partes[0] || ''
    if (!dir) return []
    let hojas = []
    try { hojas = JSON.parse(partes[1] || '[]') } catch(e) { return [] }
    if (!Array.isArray(hojas) || !hojas.length) return []
    return hojas.map(h => dir + h)
  } catch(e) { return [] }
}

module.exports = { BASE, fetchTendencias, buscarManga, getBiblioteca, getDetalle, getPaginas }
