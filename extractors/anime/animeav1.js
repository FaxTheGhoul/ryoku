'use strict'
// ─── extractors/anime/animeav1.js ──────────────────────────────────────────────
// Fuente: animeav1.com
//
// A diferencia de latanime/monoschinos, esta fuente expone:
//  - Una API de búsqueda JSON directa (POST /api/search) -- sin HTML que parsear.
//  - Un catálogo (/catalogo) completamente server-rendered, con filtros por
//    categoría/género/estado y paginación vía ?page=N (20 resultados/página).
//  - Cada página de episodio trae, ya embebido en el HTML como un objeto JS
//    (SvelteKit), TODOS los servidores de una (DUB y SUB) -- un solo GET por
//    episodio alcanza, sin clicks ni peticiones extra.
// Nada de esto pasa por Cloudflare, EXCEPTO el servidor por defecto "HLS"
// (player.zilla-networks.com), que sí está protegido -- se excluye de
// getServidores() porque no hay resolver capaz de pasarlo (necesitaría un
// BrowserWindow real, como monoschinos). El resto de servidores (Voe,
// MP4Upload, StreamTape, YourUpload, UPNShare) son hosts genéricos que ya
// resuelve extractors/anime/index.js.

const axios   = require('axios')
const cheerio = require('cheerio')

const BASE = 'https://animeav1.com'
const CDN  = 'https://cdn.animeav1.com'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': BASE + '/',
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function _cover(id) { return id ? `${CDN}/covers/${id}.jpg` : '' }

