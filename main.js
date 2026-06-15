const { app, BrowserWindow, ipcMain, session, dialog, shell } = require('electron')
const path = require('path')
const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs')
const os = require('os')
const extractors  = require('./extractors/anime')
const latanime    = require('./extractors/anime/latanime')
const animeflv    = require('./extractors/anime/animeflv')
const DiscordRPC  = require('discord-rpc')
const { autoUpdater } = require('electron-updater')

const { createSplash } = require('./splash')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
const HEADERS = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-ES,es;q=0.9' }

const AD_DOMAINS = [
  // Display / programmatic
  'doubleclick','googlesyndication','googletagmanager','adservice','pagead','adnxs',
  'taboola','outbrain','popads','popcash','propellerads','adsterra','hilltopads',
  'trafficjunky','exoclick','juicyads','plugrush','tsyndicate','realsrv','adspyglass',
  'adcash','richpush','push.express','notix','onclickads','clickadu','etargetnet',
  // Video ads (VAST/VPAID/IMA)
  'imasdk.googleapis.com','securepubads','ima3.js','ima.js',
  '/vast','vpaid','adtag','ad_tag','adsystem','vast.xml','/preroll',
  'springserve','smartadserver','spotxchange','freewheel','moatads',
  'aniview','primis','connatix','jw-platform.com/advertising',
  // Específicos goodstream / video embed ads
  '1xbet','betano','bet365','betchan','vbet','mostbet','pin-up',
  'casino','betting','sport-bet',
  // Analytics / tracking
  'epidemicjungle','mc.yandex','hotjar','clarity.ms',
  'facebook.com/tr','connect.facebook','google-analytics',
  'amplitude.com','segment.io','mixpanel','fullstory',
]

// CACHE EN DISCO
const coverCache = new Map()
const CACHE_FILE = path.join(os.tmpdir(), 'anistream-covers.json')
try { const s = JSON.parse(fs.readFileSync(CACHE_FILE,'utf8')); Object.entries(s).forEach(([k,v])=>coverCache.set(k,v)) } catch(e){}
function guardarCache() { try { const o={}; coverCache.forEach((v,k)=>{o[k]=v}); fs.writeFileSync(CACHE_FILE,JSON.stringify(o)) } catch(e){} }

// CACHE JIKAN (MAL) en disco
const JIKAN_CACHE_FILE = path.join(os.tmpdir(), 'ryoku-jikan.json')
const jikanCache = new Map()
try { const j = JSON.parse(fs.readFileSync(JIKAN_CACHE_FILE,'utf8')); Object.entries(j).forEach(([k,v])=>jikanCache.set(k,v)) } catch(e){}
function guardarJikanCache() { try { const o={}; jikanCache.forEach((v,k)=>{o[k]=v}); fs.writeFileSync(JIKAN_CACHE_FILE,JSON.stringify(o)) } catch(e){} }

// CACHE DE BÚSQUEDAS EN MEMORIA (evita repetir peticiones de red)
const _buscarAnimeCache  = new Map()
const _buscarMangaCache  = new Map()
const _BUSCAR_TTL        = 5 * 60 * 1000  // 5 minutos

// Ratings de MAL que indican contenido +18
const MAL_ADULTO_RATINGS = ['Rx', 'R+'] // Rx=hentai, R+=mild nudity

// Buscar anime en Jikan (MAL) y devolver géneros, score, rating, imagen
async function jikanBuscar(titulo) {
  // Limpiar título para búsqueda: quitar "Latino/Castellano/S1/S2/Temporada N"
  const query = titulo
    .replace(/\s+(latino|castellano|sub|dub|doblado|redoblaje|audio latino|audio castellano)/gi, '')
    .replace(/\s+(s\d+|temporada\s*\d+|season\s*\d+)/gi, '')
    .replace(/\s*\(.*?\)/g, '')
    .trim()

  if (jikanCache.has(query)) return jikanCache.get(query)

  try {
    await new Promise(r => setTimeout(r, 350)) // respetar rate limit de Jikan (3 req/s)
    const res = await axios.get('https://api.jikan.moe/v4/anime', {
      params: { q: query, limit: 1, sfw: false },
      headers: { 'Accept': 'application/json' },
      timeout: 5000
    })
    const anime = res.data?.data?.[0]
    if (!anime) { jikanCache.set(query, null); return null }

    const result = {
      malId:    anime.mal_id,
      score:    anime.score,
      rating:   anime.rating,   // 'Rx', 'R+', 'R', 'PG-13', 'PG', 'G'
      imagen:   anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || null,
      sinopsis: anime.synopsis || '',
      generos:  [
        ...(anime.genres  || []).map(g => g.name),
        ...(anime.themes  || []).map(g => g.name),
        ...(anime.demographics || []).map(g => g.name)
      ],
      adulto: MAL_ADULTO_RATINGS.includes(anime.rating) || anime.genres?.some(g => g.name === 'Hentai')
    }
    jikanCache.set(query, result)
    guardarJikanCache()
    return result
  } catch(e) {
    jikanCache.set(query, null)
    return null
  }
}

// Enriquecer lista de animes con datos de MAL (en paralelo, con límite)
async function enriquecerConMAL(lista) {
  const CONCURRENCY = 3
  const results = [...lista]
  for (let i = 0; i < results.length; i += CONCURRENCY) {
    const batch = results.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (r, idx) => {
      const mal = await jikanBuscar(r.titulo)
      if (mal) {
        results[i + idx] = {
          ...r,
          malScore:  mal.score,
          malRating: mal.rating,
          malGeneros: mal.generos,
          // Usar imagen MAL si latanime no tiene una buena
          imagen:  r.imagen || mal.imagen || '',
          // +18 si latanime ya lo marcó O si MAL dice Rx/hentai
          adulto:  r.adulto || mal.adulto
        }
      }
    }))
  }
  return results
}

// ─── DISCORD RICH PRESENCE ───────────────────────────────────────────────────
const DISCORD_CLIENT_ID = '1514420491962683442'
let _rpc = null, _rpcReady = false
function initDiscord() {
  try {
    DiscordRPC.register(DISCORD_CLIENT_ID)
    _rpc = new DiscordRPC.Client({ transport: 'ipc' })
    _rpc.on('ready', () => { _rpcReady = true })
    _rpc.login({ clientId: DISCORD_CLIENT_ID }).catch(() => {})
  } catch(e) {}
}
function discordSet(data) {
  if (!_rpcReady || !_rpc) return
  try {
    const activity = { instance: false }
    if (data.details)       activity.details        = data.details
    if (data.state)         activity.state          = data.state
    if (data.startTime)     activity.startTimestamp = data.startTime
    if (data.largeImageKey) activity.largeImageKey  = data.largeImageKey
    if (data.largeImageText)activity.largeImageText = data.largeImageText
    _rpc.setActivity(activity).catch(() => {})
  } catch(e) {}
}
ipcMain.on('discord-update', (_, data) => discordSet(data))
ipcMain.on('discord-clear',  ()       => { if (_rpcReady && _rpc) _rpc.clearActivity().catch(() => {}) })

// ─── APP CONFIG ──────────────────────────────────────────────────────────────
const APP_CONFIG_FILE = path.join(app.getPath('userData'), 'anistream-appconfig.json')
let appConfig = {}
try { appConfig = JSON.parse(fs.readFileSync(APP_CONFIG_FILE, 'utf8')) } catch(e) {}
function guardarConfig() { try { fs.writeFileSync(APP_CONFIG_FILE, JSON.stringify(appConfig)) } catch(e) {} }

// ─── MULTI-SOURCE ANIME ───────────────────────────────────────────────────────
const ANIME_SOURCES = {
  latanime: { id: 'latanime', nombre: 'Latanime', BASE: 'https://latanime.org' },
  animeflv:    { id: 'animeflv',    nombre: 'AnimeFLV',         BASE: 'https://www4.animeflv.net' }
}
const _savedAnimeSource  = appConfig?.['anime-source']
let   _activeAnimeSource = ANIME_SOURCES[_savedAnimeSource] || ANIME_SOURCES['latanime']

ipcMain.handle('get-anime-sources', () =>
  Object.values(ANIME_SOURCES).map(s => ({ id: s.id, nombre: s.nombre, dominio: s.BASE.replace(/https?:\/\//, '') }))
)
ipcMain.handle('get-anime-source', () => _activeAnimeSource?.id || 'latanime')
ipcMain.handle('set-anime-source', (_, id) => {
  const src = ANIME_SOURCES[id]; if (!src) return false
  _activeAnimeSource = src
  if (appConfig) { appConfig['anime-source'] = id; guardarConfig() }
  return true
})

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    frame: false,
    title: 'RYOKU',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'renderer', 'preload.js'),
      webviewTag: false
    },
    backgroundColor: '#0F172A',
    show: false
  })
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['<all_urls>'] },
    (details, cb) => {
      const url = details.url
      if (url.includes('latanime.org') || url.includes('s2.latanime') || url.includes('cdn.latanime')) {
        details.requestHeaders['Referer'] = 'https://latanime.org/'
        details.requestHeaders['Origin']  = 'https://latanime.org'
      } else if (url.includes('animeflv.net') || url.includes('cdn.animeflv')) {
        details.requestHeaders['Referer'] = 'https://www4.animeflv.net/'
        details.requestHeaders['Origin']  = 'https://www4.animeflv.net'
      } else if (url.includes('zonatmo.org') || url.includes('storage2.zonatmo') || url.includes('storage.zonatmo')) {
        details.requestHeaders['Referer'] = 'https://zonatmo.org/'
        details.requestHeaders['Origin']  = 'https://zonatmo.org'
      } else if (url.includes('novelcool.com') || url.includes('img.novelcool') || url.includes('img2.novelcool') || url.includes('img3.novelcool')) {
        details.requestHeaders['Referer'] = 'https://es.novelcool.com/'
        details.requestHeaders['Origin']  = 'https://es.novelcool.com'
      } else if (url.includes('mxcontent.net') || url.includes('mxcdn.net') || url.includes('mixdrop')) {
        details.requestHeaders['Referer'] = 'https://mixdrop.ag/'
        details.requestHeaders['Origin']  = 'https://mixdrop.ag'
      } else if (url.includes('goodstream') || url.includes('gscdn.cam')) {
        details.requestHeaders['Referer'] = 'https://gscdn.cam/'
        details.requestHeaders['Origin']  = 'https://gscdn.cam'
        // Capturar la URL del m3u8 que goodstream pide internamente y enviarla al renderer
        if (url.includes('.m3u8') && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('goodstream-m3u8-captured', url)
        }
      }
      cb({ requestHeaders: details.requestHeaders })
    }
  )
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Permitir popup de Firebase/Google OAuth
    if (url.startsWith('https://ryoku-app-53e5c.firebaseapp.com') ||
        url.startsWith('https://accounts.google.com')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500, height: 650,
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        }
      }
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const u = details.url.toLowerCase()
    const block = AD_DOMAINS.some(d => u.includes(d))
    cb({ cancel: block })
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.on('maximize',   () => mainWindow.webContents.send('window-maximize-change', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximize-change', false))
}

app.whenReady().then(() => {
  createWindow(); createSplash(mainWindow, appConfig); initDiscord(); initUpdater(mainWindow)
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
ipcMain.on('minimize-window', () => mainWindow.minimize())
ipcMain.on('maximize-window', () => { if(mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize() })
ipcMain.on('close-window', () => mainWindow.close())

// ANILIST - portada
async function getInfoAnilist(titulo) {
  try {
    const query = `query ($s: String) { Media(search: $s, type: ANIME) { coverImage { large } } }`
    const { data } = await axios.post('https://graphql.anilist.co', { query, variables: { s: titulo } }, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 })
    return { imagen: data?.data?.Media?.coverImage?.large || '', sinopsis: '' }
  } catch(e) { return { imagen:'', sinopsis:'' } }
}

// LATANIME - sinopsis directa
async function getSinopsisLatanime(url) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 })
    const $ = cheerio.load(data)
    // Intentar primero selectores del cuerpo (texto completo)
    const selectores = [
      '.sinopsis p', '.Description p', '.descripcion p',
      '.sinopsis', '.Description', '.descripcion',
      '[class*="sinopsis"]', '[class*="descripcion"]', '[class*="description"]',
      '.anime-info p', '.info-content p', '.anime-description p',
    ]
    for (const sel of selectores) {
      const textos = []
      $(sel).each((_, el) => { const t = $(el).text().trim(); if (t) textos.push(t) })
      if (textos.length) {
        const joined = textos.join(' ').trim()
        if (joined.length > 80) return joined
      }
    }
    // Fallback: párrafo más largo del cuerpo (latanime usa <p> sin clase)
    let mejor = ''
    $('p').each((_, el) => {
      if ($(el).closest('nav, footer, aside, header, .nav, .footer, .menu, .copyright').length) return
      const t = $(el).text().trim()
      if (t.length > mejor.length) mejor = t
    })
    if (mejor.length > 80) return mejor
    // Último fallback: og:description (truncado)
    const sinopsis = $('meta[property="og:description"]').attr('content') || ''
    return sinopsis.replace(/Todos los anime.*sin limites\./i,'').replace(/Para descargar.*sin limites\./i,'').trim()
  } catch(e) { return '' }
}

// ANIMEFLV - sinopsis en español
async function getSinopsisAnimeFlv(titulo) {
  try {
    const query = titulo.replace(/\s+(Latino|Castellano)$/i,'').replace(/\s+S\d+$/i,'').trim()
    const { data } = await axios.get(
      `https://www4.animeflv.net/browse?q=${encodeURIComponent(query)}`,
      { headers: HEADERS, timeout: 5000 }
    )
    const $ = cheerio.load(data)
    const link = $('ul.ListAnimes li a').first().attr('href')
    if (!link) return ''
    const { data: page } = await axios.get(`https://www3.animeflv.net${link}`, { headers: HEADERS, timeout: 5000 })
    const $p = cheerio.load(page)
    return $p('.sinopsis p, .Description p').first().text().trim() || ''
  } catch(e) { return '' }
}

// RECIENTES + SLIDER — caché 5 min por fuente
const _recientesCache = {}
const _RECIENTES_TTL  = 5 * 60 * 1000

async function _fetchRecientes(srcId) {
  try {
    let result
    if (srcId === 'animeflv') {
      result = await animeflv.getRecientes()} else {
      result = await latanime.getRecientes()
    }
    _recientesCache[srcId] = { data: result, ts: Date.now() }
    return result
  } catch(e) { console.error('[AO] _fetchRecientes error:', e.message); return { slider:[], lista:[], series:[] } }
}

// Prefetch de la fuente no activa en background
function _prefetchOtraFuente(activeSrcId) {
  const otra = activeSrcId === 'latanime' ? 'animeflv' : activeSrcId === 'animeflv' ? 'latanime' : null
  if (otra) {
    const cached = _recientesCache[otra]
    if (!cached || Date.now() - cached.ts > _RECIENTES_TTL) {
      setTimeout(() => _fetchRecientes(otra), 500)
    }
  }
}

ipcMain.handle('get-recientes', async () => {
  const srcId = _activeAnimeSource?.id || 'latanime'
  const cached = _recientesCache[srcId]
  if (cached && Date.now() - cached.ts < _RECIENTES_TTL) {
    _prefetchOtraFuente(srcId)   // mantener la otra fuente caliente
    return cached.data
  }
  const result = await _fetchRecientes(srcId)
  _prefetchOtraFuente(srcId)     // prefetch background después de cargar
  return result
})

ipcMain.handle('_get-recientes-LEGACY', async () => {
  try {
    const { data } = await axios.get('https://latanime.org', { headers: HEADERS })
    const $ = cheerio.load(data)

    // ── 1. SLIDER: animes en el carousel principal (portadas reales, link /anime/) ──
    const slider = []
    const sliderVistos = new Set()
    // El carousel de latanime usa links /anime/ con portadas y descripción
    $('a[href*="/anime/"]').each((i, el) => {
      if (slider.length >= 17) return false
      const link = $(el).attr('href') || ''
      if (!link.includes('/anime/') || sliderVistos.has(link)) return
      sliderVistos.add(link)
      const img = $(el).find('img').first()
      const imagen = img.attr('data-src') || img.attr('src') || ''
      if (!imagen || imagen.includes('logito') || imagen.includes('web.jpg') || imagen.includes('monitos')) return
      // Detectar idioma del slug
      const slug = link.split('/anime/')[1] || ''
      let idioma = ''
      if (slug.includes('-latino')) idioma = 'Latino'
      else if (slug.includes('-castellano')) idioma = 'Castellano'
      // Título: usar el alt de la imagen que siempre es limpio
      let titulo = img.attr('alt')?.trim() || ''
      // Si no hay alt, tomar el primer heading
      if (!titulo) {
        titulo = $(el).find('h2, h3').first().text().trim()
      }
      // Limpiar: si el texto tiene el título duplicado (latanime lo repite), cortar en la primera repetición
      if (titulo) {
        const words = titulo.split(' ')
        const halfLen = Math.ceil(words.length / 2)
        const firstHalf = words.slice(0, halfLen).join(' ')
        const secondHalf = words.slice(halfLen).join(' ')
        if (secondHalf.startsWith(firstHalf.slice(0, 20))) titulo = firstHalf
      }
      if (titulo.length > 65) titulo = titulo.slice(0, 65).trimEnd() + '…'
      // Descripción: buscar el párrafo que NO sea el título
      let desc = ''
      $(el).find('p').each((_, p) => {
        const t = $(p).text().trim()
        if (t && !titulo.toLowerCase().startsWith(t.toLowerCase().slice(0, 15))) {
          desc = t.slice(0, 150)
          return false
        }
      })
      if (titulo) slider.push({ titulo, imagen, link, idioma, desc })
    })

    // ── 2. AÑADIDOS RECIENTEMENTE: episodios con link /ver/ ──
    const lista = []
    const vistos = new Set()
    $('a[href*="/ver/"]').each((i, el) => {
      if (lista.length >= 40) return false
      const link = $(el).attr('href') || ''
      if (!link || vistos.has(link)) return
      vistos.add(link)
      const slug = link.split('/ver/')[1] || ''
      const epMatch = slug.match(/-episodio-(\d+)$/)
      const epNum = epMatch ? epMatch[1] : ''
      const nombreSlug = slug.replace(/-episodio-\d+$/, '').replace(/-/g, ' ')
      let idioma = ''
      if (nombreSlug.includes(' latino')) idioma = 'Latino'
      else if (nombreSlug.includes(' castellano')) idioma = 'Castellano'
      else if (nombreSlug.includes(' sub')) idioma = 'Sub'
      const titulo = nombreSlug
        .replace(/ latino$/, '').replace(/ castellano$/, '').replace(/ sub$/, '')
        .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').trim()
      // Fecha
      const fecha = $(el).find('time, .date, span').last().text().trim()
      const img = $(el).find('img').first()
      const imagen = img.attr('data-src') || img.attr('src') || ''
      if (titulo) lista.push({ titulo, link, ep: epNum ? `Ep ${epNum}` : '', idioma, imagen, fecha })
    })

    // ── 3. SERIES RECIENTES: sección separada con portadas /anime/ ──
    const series = []
    const seriesVistos = new Set()
    // Buscar la sección "Series recientes" — en latanime es un bloque con h2/h3 + links /anime/
    let enSeriesRecientes = false
    $('h2, h3, h4').each((i, el) => {
      if ($(el).text().toLowerCase().includes('series recientes')) enSeriesRecientes = true
    })
    // Tomar los últimos links /anime/ de la página (la sección "series recientes" está al final)
    // latanime muestra 12 series en esa sección
    const todosAnimeLinks = []
    $('a[href*="/anime/"]').each((i, el) => {
      const link = $(el).attr('href') || ''
      if (!link.includes('/anime/')) return
      const img = $(el).find('img').first()
      const imagen = img.attr('data-src') || img.attr('src') || ''
      const tituloEl = $(el).find('h2, h3, .title, p, span').first()
      let titulo = tituloEl.text().trim() || img.attr('alt')?.trim() || ''
      // Limpiar duplicados
      const mitad = Math.ceil(titulo.length / 2)
      if (titulo.slice(0, mitad).trim() === titulo.slice(mitad).trim()) titulo = titulo.slice(0, mitad).trim()
      if (titulo.length > 60) titulo = titulo.slice(0, 60).trimEnd() + '…'
      const slug = link.split('/anime/')[1] || ''
      let idioma = ''
      if (slug.includes('-latino')) idioma = 'Latino'
      else if (slug.includes('-castellano')) idioma = 'Castellano'
      if (titulo) todosAnimeLinks.push({ titulo, imagen, link, idioma })
    })
    // Las series recientes son los últimos ~12 links únicos de /anime/ en la página
    const setParaSeries = new Set()
    const todosRev = [...todosAnimeLinks].reverse()
    for (const s of todosRev) {
      if (setParaSeries.has(s.link)) continue
      setParaSeries.add(s.link)
      series.unshift(s)
      if (series.length >= 12) break
    }

    return { slider, lista, series }
  } catch(e) { return { slider:[], lista:[], series:[] } }
})

// BUSQUEDA con filtros
ipcMain.handle('buscar', async (_, query, filtros = {}) => {
  const cacheKey = JSON.stringify({ q: query, ...filtros, src: _activeAnimeSource?.id })
  const hit = _buscarAnimeCache.get(cacheKey)
  if (hit && Date.now() - hit.ts < _BUSCAR_TTL) return hit.data
  try {
    const data = _activeAnimeSource?.id === 'animeflv'
      ? await animeflv.buscar(query, filtros)
      : await latanime.getBiblioteca({ query, ...filtros })
    _buscarAnimeCache.set(cacheKey, { data, ts: Date.now() })
    return data
  } catch(e) { console.error('[buscar]', e.message); return { lista: [], hayMas: false, page: 1 } }
})

ipcMain.handle('get-anime-biblioteca', async (_, params = {}) => {
  try {
    const { query = '', categoria = '', genero = '', emision = false, page = 1 } = params
    const tipo = categoria || ''
    const srcId = _activeAnimeSource?.id || 'latanime'

    if (srcId === 'animeflv') {
      return await animeflv.getBiblioteca({ query, genero, tipo, page })
    }
    // latanime (default)
    return await latanime.getBiblioteca({ query, genero, tipo, emision, page })
  } catch(e) {
    console.error('[get-anime-biblioteca]', e.message)
    return { lista: [], hayMas: false, page: 1 }
  }
})

// Enriquecer un anime individual con MAL (llamado desde renderer en background)
ipcMain.handle('enriquecer-anime', async (_, titulo) => {
  return await jikanBuscar(titulo)
})

// Abrir diálogo para seleccionar imagen de fondo
ipcMain.handle('open-bg-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar imagen de fondo',
    filters: [{ name: 'Imágenes', extensions: ['jpg','jpeg','png','webp','gif'] }],
    properties: ['openFile']
  })
  if (canceled || !filePaths.length) return null
  try {
    const data = fs.readFileSync(filePaths[0])
    const ext  = path.extname(filePaths[0]).slice(1).replace('jpg','jpeg')
    return `data:image/${ext};base64,${data.toString('base64')}`
  } catch(e) { return null }
})

// Limpiar todos los cachés en disco, memoria y sesión de Electron
ipcMain.handle('clear-cache', async () => {
  try {
    // 1. Memoria en Maps
    const antesCovers = coverCache.size
    const antesJikan  = jikanCache.size
    const antesTmo    = lcCoverCache.size
    coverCache.clear()
    jikanCache.clear()
    lcCoverCache.clear()

    // 2. Archivos en disco
    const files = [CACHE_FILE, JIKAN_CACHE_FILE, LC_CACHE_FILE]
    files.forEach(f => { try { fs.writeFileSync(f, '{}') } catch(e) {} })

    // 3. Caché HTTP de Electron (imágenes, recursos)
    await mainWindow.webContents.session.clearCache()
    await mainWindow.webContents.session.clearStorageData({
      storages: ['cachestorage', 'shadercache', 'serviceworkers']
    })

    const total = antesCovers + antesJikan + antesTmo
    return { ok: true, borrados: total }
  } catch(e) { return { ok: false, error: e.message } }
})
// Slugs y patrones de URL que latanime usa para contenido +18
const ADULTO_SLUGS = [
  // Patrones directos en URL de latanime para hentai explícito
  'sin-censura', 'uncensored', 'hentai',
  // Títulos hentai conocidos en latanime (sexual explícito, no ecchi)
  'overflow-', 'desbordandose',
  'venida-de-altura', 'gran-jefe-latino', 'grande-jefe-latino',
  'souryo-to-majiwaru', 'ane-naru-mono',
  'tropical-kiss', 'secret-journey',
  'aki-sora', 'oni-chichi',
  'nuki-doki',
  'yariman', 'erotica', 'eroge',
  'namaiki', 'gakuen-de-jikan', 'ane-to-boin',
  'oppai-no-ouja', 'majuu-jouka',
  'kanojo-ga-mimai-ni-konai', 'jk-to-orc',
  'elf-no-oshiego', 'brandish',
  'imaizumin-chi', 'okusama-wa-moto-yariman',
  'resort-boin', 'discipline',
  'Bible-Black', 'lingeries-office',
  'mankitsu-happening', 'buta-hime',
  'kuro-gal-ni-natta', 'shinyuu-to-shitemita',
  'classmate-no-moto-idol', 'shikijou-kyoudan',
  'omiai-aite-wa-oshiego', 'katainaka-ni-totsui-de',
  'nee-summer', 'koiito-kinenbi', 'maid-san-to-boin'
]