function _slugGenero(g) {
  return (g || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

const CATEGORIA_SLUGS = {
  'tv anime': 'tv-anime', 'tv': 'tv-anime', 'serie': 'tv-anime',
  'pelicula': 'pelicula', 'película': 'pelicula', 'movie': 'pelicula',
  'ova': 'ova', 'especial': 'especial', 'ona': 'ona',
}
function _slugCategoria(c) {
  const k = (c || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  return CATEGORIA_SLUGS[k] || ''
}

// ── Búsqueda por texto: API JSON directa, sin HTML que parsear ────────────────
async function _apiSearch(query) {
  const q = (query || '').trim()
  if (!q) return []
  try {
    const { data } = await axios.post(`${BASE}/api/search`,
      { query: q },
      { headers: { ...HEADERS, 'Content-Type': 'application/json' }, timeout: 8000 })
    if (!Array.isArray(data)) return []
    return data
      .map(r => ({
        titulo: r.title || '',
        imagen: _cover(r.id),
        link: `${BASE}/media/${r.slug}`,
        categoria: '', anio: '', adulto: false,
      }))
      .filter(r => r.titulo && r.link)
  } catch(e) { return [] }
}

// ── Catálogo: tarjetas server-rendered en /catalogo ────────────────────────────
function _extraerCatalogo($) {
  const lista = [], vistos = new Set()
  $('article').each((i, el) => {
    const a = $(el).find('a[href^="/media/"]').first()
    let link = a.attr('href') || ''
    if (!link || vistos.has(link)) return
    // Solo tarjetas de ficha (/media/slug), no de episodio (/media/slug/N)
    if (/\/media\/[^/]+\/\d+$/.test(link)) return
    vistos.add(link)
    const img    = $(el).find('img').first()
    const imagen = img.attr('src') || ''
    const titulo = $(el).find('h3').first().text().trim()
    const categoria = $(el).find('[class*="rounded-se-lg"]').first().text().trim()
    if (titulo) lista.push({ titulo, imagen, link: BASE + link, categoria, anio: '', adulto: false })
  })
  return lista
}

async function getBiblioteca({ query, categoria, genero, emision, page } = {}) {
  const p = Math.max(1, parseInt(page) || 1)
  if (query?.trim()) {
    // La API de búsqueda ya trae los mejores matches de una -- no pagina.
    const resultados = p === 1 ? await _apiSearch(query) : []
    return { lista: resultados, hayMas: false, page: p }
  }
  const params = {}
  if (p > 1) params.page = p
  const catSlug = _slugCategoria(categoria)
  if (catSlug) params.category = catSlug
  if (genero?.trim()) params.genre = _slugGenero(genero)
  if (emision) params.status = 'emision'
  try {
    const res = await axios.get(`${BASE}/catalogo`, { params, headers: HEADERS, timeout: 12000 })
    const resultados = _extraerCatalogo(cheerio.load(res.data))
    return { lista: resultados, hayMas: resultados.length >= 20, page: p }
  } catch(e) { return { lista: [], hayMas: false, page: p } }
}

async function buscar(query, filtros = {}) {
  const { categoria, emision, genero } = filtros
  if (query?.trim()) return (await _apiSearch(query)).slice(0, 48)
  const r = await getBiblioteca({ categoria, genero, emision, page: 1 })
  return (r.lista || []).slice(0, 48)
}

// ── Recientes (home): hero + episodios recién agregados + series derivadas ────
async function getRecientes() {
  try {
    const { data } = await axios.get(BASE, { headers: HEADERS, timeout: 12000 })
    const $ = cheerio.load(data)

    // Slider: carrusel principal (hero, un <article> con <h1> por slide)
    const slider = []
    $('h1').each((i, el) => {
      if (slider.length >= 10) return
      const $h1 = $(el)
      const art = $h1.closest('article')
      if (!art.length) return
      const titulo = $h1.text().trim()
      const link   = art.find('a[href^="/media/"]').first().attr('href') || ''
      const imagen = art.find('img').first().attr('src') || ''
      let desc = ''
      art.find('p').each((_, p) => { const t = $(p).text().trim(); if (t.length > desc.length) desc = t })
      if (titulo && link) slider.push({ titulo, imagen, link: BASE + link, idioma: '', desc: desc.slice(0, 150) })
    })

    // Lista: episodios recientemente actualizados (tarjetas /media/slug/N)
    const lista = [], vistos = new Set()
    $('article').each((i, el) => {
      if (lista.length >= 40) return
      const $el = $(el)
      const link = $el.find('a[href^="/media/"]').first().attr('href') || ''
      const epMatch = link.match(/\/media\/[^/]+\/(\d+)$/)
      if (!epMatch || vistos.has(link)) return
      vistos.add(link)
      const imagen = $el.find('img').first().attr('src') || ''
      const titulo = $el.find('header div').first().text().trim()
      const fecha  = $el.find('figure span').first().text().trim()
      if (titulo) lista.push({ titulo, link: BASE + link, ep: `Ep ${epMatch[1]}`, idioma: '', imagen, fecha })
    })

    // Series: la home trae un widget aparte llamado "Animes" (distinto del
    // de "Episodios") con tarjetas de FICHA que sí traen la portada real
    // (article > img[alt^="Portada de "] + h3 + link a /media/slug SIN
    // número de episodio) -- confirmado en vivo. Antes esto se deducía de
    // `lista` (episodios recientes), lo que terminaba repitiendo la miniatura
    // del episodio como si fuera portada. _extraerCatalogo ya filtra por esa
    // misma forma de tarjeta (excluye links /media/slug/N), así que se
    // reutiliza tal cual sobre el HTML de la home.
    const series = _extraerCatalogo($).slice(0, 12).map(s => ({ titulo: s.titulo, imagen: s.imagen, link: s.link, idioma: '' }))

    return { slider, lista, series }
  } catch(e) { return { slider: [], lista: [], series: [] } }
}

// ── Ficha de anime ──────────────────────────────────────────────────────────
async function getAnime(url) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 })
    const $ = cheerio.load(data)

    const titulo = $('h1').first().text().trim()

    // animeav1 NO trae <meta property="og:image"> -- la portada solo existe
    // como <img alt="{título} Portada" src="https://cdn.animeav1.com/covers/ID.jpg">
    // en el HTML. Se busca por ese alt (más preciso que agarrar el primer
    // /covers/ de la página, que podría pertenecer a un anime relacionado).
    let imagen = $('img[alt$="Portada"]').first().attr('src') || ''
    if (!imagen) {
      const coverMatch = data.match(/https:\/\/cdn\.animeav1\.com\/covers\/\d+\.jpg/)
      if (coverMatch) imagen = coverMatch[0]
    }

    // Tampoco hay <meta property="og:description"> con la sinopsis real -- la
    // única <meta name="description"> es una frase genérica de SEO ("Mira
    // todos los episodios de X..."), no la sinopsis del anime. La sinopsis
    // real sí está en el objeto embebido (SvelteKit) como synopsis:"...".
    let sinopsis = ''
    const synMatch = data.match(/synopsis:"((?:\\.|[^"\\])*)"/)
    if (synMatch) {
      try { sinopsis = JSON.parse('"' + synMatch[1] + '"').trim() } catch(e) {}
    }
    if (!sinopsis) {
      sinopsis = ($('meta[property="og:description"]').attr('content') ||
                   $('meta[name="description"]').attr('content') || '').trim()
    }
    if (!sinopsis || sinopsis.length < 80) {
      let mejor = ''
      $('p').each((_, el) => {
        if ($(el).closest('nav, footer, aside, header, .nav, .footer, .menu, script, style').length) return
        const t = $(el).text().trim()
        if (t.length > mejor.length) mejor = t
      })
      if (mejor.length > sinopsis.length) sinopsis = mejor
    }

    const slug = url.split('/media/')[1]?.split('/')[0]?.split('?')[0] || ''
    const countMatch = data.match(/episodesCount:(\d+)/)
    const episodesCount = countMatch ? parseInt(countMatch[1], 10) : 0

    // Miniatura por episodio: cada uno tiene un screenshot real en
    //   https://cdn.animeav1.com/screenshots/{mediaId}/{numeroEpisodio}.jpg
    // donde mediaId es el MISMO id numérico que usa la portada
    // (covers/{mediaId}.jpg) -- confirmado en vivo contra el sitio. Si por lo
    // que sea no se pudo sacar el id de la portada, se deja sin miniatura
    // propia y el renderer cae de vuelta a la portada general del anime.
    const mediaIdMatch = imagen.match(/covers\/(\d+)\.jpg/)
    const mediaId = mediaIdMatch ? mediaIdMatch[1] : ''
    const epImagen = n => mediaId ? `${CDN}/screenshots/${mediaId}/${n}.jpg` : ''

    const episodios = []
    for (let n = 1; n <= episodesCount; n++) {
      episodios.push({ num: n, link: `${BASE}/media/${slug}/${n}`, imagen: epImagen(n) })
    }
    if (!episodios.length && slug) {
      // Fallback si no se pudo leer episodesCount: usar los links visibles en el HTML
      const vistos = new Set()
      const re = new RegExp(`/media/${slug}/(\\d+)$`)
      $('a[href*="/media/"]').each((i, el) => {
        const href = $(el).attr('href') || ''
        const m = href.match(re)
        if (m && !vistos.has(m[1])) { vistos.add(m[1]); episodios.push({ num: parseInt(m[1], 10), link: BASE + href, imagen: epImagen(parseInt(m[1], 10)) }) }
      })
      episodios.sort((a, b) => a.num - b.num)
    }

    return { titulo, imagen, sinopsis, episodios }
  } catch(e) { return null }
}