function esContenidoAdulto(titulo, link) {
  const t = (titulo || '').toLowerCase()
  const l = (link   || '').toLowerCase()
  // Hentai explícito en título/URL
  if (t.includes('hentai') || l.includes('hentai')) return true
  if (l.includes('sin-censura') || t.includes('sin censura')) return true
  // Slugs conocidos +18
  return ADULTO_SLUGS.some(s => l.includes(s))
}

// Categorías que latanime muestra junto al título en el directorio/listas
const CATS_LATANIME = [
  'Latino Sin Censura','Castellano Sin Censura',
  'Sin Censura','Pelicula Latino','Pelicula Castellano',
  'Ova Latino','Ova Castellano','Live Action',
  'Donghua','Cartoon','Aenime',
  'Latino','Castellano','Anime','Ova','Película','Especial'
]

function extraerAnimes($) {
  const lista = []
  const vistos = new Set()
  $('a[href*="/anime/"]').each((i, el) => {
    if (lista.length >= 96) return false
    const link = $(el).attr('href')
    if (!link || vistos.has(link)) return
    vistos.add(link)

    // Título desde h3/h2/alt de img — latanime lo repite en el texto del anchor
    const img    = $(el).find('img').first()
    const imagen = img.attr('data-src') || img.attr('src') || ''
    let titulo   = $(el).find('h3,h2,.title').first().text().trim()
                || img.attr('alt')?.trim() || ''

    // Texto completo del anchor para extraer categoría y año
    const txt = $(el).text()

    // Detectar categoría real de latanime buscando los strings exactos
    let categoria = ''
    for (const cat of CATS_LATANIME) {
      if (txt.includes(cat)) { categoria = cat; break }
    }
    // Fallback: detectar por URL
    if (!categoria) {
      const slug = link.toLowerCase()
      if (slug.includes('-castellano')) categoria = 'Castellano'
      else if (slug.includes('-latino'))    categoria = 'Latino'
    }

    // Detectar año (4 dígitos entre 1980-2030)
    const anioMatch = txt.match(/\b(19[89]\d|20[0-3]\d)\b/)
    const anio = anioMatch ? anioMatch[1] : ''

    // +18: Sin Censura explícito O slugs hentai conocidos
    const adulto = categoria.includes('Sin Censura')
                || esContenidoAdulto(titulo, link)

    if (titulo && link) lista.push({ titulo, imagen, link, categoria, anio, adulto })
  })
  return lista
}

// SERVIDORES
ipcMain.handle('get-servidores', async (_, url) => {
  try {
    if (url?.includes('animeflv.net'))           return await animeflv.getServidores(url)
    return await latanime.getServidores(url)
  } catch(e) { return [] }
})

// get-anime — delega por fuente activa
ipcMain.handle('get-anime', async (_, url) => {
  try {
    if (url?.includes('animeflv.net/anime/'))       return await animeflv.getAnime(url)
    return await latanime.getAnime(url, { coverCache, jikanBuscar })
  } catch(e) { return null }
})

ipcMain.handle('_get-servidores-LEGACY', async (_, url) => {
  try {
    const { data } = await axios.get(url, { headers: HEADERS })
    const $ = cheerio.load(data)
    const servidores = []
    $('[data-player]').each((i, el) => {
      const b64 = $(el).attr('data-player')
      const nombre = $(el).text().trim() || `Servidor ${i+1}`
      try {
        const decoded = Buffer.from(b64,'base64').toString('utf8')
        if (decoded.startsWith('http')) servidores.push({ nombre: nombre.toLowerCase(), url: decoded })
      } catch(e) {}
    })
    const orden = ['mp4upload','dsvplay','voe','mixdrop','hexload']
    servidores.sort((a,b) => {
      const ia = orden.findIndex(p=>a.nombre.includes(p))
      const ib = orden.findIndex(p=>b.nombre.includes(p))
      if (ia===-1&&ib===-1) return 0; if (ia===-1) return 1; if (ib===-1) return -1; return ia-ib
    })
    return servidores
  } catch(e) { return [] }
})

// INFO ANIME (legacy — Latanime only, replaced by get-anime above)
ipcMain.handle('_get-anime-latanime-legacy', async (_, url) => {
  try {
    const slugBase = url.split('/anime/')[1]?.replace(/-(latino|castellano)$/, '') || ''
    const cacheKey = slugBase
    const cachedImg = coverCache.get(cacheKey)

    const urlsAProbar = [
      `https://latanime.org/anime/${slugBase}-latino`,
      `https://latanime.org/anime/${slugBase}-castellano`,
      url
    ]

    let data = null
    for (const u of urlsAProbar) {
      try {
        const res = await axios.get(u, { headers: HEADERS, timeout: 8000 })
        if (res.status === 200) { data = res.data; break }
      } catch(e) { continue }
    }
    if (!data) return null

    const $ = cheerio.load(data)
    let titulo = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim() || ''
    titulo = titulo.replace(/\s*[—–|-]\s*(Latanime|Ver Anime|Online).*/i,'').replace(/\s*\|\s*Latanime.*/i,'').trim()

    const tituloLimpio = titulo.replace(/\s+(Latino|Castellano)$/i,'').replace(/\s+S\d+$/i,'').trim()
    const slugTitulo = slugBase.replace(/-/g,' ')

    // Portada
    let imagen = cachedImg || $('meta[property="og:image"]').attr('content') || ''

    // Sinopsis — intentar selectores del cuerpo primero (texto completo)
    const _sinopsisSelectores = [
      '.sinopsis p', '.Description p', '.descripcion p',
      '.sinopsis', '.Description', '.descripcion',
      '[class*="sinopsis"]', '[class*="descripcion"]', '[class*="description"]',
      '.anime-info p', '.info-content p', '.anime-description p',
    ]
    let sinopsis = ''
    for (const sel of _sinopsisSelectores) {
      const textos = []
      $(sel).each((_, el) => { const t = $(el).text().trim(); if (t) textos.push(t) })
      if (textos.length) {
        const joined = textos.join(' ').trim()
        if (joined.length > 80) { sinopsis = joined; break }
      }
    }
    if (!sinopsis) {
      // Fallback: párrafo más largo del cuerpo
      let mejor = ''
      $('p').each((_, el) => {
        if ($(el).closest('nav, footer, aside, header, .nav, .footer, .menu, .copyright').length) return
        const t = $(el).text().trim()
        if (t.length > mejor.length) mejor = t
      })
      if (mejor.length > 80) sinopsis = mejor
    }
    if (!sinopsis) {
      sinopsis = ($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '')
        .replace(/Todos los anime.*sin limites\./i,'').replace(/Para descargar.*sin limites\./i,'').trim()
    }

    if (!sinopsis || sinopsis.length < 80) {
      for (const u of urlsAProbar.slice(1)) {
        const s = await getSinopsisLatanime(u)
        if (s && s.length > 80) { sinopsis = s; break }
      }
    }

    if (!sinopsis || sinopsis.length < 80) {
      sinopsis = await getSinopsisAnimeFlv(tituloLimpio) ||
                 await getSinopsisAnimeFlv(slugTitulo) || sinopsis
    }

    // Último recurso: MAL vía Jikan
    if (!sinopsis || sinopsis.length < 80) {
      try {
        const mal = await jikanBuscar(tituloLimpio) || await jikanBuscar(slugTitulo)
        if (mal?.sinopsis && mal.sinopsis.length > 80) sinopsis = mal.sinopsis
      } catch(e) {}
    }

    if (!imagen || imagen.includes('web.jpg')) {
      for (const t of [tituloLimpio, slugTitulo, titulo]) {
        const info = await getInfoAnilist(t)
        if (info.imagen) { imagen = info.imagen; break }
      }
    }

    if (imagen) { coverCache.set(cacheKey, imagen); guardarCache() }

    // Episodios
    const episodios = []
    const vistos = new Set()
    $('a[href*="/ver/"]').each((i, el) => {
      const link = $(el).attr('href') || ''
      if (vistos.has(link)) return
      vistos.add(link)
      const epMatch = link.match(/-episodio-(\d+)/)
      const num = epMatch ? parseInt(epMatch[1]) : i+1
      episodios.push({ num, link })
    })
    episodios.sort((a,b) => a.num - b.num)

    return { titulo, imagen, sinopsis, episodios }
  } catch(e) { return null }
})

// STREAM
const streamCache = new Map()
const STREAM_CACHE_TTL = 8 * 60 * 1000
function streamCacheGet(url) {
  const entry = streamCache.get(url)
  if (!entry) return null
  if (Date.now() - entry.ts > STREAM_CACHE_TTL) { streamCache.delete(url); return null }
  return entry.data
}
function streamCacheSet(url, data) { streamCache.set(url, { data, ts: Date.now() }) }
setInterval(() => { const n = Date.now(); for (const [k,v] of streamCache) if (n-v.ts > STREAM_CACHE_TTL) streamCache.delete(k) }, 15*60*1000)

// Detectar si una URL de red ES realmente un archivo de video
// El bug anterior: mp4upload.com contiene '.mp4' en el dominio, activando el filtro incorrectamente
// Solución: verificar que .mp4 / .m3u8 esté en el PATH, no en el dominio
function _esUrlVideo(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    const path = parsed.pathname.toLowerCase()
    // .m3u8 en el path
    if (path.includes('.m3u8')) return true
    // .mp4 en el path, excluyendo páginas embed/html y recursos no-video
    if (path.includes('.mp4')) {
      if (path.endsWith('.html') || path.endsWith('.htm')) return false
      if (path.includes('thumb') || path.includes('poster') ||
          path.includes('preview') || path.includes('sample') ||
          path.includes('placeholder') || path.includes('advert')) return false
      return true
    }
    return false
  } catch(e) {
    // Fallback si URL inválida
    const ul = rawUrl.toLowerCase()
    return ul.includes('.m3u8') || (ul.includes('.mp4') && !ul.includes('.html'))
  }
}

// Extrae m3u8 de un embed de Goodstream/gscdn.cam usando BrowserWindow con sesión propia
async function _getGoodstreamM3u8(embedUrl) {
  return new Promise((resolve) => {
    const { session: elSession } = require('electron')
    // Usar una partición efímera para no mezclar con la sesión principal
    const partName = 'goodstream-extract-' + Date.now()
    const partSession = elSession.fromPartition(partName, { cache: false })

    let win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true,
        session: partSession,
      }
    })

    let resolved = false
    const done = (result) => {
      if (resolved) return
      resolved = true
      try { if (win && !win.isDestroyed()) win.destroy() } catch(e) {}
      win = null
      resolve(result)
    }

    const timer = setTimeout(() => {
      console.log('[goodstream-m3u8] timeout:', embedUrl.substring(0, 60))
      done(null)
    }, 20000)

    // Interceptar peticiones de red en la sesión de la ventana
    partSession.webRequest.onBeforeRequest((details, cb) => {
      const u = details.url
      if (!resolved && u.includes('.m3u8')) {
        clearTimeout(timer)
        console.log('[goodstream-m3u8] captured:', u.substring(0, 80))
        done({ url: u, tipo: 'hls', headers: { Referer: embedUrl, Origin: new URL(embedUrl).origin } })
      }
      cb({})
    })

    // UA que acepta gscdn.cam
    partSession.webRequest.onBeforeSendHeaders((details, cb) => {
      const headers = { ...details.requestHeaders, 'User-Agent': UA, 'Referer': embedUrl }
      cb({ requestHeaders: headers })
    })

    win.loadURL(embedUrl, { userAgent: UA })
  })
}