// ── Servidores de un episodio ───────────────────────────────────────────────
// Cada página de episodio trae embebido, sin comillas en las claves (objeto JS
// serializado por SvelteKit, no JSON), algo como:
//   embeds:{DUB:[{server:"HLS",url:"..."},{server:"Voe",url:"..."}],SUB:[...]}
// Se extrae balanceando llaves para aislar ese bloque y luego con una regex
// puntual sobre los pares {server:"...",url:"..."} que contiene.
async function getServidores(url) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 10000 })

    const embedsIdx = data.indexOf('embeds:{')
    if (embedsIdx === -1) return []
    let depth = 1, end = -1
    for (let i = embedsIdx + 8; i < data.length; i++) {
      const c = data[i]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    const bloque = end === -1 ? data.slice(embedsIdx, embedsIdx + 6000) : data.slice(embedsIdx, end + 1)
    // Idioma de cada servidor = la lista (SUB:[...] / DUB:[...]) en la que
    // está. Antes se asumía que DUB venía siempre antes que SUB ("todo lo que
    // está después de SUB es sub"); cuando la página trae SUB primero, los
    // latinos quedaban después y salían todos etiquetados como "sub".
    const marcas = []
    const reMarca = /\b([A-Z]{2,4})\s*:\s*\[/g
    let mk
    while ((mk = reMarca.exec(bloque))) marcas.push({ pos: mk.index, idioma: mk[1] === 'SUB' ? 'sub' : 'latino' })
    const idiomaEn = pos => { let l = 'sub'; for (const x of marcas) if (x.pos <= pos) l = x.idioma; return l }

    const servidores = []
    const re = /\{server:"([^"]+)",url:"([^"]*)"\}/g
    let m
    while ((m = re.exec(bloque))) {
      const nombre = (m[1] || '').toLowerCase()
      const srvUrl = m[2] || ''
      if (!srvUrl || nombre === 'hls') continue // Cloudflare, sin resolver -- se descarta
      const idioma = idiomaEn(m.index)
      servidores.push({ nombre: `${nombre} ${idioma}`, url: srvUrl, idioma })
    }

    const orden = ['mp4upload', 'voe', 'streamtape', 'yourupload', 'upnshare']
    // Subtitulados primero, latino después; dentro de cada grupo, el orden
    // de proveedores de siempre.
    servidores.sort((a, b) => {
      if (a.idioma !== b.idioma) return a.idioma === 'sub' ? -1 : 1
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

// ── Calendario ("Horario") ──────────────────────────────────────────────────
// /horario es una página SvelteKit renderizada 100% client-side: el HTML
// crudo no trae los datos del listado (solo las etiquetas de los 7 botones de
// día), así que no sirve pedirla con axios+cheerio como el resto del sitio.
// SvelteKit sí expone la data de cualquier ruta en un endpoint hermano
// {ruta}/__data.json -- confirmado en vivo que /horario/__data.json responde
// 200 con JSON sin necesitar sesión/cookies. El JSON usa el formato
// "devalue" de SvelteKit: un array plano de valores donde los objetos no
// tienen sus campos inline sino como ÍNDICES a otras posiciones del mismo
// array (para compartir valores repetidos, ej. poster:null se reusa entre
// items) -- _unflattenDevalue() lo reconstruye a objetos JS normales.
//
// El día de la semana de cada anime NO viene como campo explícito -- se
// confirmó en vivo (comparando contra los 7 botones de día reales de la UI,
// 7/7 coincidencias exactas) que es simplemente el día de la semana de
// `latestEpisode.createdAt` calculado en la ZONA HORARIA LOCAL de quien
// pide los datos (new Date(iso).getDay()), igual que hace el propio front
// del sitio en el navegador del visitante. Como RYOKU es de uso personal y
// corre en la propia máquina del usuario, usar getDay() tal cual (zona
// horaria del sistema) reproduce exactamente lo que vería en el sitio.
function _unflattenDevalue(values) {
  const hydrated = new Array(values.length)
  function hydrate(i) {
    if (hydrated[i] !== undefined) return hydrated[i]
    const v = values[i]
    if (v === null || typeof v !== 'object') { hydrated[i] = v; return v }
    if (Array.isArray(v)) {
      const arr = []
      hydrated[i] = arr
      for (const idx of v) arr.push(hydrate(idx))
      return arr
    }
    const obj = {}
    hydrated[i] = obj
    for (const k in v) obj[k] = hydrate(v[k])
    return obj
  }
  return hydrate(0)
}

const _DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']

async function getCalendario() {
  try {
    const { data } = await axios.get(`${BASE}/horario/__data.json`, { headers: HEADERS, timeout: 12000 })
    const nodos = Array.isArray(data?.nodes) ? data.nodes : []
    const nodo = nodos.find(n => n?.data && Array.isArray(n.data) &&
      n.data[0] && typeof n.data[0] === 'object' && 'media' in n.data[0])
    if (!nodo) return {}

    const root  = _unflattenDevalue(nodo.data)
    const media = Array.isArray(root.media) ? root.media : []

    const dias = {}
    for (const m of media) {
      if (!m?.slug || !m?.latestEpisode?.createdAt) continue
      const dia = _DIAS_SEMANA[new Date(m.latestEpisode.createdAt).getDay()]
      if (!dias[dia]) dias[dia] = []
      dias[dia].push({
        titulo: m.title || '',
        link: `${BASE}/media/${m.slug}`,
        ep: m.latestEpisode.number != null ? `Ep ${m.latestEpisode.number}` : '',
        badge: '',
        imagen: _cover(m.id),
      })
    }
    return dias
  } catch(e) { return {} }
}

module.exports = { BASE, getRecientes, buscar, getBiblioteca, getAnime, getServidores, getCalendario }