ipcMain.handle('get-stream', async (_, serverUrl) => {
  const cached = streamCacheGet(serverUrl)
  if (cached) return cached
  try {
    let resultado = null

    // gscdn.cam / goodstream embed — extraer m3u8 con BrowserWindow dedicado
    if (serverUrl.includes('gscdn.cam') || serverUrl.includes('goodstream')) {
      console.log('[get-stream] goodstream:', serverUrl.substring(0, 80))
      resultado = await _getGoodstreamM3u8(serverUrl)
      console.log('[get-stream] goodstream m3u8:', resultado?.url?.substring(0, 80) || 'null')
    } else {
      resultado = await extractors.getStream(serverUrl)
    }

    // Transferir cookies de Mixdrop a la sesión principal para reproducción
    if (resultado?.sessionCookies?.length) {
      const { session: elSess } = require('electron')
      const mainSess = elSess.defaultSession
      for (const c of resultado.sessionCookies) {
        try {
          const domain = c.domain.replace(/^\./, '')
          await mainSess.cookies.set({
            url: `https://${domain}`, name: c.name, value: c.value,
            domain: c.domain, path: c.path || '/', secure: c.secure, httpOnly: c.httpOnly,
          })
        } catch(e) {}
      }
      console.log('[get-stream] cookies Mixdrop transferidas:', resultado.sessionCookies.length)
    }

    if (resultado) streamCacheSet(serverUrl, resultado)
    return resultado
  } catch(e) {
    console.error('[get-stream]', e.message)
    return null
  }
})


// CALENDARIO
ipcMain.handle('get-calendario', async () => {
  try {
    // LatAnime bloquea axios — usar BrowserWindow
    const html = await new Promise((resolve) => {
      let win = null
      const timer = setTimeout(() => { if(win&&!win.isDestroyed())win.destroy(); resolve('') }, 20000)
      win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
      win.webContents.on('did-finish-load', async () => {
        try {
          await new Promise(r => setTimeout(r, 2000))
          const h = await win.webContents.executeJavaScript('document.documentElement.outerHTML')
          clearTimeout(timer); win.destroy(); resolve(h)
        } catch(e) { clearTimeout(timer); win.destroy(); resolve('') }
      })
      win.webContents.on('did-fail-load', (_,code) => { if(code===-3) return; clearTimeout(timer); win.destroy(); resolve('') })
      win.loadURL('https://latanime.org/calendario', { userAgent: UA })
    })

    if (!html) return {}
    const $ = cheerio.load(html)
    const orden = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo','otros']
    const dias = {}

    let diasUlIdx = -1
    const listas = $('ul').toArray()
    listas.forEach((ul, i) => {
      const items = $(ul).find('> li').toArray()
      if (items.length < 3) return
      const textos = items.map(li => $(li).text().trim().toLowerCase().replace(/\s+/g,''))
      const matchCount = textos.filter(t => orden.includes(t)).length
      if (matchCount >= 3) diasUlIdx = i
    })

    if (diasUlIdx === -1) return {}

    let diaIdx = 0
    listas.slice(diasUlIdx + 1).forEach(ul => {
      const items = $(ul).find('> li').toArray()
      if (!items.length) return
      const tieneLinks = items.some(li => $(li).find('a[href*="/anime/"]').length > 0)
      if (!tieneLinks) return
      const dia = orden[diaIdx] || 'otros'
      if (!dias[dia]) dias[dia] = []
      diaIdx++
      items.forEach(li => {
        const a = $(li).find('a[href*="/anime/"]').first()
        const link = a.attr('href') || ''
        const texto = $(li).text().trim()
        if (!link || !texto) return
        const epMatch = texto.match(/Próximo\s*-\s*(\d+)/i)
        const ep = epMatch ? `Ep ${epMatch[1]}` : ''
        const titulo = texto.replace(/Próximo\s*-\s*\d+/gi, '').trim()
        if (!titulo || titulo.length < 3) return
        const badge = titulo.toLowerCase().includes('castellano') ? 'castellano'
          : titulo.toLowerCase().includes('latino') ? 'latino' : ''
        const slug = link.split('/anime/')[1]?.replace(/-(latino|castellano)$/i,'') || ''
        const imagen = coverCache.get(slug) || ''
        dias[dia].push({ titulo, link, ep, badge, imagen })
      })
    })

    // Enriquecer portadas en background
    const sinImagen = Object.values(dias).flat().filter(a => !a.imagen)
    Promise.all(sinImagen.slice(0, 8).map(async a => {
      try {
        const slugBase = a.link.split('/anime/')[1]?.replace(/-(latino|castellano)$/i,'') || ''
        if (slugBase) {
          for (const suffix of ['-latino', '-castellano', '']) {
            try {
              const res = await axios.get(`https://latanime.org/anime/${slugBase}${suffix}`, { headers: HEADERS, timeout: 5000 })
              const $p = cheerio.load(res.data)
              const img = $p('meta[property="og:image"]').attr('content') || ''
              if (img && !img.includes('web.jpg')) {
                a.imagen = img; coverCache.set(slugBase, img); guardarCache(); return
              }
            } catch(e) { continue }
          }
        }
        const t = a.titulo.replace(/\s+(Latino|Castellano)$/i,'').replace(/\s+S\d+$/i,'').trim()
        const info = await getInfoAnilist(t)
        if (info.imagen) { a.imagen = info.imagen; if(slugBase){ coverCache.set(slugBase, info.imagen); guardarCache() } }
      } catch(e) {}
    })).catch(() => {})

    return dias
  } catch(e) { return {} }
})
// ─── DATOS POR FUENTE: favs, historial, progreso ─────────────────────────────
function _srcFile(prefix, srcId) { return require('path').join(app.getPath('userData'), `anistream-${prefix}-${srcId}.json`) }
function _loadJ(f, fb) { try { return JSON.parse(fs.readFileSync(f,'utf8')) } catch(e) { return fb } }
function _saveJ(f, d)  { try { fs.writeFileSync(f, JSON.stringify(d)) } catch(e) {} }

const _favsD = { latanime: _loadJ(_srcFile('favs','latanime'),[]),      animeflv: _loadJ(_srcFile('favs','animeflv'),[]) }
const _histD = { latanime: _loadJ(_srcFile('historial','latanime'),[]), animeflv: _loadJ(_srcFile('historial','animeflv'),[]) }
const _progD = { latanime: _loadJ(_srcFile('progreso','latanime'),{}),  animeflv: _loadJ(_srcFile('progreso','animeflv'),{}) }

function _src()  { return _activeAnimeSource?.id || 'latanime' }
function _favs() { return _favsD[_src()] || [] }
function _hist() { return _histD[_src()] || [] }
function _prog() { return _progD[_src()] || {} }
function _setF(v) { _favsD[_src()] = v; _saveJ(_srcFile('favs',      _src()), v) }
function _setH(v) { _histD[_src()] = v; _saveJ(_srcFile('historial', _src()), v) }
function _setP(k,v){ _progD[_src()][k] = v; _saveJ(_srcFile('progreso',_src()), _prog()) }
function _delP(k)  { delete _progD[_src()][k]; _saveJ(_srcFile('progreso',_src()), _prog()) }

ipcMain.handle('get-favs',   ()        => _favs())
ipcMain.handle('toggle-fav', (_, anime) => {
  let list = [..._favs()]
  const idx = list.findIndex(f => f.url === anime.url)
  if (idx >= 0) list.splice(idx, 1); else list.unshift(anime)
  _setF(list); return list
})
ipcMain.handle('is-fav', (_, url) => _favs().some(f => f.url === url))

// HISTORIAL
ipcMain.handle('get-historial',    ()        => _hist())
ipcMain.handle('add-historial',    (_, ep)   => {
  let list = _hist().filter(h => h.link !== ep.link)
  list.unshift(ep)
  if (list.length > 500) list = list.slice(0, 500)
  _setH(list); return list
})
ipcMain.handle('remove-historial', (_, link) => { _setH(_hist().filter(h => h.link !== link)) })
ipcMain.handle('remove-progreso',  (_, link) => { _delP(link) })
ipcMain.handle('clear-historial',  ()        => { _setH([]); return [] })

// PROGRESO DE EPISODIOS
ipcMain.handle('set-progreso',        (_, link, currentTime, duration) => {
  _setP(link, { currentTime, duration, porcentaje: duration > 0 ? (currentTime/duration)*100 : 0 })
})
ipcMain.handle('get-progreso',        (_, link) => _prog()[link] || null)
ipcMain.handle('get-todos-progresos', ()        => _prog())

ipcMain.handle('clear-stream-cache', (_, url) => {
  if (url) streamCache.delete(url)
  else streamCache.clear()
  // También limpiar cache interno de extractors
  try { extractors.clearCache(url || null) } catch(e) {}
})


// PROXY STREAM — para servidores que validan Referer (mp4upload, etc.)
// El renderer pide la URL al main, que la retransmite con el Referer correcto
const http  = require('http')
const https = require('https')

let _proxyServer = null
let _proxyPort   = 0

function startProxyServer() {
  if (_proxyServer) return Promise.resolve(_proxyPort)
  return new Promise((res) => {
    _proxyServer = http.createServer((req, clientRes) => {
      // URL real codificada en el path: /proxy?url=...&referer=...
      const parsedReq = new URL('http://localhost' + req.url)
      const target    = parsedReq.searchParams.get('url')
      const referer   = parsedReq.searchParams.get('referer') || ''
      if (!target) { clientRes.writeHead(400); clientRes.end(); return }

      // Mixdrop CDN requiere cookies de sesión → usar electron.net con persist:mixdrop_v3
      const isMxCDN = target.includes('mxcontent.net') || target.includes('mxcdn.net')
      if (isMxCDN) {
        try {
          const { net, session: elSession } = require('electron')
          const mxSess = elSession.fromPartition('persist:mixdrop_v3')
          const netReq = net.request({
            url: target,
            method: 'GET',
            session: mxSess,
            useSessionCookies: true,
          })
          netReq.setHeader('User-Agent', UA)
          netReq.setHeader('Referer', 'https://mixdrop.ag/')
          netReq.setHeader('Origin', 'https://mixdrop.ag')
          netReq.setHeader('Accept', '*/*')
          netReq.setHeader('Accept-Language', 'es-ES,es;q=0.9')
          if (req.headers['range']) netReq.setHeader('Range', req.headers['range'])
          netReq.on('response', (response) => {
            const hdr = {}
            for (const [k, v] of Object.entries(response.headers)) {
              hdr[k] = Array.isArray(v) ? v[0] : v
            }
            clientRes.writeHead(response.statusCode, {
              'Content-Type':   hdr['content-type']   || 'video/mp4',
              'Content-Length': hdr['content-length'] || '',
              'Accept-Ranges':  'bytes',
              'Content-Range':  hdr['content-range']  || '',
            })
            response.pipe(clientRes)
          })
          netReq.on('error', (e) => { console.error('[PROXY-MX]', e.message); clientRes.writeHead(502); clientRes.end() })
          netReq.end()
        } catch(e) { console.error('[PROXY-MX] fatal:', e.message); clientRes.writeHead(500); clientRes.end() }
        return
      }

      const parsed   = new URL(target)
      const isHttps  = parsed.protocol === 'https:'
      const lib      = isHttps ? https : http
      const options  = {
        hostname: parsed.hostname,
        port:     parsed.port || (isHttps ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers: {
          'User-Agent':      UA,
          'Referer':         referer,
          'Origin':          referer ? new URL(referer).origin : '',
          'Accept':          '*/*',
          'Accept-Language': 'es-ES,es;q=0.9',
          'Range':           req.headers['range'] || '',
        }
      }
      const proxyReq = lib.request(options, (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode, {
          'Content-Type':   proxyRes.headers['content-type']   || 'video/mp4',
          'Content-Length': proxyRes.headers['content-length'] || '',
          'Accept-Ranges':  'bytes',
          'Content-Range':  proxyRes.headers['content-range']  || '',
        })
        proxyRes.pipe(clientRes)
      })
      proxyReq.on('error', () => { clientRes.writeHead(502); clientRes.end() })
      proxyReq.end()
    })
    _proxyServer.listen(0, '127.0.0.1', () => {
      _proxyPort = _proxyServer.address().port
      console.log('[PROXY] servidor en puerto', _proxyPort)
      res(_proxyPort)
    })
  })
}

ipcMain.handle('get-proxy-url', async (_, targetUrl, referer) => {
  const port = await startProxyServer()
  const encoded = encodeURIComponent(targetUrl)
  const refEnc  = encodeURIComponent(referer || '')
  return `http://127.0.0.1:${port}/proxy?url=${encoded}&referer=${refEnc}`
})

// ─── MÓDULO MANGA (zonatmo.org) ──────────────────────────────────────────────
const MANGA_BASE = 'https://zonatmo.org'
const MANGA_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Referer': 'https://zonatmo.org/'
}

// Cache portadas
const lcCoverCache = new Map()
const LC_CACHE_FILE = path.join(os.tmpdir(), 'ryoku-tmo-covers.json')
try { const d = JSON.parse(fs.readFileSync(LC_CACHE_FILE,'utf8')); Object.entries(d).forEach(([k,v])=>lcCoverCache.set(k,v)) } catch(e){}
let _saveLCCacheTimer = null
function saveLCCache() {
  clearTimeout(_saveLCCacheTimer)
  _saveLCCacheTimer = setTimeout(() => {
    try { fs.writeFileSync(LC_CACHE_FILE, JSON.stringify(Object.fromEntries(lcCoverCache))) } catch(e) {}
  }, 3000)  // escribir a disco máx 1 vez cada 3s
}

// BrowserWindow para páginas de capítulo (zonatmo las renderiza con JS)
function tmoCapBrowser(url, waitMs = 4000) {
  return new Promise((resolve) => {
    let win = null
    const timer = setTimeout(() => { cleanup(); resolve([]) }, 25000)
    function cleanup() { clearTimeout(timer); try { if(win&&!win.isDestroyed()) win.destroy() } catch(e){} win=null }
    win = new BrowserWindow({ show:false, width:1280, height:900,
      webPreferences:{ nodeIntegration:false, contextIsolation:true }
    })
    win.webContents.session.webRequest.onBeforeSendHeaders({ urls:['<all_urls>'] }, (d,cb) => {
      d.requestHeaders['Referer'] = MANGA_BASE + '/'
      d.requestHeaders['Origin']  = MANGA_BASE
      d.requestHeaders['User-Agent'] = UA
      cb({ requestHeaders: d.requestHeaders })
    })
    win.webContents.on('did-finish-load', async () => {
      try {
        await new Promise(r => setTimeout(r, waitMs))
        // Extraer imágenes del lector via JS — zonatmo las mete en img tags con clase 'viewer-img' o similar
        const paginas = await win.webContents.executeJavaScript(`
          (function() {
            // Intentar obtener desde variable JS del sitio
            if (window.chapter_pages) return window.chapter_pages;
            if (window.pages) return window.pages;
            // Fallback: recolectar imgs del DOM
            const imgs = [];
            document.querySelectorAll('img').forEach(img => {
              const src = img.src || img.dataset.src || img.dataset.original || '';
              if (src && src.match(/https?:\\/\\/.+\\.(jpg|jpeg|png|webp)/i)) {
                const skip = ['logo','icon','header','footer','avatar','banner','nav','button','sprite'];
                if (!skip.some(s => src.toLowerCase().includes(s))) imgs.push(src);
              }
            });
            return imgs;
          })()
        `)
        cleanup()
        if (Array.isArray(paginas) && paginas.length) {
          resolve([...new Set(paginas.map(p => typeof p === 'string' ? p : (p.url || p.src || ''))
            .filter(p => p && p.match(/https?:\/\/.+\.(jpg|jpeg|png|webp)/i)))])
        } else {
          resolve([])
        }
      } catch(e) { cleanup(); resolve([]) }
    })
    win.webContents.on('did-fail-load', (_,code) => { if(code===-3) return; cleanup(); resolve([]) })
    win.loadURL(url, { userAgent: UA })
  })
}

// ─── NC CAP BROWSER — capítulos NovelCool ────────────────────────────────────
// Abre el capítulo en BrowserWindow, detecta el source picker de techsmartideas.com,
// hace click en la fuente indicada y extrae TODAS las imágenes del lector resultante.

// JS que se ejecuta en el lector para extraer el array completo de imágenes
const _extractImgsJS = `(function(){
  var BAD=/logo|icon|avatar|header|banner|sprite|favicon|transparent|default_pic/i;

  // Convierte un elemento a URL (acepta string O objeto {u,url,src,image,img})
  function toUrl(v){
    if(typeof v==='string') return v;
    if(v&&typeof v==='object') return v.u||v.url||v.src||v.image||v.img||v.path||'';
    return '';
  }
  function isGoodUrl(s){
    return typeof s==='string'&&s.indexOf('http')===0&&!BAD.test(s);
  }
  function extractArr(arr){
    if(!Array.isArray(arr)||arr.length<2) return null;
    var urls=arr.map(toUrl).filter(isGoodUrl);
    return urls.length>=2?urls:null;
  }

  // Método 1: variables globales conocidas (strings O objetos)
  var known=['im_p','images','chapterImages','chapter_images','pageImages','pages','imgs',
             'manga_pages','chp_images','arr_images','imageList','imgList','picList','chapterData'];
  for(var i=0;i<known.length;i++){
    var v=window[known[i]];
    var r=extractArr(v);
    if(r&&r.length>1) return r;
    // También buscar sub-propiedad
    if(v&&typeof v==='object'&&!Array.isArray(v)){
      var subs=['images','imgs','pages','list','data','chapter','pics'];
      for(var s=0;s<subs.length;s++){
        var r2=extractArr(v[subs[s]]);
        if(r2&&r2.length>1) return r2;
      }
    }
  }

  // Método 2: escanear TODAS las propiedades de window
  try{
    var keys=Object.keys(window);
    for(var k=0;k<keys.length;k++){
      try{
        var val=window[keys[k]];
        var res=extractArr(val);
        if(res&&res.length>5) return res;
        if(val&&typeof val==='object'&&!Array.isArray(val)){
          var ks=Object.keys(val).slice(0,30);
          for(var ki=0;ki<ks.length;ki++){
            var res2=extractArr(val[ks[ki]]);
            if(res2&&res2.length>5) return res2;
          }
        }
      }catch(e){}
    }
  }catch(e){}

  // Método 3: parsear <script> inline buscando arrays JSON con URLs
  var scripts=document.querySelectorAll('script:not([src])');
  for(var si=0;si<scripts.length;si++){
    var txt=scripts[si].textContent||'';
    // Buscar arrays de strings con http
    var rx=/\\[["'][^"']*https?:[^\\]]{10,}["'][^\\]]*\\]/g;
    var m;
    while((m=rx.exec(txt))!==null){
      try{
        var arr=JSON.parse(m[0]);
        var res3=extractArr(arr);
        if(res3&&res3.length>1) return res3;
      }catch(e){}
    }
  }

  // Método 4: DOM — imágenes visibles con atributos data-*
  var found=[];
  Array.from(document.images).forEach(function(el){
    var s=el.getAttribute('data-original')||el.getAttribute('data-src')||
          el.getAttribute('data-lazy')||el.getAttribute('data-url')||el.src||'';
    if(isGoodUrl(s)&&found.indexOf(s)<0) found.push(s);
  });
  if(found.length>0) return found;

  // Método 5: imágenes grandes visibles
  return Array.from(document.images)
    .filter(function(i){return i.naturalWidth>200&&i.naturalHeight>200;})
    .map(function(i){return i.src;})
    .filter(isGoodUrl);
})()`

function _ncCapBrowser(chapterUrl, base, sourceIdx, maxWait, onChunk) {
  sourceIdx = sourceIdx || 1
  maxWait   = maxWait   || 30000
  return new Promise((resolve) => {
    let win = null, resolved = false, sourceClicked = false

    // Cierra ventana — no resuelve la promesa
    const cleanup = () => {
      try { if (win && !win.isDestroyed()) win.destroy() } catch(e) {}
      win = null
    }

    // Para errores/timeout (antes de resolución temprana)
    const finish = (imgs) => {
      clearTimeout(timer)
      if (!resolved) {
        resolved = true
        resolve(Array.isArray(imgs) ? imgs.filter(Boolean) : [])
      }
      cleanup()
    }

    // Resolución temprana con primera tanda — ventana queda abierta para carga en background
    const resolveEarly = (firstPages, total) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      resolve({ pages: firstPages, total })
      // Timer de seguridad para asegurar que la ventana se cierre eventualmente
      setTimeout(cleanup, 120000)
    }

    const timer = setTimeout(() => finish([]), maxWait)

    // Sesión en memoria (NO persist:) — evita contaminación entre llamadas
    const _partition = 'nc-' + Date.now() + '-' + Math.floor(Math.random() * 99999)
    win = new BrowserWindow({ show: false, width: 1280, height: 900,
      webPreferences: { nodeIntegration: false, contextIsolation: true, partition: _partition }
    })

    win.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (d, cb) => {
      d.requestHeaders['Referer']    = base + '/'
      d.requestHeaders['Origin']     = base
      d.requestHeaders['User-Agent'] = UA
      cb({ requestHeaders: d.requestHeaders })
    })

    win.webContents.on('did-finish-load', async () => {
      if (resolved) return
      try {
        const curUrl = win.webContents.getURL()
        console.log('[_ncCapBrowser] did-finish-load →', curUrl.substring(0, 120))

        if (curUrl.includes('techsmartideas.com')) {
          // Source picker detectado — hacer click en la fuente indicada
          if (sourceClicked) return  // ya hicimos click, esperando navegación
          sourceClicked = true
          await new Promise(r => setTimeout(r, 1200))
          await win.webContents.executeJavaScript(`
            (function() {
              var idx = ${sourceIdx};
              var links = Array.from(document.querySelectorAll('a[href],button'));
              var matches = links.filter(function(el) {
                var t = (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                return t === 'source ' + idx || t === 'source' + idx;
              });
              if (matches.length) { matches[0].click(); return; }
              var all = links.filter(function(el) {
                return /source/i.test(el.textContent || '');
              });
              if (all[idx - 1]) { all[idx - 1].click(); return; }
              if (all[0]) all[0].click();
            })()
          `).catch(() => {})
          // La navegación disparará otro did-finish-load

        } else {
          // En el lector del capítulo (financemasterpro.com)
          // Reader tiene: select "Cargar imágenes:10" y select "Page:N"
          // Estrategia:
          //  1. Leer páginas ANTES de tocar nada
          //  2. Para cada página: navegar, scroll para lazy-load, recolectar imágenes
          const extractAll = async () => {
            if (resolved) return
            await new Promise(r => setTimeout(r, 900))
            if (resolved) return

            // JS auxiliar: extrae imágenes manga del DOM (sin logos, iconos, etc.)
            const domExtractJS = `(function(){
              var BAD=/logo|icon|avatar|header|banner|sprite|favicon|transparent|default_pic|menusub|menu-|iconfont/i;
              var found=[];
              Array.from(document.images).forEach(function(el){
                var s=el.getAttribute('data-original')||el.getAttribute('data-src')||
                      el.getAttribute('data-lazy')||el.src||'';
                if(s&&s.indexOf('http')===0&&!BAD.test(s)&&found.indexOf(s)<0)found.push(s);
              });
              return found;
            })()`

            // ── Paso 1: leer todos los grupos "Page" ANTES de cambiar imgCount ──
            let pageVals = []
            try {
              pageVals = await win.webContents.executeJavaScript(`
                (function(){
                  var best=null, bestLen=0;
                  Array.from(document.querySelectorAll('select')).forEach(function(s){
                    var opts=Array.from(s.options);
                    // El select "Page" tiene opciones con texto "Page" o numérico puro
                    var isPage=opts.some(function(o){return /page/i.test(o.textContent);});
                    if(isPage && opts.length > bestLen){ best=s; bestLen=opts.length; }
                  });
                  if(!best) return [];
                  return Array.from(best.options).map(function(o){return o.value;});
                })()
              `)
              console.log('[_ncCapBrowser] pageVals (raw):', pageVals)
            } catch(e) {}

            // ── Paso 2: poner imgCount al max para cada página ────────────────────
            const setMaxImgs = async () => {
              try {
                await win.webContents.executeJavaScript(`
                  (function(){
                    var sel=Array.from(document.querySelectorAll('select')).find(function(s){
                      return Array.from(s.options).some(function(o){
                        return /^\\d+$/.test((o.value||'').trim())&&parseInt(o.value)>=10;
                      });
                    });
                    if(!sel)return;
                    var opt=document.createElement('option');
                    opt.value='999';opt.textContent='999';
                    sel.appendChild(opt);
                    sel.value='999';
                    sel.dispatchEvent(new Event('change',{bubbles:true}));
                  })()
                `)
              } catch(e) {}
            }

            await setMaxImgs()
            await new Promise(r => setTimeout(r, 700))
            if (resolved) return

            // Si no detectamos páginas, tratar como página única
            if (pageVals.length === 0) pageVals = ['']

            // Helper: scroll + espera hasta que el conteo de imgs nuevas se estabilice
            const scrollLoad = async (knownImgs) => {
              let lastNew = 0, stable = 0
              for (let sc = 0; sc < 10 && !win?.isDestroyed(); sc++) {
                await win.webContents.executeJavaScript(
                  `window.scrollTo(0,document.body.scrollHeight);` +
                  `window.dispatchEvent(new Event('scroll',{bubbles:true}));`
                ).catch(() => {})
                await new Promise(r => setTimeout(r, 450))
                if (win?.isDestroyed()) break
                try {
                  const imgs = await win.webContents.executeJavaScript(domExtractJS)
                  const newOnes = (imgs||[]).filter(Boolean).filter(u => !knownImgs.has(u))
                  if (newOnes.length > lastNew) { lastNew = newOnes.length; stable = 0 }
                  else if (++stable >= 2) break
                } catch(e) {}
              }
            }

            // Helper: navegar al grupo "Page" indicado
            const navToPage = async (pv) => {
              try {
                await win.webContents.executeJavaScript(`
                  (function(){
                    var sel=Array.from(document.querySelectorAll('select')).find(function(s){
                      return Array.from(s.options).some(function(o){return /page/i.test(o.textContent);});
                    });
                    if(sel){ sel.value=${JSON.stringify(pv)}; sel.dispatchEvent(new Event('change',{bubbles:true})); }
                  })()
                `)
                await new Promise(r => setTimeout(r, 900))
              } catch(e) {}
            }

            // ── Grupo 1: cargar y resolver de inmediato ───────────────────────────
            const allImgs = new Set()
            await scrollLoad(allImgs)
            try {
              const imgs = await win.webContents.executeJavaScript(domExtractJS)
              ;(imgs||[]).filter(Boolean).forEach(u => allImgs.add(u))
            } catch(e) {}

            const firstBatch = [...allImgs]

            // ── Total exacto: leer "1 of N" del DOM (disponible en el lector) ────
            let totalExact = 0
            try {
              totalExact = await win.webContents.executeJavaScript(`
                (function(){
                  var all = Array.from(document.querySelectorAll('*'));
                  for (var i = 0; i < all.length; i++) {
                    var t = (all[i].childNodes[0]||{}).nodeValue || '';
                    var m = t.match(/\b(\d+)\s+of\s+(\d+)/i);
                    if (m) return parseInt(m[2]);
                  }
                  // fallback: buscar en todo el textContent del body
                  var bm = document.body.innerText.match(/\b\d+\s+of\s+(\d+)/i);
                  return bm ? parseInt(bm[1]) : 0;
                })()
              `)
            } catch(e) {}
            const totalEst = (totalExact > 0) ? totalExact : pageVals.length * Math.max(firstBatch.length, 10)
            console.log('[_ncCapBrowser] grupo 1/', pageVals.length, '— imgs:', firstBatch.length, 'totalExact:', totalExact, 'totalEst:', totalEst)

            if (pageVals.length <= 1) {
              // Un solo grupo — resolver con todo
              finish(firstBatch)
              return
            }

            // Resolver de inmediato con primera tanda + estimado de total
            resolveEarly(firstBatch, totalEst)

            // ── Grupos 2-N: carga en background ──────────────────────────────────
            for (let pi = 1; pi < pageVals.length; pi++) {
              if (win?.isDestroyed()) break
              await navToPage(pageVals[pi])
              if (win?.isDestroyed()) break
              await scrollLoad(allImgs)
              if (win?.isDestroyed()) break
              try {
                const imgs = await win.webContents.executeJavaScript(domExtractJS)
                const batch = (imgs||[]).filter(Boolean).filter(u => !allImgs.has(u))
                batch.forEach(u => allImgs.add(u))
                console.log('[_ncCapBrowser] grupo', pi+1, '/', pageVals.length, '— nuevas:', batch.length, 'acum:', allImgs.size)
                if (batch.length > 0 && onChunk) onChunk(batch)
              } catch(e) {}
            }

            console.log('[_ncCapBrowser] background completo — total real:', allImgs.size)
            if (onChunk) onChunk({ done: true, total: allImgs.size })
            cleanup()
          }
          extractAll()
        }
      } catch(e) { finish([]) }
    })

    win.webContents.on('did-fail-load', (_, code) => { if (code === -3) return; finish([]) })
    win.loadURL(chapterUrl, { userAgent: UA })
  })
}

// Helper: extraer mangas de HTML de zonatmo
// El link de texto tiene formato: "Título MANGA|MANHWA|MANHUA 9.30 Demografía"


function parsearLinksZona($, aEls, limite = 24) {
  const lista = []
  const vistos = new Set()
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
      tipo = tipoMatch[1]
      const resto = textoRaw.slice(tipoMatch.index + tipoMatch[0].length).trim()
      const rm = resto.match(/^(\d+(?:\.\d+)?)\s*(.*)$/)
      if (rm) { rating = parseFloat(rm[1]) || 0; demografia = rm[2].trim() }
    } else {
      titulo = textoRaw
    }
    if (!titulo || titulo.length < 2 || titulo.length > 150) return
    const imagen = lcCoverCache.get(link) || ''
    lista.push({ titulo: titulo.trim(), link, imagen, cap: '', tipo, rating: rating > 0 ? rating : undefined, demografia: demografia || undefined })
  })
  return lista
}

// Alias para búsqueda
function extraerMangasZona($, limite = 60) {
  return parsearLinksZona($, $('a[href*="/library/"]'), limite)
}

// HOME — devuelve { pop:{general,seinen,josei}, trend:{general,seinen,josei}, nuevos }
// Coincide con los 3 tabs de Populares y 3 tabs de Trending de zonatmo
ipcMain.handle('get-manga-tendencias', async () => {
  // Delegar a NovelCool si es la fuente activa
  if (_activeMangaSource?.id === 'novelcool') {
    const nc = _getNovelcoolSrc()
    const empty = { pop:{general:[],seinen:[],josei:[]}, trend:{general:[],seinen:[],josei:[]}, nuevos:[] }
    if (nc?.fetchTendencias) return (await nc.fetchTendencias()) || empty
    return empty
  }

  const empty = { pop:{general:[],seinen:[],josei:[]}, trend:{general:[],seinen:[],josei:[]}, nuevos:[] }

  for (let intento = 0; intento < 2; intento++) {
    try {
      const { data: html } = await axios.get(MANGA_BASE, { headers: MANGA_HEADERS, timeout: 15000 })
      const $ = cheerio.load(html)

      const markers = {
        popGeneral:  html.search(/id="pills-populars"/),
        popSein:     html.search(/id="pills-populars-boys"/),
        popJosei:    html.search(/id="pills-populars-girls"/),
        trendGeneral:html.search(/id="pills-trending"/),
        trendSein:   html.search(/id="pills-trending-boys"/),
        trendJosei:  html.search(/id="pills-trending-girls"/),
      }

      const parseSlice = (from, to, lim=18) => {
        if (from < 0) return []
        const slice = to > 0 ? html.slice(from, to) : html.slice(from)
        const $s = cheerio.load(slice)
        return parsearLinksZona($s, $s('a[href*="/library/"]'), lim)
      }

      const pop = {
        general: parseSlice(markers.popGeneral,  markers.popSein > 0  ? markers.popSein  : markers.trendGeneral, 18),
        seinen:  parseSlice(markers.popSein  > 0 ? markers.popSein   : markers.popGeneral,  markers.popJosei  > 0 ? markers.popJosei  : markers.trendGeneral, 18),
        josei:   parseSlice(markers.popJosei > 0 ? markers.popJosei  : markers.popGeneral,  markers.trendGeneral > 0 ? markers.trendGeneral : html.length, 18),
      }

      const trend = {
        general: parseSlice(markers.trendGeneral > 0 ? markers.trendGeneral : html.length * 0.6,  markers.trendSein  > 0 ? markers.trendSein  : html.length, 18),
        seinen:  parseSlice(markers.trendSein  > 0 ? markers.trendSein  : html.length * 0.7, markers.trendJosei > 0 ? markers.trendJosei : html.length, 18),
        josei:   parseSlice(markers.trendJosei > 0 ? markers.trendJosei : html.length * 0.8, html.length, 18),
      }

      // Si todas las listas están vacías y hay HTML, zonatmo cambió su estructura
      // Fallback: extraer todos los links del home
      if (!pop.general.length && !trend.general.length) {
        console.warn('[manga-tendencias] markers no encontrados, usando fallback global')
        const todos = parsearLinksZona($, $('a[href*="/library/"]'), 54)
        pop.general   = todos.slice(0, 18)
        trend.general = todos.slice(18, 36)
        const nuevosFb = todos.slice(36, 54)
        const todasFb = [pop.general, pop.seinen, pop.josei, trend.general, trend.seinen, trend.josei, nuevosFb]
        todasFb.forEach(lista => lista.forEach(m => { if (!m.imagen) m.imagen = lcCoverCache.get(m.link) || '' }))
        return { pop, trend, nuevos: nuevosFb }
      }

      const dedup = (listas) => {
        const seen = new Set()
        listas.forEach(lista => lista.forEach(m => {
          if (seen.has(m.link)) m._dup = true
          else seen.add(m.link)
        }))
        listas.forEach((lista, i) => { if (i > 0) listas[i] = lista.filter(m => !m._dup) })
      }
      dedup([pop.general, pop.seinen, pop.josei])
      dedup([trend.general, trend.seinen, trend.josei])

      let nuevos = []
      try {
        const { data: bHtml } = await axios.get(
          MANGA_BASE + '/biblioteca?order_item=creation&order_dir=desc&_pg=1',
          { headers: MANGA_HEADERS, timeout: 8000 }
        )
        const $b = cheerio.load(bHtml)
        nuevos = parsearLinksZona($b, $b('a[href*="/library/"]'), 18)
      } catch(e) { console.error('[nuevos]', e.message) }

      const todasListas = [pop.general, pop.seinen, pop.josei, trend.general, trend.seinen, trend.josei, nuevos]
      todasListas.forEach(lista => lista.forEach(m => { if (!m.imagen) m.imagen = lcCoverCache.get(m.link) || '' }))

      return { pop, trend, nuevos }
    } catch(e) {
      console.error(`[manga-tendencias] intento ${intento+1}:`, e.message)
      if (intento === 0) await new Promise(r => setTimeout(r, 2000)) // esperar antes de reintentar
    }
  }
  return empty
})


// Fetch de página de zonatmo via BrowserWindow (evita bot-detection)
// Versión ligera para páginas de listado — solo necesita el HTML, no espera imágenes
function tmoBrowser(url, waitMs = 2500) {
  return new Promise((resolve) => {
    let win = null
    const timer = setTimeout(() => { cleanup(); resolve('') }, 20000)
    function cleanup() { clearTimeout(timer); try { if(win&&!win.isDestroyed()) win.destroy() } catch(e){} win=null }
    win = new BrowserWindow({ show:false, width:1280, height:900,
      webPreferences:{ nodeIntegration:false, contextIsolation:true }
    })
    win.webContents.session.webRequest.onBeforeSendHeaders({ urls:['<all_urls>'] }, (d,cb) => {
      d.requestHeaders['Referer'] = MANGA_BASE + '/'
      d.requestHeaders['Origin']  = MANGA_BASE
      d.requestHeaders['User-Agent'] = UA
      cb({ requestHeaders: d.requestHeaders })
    })
    win.webContents.on('did-finish-load', async () => {
      try {
        await new Promise(r => setTimeout(r, waitMs))
        const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML')
        cleanup(); resolve(html)
      } catch(e) { cleanup(); resolve('') }
    })
    win.webContents.on('did-fail-load', (_,code) => { if(code===-3) return; cleanup(); resolve('') })
    win.loadURL(url, { userAgent: UA })
  })
}

// BÚSQUEDA — usa BrowserWindow para /biblioteca (bot-detection bypass)
ipcMain.handle('buscar-manga', async (_, query) => {
  // Cache top-level: cubre ambas fuentes
  const _cacheKey = `${_activeMangaSource?.id || 'zonatmo'}::${query}`
  const _hit = _buscarMangaCache.get(_cacheKey)
  if (_hit && Date.now() - _hit.ts < _BUSCAR_TTL) return _hit.data
  const _saveMangaCache = (data) => { _buscarMangaCache.set(_cacheKey, { data, ts: Date.now() }); return data }

  // Delegar a NovelCool si es la fuente activa
  if (_activeMangaSource?.id === 'novelcool') {
    const nc = _getNovelcoolSrc()
    if (nc?.buscarManga) return _saveMangaCache(await nc.buscarManga(query))
    return []
  }

  try {
    let url

    // Mapa de valores de order_item de la UI → valores reales de zonatmo
    const ordenMap = {
      'likes':     'likes_count',
      'score':     'score',
      'creation':  'creation',
      'trending':  'trending',
      'alphabetic':'alphabetic'
    }

    if (query && query.startsWith('{')) {
      const p = JSON.parse(query)
      const orden = ordenMap[p.order_item] || p.order_item || 'likes_count'
      const pag   = parseInt(p.pg) || 1
      const qs = new URLSearchParams()
      qs.set('order_item', orden)
      qs.set('order_dir',  p.order_dir || 'desc')
      qs.set('title',      p.title     || '')
      qs.set('filter_by',  'title')
      qs.set('author_filter', '')
      qs.set('type',       p.type       || '')
      qs.set('demography', p.demography || '')
      qs.set('status',     '')
      qs.set('_pg',        String(pag))
      if (pag > 1) qs.set('page', String(pag))  // zonatmo usa 'page' para cambiar resultados
      if (p.genders?.length)         p.genders.forEach(g => qs.append('genders[]', g))
      if (p.exclude_genders?.length) p.exclude_genders.forEach(g => qs.append('exclude_genders[]', g))
      url = `${MANGA_BASE}/biblioteca?${qs.toString()}`
    } else if (query.startsWith('__seccion__')) {
      const parte = query.replace('__seccion__', '')
      const [orden, pag = '1'] = parte.split(':')
      const ordenReal = ordenMap[orden] || orden
      url = `${MANGA_BASE}/biblioteca?order_item=${ordenReal}&order_dir=desc&_pg=${pag}&filter_by=title&title=&type=&demography=&status=`
      if (parseInt(pag) > 1) url += `&page=${pag}`
    } else {
      url = `${MANGA_BASE}/biblioteca?order_item=likes_count&order_dir=desc&title=${encodeURIComponent(query)}&filter_by=title&_pg=1`
    }
    console.log('[buscar-manga]', url)
    const html = await tmoBrowser(url, 3000)
    if (!html) return []
    const $ = cheerio.load(html)
    const lista = extraerMangasZona($, 48)
    lista.forEach(m => { if (!m.imagen) m.imagen = lcCoverCache.get(m.link) || '' })
    return _saveMangaCache(lista)
  } catch(e) { console.error('[buscar-manga]', e.message); return [] }
})

// SUGERENCIAS — autocomplete ligero (solo NovelCool, solo SSR, límite 8)
ipcMain.handle('sugerir-manga', async (_, query) => {
  if (!query || query.length < 2) return []
  if (_activeMangaSource?.id === 'novelcool') {
    const nc = _getNovelcoolSrc()
    if (nc?.sugerencias) {
      try { return await nc.sugerencias(query) } catch(e) { return [] }
    }
  }
  // Fuentes sin sugerencias: devuelve vacío (no lanzar búsqueda completa)
  return []
})

// PORTADA LAZY — el renderer llama esto individualmente por tarjeta sin portada
// Throttle: max 6 requests simultáneos para no saturar zonatmo
let _portadaSlots = 0
const MAX_PORTADA_SLOTS = 10
const _portadaQueue = []

async function _portadaWorker() {
  if (_portadaSlots >= MAX_PORTADA_SLOTS || !_portadaQueue.length) return
  _portadaSlots++
  const { url, resolve } = _portadaQueue.shift()
  const fetchPortada = async (timeout) => {
    const isNC = url.includes('novelcool.com')
    const headers = isNC
      ? (_getNovelcoolSrc()?.HEADERS || MANGA_HEADERS)
      : MANGA_HEADERS
    const { data } = await axios.get(url, { headers, timeout })
    // Si el sitio retorna Cloudflare challenge, no parsear
    if (data && (data.includes('Just a moment') || data.includes('cf-browser-verification'))) return ''
    const $ = cheerio.load(data)
    return $('meta[property="og:image"]').attr('content') ||
           $('meta[name="og:image"]').attr('content') ||
           $('img.cover, img.portada, .book-cover img').first().attr('src') || ''
  }
  try {
    if (lcCoverCache.has(url)) { resolve(lcCoverCache.get(url)); _portadaSlots--; _portadaWorker(); return }
    let img = ''
    try { img = await fetchPortada(5000) } catch(e1) {}  // sin retry — falla rápido
    if (img) { lcCoverCache.set(url, img); saveLCCache() }
    resolve(img)
  } catch(e) { resolve('') }
  _portadaSlots--
  _portadaWorker()
}

// Dedup: si el mismo URL ya está en queue, compartir la misma Promise
const _portadaPending = new Map()
ipcMain.handle('get-manga-portada', (_, url) => {
  if (lcCoverCache.has(url)) return Promise.resolve(lcCoverCache.get(url))
  if (_portadaPending.has(url)) return _portadaPending.get(url)
  const p = new Promise(resolve => {
    _portadaQueue.push({ url, resolve: (img) => {
      _portadaPending.delete(url)
      resolve(img)
    }})
    _portadaWorker()
  })
  _portadaPending.set(url, p)
  return p
})

// DETALLE — página del manga con axios (HTML estático)
ipcMain.handle('get-manga-detalle', async (_, url, tituloFallback) => {
  try {
    // Delegar a NovelCool solo si la URL pertenece a ese dominio
    if (url && url.includes('novelcool')) {
      const nc = _getNovelcoolSrc()
      if (nc?.getDetalle) return await nc.getDetalle(url, tituloFallback)
    }
    const { data } = await axios.get(url, { headers: MANGA_HEADERS, timeout: 10000 })
    const $ = cheerio.load(data)

    // ── Título ──
    // zonatmo tiene DOS h1: primero "MANGA|MANHWA|MANHUA" (badge), segundo el título real.
    // Estrategia: buscar el h1 cuyo texto NO sea solo el tipo de publicación.
    const TIPOS = new Set(['MANGA','MANHWA','MANHUA'])
    let titulo = ''
    $('h1').each((i, el) => {
      const t = $(el).text().trim()
      if (!TIPOS.has(t.toUpperCase()) && t.length > 1) { titulo = t; return false }
    })
    // Fallback: og:title limpio
    if (!titulo) {
      titulo = ($('meta[property="og:title"]').attr('content') || '')
        .replace(/^Ver\s+/i, '').replace(/\s+Online Gratis.*$/i, '').trim()
    }
    if (!titulo) titulo = tituloFallback || ''

    // ── Portada ──
    const imagen = $('meta[property="og:image"]').attr('content') || lcCoverCache.get(url) || ''
    if (imagen) lcCoverCache.set(url, imagen)

    // ── Sinopsis ──
    // zonatmo: og:description empieza con "Lee X en línea gratis. " — limpiar eso
    let sinopsis = $('meta[property="og:description"]').attr('content') || ''
    sinopsis = sinopsis.replace(/^Lee .+ en l[íi]nea gratis\.\s*/i, '').trim()
    if (sinopsis.length < 30) {
      sinopsis = $('[class*="description"] p, [class*="sinopsis"] p').first().text().trim() || sinopsis
    }

    // ── Géneros ──
    // zonatmo: links /biblioteca?genders[]=N dentro de h6
    const generos = []
    $('h6 a[href*="genders"]').each((i, el) => {
      const g = $(el).text().trim()
      if (g && g.length < 30 && !generos.includes(g)) generos.push(g)
    })

    // ── Estado ──
    // zonatmo: "##### Estado\nPublicándose" — buscar el párrafo siguiente al h5 Estado
    let estadoTxt = ''
    $('h5, h6, strong, b').each((i, el) => {
      if ($(el).text().trim().toLowerCase() === 'estado') {
        estadoTxt = $(el).next().text().trim() || $(el).parent().next().text().trim()
        return false
      }
    })

    // ── Capítulos ──
    // zonatmo estructura: <li> con <h4><a href="#">Capítulo N</a></h4>
    // y dentro <a href="/view_uploads/ID">Leer online</a>
    // + fecha como texto libre "DD/MM/YYYY"
    const capitulos = []
    const vistos = new Set()

    $('li').each((i, liEl) => {
      // Buscar el link de lectura dentro del li
      const leerLink = $(liEl).find('a[href*="/view_uploads/"]').first()
      if (!leerLink.length) return
      const href = leerLink.attr('href') || ''
      if (vistos.has(href)) return
      vistos.add(href)
      const fullLink = href.startsWith('http') ? href : MANGA_BASE + href

      // Número: del h4/h3 > a (que apunta a "#") o del texto del h4
      const h4Text = $(liEl).find('h4, h3').first().text().trim()
      const numMatch = h4Text.match(/(\d+(?:\.\d+)?)/)
      const num = numMatch ? numMatch[1] : String(capitulos.length + 1)

      // Fecha: texto del li que tenga formato de fecha DD/MM/YYYY
      const liTexto = $(liEl).text()
      const fechaMatch = liTexto.match(/(\d{2}\/\d{2}\/\d{4})/)
      const fecha = fechaMatch ? fechaMatch[1] : ''

      capitulos.push({ num, link: fullLink, fecha })
    })

    capitulos.sort((a, b) => parseFloat(b.num) - parseFloat(a.num))

    // ── Tipo (MANGA / MANHWA / MANHUA) ──
    // zonatmo: primer h1 contiene solo "MANGA", "MANHWA" o "MANHUA"
    let tipo = 'MANGA'
    $('h1').each((i, el) => {
      const t = $(el).text().trim().toUpperCase()
      if (TIPOS.has(t)) { tipo = t; return false }
    })
    // Fallback: inferir de la URL /library/manhwa/ o /library/manga/
    if (tipo === 'MANGA') {
      if (url.includes('/library/manhwa/')) tipo = 'MANHWA'
      else if (url.includes('/library/manhua/')) tipo = 'MANHUA'
    }

    saveLCCache()
    return { titulo, imagen, sinopsis, generos: generos.slice(0, 8), capitulos, estado: estadoTxt, tipo }
  } catch(e) { console.error('[manga-detalle]', e.message); return null }
})

// ─── MANGA SOURCES ────────────────────────────────────────────────────────────
const MANGA_SOURCES = {
  zonatmo:   { id: 'zonatmo',   nombre: 'ZonaTMO',  BASE: 'https://zonatmo.com' },
  novelcool: { id: 'novelcool', nombre: 'NovelCool', BASE: 'https://es.novelcool.com' }
}
let _activeMangaSource = MANGA_SOURCES[appConfig?.['manga-source']] || MANGA_SOURCES['zonatmo']

let _novelcoolSrc = null
function _getNovelcoolSrc() {
  if (_novelcoolSrc) return _novelcoolSrc
  try {
    const createNC = require('./extractors/manga/novelcool')
    _novelcoolSrc = createNC({
      tmoBrowser, tmoCapBrowser,
      tmoCapBrowserFast: (url) => tmoCapBrowser(url, 2000),
      _browserRunJS: (url, base, js, waitMs) => new Promise((resolve) => {
        const w = new BrowserWindow({
          show: false, width: 1280, height: 900,
          webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:novelcool-cap' }
        })
        const cleanup = () => { try { if (!w.isDestroyed()) w.destroy() } catch(e){} }
        const timer = setTimeout(() => { cleanup(); resolve([]) }, (waitMs || 4000) + 8000)
        w.webContents.on('did-finish-load', async () => {
          try {
            await new Promise(r => setTimeout(r, waitMs || 4000))
            if (w.isDestroyed()) { clearTimeout(timer); resolve([]); return }
            const result = await w.webContents.executeJavaScript(js)
            clearTimeout(timer); cleanup(); resolve(result || [])
          } catch(e) { clearTimeout(timer); cleanup(); resolve([]) }
        })
        w.webContents.on('did-fail-load', (_, code) => {
          if (code === -3) return
          clearTimeout(timer); cleanup(); resolve([])
        })
        w.loadURL(url, { userAgent: UA })
      }),
      // Dos fases: carga + relleno del formulario, luego navegación/AJAX + extracción
      _browserRunJS2Step: (url, fillJs, extractJs, fillWaitMs, extractWaitMs) => new Promise((resolve) => {
        const w = new BrowserWindow({
          show: false, width: 1280, height: 900,
          webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:novelcool-cap' }
        })
        const cleanup = () => { try { if (!w.isDestroyed()) w.destroy() } catch(e){} }
        const timer = setTimeout(() => { cleanup(); resolve([]) }, (fillWaitMs || 2500) + (extractWaitMs || 5000) + 12000)
        let loads = 0, done = false
        const tryDone = (v) => { if (!done) { done = true; clearTimeout(timer); cleanup(); resolve(v) } }
        w.webContents.on('did-finish-load', async () => {
          loads++
          if (loads === 1) {
            // Página cargada: esperar render del formulario, rellenar, hacer submit
            await new Promise(r => setTimeout(r, fillWaitMs || 2500))
            if (done || w.isDestroyed()) { tryDone([]); return }
            try { await w.webContents.executeJavaScript(fillJs) } catch(e) {}
            // Para AJAX (sin navegación): extraer del mismo DOM después de extractWaitMs
            // Si hay navegación, did-finish-load dispara de nuevo (loads===2) y extrae allí primero
            await new Promise(r => setTimeout(r, extractWaitMs || 5000))
            if (done || w.isDestroyed()) { tryDone([]); return }
            try { tryDone(await w.webContents.executeJavaScript(extractJs) || []) } catch(e) { tryDone([]) }
          } else {
            // El formulario redirigió a una nueva página: extraer aquí (gana a loads===1)
            await new Promise(r => setTimeout(r, extractWaitMs || 5000))
            if (done || w.isDestroyed()) { tryDone([]); return }
            try { tryDone(await w.webContents.executeJavaScript(extractJs) || []) } catch(e) { tryDone([]) }
          }
        })
        w.webContents.on('did-fail-load', (_, code) => {
          if (code === -3) return
          tryDone([])
        })
        w.loadURL(url, { userAgent: UA })
      }),
      _ncCapBrowser: _ncCapBrowser,
      lcCoverCache, saveLCCache,
      lcDetailCache: new Map(), saveLCDetailCache: () => {},
      LC_DETAIL_TTL: 10 * 60 * 1000,
      UA
    })
  } catch(e) { console.error('[novelcool] init error', e.message) }
  if (_novelcoolSrc) return _novelcoolSrc
  try {
    const createNC = require('./extractors/manga/novelcool')
    _novelcoolSrc = createNC({
      tmoBrowser, tmoCapBrowser,
      tmoCapBrowserFast: (url) => tmoCapBrowser(url, 2000),
      _browserRunJS: (url, base, js, waitMs) => new Promise((resolve) => {
        const w = new BrowserWindow({
          show: false, width: 1280, height: 900,
          webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:novelcool-cap' }
        })
        const cleanup = () => { try { if (!w.isDestroyed()) w.destroy() } catch(e){} }
        const timer = setTimeout(() => { cleanup(); resolve([]) }, (waitMs || 4000) + 8000)
        w.webContents.on('did-finish-load', async () => {
          try {
            await new Promise(r => setTimeout(r, waitMs || 4000))
            if (w.isDestroyed()) { clearTimeout(timer); resolve([]); return }
            const result = await w.webContents.executeJavaScript(js)
            clearTimeout(timer); cleanup(); resolve(result || [])
          } catch(e) { clearTimeout(timer); cleanup(); resolve([]) }
        })
        w.webContents.on('did-fail-load', (_, code) => {
          if (code === -3) return
          clearTimeout(timer); cleanup(); resolve([])
        })
        w.loadURL(url, { userAgent: UA })
      }),
      _browserRunJS2Step: (url, fillJs, extractJs, fillWaitMs, extractWaitMs) => new Promise((resolve) => {
        const w = new BrowserWindow({
          show: false, width: 1280, height: 900,
          webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:novelcool-cap' }
        })
        const cleanup = () => { try { if (!w.isDestroyed()) w.destroy() } catch(e){} }
        const timer = setTimeout(() => { cleanup(); resolve([]) }, (fillWaitMs || 2500) + (extractWaitMs || 5000) + 12000)
        let loads = 0, done = false
        const tryDone = (v) => { if (!done) { done = true; clearTimeout(timer); cleanup(); resolve(v) } }
        w.webContents.on('did-finish-load', async () => {
          loads++
          if (loads === 1) {
            await new Promise(r => setTimeout(r, fillWaitMs || 2500))
            if (done || w.isDestroyed()) { tryDone([]); return }
            try { await w.webContents.executeJavaScript(fillJs) } catch(e) {}
            await new Promise(r => setTimeout(r, extractWaitMs || 5000))
            if (done || w.isDestroyed()) { tryDone([]); return }
            try { tryDone(await w.webContents.executeJavaScript(extractJs) || []) } catch(e) { tryDone([]) }
          } else {
            await new Promise(r => setTimeout(r, extractWaitMs || 5000))
            if (done || w.isDestroyed()) { tryDone([]); return }
            try { tryDone(await w.webContents.executeJavaScript(extractJs) || []) } catch(e) { tryDone([]) }
          }
        })
        w.webContents.on('did-fail-load', (_, code) => {
          if (code === -3) return
          tryDone([])
        })
        w.loadURL(url, { userAgent: UA })
      }),
      _ncCapBrowser: _ncCapBrowser,
      lcCoverCache, saveLCCache,
      lcDetailCache: new Map(), saveLCDetailCache: () => {},
      LC_DETAIL_TTL: 10 * 60 * 1000,
      UA
    })
  } catch(e) { console.error('[novelcool] init error', e.message) }
  return _novelcoolSrc
}

ipcMain.handle('get-manga-sources', () =>
  Object.values(MANGA_SOURCES).map(s => ({ id: s.id, nombre: s.nombre }))
)
ipcMain.handle('get-manga-source', () => _activeMangaSource?.id || 'zonatmo')
ipcMain.handle('set-manga-source', (_, id) => {
  const src = MANGA_SOURCES[id]; if (!src) return false
  _activeMangaSource = src
  if (appConfig) { appConfig['manga-source'] = id; guardarConfig() }
  return true
})

ipcMain.handle('get-manga-paginas', async (event, url, sourceIdx) => {
  if (url && url.includes('novelcool')) {
    const nc = _getNovelcoolSrc()
    if (nc?.getPaginas) {
      const onChunk = (pages) => {
        try {
          if (!event.sender.isDestroyed()) {
            if (pages && pages.done) {
              event.sender.send('nc-pages-done', pages.total)
            } else {
              event.sender.send('nc-pages-more', pages)
            }
          }
        } catch(e) {}
      }
      return await nc.getPaginas(url, sourceIdx, onChunk)
    }
  }
  return tmoCapBrowser(url, 4500)
})

// ─── WINDOW / UI HANDLERS ─────────────────────────────────────────────────────
ipcMain.handle('is-maximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.on('set-win-bg', (_, color) => {
  try { if (mainWindow && color) mainWindow.setBackgroundColor(color) } catch(e) {}
})
ipcMain.on('app-ready', () => {})

// ─── CONFIG HANDLERS ─────────────────────────────────────────────────────────
ipcMain.handle('config-get',     ()        => appConfig)
ipcMain.handle('config-set',     (_, k, v) => { appConfig[k] = v; guardarConfig() })
ipcMain.handle('config-set-all', (_, data) => { Object.assign(appConfig, data); guardarConfig() })

// ─── BACKGROUND IMAGE ─────────────────────────────────────────────────────────
const BG_FILE = path.join(app.getPath('userData'), 'anistream-bg.txt')
ipcMain.handle('bg-get', () => {
  try { return fs.readFileSync(BG_FILE, 'utf8') || null } catch(e) { return null }
})
ipcMain.handle('bg-set', (_, dataUrl) => {
  try {
    if (dataUrl) fs.writeFileSync(BG_FILE, dataUrl, 'utf8')
    else { try { fs.unlinkSync(BG_FILE) } catch(e) {} }
  } catch(e) {}
})

// ─── CHECK SERVIDORES ─────────────────────────────────────────────────────────
ipcMain.handle('check-servidores', async (_, servidores) => {
  if (!Array.isArray(servidores)) return []
  const results = await Promise.allSettled(
    servidores.map(s => axios.head(s.url, { timeout: 4000, headers: HEADERS })
      .then(() => ({ ...s, ok: true })).catch(() => ({ ...s, ok: false })))
  )
  return results.map(r => r.status === 'fulfilled' ? r.value : { ok: false })
})

// ─── CHECK NUEVOS EPS ─────────────────────────────────────────────────────────
ipcMain.handle('check-nuevos-eps', async (_, items) => {
  if (!Array.isArray(items) || !items.length) return []
  const nuevos = []
  for (const item of items.slice(0, 10)) {
    try {
      const src = item.url?.includes('animeflv.net') ? animeflv : latanime
      const info = await src.getAnime(item.url)
      const lastEp = info?.episodios?.length ? info.episodios[info.episodios.length - 1].num : 0
      if (lastEp > (item.lastEp || 0)) nuevos.push({ ...item, newEp: lastEp })
    } catch(e) {}
  }
  return nuevos
})


// ─── AUTO UPDATER ─────────────────────────────────────────────────────────────
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'FaxTheGhoul',
  repo: 'ryoku',
  token: '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',
  private: true,
})
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function initUpdater(win) {
  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update-available', info.version)
  })
  autoUpdater.on('download-progress', (p) => {
    win.webContents.send('update-progress', Math.round(p.percent))
  })
  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('update-downloaded')
  })
  autoUpdater.on('error', (e) => {
    console.error('[Updater]', e.message)
  })
  // Chequear al abrir, con delay para no bloquear el splash
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000)
}

ipcMain.on('update-download', () => autoUpdater.downloadUpdate())
ipcMain.on('update-install',  () => autoUpdater.quitAndInstall())

// ─── GOOGLE AUTH — abre en navegador del sistema ──────────────────────────────
ipcMain.handle('google-auth', () => {
  return new Promise((resolve) => {
    let resolved = false

    function doResolve (data) {
      if (resolved) return
      resolved = true
      try { server.close() } catch (e) {}
      resolve(data)
    }

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost')

      // ── Página principal: carga Firebase y hace signInWithPopup ──────────
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>RYOKU — Iniciar sesion</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0F172A;color:#F8FAFC}
  .box{text-align:center;padding:2rem;max-width:320px}
  h2{font-size:1.3rem;margin-bottom:.5rem}
  p{color:#94a3b8;font-size:.875rem;line-height:1.5;margin-bottom:1.5rem}
  .btn{display:inline-flex;align-items:center;gap:10px;background:#1e293b;border:1px solid #334155;border-radius:10px;padding:10px 24px;color:#F8FAFC;font-size:.9rem;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s;font-family:inherit}
  .btn:hover{background:#253347;border-color:#60A5FA}
  .btn:disabled{opacity:.5;cursor:default}
  .ok{color:#4ade80}
  .err{color:#f87171;margin-top:.5rem;font-size:.8rem}
</style>
</head>
<body>
<div class="box">
  <h2>Iniciar sesion en RYOKU</h2>
  <p>Haz click para conectar tu cuenta de Google y sincronizar tus datos.</p>
  <button class="btn" id="btn" onclick="login()">
    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
    Continuar con Google
  </button>
  <p class="err" id="err-msg" style="display:none"></p>
</div>
<script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js"></script>
<script>
  firebase.initializeApp({"apiKey":"AIzaSyBJHAIT0LWoapssUbvUKzlYeB82ud54-HA","authDomain":"ryoku-app-53e5c.firebaseapp.com","projectId":"ryoku-app-53e5c","storageBucket":"ryoku-app-53e5c.firebasestorage.app","messagingSenderId":"616976179183","appId":"1:616976179183:web:2b1240f258faf6bb0d601a"})
  var auth = firebase.auth()
  var provider = new firebase.auth.GoogleAuthProvider()
  var box = document.querySelector('.box')
  var btn = document.getElementById('btn')
  var errMsg = document.getElementById('err-msg')

  function login() {
    btn.disabled = true
    btn.textContent = 'Conectando...'
    errMsg.style.display = 'none'
    auth.signInWithPopup(provider).then(function(result) {
      var idToken     = result.credential && result.credential.idToken
      var accessToken = result.credential && result.credential.accessToken
      return fetch('/auth-result', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ idToken: idToken, accessToken: accessToken })
      })
    }).then(function() {
      box.innerHTML = '<h2 class="ok">&#10003; Sesion iniciada</h2><p>Puedes cerrar esta pestana y volver a RYOKU.</p>'
    }).catch(function(err) {
      var code = err && err.code || 'unknown'
      fetch('/auth-result', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({error:code})})
      btn.disabled = false
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Continuar con Google'
      if (code !== 'auth/popup-closed-by-user') {
        errMsg.textContent = err.message || code
        errMsg.style.display = 'block'
      }
    })
  }
</script>
</body>
</html>`)

      // ── Recibir tokens desde la página ───────────────────────────────────
      } else if (url.pathname === '/auth-result' && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += chunk.toString() })
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            res.writeHead(200); res.end('OK')
            if (data.idToken || data.accessToken) {
              doResolve({ idToken: data.idToken, accessToken: data.accessToken })
            } else {
              doResolve({ error: data.error || 'cancelled' })
            }
          } catch (e) { res.writeHead(400); res.end('Bad Request') }
        })
      } else {
        res.writeHead(404); res.end('Not found')
      }
    })

    server.on('error', () => doResolve({ error: 'server_error' }))

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      shell.openExternal('http://127.0.0.1:' + port)
    })
  })
})
