const { app, BrowserWindow, ipcMain, session, dialog, shell, nativeImage } = require('electron')
const path = require('path')
const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
// ── LOG TEMPORAL DE DIAGNOSTICO -- flujo de cierre para actualizar ─────────
// Se escribe directo en la carpeta del proyecto (no en os.tmpdir(), que en
// el .exe empaquetado cae en el temp de Windows y no es visible desde aca)
// para poder leerlo despues del build. Sacar una vez resuelto el bug del
// instalador NSIS "no se puede cerrar RYOKU".
function _logQuit(msg) {
  try { fs.appendFileSync('D:\\Programas\\anime-app\\ryoku-quit-debug.log', `[${new Date().toISOString()}] ${msg}\n`) } catch (e) {}
}
const http  = require('http')
const https = require('https')
const extractors  = require('./extractors/anime')
const latanime     = require('./extractors/anime/latanime')
const animeav1     = require('./extractors/anime/animeav1')
const { MIXDROP_LEGIT } = require('./extractors/anime/_base')
// MangaOni no necesita BrowserWindow/caches inyectados (a diferencia de
// NovelCool) -- es un módulo plano de axios+cheerio, se puede requerir directo.
const mangaOni = require('./extractors/manga/manga-oni')

// ── Desactivar crashpad_handler.exe ────────────────────────────────────────
// Electron levanta por defecto un proceso aparte (crashpad_handler.exe, con
// nombre DISTINTO a RYOKU.exe) para reportar crashes -- no lo usamos (no hay
// servidor de crash reports configurado) y aca no aporta nada, pero es un
// gotcha conocido de Electron: ese proceso puede quedar vivo unos instantes
// despues de que RYOKU.exe ya cerro, reteniendo un handle sobre algun archivo
// de la carpeta de instalacion. El propio instalador NSIS de electron-builder
// SI revisa que "RYOKU.exe" ya no este corriendo antes de actualizar -- pero
// no tiene forma de saber de crashpad_handler.exe, y cuando el desinstalador
// de la version vieja intenta renombrar los archivos para limpiarlos
// (un.atomicRMDir, ver uninstaller.nsh) se encuentra el archivo "ocupado" y
// aborta con "Fallo al desinstalar archivos antiguos... : 2". Desactivando
// el crash reporter, ese proceso nunca se crea y el archivo nunca queda
// bloqueado.
app.commandLine.appendSwitch('disable-crash-reporter')

// ─── Instancia única ───────────────────────────────────────────────────────
// Sin esto, abrir la app dos veces (doble clic al acceso directo mientras ya
// está abierta, etc.) hace que dos procesos lean el mismo JSON de favoritos/
// historial/progreso al arrancar y después escriban cada uno por su cuenta:
// el que se cierra último pisa silenciosamente los cambios que hizo el otro.
// Con el lock, el segundo intento de abrir la app no crea un proceso nuevo:
// solo le avisa al primero (evento 'second-instance') que traiga la ventana
// existente al frente.
const _gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!_gotSingleInstanceLock) {
  _logQuit('no se obtuvo el lock de instancia unica al arrancar (pid=' + process.pid + '), cerrando esta copia')
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => {
  _logQuit('second-instance recibido, mainWindow existe=' + !!mainWindow + ' destruida=' + (mainWindow ? mainWindow.isDestroyed() : 'n/a'))
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

// ─── Guardado atómico con backup ──────────────────────────────────────────
// Reemplaza los fs.writeFileSync directos para los datos que realmente
// importa no perder (config, favoritos, historial, progreso, tombstones):
// 1) Escribe a un .tmp en la MISMA carpeta y hace fs.renameSync sobre el
//    archivo final. rename() es atómico dentro del mismo volumen (en
//    Windows y en POSIX): si la app se cierra de golpe, se corta la luz o
//    lo mata el sistema a mitad de una escritura, el .tmp queda a medio
//    escribir pero el archivo real nunca se toca hasta que el rename ya
//    tiene los bytes completos listos — nunca queda un JSON a medias.
// 2) Antes de pisar el archivo, si el que ya está en disco es JSON válido,
//    lo copia a .bak. Así, si algún día el archivo real aparece corrupto
//    igual (disco con errores, antivirus raro, etc.), _loadJSONSeguro
//    puede recuperar la versión anterior en vez de tirar todo y arrancar
//    de cero en silencio.
function _guardarJSONSeguro(f, data) {
  try {
    const json = JSON.stringify(data)
    const tmp = f + '.tmp'
    fs.writeFileSync(tmp, json)
    try {
      if (fs.existsSync(f)) {
        JSON.parse(fs.readFileSync(f, 'utf8'))
        fs.copyFileSync(f, f + '.bak')
      }
    } catch (eBak) {}
    fs.renameSync(tmp, f)
  } catch (e) {}
}
function _loadJSONSeguro(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) {
    try { return JSON.parse(fs.readFileSync(f + '.bak', 'utf8')) } catch (e2) { return fallback }
  }
}

// ── Servidor local para búsqueda con BrowserWindow (bypass Cloudflare) ──
const _localServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const u = new URL(req.url, 'http://localhost')
  if (u.pathname === '/api/anime/buscar') {
    const q = u.searchParams.get('q') || ''
    const src = u.searchParams.get('source') || 'latanime'
    try {
      let raw
      if (src === 'animeav1') raw = await animeav1.buscar(q)
      else raw = await latanime.getBiblioteca({ query: q })
      const data = Array.isArray(raw) ? raw : (raw?.lista || [])
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('[]')
    }
  } else if (u.pathname === '/api/anime/biblioteca') {
    const src   = u.searchParams.get('source')    || 'latanime'
    const query  = u.searchParams.get('query')    || ''
    const genero = u.searchParams.get('genero')   || ''
    const tipo   = u.searchParams.get('categoria')|| ''
    const page   = parseInt(u.searchParams.get('page') || '1', 10)
    try {
      let result
      if (src === 'animeav1') result = await animeav1.getBiblioteca({ query, genero, categoria: tipo, page })
      else result = await latanime.getBiblioteca({ query, genero, tipo, page })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ lista: [], hayMas: false }))
    }
  } else {
    // Proxy al servidor remoto para todo lo demás
    const remoteUrl = 'https://ryoku.onrender.com' + req.url
    const proxyReq = https.get(remoteUrl, { headers: { 'Accept': 'application/json' } }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      proxyRes.pipe(res)
    })
    proxyReq.on('error', () => { try { res.writeHead(502); res.end('[]') } catch(e){} })
  }
})
_localServer.listen(3001, '127.0.0.1', () => console.log('[local-server] puerto 3001'))
const DiscordRPC  = require('discord-rpc')
const { autoUpdater } = require('electron-updater')

// Red de seguridad global: un error async sin capturar (p.ej. un evento
// del autoUpdater disparando webContents.send sobre una ventana ya
// destruida) no debe tumbar todo el proceso principal.
process.on('uncaughtException', (err) => { console.error('[uncaughtException]', err) })
process.on('unhandledRejection', (err) => { console.error('[unhandledRejection]', err) })


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
try {
  const j = JSON.parse(fs.readFileSync(JIKAN_CACHE_FILE,'utf8'))
  // Migración: entradas cacheadas antes de agregar members/popularity/favorites
  // se descartan para que se vuelvan a pedir con los datos completos.
  Object.entries(j).forEach(([k,v]) => { if (!v || v.members !== undefined) jikanCache.set(k,v) })
} catch(e){}
function guardarJikanCache() { try { const o={}; jikanCache.forEach((v,k)=>{o[k]=v}); fs.writeFileSync(JIKAN_CACHE_FILE,JSON.stringify(o)) } catch(e){} }

// ── TOP ANIME REAL (mismos datos que myanimelist.net/topanime.php, vía Jikan) ──
let _jikanTopCache = { data: null, ts: 0 }
const _JIKAN_TOP_TTL = 6 * 60 * 60 * 1000 // 6h — el ranking global no cambia seguido

// Cola global para las peticiones axios a Jikan que sigue usando jikanBuscar
// (enriquecimiento de tarjetas, sinopsis de respaldo, etc.) — evita que varias
// llamadas concurrentes superen el límite de 3 req/s de la API pública.
//
// Tiene DOS niveles de prioridad porque no todas las llamadas son iguales:
// el enriquecimiento en segundo plano de la grilla de inicio (20+ tarjetas)
// puede encolar muchísimas peticiones de una vez, y antes una cola simple
// (una sola cadena de .then) hacía que abrir la ficha de un anime -- donde
// el usuario SÍ está esperando en pantalla -- se pusiera detrás de todo ese
// trabajo de fondo, sumando hasta 15-20s de espera solo en cola. Con
// prioridad 'alta' (usada al abrir una ficha), esa llamada se procesa antes
// que cualquier tarea normal pendiente, sin romper el límite de 3 req/s
// (se sigue respetando el mismo hueco de 500ms entre cada petición, sea cual
// sea su prioridad).
let _jikanColaAlta = []
let _jikanColaNormal = []
let _jikanProcesando = false
function _jikanEncolar(fn, opts) {
  return new Promise((resolve, reject) => {
    const tarea = { fn, resolve, reject }
    if (opts && opts.prioridad === 'alta') _jikanColaAlta.push(tarea)
    else _jikanColaNormal.push(tarea)
    _jikanProcesarCola()
  })
}
async function _jikanProcesarCola() {
  if (_jikanProcesando) return
  _jikanProcesando = true
  while (_jikanColaAlta.length || _jikanColaNormal.length) {
    const tarea = _jikanColaAlta.length ? _jikanColaAlta.shift() : _jikanColaNormal.shift()
    try { tarea.resolve(await tarea.fn()) } catch (e) { tarea.reject(e) }
    if (_jikanColaAlta.length || _jikanColaNormal.length) await new Promise(r => setTimeout(r, 500))
  }
  _jikanProcesando = false
}

// Confirmado con el usuario: api.jikan.moe y graphql.anilist.co responden
// perfecto desde un navegador normal, pero axios/Node recibe 504/403 en las
// mismas peticiones — bloqueo por fingerprint (anti-bot), no caída real del
// servicio ni de la red del usuario. Mismo problema que ya resolvimos para
// AnimeFLV (Cloudflare): usar un BrowserWindow oculto real en vez de axios.

// GET: navegar directo a la URL (igual que la prueba manual del usuario, que
// sí funcionó) y leer el texto plano de la respuesta JSON — sin fetch(), sin
// CORS de por medio.
async function _fetchGetComoNavegador(url) {
  return await new Promise((resolve, reject) => {
    let win = null
    const timer = setTimeout(() => { if (win && !win.isDestroyed()) win.destroy(); reject(new Error('timeout esperando la ventana oculta')) }, 15000)
    win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
    win.webContents.on('did-finish-load', async () => {
      try {
        const texto = await win.webContents.executeJavaScript('document.body.innerText')
        clearTimeout(timer); win.destroy(); resolve(texto)
      } catch(e) { clearTimeout(timer); if (!win.isDestroyed()) win.destroy(); reject(e) }
    })
    win.webContents.on('did-fail-load', (_, code, desc) => { if (code === -3) return; clearTimeout(timer); win.destroy(); reject(new Error(`did-fail-load ${code} ${desc}`)) })
    win.loadURL(url)
  })
}

// POST: cargar primero un origen real (anilist.co) — un fetch cruzado desde
// about:blank (origen "null") daba "Failed to fetch" por CORS; desde el sitio
// real de AniList el propio frontend hace exactamente este mismo fetch.
async function _fetchPostComoNavegador(paginaOrigen, url, body) {
  return await new Promise((resolve, reject) => {
    let win = null
    const timer = setTimeout(() => { if (win && !win.isDestroyed()) win.destroy(); reject(new Error('timeout esperando la ventana oculta')) }, 15000)
    win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
    win.webContents.on('did-finish-load', async () => {
      try {
        const bodyLiteral = JSON.stringify(JSON.stringify(body))
        const script = `
          fetch(${JSON.stringify(url)}, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: ${bodyLiteral}
          }).then(r => r.text())
        `
        const texto = await win.webContents.executeJavaScript(script)
        clearTimeout(timer); win.destroy(); resolve(texto)
      } catch(e) { clearTimeout(timer); if (!win.isDestroyed()) win.destroy(); reject(e) }
    })
    win.webContents.on('did-fail-load', (_, code, desc) => { if (code === -3) return; clearTimeout(timer); win.destroy(); reject(new Error(`did-fail-load ${code} ${desc}`)) })
    win.loadURL(paginaOrigen)
  })
}

// AniList (GraphQL) como fuente alternativa/primaria — servicio independiente
// de Jikan (si uno está caído, el otro suele estar bien), sin autenticación,
// y su orden "TRENDING" refleja actividad reciente real de la comunidad —
// encaja mejor con "esta semana" que el conteo estático de miembros de MAL.
let _anilistTopCache = { data: null, ts: 0 }
async function anilistTopAnime() {
  if (_anilistTopCache.data && Date.now() - _anilistTopCache.ts < _JIKAN_TOP_TTL) return _anilistTopCache.data
  const query = `query ($perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
        title { romaji english }
        coverImage { large }
        averageScore
        popularity
        favourites
      }
    }
  }`
  try {
    const texto = await _fetchPostComoNavegador('https://anilist.co', 'https://graphql.anilist.co', { query, variables: { perPage: 25 } })
    const json = JSON.parse(texto)
    const lista = json?.data?.Page?.media || []
    const data = lista.map(a => ({
      titulo:       a.title?.romaji || a.title?.english || '',
      tituloIngles: a.title?.english || '',
      score:        a.averageScore ? a.averageScore / 10 : null, // AniList usa 0-100, MAL usa 0-10
      members:      a.popularity,
      rank:         null,
      imagen:       a.coverImage?.large || '',
    })).filter(a => a.titulo)
    if (!data.length) throw new Error('respuesta vacía: ' + texto.slice(0, 200))
    _anilistTopCache = { data, ts: Date.now() }
    console.log('[anilistTopAnime] OK, primeros títulos:', data.slice(0,5).map(a=>a.titulo).join(', '))
    return data
  } catch(e) {
    console.error('[anilistTopAnime] fallo:', e.message)
    return _anilistTopCache.data || []
  }
}

// Intenta AniList primero (independiente de Jikan) y si falla del todo cae a Jikan.
async function topAnimeReal() {
  // AniList primero: su orden TRENDING refleja lo que está sonando AHORA
  // (pedido explícito del usuario), no popularidad histórica acumulada como
  // el ranking de MAL — Jikan queda de respaldo si AniList falla.
  const anilist = await anilistTopAnime()
  if (anilist.length) return anilist
  console.log('[topAnimeReal] AniList sin datos, probando Jikan como respaldo...')
  return await jikanTopAnime()
}

async function jikanTopAnime() {
  if (_jikanTopCache.data && Date.now() - _jikanTopCache.ts < _JIKAN_TOP_TTL) return _jikanTopCache.data
  // bypopularity = ranking real por cantidad de miembros de MAL (equivalente a
  // "más populares"), NO por score — el ranking por score (topanime.php por
  // defecto) está lleno de películas/OVAs y clásicos de nicho que casi nunca
  // están en un sitio de streaming Latino enfocado en estrenos recientes.
  const intentos = 2
  for (let i = 1; i <= intentos; i++) {
    try {
      const texto = await _fetchGetComoNavegador('https://api.jikan.moe/v4/top/anime?filter=bypopularity&limit=25')
      const json = JSON.parse(texto)
      const data = (json?.data || []).map(a => ({
        malId:        a.mal_id,
        titulo:       a.title,
        tituloIngles: a.title_english || '',
        score:        a.score,
        members:      a.members,
        rank:         a.rank,
        imagen:       a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || '',
      }))
      if (!data.length) throw new Error('respuesta vacía: ' + texto.slice(0, 200))
      _jikanTopCache = { data, ts: Date.now() }
      console.log('[jikanTopAnime] OK, primeros títulos:', data.slice(0,5).map(a=>a.titulo).join(', '))
      return data
    } catch(e) {
      console.error(`[jikanTopAnime] fallo (intento ${i}/${intentos}):`, e.message)
      if (i < intentos) await new Promise(r => setTimeout(r, 1500))
    }
  }
  return _jikanTopCache.data || []
}

// Cruza el Top Anime real de MAL con el catálogo del sitio activo, para que
// el panel "Top de la semana" muestre ranking/score/members reales pero
// enlazando a contenido que sí existe (y se puede reproducir) en el sitio.
//
// Antes era UNA sola caché (no por fuente): alternar entre latanime y
// monoschinos invalidaba la del otro cada vez, así que volver a una fuente
// pagaba el costo completo de nuevo aunque se hubiera consultado hace poco
// — esto se notaba más en MonosChinos porque sus búsquedas son mucho más
// lentas (pasan por una ventana oculta para el bypass de Cloudflare, no un
// simple pedido HTTP como latanime). Ahora hay una entrada por fuente, y
// además se persiste en disco para que un reinicio de la app no la pierda.
const TOP_SEMANA_CACHE_FILE = path.join(os.tmpdir(), 'ryoku-top-semana.json')
let _topSemanaRealCache = {} // { [srcId]: { data, ts } }
try { _topSemanaRealCache = JSON.parse(fs.readFileSync(TOP_SEMANA_CACHE_FILE, 'utf8')) || {} } catch(e) {}
function _guardarTopSemanaCache() { try { fs.writeFileSync(TOP_SEMANA_CACHE_FILE, JSON.stringify(_topSemanaRealCache)) } catch(e) {} }
const _TOP_SEMANA_TTL = 30 * 60 * 1000 // 30 min

async function topSemanaReal(limite = 5) {
  const srcId = _activeAnimeSource?.id || 'latanime'
  const cacheEntry = _topSemanaRealCache[srcId]
  if (cacheEntry?.data && Date.now() - cacheEntry.ts < _TOP_SEMANA_TTL) {
    return cacheEntry.data
  }
  const top = await topAnimeReal()
  if (!top.length) { console.error('[topSemanaReal] sin datos de AniList ni Jikan, abortando'); return _topSemanaRealCache[srcId]?.data || [] }
  const buscarEnSitio = q => srcId === 'animeav1' ? animeav1.buscar(q) : latanime.buscar(q)
  const candidatos = top.slice(0, 25)

  // Se busca en bloques de a CONCURRENCIA candidatos (paralelo dentro de cada
  // bloque, para acelerar en fuentes que sí soportan pedidos concurrentes)
  // pero SE DETIENE apenas hay "limite" coincidencias — igual que la versión
  // secuencial original. Sin este corte, en MonosChinos (cuyas búsquedas pasan
  // todas por una sola ventana compartida en cola, por el bypass de
  // Cloudflare) encolar los 25 candidatos sin parar podía tardar varios
  // minutos y el panel se quedaba "cargando" sin dar nunca resultado.
  const CONCURRENCIA = 6
  const resultados = []
  for (let start = 0; start < candidatos.length && resultados.length < limite; start += CONCURRENCIA) {
    const bloque = candidatos.slice(start, start + CONCURRENCIA)
    const encontradosBloque = await Promise.all(bloque.map(async (a) => {
      // Varias variantes de título: los sitios Latinos a veces guardan el nombre
      // en inglés, a veces el romaji de MAL, y a veces solo la parte antes de ":"
      const variantes = [a.tituloIngles, a.titulo]
        .filter(Boolean)
        .flatMap(t => [t, t.split(':')[0].trim()])
        .filter((t, idx, arr) => t && arr.indexOf(t) === idx)
      let encontrados = []
      for (const v of variantes) {
        try { encontrados = await buscarEnSitio(v) } catch(e) {}
        if (encontrados.length) break
      }
      if (!encontrados.length) { console.log('[topSemanaReal] sin match local para:', a.titulo); return null }
      return { a, local: encontrados[0] }
    }))
    for (const m of encontradosBloque) {
      if (!m) continue
      if (resultados.length >= limite) break
      console.log('[topSemanaReal] match:', m.a.titulo, '→', m.local.titulo)
      resultados.push({
        titulo: m.local.titulo, link: m.local.link, imagen: m.a.imagen || m.local.imagen || '', idioma: m.local.idioma || '',
        malScore: m.a.score, malMembers: m.a.members, malRank: m.a.rank
      })
    }
  }
  console.log(`[topSemanaReal] ${resultados.length}/${limite} encontrados`)
  _topSemanaRealCache[srcId] = { data: resultados, ts: Date.now() }
  _guardarTopSemanaCache()
  return resultados
}

// CACHE DE BÚSQUEDAS EN MEMORIA (evita repetir peticiones de red)
const _buscarAnimeCache  = new Map()
const _buscarMangaCache  = new Map()
const _BUSCAR_TTL        = 5 * 60 * 1000  // 5 minutos
// Cache de biblioteca -- sin esto, cada entrada a Biblioteca (y cada cambio
// de página/filtro, incluso volver a una página ya vista) repetía toda la
// extracción desde cero. Para MonosChinos eso significa abrir una
// BrowserWindow oculta, esperar el bypass de Cloudflare y el render de Vue
// (varios segundos) -- por eso se sentía tan lento. Con cache, volver a una
// combinación de filtros/página ya vista es instantáneo dentro del TTL.
const _bibliotecaCache    = new Map()
const _BIBLIOTECA_TTL     = 5 * 60 * 1000  // 5 minutos
// Cleanup periódico para evitar que los mapas crezcan sin límite en sesiones largas
setInterval(() => {
  const n = Date.now()
  for (const [k,v] of _buscarAnimeCache) if (n - v.ts > _BUSCAR_TTL) _buscarAnimeCache.delete(k)
  for (const [k,v] of _buscarMangaCache) if (n - v.ts > _BUSCAR_TTL) _buscarMangaCache.delete(k)
  for (const [k,v] of _bibliotecaCache)  if (n - v.ts > _BIBLIOTECA_TTL) _bibliotecaCache.delete(k)
}, 10 * 60 * 1000)

// ─── BÚSQUEDA CON TOLERANCIA A ERRORES ORTOGRÁFICOS ────────────────────────
// Los sitios fuente (latanime, monoschinos, zonatmo, novelcool) hacen su
// propio matching por substring -- si el usuario escribe "atac on titan" o
// "one peice", el sitio no devuelve nada porque el substring no coincide
// literal. Estrategia: 1) probar la búsqueda tal cual la escribió el usuario
// (así se preserva el orden/relevancia que ya da el sitio cuando SÍ hay un
// buen match); 2) si nada de lo que volvió se parece de verdad al query, es
// probable que haya un typo -- reintentar con solo la palabra más larga/única
// del query (para que el sitio, que sí hace substring, traiga candidatos más
// amplios) y combinar con lo que ya había; 3) reordenar todo por similitud
// difusa (tolera letras cambiadas/faltantes, tildes, orden de palabras) al
// texto original, para que lo más parecido a lo que el usuario quiso escribir
// quede primero.

function _normalizarBusqueda(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function _distanciaLevenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array(n + 1), curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + costo)
    }
    const tmp = prev; prev = curr; curr = tmp
  }
  return prev[n]
}

function _similitudIgualLargo(a, b) {
  if (!a.length && !b.length) return 1
  return 1 - _distanciaLevenshtein(a, b) / Math.max(a.length, b.length)
}

// Similitud 0..1 entre lo que escribió el usuario y el título de un resultado.
function _similitudTitulo(query, titulo) {
  const q = _normalizarBusqueda(query)
  const t = _normalizarBusqueda(titulo)
  if (!q || !t) return 0
  if (t.includes(q)) return 1
  if (q.includes(t)) return 0.95

  let mejor = _similitudIgualLargo(q, t)

  // Ventana deslizante del largo del query sobre el título -- para títulos
  // largos con subtítulo/temporada donde el query es solo una parte.
  if (t.length > q.length) {
    for (let i = 0; i <= t.length - q.length; i++) {
      const s = _similitudIgualLargo(q, t.slice(i, i + q.length))
      if (s > mejor) mejor = s
    }
  }

  // Comparación palabra por palabra -- tolera orden distinto y typos aislados
  const qPalabras = q.split(' ').filter(Boolean)
  const tPalabras = t.split(' ').filter(Boolean)
  if (qPalabras.length && tPalabras.length) {
    const proms = qPalabras.map(qw => Math.max(...tPalabras.map(tw => _similitudIgualLargo(qw, tw))))
    const prom = proms.reduce((a, b) => a + b, 0) / proms.length
    if (prom > mejor) mejor = prom
  }
  return mejor
}

// Umbral desde el cual consideramos que un resultado SÍ es lo que el usuario
// buscaba (tolera 1-2 letras cambiadas/faltantes en una palabra típica).
const _SIMILITUD_OK = 0.72

// lista: resultados ya obtenidos con el query tal cual. buscarAmplio(clave):
// re-ejecuta la búsqueda del sitio activo con una palabra clave más simple.
// opts.maxIntentos: máximo de llamadas extra de red a buscarAmplio (por
// defecto 3). Pasar 0 desactiva los reintentos de red por completo -- útil
// para fuentes con pipelines caros/lentos (p.ej. monoschinos) -- pero el
// reordenamiento por similitud de lo que YA se obtuvo sigue aplicando gratis.
// opts.timeoutMs: tiempo máximo por intento de red antes de darlo por
// perdido (por defecto 8000ms), para que una fuente lenta no cuelgue toda
// la búsqueda -- si se agota, ese intento simplemente no aporta resultados.
async function _buscarConTolerancia(textoOriginal, lista, buscarAmplio, getTitulo = m => m.titulo, opts = {}) {
  const { maxIntentos = 3, timeoutMs = 8000 } = opts
  const texto = (textoOriginal || '').trim()
  if (!texto || !Array.isArray(lista)) return lista
  const sim = (m) => _similitudTitulo(texto, getTitulo(m) || '')
  let combinada = lista
  const vistos = new Set(combinada.map(m => m.link || m.url).filter(Boolean))
  const yaBuenMatch = () => combinada.some(m => sim(m) >= _SIMILITUD_OK)
  if (combinada.length && yaBuenMatch()) return combinada

  let intentos = 0
  const agregar = async (clave) => {
    if (!clave || intentos >= maxIntentos) return
    intentos++
    try {
      const tarea = Promise.resolve(buscarAmplio(clave))
      const extra = (timeoutMs > 0
        ? await Promise.race([
            tarea,
            new Promise(resolve => setTimeout(() => resolve([]), timeoutMs))
          ])
        : await tarea) || []
      extra.forEach(m => {
        const k = m.link || m.url
        if (k && !vistos.has(k)) { vistos.add(k); combinada = combinada.concat([m]) }
      })
    } catch (e) { console.error('[busqueda-tolerante]', e.message) }
  }

  if (maxIntentos > 0) {
    // Probable typo: reintentar con cada palabra del query (la más larga
    // primero -- suele ser la más discriminativa) hasta encontrar un buen
    // match. Probamos todas por si el typo cae justo en la más larga.
    const palabras = [...new Set(texto.split(/\s+/).filter(w => w.length >= 3))]
      .sort((a, b) => b.length - a.length)
    for (const palabra of palabras) {
      if (yaBuenMatch() || intentos >= maxIntentos) break
      if (palabra.toLowerCase() !== texto.toLowerCase()) await agregar(palabra)
    }

    // Si nada dio un buen match (el typo cae en la única palabra del query, o
    // al principio de todas), probar con un prefijo más corto -- los errores
    // suelen estar más adentro de la palabra que al principio, así que un
    // prefijo tiene más chance de seguir siendo substring del título real.
    if (!yaBuenMatch() && intentos < maxIntentos) {
      const base = palabras[0] || texto
      const prefijo = base.slice(0, Math.max(3, base.length - 2))
      if (prefijo && prefijo.length < base.length) await agregar(prefijo)
    }
  }

  if (!combinada.length) return combinada
  return combinada.map(m => ({ m, s: sim(m) })).sort((a, b) => b.s - a.s).map(x => x.m)
}

// Ratings de MAL que indican contenido +18
const MAL_ADULTO_RATINGS = ['Rx', 'R+'] // Rx=hentai, R+=mild nudity

// Buscar anime en Jikan (MAL) y devolver géneros, score, rating, imagen.
// prioridad: 'alta' para llamadas donde el usuario está esperando en pantalla
// (p.ej. abrir la ficha de un anime) -- se procesan antes que el
// enriquecimiento de fondo pendiente en la cola. Ver _jikanEncolar arriba.
async function jikanBuscar(titulo, { prioridad } = {}) {
  // Limpiar título para búsqueda: quitar "Latino/Castellano/S1/S2/Temporada N"
  const query = titulo
    .replace(/\s+(latino|castellano|sub|dub|doblado|redoblaje|audio latino|audio castellano)/gi, '')
    .replace(/\s+(s\d+|temporada\s*\d+|season\s*\d+)/gi, '')
    .replace(/\s*\(.*?\)/g, '')
    .trim()

  if (jikanCache.has(query)) return jikanCache.get(query)

  try {
    const res = await _jikanEncolar(() => axios.get('https://api.jikan.moe/v4/anime', {
      params: { q: query, limit: 1, sfw: false },
      headers: { 'Accept': 'application/json' },
      timeout: 5000
    }), { prioridad })
    const anime = res.data?.data?.[0]
    if (!anime) { jikanCache.set(query, null); return null }

    const result = {
      malId:      anime.mal_id,
      score:      anime.score,
      scoredBy:   anime.scored_by,   // cantidad real de usuarios que puntuaron (MAL)
      members:    anime.members,     // cantidad real de usuarios que siguen el anime (MAL) — popularidad real
      favorites:  anime.favorites,   // cantidad real de favoritos (MAL)
      popularity: anime.popularity,  // ranking real de popularidad de MAL (menor = más popular)
      rank:       anime.rank,        // ranking real por score de MAL
      rating:     anime.rating,   // 'Rx', 'R+', 'R', 'PG-13', 'PG', 'G'
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
let appConfig = _loadJSONSeguro(APP_CONFIG_FILE, {})
function guardarConfig() { _guardarJSONSeguro(APP_CONFIG_FILE, appConfig) }

// ── Aviso de "recién actualizado" ───────────────────────────────────────────
// Guardamos la última versión con la que arrancó RYOKU. Si en este arranque
// la versión actual es distinta de la guardada (y sí había una guardada, o
// sea que no es la primera vez que se abre la app), significa que se acaba
// de aplicar una actualización -- se lo avisamos al renderer una sola vez
// para que muestre un toast de confirmación.
const _RYOKU_PREV_VERSION = appConfig.lastVersion || null
const _RYOKU_CURR_VERSION = app.getVersion()
let _RYOKU_JUST_UPDATED = !!(_RYOKU_PREV_VERSION && _RYOKU_PREV_VERSION !== _RYOKU_CURR_VERSION)
appConfig.lastVersion = _RYOKU_CURR_VERSION
guardarConfig()

// ─── MULTI-SOURCE ANIME ───────────────────────────────────────────────────────
// AnimeFLV se sacó de acá — el sitio dejó de tener catálogo (todos los animes
// aparecían caídos), así que ya no es una fuente seleccionable. El resto del
// código (_SRCS, _srcFromUrl, _DOMAIN_MAP más abajo) se deja intacto a propósito:
// sigue clasificando favoritos/historial VIEJOS que ya tenían URLs de
// animeflv.net, para no perder esos datos guardados — solo se quita la
// posibilidad de elegirlo como fuente activa para navegar.
const ANIME_SOURCES = {
  latanime:    { id: 'latanime',    nombre: 'Latanime',     BASE: 'https://latanime.org' },
  animeav1:    { id: 'animeav1',    nombre: 'AnimeAV1',     BASE: 'https://animeav1.com' }
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
      } else if (url.includes('mxcontent.net') || url.includes('mxcdn.net') || url.includes('mixdrop')) {
        details.requestHeaders['Referer'] = 'https://mixdrop.ag/'
        details.requestHeaders['Origin']  = 'https://mixdrop.ag'
      } else if (url.includes('animeav1.com') || url.includes('cdn.animeav1.com')) {
        details.requestHeaders['Referer'] = 'https://animeav1.com/'
        details.requestHeaders['Origin']  = 'https://animeav1.com'
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
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript("window._RYOKU_SERVER = 'http://localhost:3001'").catch(() => {})
    if (_RYOKU_JUST_UPDATED) {
      _RYOKU_JUST_UPDATED = false // avisar una sola vez por sesión, aunque el renderer recargue
      mainWindow.webContents.send('app-updated', { from: _RYOKU_PREV_VERSION, to: _RYOKU_CURR_VERSION })
    }
    // OPTIMIZACIÓN: antes la ventana quedaba INVISIBLE hasta que 'app-ready'
    // llegaba desde el renderer (que a su vez espera a que termine de
    // cargar el catálogo de inicio -- con caché fría, o con MonosChinos
    // como fuente activa -- eso puede tardar varios segundos, hasta el
    // punto de sentirse como que la app no abrió) o hasta el fallback de
    // 6s. Pero el propio renderer (ver renderer/modulos/ui.js) ya pinta
    // "Cargando..." apenas arranca, ANTES de pedir el catálogo, y la
    // animación de entrada (puertas abriéndose) corre desde que carga la
    // página, independiente de los datos -- está pensada para estar ya en
    // marcha cuando la ventana se muestra. Mostrar bien pronto (los datos
    // se rellenan solos cuando lleguen) hace que abrir RYOKU se sienta
    // instantáneo en vez de una espera muda sin ningún indicio de que la
    // app sí está abriendo.
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show() }, 500)
    // Red de seguridad por si ese primer show fallara silenciosamente.
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show() }, 6000)
  })
  // Avisa al splash de actualización (si hay uno esperando) que la app ya se
  // ve, para que se cierre justo ahora y no a un tiempo fijo.
  mainWindow.once('show', () => { try { fs.writeFileSync(_MARCA_APP_ABIERTA, '1') } catch (e) {} })
  mainWindow.on('maximize',   () => mainWindow.webContents.send('window-maximize-change', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximize-change', false))

  // Guardar en cloud antes de cerrar
  // Único mecanismo de cierre, compartido con el botón custom de la titlebar
  // (ver ipcMain.on('close-window', ...) más abajo) — evita registrar un
  // listener 'save-before-quit-done' distinto por cada intento de cierre,
  // que antes podía disparar mainWindow.close() dos veces en la misma
  // pasada (riesgo de "Object has been destroyed").
  mainWindow.on('close', (e) => {
    _logQuit('mainWindow close (nativo), _quitting=' + _quitting)
    if (_quitting) return
    e.preventDefault()
    _requestQuit()
  })
  mainWindow.on('closed', () => { _logQuit('mainWindow closed') })
}

app.whenReady().then(() => {
  createWindow(); initDiscord(); initUpdater(mainWindow)
})

app.on('window-all-closed', () => {
  _logQuit('window-all-closed, plataforma=' + process.platform)
  if (process.platform !== 'darwin') {
    app.quit()
    // Red de seguridad: si por lo que sea el proceso no termina de cerrarse
    // solo (algún handle abierto -- servidor local, RPC de Discord, una
    // descarga/stream en curso, etc.), forzamos la salida a los 5s para que
    // nunca quede un proceso zombie ocupando el single-instance lock y
    // bloqueando que la app se vuelva a abrir.
    setTimeout(() => {
      _logQuit('app.quit() no cerro el proceso en 5s, forzando app.exit(0)')
      app.exit(0)
    }, 5000)
  }
})
app.on('will-quit', () => _logQuit('will-quit (cierre normal)'))
app.on('quit', () => _logQuit('quit (cierre normal)'))
ipcMain.on('minimize-window', () => mainWindow.minimize())
ipcMain.on('win-drag', (_, x, y) => { if(mainWindow) mainWindow.setPosition(Math.round(x), Math.round(y)) })
ipcMain.on('maximize-window', () => { if(mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize() })
let _quitting  = false
let _quitTimer = null

// Pide al renderer que guarde antes de salir (con fallback si nunca responde).
// Llamado tanto por el botón custom de la titlebar (close-window) como por
// el cierre nativo de la ventana (mainWindow.on('close', ...)) — un único
// timer/guard evita que ambos caminos disparen el cierre por duplicado.
function _requestQuit() {
  _logQuit('_requestQuit, _quitting=' + _quitting + ' _quitTimer=' + !!_quitTimer)
  if (_quitting || _quitTimer) return
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('save-before-quit')
  _quitTimer = setTimeout(() => { _logQuit('fallback de 4s disparado (renderer no respondio a tiempo)'); _doQuit() }, 4000)
}
function _doQuit() {
  _logQuit('_doQuit, _quitting=' + _quitting)
  if (_quitting) return
  _quitting = true
  if (_quitTimer) { clearTimeout(_quitTimer); _quitTimer = null }
  // No alcanza con cerrar solo mainWindow y esperar a que 'window-all-closed'
  // dispare solo: los extractores de anime/manga abren BrowserWindow ocultas
  // (bypass Cloudflare/bot-detection, extraccion de paginas de manga en
  // background -- la de NovelCool se deja viva a proposito hasta 2 minutos
  // para precargar paginas siguientes) y si el usuario cierra RYOKU mientras
  // alguna sigue viva, 'window-all-closed' nunca llega a disparar: el proceso
  // queda zombie en segundo plano (visible en el Administrador de Tareas) y
  // bloquea que la app se vuelva a abrir (mantiene el single-instance lock).
  // Igual que en el flujo de actualizacion (mas arriba), destruimos TODAS las
  // ventanas de forma explicita antes de salir.
  BrowserWindow.getAllWindows().forEach((w) => {
    try { if (!w.isDestroyed()) w.destroy() } catch (e) {}
  })
  _logQuit('_doQuit: ventanas destruidas, quedan=' + BrowserWindow.getAllWindows().length)
  app.quit()
}
ipcMain.on('close-window', () => { _logQuit('IPC close-window recibido'); _requestQuit() })
ipcMain.on('save-before-quit-done', () => { _logQuit('IPC save-before-quit-done recibido'); _doQuit() })

// ─── AUTOCOMPLETAR (buscadores de anime y manga) ──────────────────────────────
// Sugerencias de títulos desde AniList (GraphQL, ~150-300 ms, ordenado por
// coincidencia). Sirve igual para cualquier fuente activa: al elegir una
// sugerencia se busca ese título en la fuente (que ya tolera variaciones, ver
// _buscarConTolerancia). Caché de 10 min por (tipo, texto).
const _acCache = new Map()
const _AC_TTL = 10 * 60 * 1000
ipcMain.handle('autocompletar', async (_, tipo, texto) => {
  const q = String(texto || '').trim()
  if (q.length < 2) return []
  const tipoAL = tipo === 'manga' ? 'MANGA' : 'ANIME'
  const adulto = appConfig?.['app-18'] === true || appConfig?.['app-18'] === 'true'
  const clave = `${tipoAL}|${adulto ? 1 : 0}|${q.toLowerCase()}`
  const c = _acCache.get(clave)
  if (c && Date.now() - c.ts < _AC_TTL) return c.data
  const query = `query ($s: String, $t: MediaType, $adult: Boolean, $noFmt: [MediaFormat]) {
    Page(perPage: 8) {
      media(search: $s, type: $t, isAdult: $adult, format_not_in: $noFmt, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
        id title { romaji english } synonyms format countryOfOrigin seasonYear startDate { year } coverImage { medium }
      }
    }
  }`
  const vars = { s: q, t: tipoAL, noFmt: tipoAL === 'MANGA' ? ['NOVEL'] : ['MUSIC'] }
  if (!adulto) vars.adult = false
  try {
    const { data } = await axios.post('https://graphql.anilist.co', { query, variables: vars }, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 6000,
    })
    const FMT = { TV: 'Serie', TV_SHORT: 'Serie corta', MOVIE: 'Película', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Especial', MANGA: 'Manga', ONE_SHOT: 'One shot' }
    const lista = (data?.data?.Page?.media || []).map(m => {
      let formato = FMT[m.format] || ''
      if (tipoAL === 'MANGA' && m.countryOfOrigin === 'KR') formato = 'Manhwa'
      if (tipoAL === 'MANGA' && m.countryOfOrigin === 'CN') formato = 'Manhua'
      const titulo = m.title?.romaji || m.title?.english || ''
      return {
        titulo,
        alterno: (m.title?.english && m.title.english.toLowerCase() !== titulo.toLowerCase()) ? m.title.english : '',
        formato,
        anio: m.seasonYear || m.startDate?.year || '',
        imagen: m.coverImage?.medium || '',
      }
    }).filter(x => x.titulo)
    _acCache.set(clave, { data: lista, ts: Date.now() })
    if (_acCache.size > 400) _acCache.delete(_acCache.keys().next().value)
    return lista
  } catch (e) { return [] }
})

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
    const { data: page } = await axios.get(`https://www4.animeflv.net${link}`, { headers: HEADERS, timeout: 5000 })
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
    if (srcId === 'animeav1') {
      result = await animeav1.getRecientes()
    } else {
      result = await latanime.getRecientes()
    }
    _recientesCache[srcId] = { data: result, ts: Date.now() }
    return result
  } catch(e) { console.error('[AO] _fetchRecientes error:', e.message); return { slider:[], lista:[], series:[] } }
}

// Prefetch de la fuente no activa en background — con 3 fuentes, se calienta
// la siguiente en orden fijo (round-robin simple) en vez de un toggle binario.
const _ORDEN_FUENTES = ['latanime', 'animeav1']
function _prefetchOtraFuente(activeSrcId) {
  const idx = _ORDEN_FUENTES.indexOf(activeSrcId)
  const otra = _ORDEN_FUENTES[(idx + 1) % _ORDEN_FUENTES.length] || 'latanime'
  const cached = _recientesCache[otra]
  if (!cached || Date.now() - cached.ts > _RECIENTES_TTL) {
    setTimeout(() => _fetchRecientes(otra), 500)
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
    const srcId = _activeAnimeSource?.id || 'latanime'
    const ejecutar = (q) => srcId === 'animeav1'
        ? animeav1.buscar(q, filtros)
        : latanime.buscar(q, filtros)
    let data = await ejecutar(query)
    if (query && query.trim()) {
      const toleranciaOpts = {}
      data = await _buscarConTolerancia(query, data, (clave) => ejecutar(clave), undefined, toleranciaOpts)
    }
    _buscarAnimeCache.set(cacheKey, { data, ts: Date.now() })
    return data
  } catch(e) { console.error('[buscar]', e.message); return [] }
})

ipcMain.handle('get-anime-biblioteca', async (_, params = {}) => {
  const { query = '', categoria = '', genero = '', emision = false, page = 1 } = params
  const tipo   = categoria || ''
  const srcId  = _activeAnimeSource?.id || 'latanime'
  const cacheKey = JSON.stringify({ query, tipo, genero, emision, page, src: srcId })
  const hit = _bibliotecaCache.get(cacheKey)
  if (hit && Date.now() - hit.ts < _BIBLIOTECA_TTL) return hit.data
  try {
    const ejecutar = (q) => srcId === 'animeav1'
      ? animeav1.getBiblioteca({ query: q, genero, categoria: tipo, emision, page })
      : latanime.getBiblioteca({ query: q, genero, tipo, emision, page })
    const data = await ejecutar(query)
    // Tolerancia a typos solo tiene sentido en la primera página de una
    // búsqueda de texto -- en páginas siguientes ya se confirmó que el query
    // trajo resultados buenos.
    if (query && query.trim() && page <= 1 && data?.lista) {
      const toleranciaOpts = {}
      data.lista = await _buscarConTolerancia(query, data.lista, async (clave) => {
        const r = await ejecutar(clave)
        return r?.lista || []
      }, undefined, toleranciaOpts)
    }
    _bibliotecaCache.set(cacheKey, { data, ts: Date.now() })
    return data
  } catch(e) {
    console.error('[get-anime-biblioteca]', e.message)
    return { lista: [], hayMas: false, page: 1 }
  }
})

// Enriquecer un anime individual con MAL (llamado desde renderer en background)
ipcMain.handle('enriquecer-anime', async (_, titulo) => {
  return await jikanBuscar(titulo)
})

// Top de la semana con datos reales (ranking global de MAL cruzado con el catálogo local)
ipcMain.handle('top-semana-real', async () => {
  try { return await topSemanaReal(5) } catch(e) { console.error('[top-semana-real]', e.message); return [] }
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
    const ext = path.extname(filePaths[0]).slice(1).toLowerCase().replace('jpg','jpeg')
    // GIF se deja tal cual (redimensionar/recodificar con nativeImage pierde
    // la animación, solo conserva el primer frame) -- para el resto (jpg/png/
    // webp), la imagen de fondo elegida por el usuario se guardaba SIN NINGÚN
    // límite de tamaño ni compresión: una foto de cámara o wallpaper 4K podía
    // terminar pesando varios MB, y como el dataURL completo se relee del
    // disco y se manda entero por IPC CADA VEZ que arranca la app (bg-get en
    // initConfig), eso sumaba un costo real y repetido de arranque -- más
    // notorio en máquinas con CPU/disco más lentos. Bajarla a un tamaño
    // razonable para un fondo (que además normalmente se ve borroneado/detrás
    // de paneles) recorta ese peso a una fracción sin notarse visualmente.
    if (ext === 'gif') {
      const data = fs.readFileSync(filePaths[0])
      return `data:image/gif;base64,${data.toString('base64')}`
    }
    const img = nativeImage.createFromPath(filePaths[0])
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    const MAX_LADO = 2560
    const resized = (width > MAX_LADO || height > MAX_LADO)
      ? img.resize(width >= height ? { width: MAX_LADO } : { height: MAX_LADO })
      : img
    const jpeg = resized.toJPEG(82)
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch(e) { console.error('[open-bg-image]', e.message); return null }
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
    _animeFichaCache.clear()  // fichas de anime en memoria (ver get-anime)

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
// SERVIDORES
// Mega no sirve como servidor de streaming (es un link de descarga del
// archivo completo, no un embed reproducible) -- se saca de la lista antes
// de devolverla al renderer, sin importar de qué fuente venga.
function _sinMega(lista) {
  return (lista || []).filter(s => !(s?.nombre || '').toLowerCase().includes('mega'))
}

ipcMain.handle('get-servidores', async (_, url) => {
  try {
    if (url?.includes('animeflv.net')) {
      // AnimeFLV tiene Cloudflare — usar BrowserWindow real en vez de axios
      const videos = await new Promise((resolve) => {
        let win = null
        const timer = setTimeout(() => { if (win && !win.isDestroyed()) win.destroy(); resolve(null) }, 20000)
        win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
        win.webContents.on('did-finish-load', async () => {
          try {
            await new Promise(r => setTimeout(r, 1500))
            const raw = await win.webContents.executeJavaScript('JSON.stringify(typeof videos !== "undefined" ? videos : null)')
            clearTimeout(timer); win.destroy(); resolve(JSON.parse(raw))
          } catch(e) { clearTimeout(timer); win.destroy(); resolve(null) }
        })
        win.webContents.on('did-fail-load', (_, code) => { if (code === -3) return; clearTimeout(timer); win.destroy(); resolve(null) })
        win.loadURL(url, { userAgent: UA })
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
      return _sinMega(servidores)
    }
    if (url?.includes('animeav1.com')) return _sinMega(await animeav1.getServidores(url))
    return _sinMega(await latanime.getServidores(url))
  } catch(e) { return [] }
})

// get-anime — delega por fuente activa
// Cache corto de fichas de anime. "Continuar viendo" pide la ficha de cada
// anime de su lista (hasta 12 para mejorar miniaturas + 3 para buscar
// episodios nuevos) y eso se repetía en cada carga del inicio y cada vez que
// se cerraba el reproductor -- 11 a 15 páginas scrapeadas cada vez (en
// Monoschinos, a través de una ventana oculta) para obtener lo mismo de hace
// un minuto. Dentro de 10 minutos, la misma ficha sale de memoria.
const _animeFichaCache = new Map()
const _ANIME_FICHA_TTL = 10 * 60 * 1000
async function _getAnimeSinCache(url) {
    // AnimeFLV ya no es una fuente activa (sitio caído) — si queda algún
    // favorito/historial viejo con link a animeflv.net, no hay de dónde traer
    // sus datos actualizados.
    if (url?.includes('animeflv.net/anime/'))  return null
    if (url?.includes('monoschinos'))           return null  // fuente eliminada
    if (url?.includes('animeav1.com/media/'))  return await animeav1.getAnime(url)
    // Prioridad 'alta': el usuario está esperando esta ficha en pantalla, así
    // que si hay enriquecimiento de fondo (grilla de inicio) encolado, esta
    // llamada a Jikan se procesa primero -- ver _jikanEncolar.
    return await latanime.getAnime(url, { coverCache, jikanBuscar: (t) => jikanBuscar(t, { prioridad: 'alta' }) })
}
ipcMain.handle('get-anime', async (_, url) => {
  try {
    const ahora = Date.now()
    const c = _animeFichaCache.get(url)
    if (c && ahora - c.ts < _ANIME_FICHA_TTL) return c.data
    const data = await _getAnimeSinCache(url)
    if (data) {
      _animeFichaCache.set(url, { data, ts: ahora })
      if (_animeFichaCache.size > 300) {
        for (const [k, v] of _animeFichaCache) if (ahora - v.ts >= _ANIME_FICHA_TTL) _animeFichaCache.delete(k)
      }
    }
    return data
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

    // Transferir cookies de Mixdrop a la sesión que realmente las usa.
    // Ojo: el proxy de reproducción para mxcontent.net/mxcdn.net (más abajo,
    // en startProxyServer) pide el video con
    // electron.session.fromPartition('persist:mixdrop_v3') — NO con
    // session.defaultSession. Antes estas cookies recién extraídas se
    // guardaban en defaultSession, una sesión que el proxy de Mixdrop nunca
    // lee, así que la transferencia no tenía ningún efecto real sobre la
    // reproducción (el renderer siempre pide estas URLs via getProxyUrl(),
    // nunca directo con defaultSession). Se guardan ahora en la misma
    // partition que usa el proxy.
    if (resultado?.sessionCookies?.length) {
      const { session: elSess } = require('electron')
      const mixdropSess = elSess.fromPartition('persist:mixdrop_v3')
      for (const c of resultado.sessionCookies) {
        try {
          const domain = c.domain.replace(/^\./, '')
          await mixdropSess.cookies.set({
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
async function _getCalendarioLatanime() {
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
}

ipcMain.handle('get-calendario', async () => {
  const srcId = _activeAnimeSource?.id || 'latanime'
  if (srcId === 'animeav1') {
    try { return await animeav1.getCalendario() } catch(e) { return {} }
  }
  return await _getCalendarioLatanime()
})
// ─── DATOS POR FUENTE: favs, historial, progreso ─────────────────────────────
function _srcFile(prefix, srcId) { return require('path').join(app.getPath('userData'), `anistream-${prefix}-${srcId}.json`) }
function _loadJ(f, fb) { return _loadJSONSeguro(f, fb) }
function _saveJ(f, d)  { _guardarJSONSeguro(f, d) }

const _SRCS = ['latanime', 'animeflv', 'animeav1']
const _favsD = Object.fromEntries(_SRCS.map(s => [s, _loadJ(_srcFile('favs',      s), [])]))
const _histD = Object.fromEntries(_SRCS.map(s => [s, _loadJ(_srcFile('historial', s), [])]))
const _progD = Object.fromEntries(_SRCS.map(s => [s, _loadJ(_srcFile('progreso',  s), {})]))

// ── Tombstones (borrados) ─────────────────────────────────────────────────────
// Bug: guardarEnCloud()/cargarDesdeCloud() en sync.js mergean favoritos/
// historial/progreso como una UNION simple entre lo local y lo que hay en la
// nube. Eso significa que si borrás un favorito acá, la próxima vez que se
// sincroniza, el ítem sigue estando en el doc de la nube (nadie lo borró ahí)
// y el merge lo vuelve a traer — "resucita". Mismo problema entre dos
// dispositivos: si lo borrás en el celular pero la PC todavía lo tiene local
// sin sincronizar, al guardar la PC lo vuelve a subir.
// La solución es un tombstone por ítem borrado (con timestamp) que viaja
// junto con favs/hist/prog: el merge, antes de unir, descarta cualquier ítem
// cuya clave tenga un tombstone. Volver a agregar el mismo ítem limpia su
// tombstone (ver toggle-fav más abajo).
const _tombD = Object.fromEntries(_SRCS.map(s => [s, _loadJ(_srcFile('tombstones', s), { favs: {}, hist: {}, prog: {} })]))
// ── Carpetas de favoritos (organización manual, por fuente) ──────────────────
const _carpetasD = Object.fromEntries(_SRCS.map(s => [s, _loadJ(_srcFile('favs-carpetas', s), [])]))
function _carpetas(s) { s = s || _src(); if (!_carpetasD[s]) _carpetasD[s] = []; return _carpetasD[s] }
function _setC(v, s)  { s = s || _src(); _carpetasD[s] = v; _saveJ(_srcFile('favs-carpetas', s), v) }
function _tomb(s) { s = s || _src(); if (!_tombD[s]) _tombD[s] = { favs: {}, hist: {}, prog: {} }; return _tombD[s] }
function _saveTomb(s) { s = s || _src(); _saveJ(_srcFile('tombstones', s), _tomb(s)) }
function _markTomb(tipo, key, s) {
  const t = _tomb(s)
  t[tipo][key] = Date.now()
  _saveTomb(s)
}
function _clearTomb(tipo, key, s) {
  const t = _tomb(s)
  if (t[tipo] && key in t[tipo]) { delete t[tipo][key]; _saveTomb(s) }
}

// Migración: redistribuye ítems al archivo de su fuente correcta según URL.
// La redistribución en memoria es inmediata (los IPC ya ven datos limpios desde
// el primer tick). Los writes a disco se difieren con setImmediate para no
// bloquear el startup ni la splash screen.
;(function _migrarFuentesCruzadas() {
  const _urlToSrc = url => {
    if (!url) return null
    if (url.includes('latanime.org'))  return 'latanime'
    if (url.includes('animeflv.net'))  return 'animeflv'
    if (url.includes('animeav1.com'))  return 'animeav1'
    return null
  }
  let changed = false
  // Favs — solo redistribuye en memoria
  for (const src of _SRCS) {
    const wrongItems = _favsD[src].filter(f => { const s=_urlToSrc(f.url); return s && s !== src })
    if (!wrongItems.length) continue
    changed = true
    _favsD[src] = _favsD[src].filter(f => { const s=_urlToSrc(f.url); return !s || s === src })
    for (const f of wrongItems) {
      const dest = _urlToSrc(f.url)
      if (!_favsD[dest]) _favsD[dest] = []
      if (!_favsD[dest].some(x => x.url === f.url)) _favsD[dest].push(f)
    }
  }
  // Historial — solo redistribuye en memoria
  for (const src of _SRCS) {
    const wrongItems = _histD[src].filter(h => { const s=_urlToSrc(h.link); return s && s !== src })
    if (!wrongItems.length) continue
    changed = true
    _histD[src] = _histD[src].filter(h => { const s=_urlToSrc(h.link); return !s || s === src })
    for (const h of wrongItems) {
      const dest = _urlToSrc(h.link)
      if (!_histD[dest]) _histD[dest] = []
      if (!_histD[dest].some(x => x.link === h.link)) _histD[dest].unshift(h)
    }
  }
  // Progreso — solo redistribuye en memoria
  for (const src of _SRCS) {
    const wrongKeys = Object.keys(_progD[src]).filter(link => { const s=_urlToSrc(link); return s && s !== src })
    if (!wrongKeys.length) continue
    changed = true
    for (const link of wrongKeys) {
      const dest = _urlToSrc(link)
      if (!_progD[dest]) _progD[dest] = {}
      if (!_progD[dest][link]) _progD[dest][link] = _progD[src][link]
      delete _progD[src][link]
    }
  }
  // Writes diferidos: no bloquean el arranque ni la splash
  if (changed) {
    setImmediate(() => {
      console.log('[migración] guardando redistribución de fuentes a disco...')
      for (const src of _SRCS) {
        _saveJ(_srcFile('favs',      src), _favsD[src])
        _saveJ(_srcFile('historial', src), _histD[src])
        _saveJ(_srcFile('progreso',  src), _progD[src])
      }
      console.log('[migración] completada')
    })
  }
})()

function _src()  { return _activeAnimeSource?.id || 'latanime' }
// Detecta la fuente por la URL del ítem (evita que un episodio se guarde bajo la fuente
// incorrecta si el usuario cambia de fuente mientras el reproductor sigue activo)
function _srcFromUrl(url) {
  if (!url) return null
  if (url.includes('latanime.org'))  return 'latanime'
  if (url.includes('animeflv.net'))  return 'animeflv'
  if (url.includes('animeav1.com'))  return 'animeav1'
  return null
}
// Fuentes eliminadas de la app. Sus ítems se descartan al restaurar desde la
// nube (ver _repartirPorFuente / restore-all-*), y sus archivos locales y la
// caché de navegador que usaba NovelCool se borran al arrancar.
const _FUENTES_ELIMINADAS = ['monoschinos', 'novelcool']
function _esDeFuenteEliminada(url) { return !!url && _FUENTES_ELIMINADAS.some(d => String(url).includes(d)) }
;(function _borrarDatosFuentesEliminadas() {
  const _rm = ruta => { try { if (fs.existsSync(ruta)) fs.rmSync(ruta, { recursive: true, force: true }) } catch (e) {} }
  for (const prefix of ['favs', 'historial', 'progreso', 'tombstones', 'favs-carpetas']) {
    const f = _srcFile(prefix, 'monoschinos')
    _rm(f); _rm(f + '.bak'); _rm(f + '.tmp')
  }
  _rm(require('path').join(app.getPath('userData'), 'Partitions', 'novelcool-cap'))
})()
// Defensivo: si en el futuro se agrega otra fuente, init al vuelo
function _favs(s) { s=s||_src(); if(!_favsD[s]) _favsD[s]=[]; return _favsD[s] }
function _hist(s) { s=s||_src(); if(!_histD[s]) _histD[s]=[]; return _histD[s] }
function _prog(s) { s=s||_src(); if(!_progD[s]) _progD[s]={}; return _progD[s] }
// Deduplica favoritos por url (se queda con la primera aparición) -- protección
// defensiva: nunca deberían existir dos entradas con la misma url, pero un
// merge de sync mal formado o una restauración vieja podría haber dejado
// alguna duplicada. Se aplica en el único punto de escritura (_setF) para
// que CUALQUIER operación (toggle, restore, reordenar, mover de carpeta)
// limpie duplicados existentes en el camino, sin tener que tocar cada caller.
function _dedupeFavsByUrl(arr) {
  const vistos = new Set()
  const out = []
  for (const f of (arr || [])) {
    if (!f || !f.url || vistos.has(f.url)) continue
    vistos.add(f.url)
    out.push(f)
  }
  return out
}
function _setF(v,s) { s=s||_src(); v = _dedupeFavsByUrl(v); _favsD[s] = v; _saveJ(_srcFile('favs',      s), v) }
function _setH(v,s) { s=s||_src(); _histD[s] = v; _saveJ(_srcFile('historial', s), v) }
function _setP(k,v,s){ s=s||_src(); _prog(s)[k] = v; _saveJ(_srcFile('progreso',s), _prog(s)) }
function _delP(k,s)  { s=s||_src(); delete _prog(s)[k]; _saveJ(_srcFile('progreso',s), _prog(s)) }

ipcMain.handle('get-favs',   ()        => _favs())
// ── Getters multi-fuente: devuelven datos de TODAS las fuentes combinados ──────
ipcMain.handle('get-all-favs-flat', () => _SRCS.flatMap(s => _favsD[s] || []))
ipcMain.handle('get-all-hist-flat', () => _SRCS.flatMap(s => _histD[s] || []))
ipcMain.handle('get-all-prog-flat', () => Object.assign({}, ..._SRCS.map(s => _progD[s] || {})))
ipcMain.handle('get-all-tombstones-flat', () => {
  const out = { favs: {}, hist: {}, prog: {} }
  for (const s of _SRCS) {
    const t = _tomb(s)
    Object.assign(out.favs, t.favs)
    Object.assign(out.hist, t.hist)
    Object.assign(out.prog, t.prog)
  }
  return out
})
// Mergea tombstones entrantes (de la nube/otro dispositivo) en el store local,
// quedándose con el timestamp más reciente por clave, y purga de favs/hist/
// prog local cualquier ítem que ese tombstone diga que ya está borrado (así
// un dispositivo que nunca vio el borrado también lo aplica localmente).
ipcMain.handle('restore-all-tombstones', (_, tombs) => {
  if (!tombs || typeof tombs !== 'object') return
  // El set entrante es el merge completo (local + nube) ya podado por sync.js
  // (_podarTomb). Se ADOPTA tal cual en vez de unirlo con el local: antes era
  // una unión que nunca olvidaba nada, así que si sync.js descartaba un
  // tombstone porque el ítem se había vuelto a agregar después (en este u
  // otro dispositivo), la copia local lo mantenía y volvía a borrar el ítem
  // en el siguiente purge. Cada clave va a la fuente de su URL.
  const nuevos = Object.fromEntries(_SRCS.map(src => [src, { favs: {}, hist: {}, prog: {} }]))
  for (const tipo of ['favs', 'hist', 'prog']) {
    for (const [key, ts] of Object.entries(tombs[tipo] || {})) {
      if (_esDeFuenteEliminada(key)) continue
      const src = _srcFromUrl(key) || _src()
      if (!nuevos[src]) nuevos[src] = { favs: {}, hist: {}, prog: {} }
      nuevos[src][tipo][key] = ts
    }
  }
  for (const s of Object.keys(nuevos)) {
    _tombD[s] = nuevos[s]
    _saveTomb(s)
    const t = _tombD[s]
    // Purgar ítems locales que tienen tombstone (borrados en otro lado)
    const favsAntes = _favs(s).length
    _favsD[s] = _favs(s).filter(f => !(f.url in t.favs))
    if (_favsD[s].length !== favsAntes) _saveJ(_srcFile('favs', s), _favsD[s])
    const histAntes = _hist(s).length
    _histD[s] = _hist(s).filter(h => !(h.link in t.hist))
    if (_histD[s].length !== histAntes) _saveJ(_srcFile('historial', s), _histD[s])
    let progChanged = false
    for (const key of Object.keys(t.prog)) {
      if (key in _prog(s)) { delete _progD[s][key]; progChanged = true }
    }
    if (progChanged) _saveJ(_srcFile('progreso', s), _progD[s])
  }
})
ipcMain.handle('toggle-fav', (_, anime) => {
  const s = _srcFromUrl(anime.url) || _src()
  let list = [..._favs(s)]
  const idx = list.findIndex(f => f.url === anime.url)
  if (idx >= 0) { list.splice(idx, 1); _markTomb('favs', anime.url, s) }
  // ts = cuándo se agregó: sync.js lo compara contra el tombstone para
  // saber si el ítem se volvió a agregar DESPUÉS de un borrado.
  else { list.unshift({ ...anime, ts: Date.now() }); _clearTomb('favs', anime.url, s) }
  _setF(list, s); return list
})
ipcMain.handle('is-fav', (_, url) => _favs(_srcFromUrl(url) || _src()).some(f => f.url === url))

// ── Carpetas de favoritos: crear/renombrar/borrar, mover un favorito, y
// reordenar (drag & drop) — todo por fuente, igual que el resto de favs. ─────
ipcMain.handle('get-carpetas-favs', () => _carpetas())
ipcMain.handle('crear-carpeta-fav', (_, nombre) => {
  nombre = (nombre || '').trim()
  const s = _src()
  if (nombre) {
    const list = _carpetas(s)
    if (!list.some(c => c.toLowerCase() === nombre.toLowerCase())) {
      _setC([...list, nombre], s)
    }
  }
  return _carpetas(s)
})
ipcMain.handle('renombrar-carpeta-fav', (_, { viejo, nuevo } = {}) => {
  nuevo = (nuevo || '').trim()
  const s = _src()
  if (viejo && nuevo) {
    const list = _carpetas(s)
    // Si ya existe una carpeta con ese nombre (sin distinguir mayúsculas,
    // igual que crear-carpeta-fav) no se crea un duplicado -- se fusiona:
    // los favs de "viejo" pasan a la carpeta existente y "viejo" se quita
    // de la lista, igual que un borrado normal de carpeta.
    const existente = list.find(c => c !== viejo && c.toLowerCase() === nuevo.toLowerCase())
    if (existente) {
      _setC(list.filter(c => c !== viejo), s)
      _setF(_favs(s).map(f => f.carpeta === viejo ? { ...f, carpeta: existente, carpetaTs: Date.now() } : f), s)
    } else {
      _setC(list.map(c => c === viejo ? nuevo : c), s)
      _setF(_favs(s).map(f => f.carpeta === viejo ? { ...f, carpeta: nuevo, carpetaTs: Date.now() } : f), s)
    }
  }
  return { carpetas: _carpetas(s), favs: _favs(s) }
})
ipcMain.handle('borrar-carpeta-fav', (_, nombre) => {
  const s = _src()
  _setC(_carpetas(s).filter(c => c !== nombre), s)
  _setF(_favs(s).map(f => f.carpeta === nombre ? { ...f, carpeta: '', carpetaTs: Date.now() } : f), s)
  return { carpetas: _carpetas(s), favs: _favs(s) }
})
ipcMain.handle('mover-fav-carpeta', (_, { url, carpeta } = {}) => {
  const s = _srcFromUrl(url) || _src()
  // carpetaTs: cuándo se cambió la carpeta -- sync.js lo usa para que gane la más reciente entre dispositivos
  _setF(_favs(s).map(f => f.url === url ? { ...f, carpeta: carpeta || '', carpetaTs: Date.now() } : f), s)
  return _favs(s)
})
ipcMain.handle('reordenar-favs', (_, urls) => {
  const s = _src()
  if (!Array.isArray(urls)) return _favs(s)
  const byUrl = new Map(_favs(s).map(f => [f.url, f]))
  const nuevo = []
  for (const u of urls) { const f = byUrl.get(u); if (f) { nuevo.push(f); byUrl.delete(u) } }
  for (const f of byUrl.values()) nuevo.push(f) // defensivo: algo se quedó afuera de `urls`
  _setF(nuevo, s)
  return nuevo
})
ipcMain.handle('get-all-carpetas-flat', () => Object.fromEntries(_SRCS.map(s => [s, _carpetasD[s] || []])))
ipcMain.handle('restore-all-carpetas', (_, obj, exacto) => {
  if (!obj || typeof obj !== 'object') return
  // exacto: la lista ya viene mergeada con los borrados aplicados (sync.js,
  // _aplicarMarcasCarpetas) y reemplaza a la local -- así una carpeta borrada
  // en otro dispositivo también se quita acá.
  if (exacto) {
    for (const s of _SRCS) if (Array.isArray(obj[s])) _setC(obj[s].filter(Boolean), s)
    return
  }
  for (const s of _SRCS) {
    const incoming = Array.isArray(obj[s]) ? obj[s] : []
    if (!incoming.length) continue
    const cur = _carpetas(s)
    const curLower = new Set(cur.map(c => c.toLowerCase()))
    const merged = [...cur]
    for (const nombre of incoming) {
      if (nombre && !curLower.has(nombre.toLowerCase())) { merged.push(nombre); curLower.add(nombre.toLowerCase()) }
    }
    if (merged.length !== cur.length) _setC(merged, s)
  }
})

// HISTORIAL
ipcMain.handle('get-historial',    ()        => _hist())
ipcMain.handle('add-historial',    (_, ep)   => {
  const s = _srcFromUrl(ep.link) || _src()
  let list = _hist(s).filter(h => h.link !== ep.link)
  list.unshift({ ...ep, ts: Date.now() })
  if (list.length > 500) list = list.slice(0, 500)
  _clearTomb('hist', ep.link, s)
  _setH(list, s); return list
})
ipcMain.handle('remove-historial', (_, link) => {
  const s = _srcFromUrl(link) || _src()
  _markTomb('hist', link, s)
  _setH(_hist(s).filter(h => h.link !== link), s)
})
// Quita varios links del historial de una vez: marca tombstone para cada uno
// y hace UNA sola escritura por fuente. Reemplaza el viejo patrón del
// renderer "clearHistorial() + addHistorial() por cada entrada que queda",
// que invertía el orden del historial (cada add hace unshift), escribía a
// disco una vez por entrada y, si mientras tanto se agregaba un episodio
// nuevo, lo borraba y le dejaba un tombstone que la sync propagaba.
ipcMain.handle('remove-historial-batch', (_, links) => {
  if (!Array.isArray(links) || !links.length) return
  const porFuente = {}
  for (const link of links) {
    if (!link) continue
    const s = _srcFromUrl(link) || _src()
    ;(porFuente[s] = porFuente[s] || new Set()).add(link)
  }
  const ahora = Date.now()
  for (const [s, set] of Object.entries(porFuente)) {
    const t = _tomb(s)
    for (const l of set) t.hist[l] = ahora
    _saveTomb(s)
    _setH(_hist(s).filter(h => !set.has(h.link)), s)
  }
})
// Actualiza la imagen de entradas existentes del historial EN SU LUGAR (sin
// moverlas ni recrearlas). cambios: [{ link, imagen }]
ipcMain.handle('set-imagenes-historial', (_, cambios) => {
  if (!Array.isArray(cambios) || !cambios.length) return
  const tocadas = new Set()
  for (const c of cambios) {
    if (!c?.link || !c?.imagen) continue
    const s = _srcFromUrl(c.link) || _src()
    const e = _hist(s).find(h => h.link === c.link)
    if (e && e.imagen !== c.imagen) { e.imagen = c.imagen; tocadas.add(s) }
  }
  for (const s of tocadas) _setH(_hist(s), s)
})
ipcMain.handle('remove-progreso',  (_, link) => {
  const s = _srcFromUrl(link) || _src()
  _markTomb('prog', link, s)
  _delP(link, s)
})
ipcMain.handle('clear-historial',  ()        => {
  const s = _src()
  for (const h of _hist(s)) _markTomb('hist', h.link, s)
  _setH([], s); return []
})
ipcMain.handle('restore-favs',     (_, lista) => { _setF(lista) })
ipcMain.handle('restore-historial',(_, lista) => { _setH(lista) })
ipcMain.handle('restore-progresos',(_, datos) => {
  if (!datos || typeof datos !== 'object') return
  const s = _src()
  _progD[s] = datos
  _saveJ(_srcFile('progreso', s), _prog(s))
})
// ── Restore multi-fuente: distribuye los ítems a la fuente correcta por URL ───
const _DOMAIN_MAP = { latanime: 'latanime.org', animeflv: 'animeflv.net', animeav1: 'animeav1.com' }
// Reparten por fuente con _srcFromUrl -- el MISMO criterio que usa toda la
// app al guardar (toggle-fav, add-historial, set-progreso). Antes usaban
// _DOMAIN_MAP (p.ej. 'monoschinos.st' exacto), así que un ítem guardado con
// otro dominio de la misma fuente, o sin fuente reconocible, no caía en
// ninguna y desaparecía del disco local en cada carga desde la nube.
function _repartirPorFuente(items, campoUrl) {
  const porFuente = Object.fromEntries(_SRCS.map(s => [s, []]))
  for (const it of items) {
    if (_esDeFuenteEliminada(it?.[campoUrl])) continue
    const s = _srcFromUrl(it?.[campoUrl]) || _src()
    ;(porFuente[s] = porFuente[s] || []).push(it)
  }
  return porFuente
}
ipcMain.handle('restore-all-favs', (_, lista) => {
  if (!Array.isArray(lista)) return
  for (const [src, items] of Object.entries(_repartirPorFuente(lista, 'url'))) _setF(items, src)
})
ipcMain.handle('restore-all-hist', (_, lista) => {
  if (!Array.isArray(lista)) return
  for (const [src, items] of Object.entries(_repartirPorFuente(lista, 'link'))) _setH(items, src)
})
ipcMain.handle('restore-all-prog', (_, datos) => {
  if (!datos || typeof datos !== 'object') return
  const tocadas = new Set()
  for (const [link, p] of Object.entries(datos)) {
    if (_esDeFuenteEliminada(link)) continue
    const src = _srcFromUrl(link) || _src()
    _prog(src)[link] = p
    tocadas.add(src)
  }
  for (const src of tocadas) _saveJ(_srcFile('progreso', src), _prog(src))
})

// PROGRESO DE EPISODIOS
ipcMain.handle('set-progreso',        (_, link, currentTime, duration) => {
  const s = _srcFromUrl(link) || _src()
  const nuevoPct = duration > 0 ? (currentTime/duration)*100 : 0
  // No pisar un episodio ya completado (>=95%, marcado a mano con el ojito o
  // por reproduccion real) con un progreso mas bajo. Esto pasaba, por
  // ejemplo, al reabrir/reproducir de nuevo un episodio que ya se habia
  // marcado como visto: el intervalo de progreso real cada 15s (o el flush
  // al cerrar el reproductor) pisaba el 100% guardado con el tiempo real de
  // reproduccion -- mucho mas bajo -- y el episodio volvia a aparecer como
  // "no visto" al volver a entrar. Solo un "quitar de visto" explicito
  // (remove-progreso) puede revertir un episodio ya completado.
  const previo = _prog(s)[link]
  if (previo && previo.porcentaje >= 95 && nuevoPct < 95) return previo
  // Igual que add-historial/toggle-fav: al escribir un progreso hay que
  // limpiar cualquier tombstone de 'prog' que hubiera quedado de un borrado
  // anterior (desmarcar visto) -- si no, el próximo sync con la nube lo
  // vuelve a encontrar tombstoned y lo borra de nuevo (ver sync.js).
  _clearTomb('prog', link, s)
  _setP(link, { currentTime, duration, porcentaje: nuevoPct, ts: Date.now() }, s)
})
ipcMain.handle('get-progreso',        (_, link) => (_prog(_srcFromUrl(link) || _src()))[link] || null)
ipcMain.handle('get-todos-progresos', ()        => _prog())

ipcMain.handle('clear-stream-cache', (_, url) => {
  if (url) streamCache.delete(url)
  else streamCache.clear()
  // También limpiar cache interno de extractors
  try { extractors.clearCache(url || null) } catch(e) {}
})


// PROXY STREAM — para servidores que validan Referer (mp4upload, etc.)
// El renderer pide la URL al main, que la retransmite con el Referer correcto

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

      // Validar el host del target ANTES de decidir qué credenciales/sesión
      // usar para pedirlo. Antes esto se hacía con target.includes('mxcontent.net')
      // sobre la URL completa como string — un host tipo
      // "mxcontent.net.evil.com" o "evil-mxcontent.net-cdn.com" también
      // "incluye" ese substring sin ser el dominio real, así que un target
      // armado a propósito podía colarse en la rama que adjunta las cookies
      // de sesión autenticadas de Mixdrop (persist:mixdrop_v3). Acá se valida
      // el HOSTNAME real contra la lista de dominios legítimos de Mixdrop.
      let targetHost = ''
      try { targetHost = new URL(target).hostname.toLowerCase() } catch(e) {
        clientRes.writeHead(400); clientRes.end(); return
      }
      const _hostMatch = (host, dominio) => host === dominio || host.endsWith('.' + dominio)
      const isMxCDN = MIXDROP_LEGIT.some(d => _hostMatch(targetHost, d))
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

      // Algunos CDN (p.ej. el que usa Lulu/luluvdo.com -- tnmr.org) devuelven
      // 403 con solo el Referer/Origin correctos: tambien exigen una cookie
      // de sesion que la pagina puso al cargar (mismo patron ya conocido con
      // Doodstream y su cf_clearance). Como generico.js ahora extrae con una
      // partition persistente fija ('persist:generico_extract_v1', ver
      // _base.js), esa cookie sigue disponible aca -- se adjunta si existe
      // alguna para el dominio del target. Si no hay ninguna, no cambia nada.
      ;(async () => {
        let cookieHeader = ''
        try {
          const { session: elSession } = require('electron')
          const genSess = elSession.fromPartition('persist:generico_extract_v1')
          const cookies = await genSess.cookies.get({ url: target })
          if (cookies.length) cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
        } catch(e) {}

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
            ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
          }
        }
        // Seguir redirecciones (Yourupload, Ok.ru y otros entregan el video
        // tras un 302 al CDN real): se repite el pedido con los mismos headers.
        const pedir = (opts, libX, saltos) => {
          const r = libX.request(opts, (proxyRes) => {
            const loc = proxyRes.headers.location
            if (loc && [301, 302, 303, 307, 308].includes(proxyRes.statusCode) && saltos < 5) {
              proxyRes.resume()
              let sig
              try { sig = new URL(loc, `${opts.protocol || 'https:'}//${opts.hostname}${opts.path}`) } catch (e) { clientRes.writeHead(502); clientRes.end(); return }
              const https2 = sig.protocol === 'https:'
              return pedir({ ...opts, protocol: sig.protocol, hostname: sig.hostname, port: sig.port || (https2 ? 443 : 80), path: sig.pathname + sig.search }, https2 ? https : http, saltos + 1)
            }
            responder(proxyRes)
          })
          r.on('error', () => { if (!clientRes.headersSent) clientRes.writeHead(502); clientRes.end() })
          r.end()
        }
        const responder = (proxyRes) => {
          clientRes.writeHead(proxyRes.statusCode, {
            'Content-Type':   proxyRes.headers['content-type']   || 'video/mp4',
            'Content-Length': proxyRes.headers['content-length'] || '',
            'Accept-Ranges':  'bytes',
            'Content-Range':  proxyRes.headers['content-range']  || '',
          })
          proxyRes.pipe(clientRes)
        }
        pedir({ ...options, protocol: parsed.protocol }, lib, 0)
      })()
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
  // Delegar a MangaOni si es la fuente activa
  if (_activeMangaSource?.id === 'manga-oni') {
    const empty = { pop:{general:[],seinen:[],josei:[]}, trend:{general:[],seinen:[],josei:[]}, nuevos:[] }
    return (await mangaOni.fetchTendencias()) || empty
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

  // Texto libre contra el que aplicar tolerancia a typos, y si esto es
  // página 1 (reintentar/reordenar solo tiene sentido ahí — ver comentario
  // en _buscarConTolerancia). __seccion__ es navegación pura, sin texto.
  let _textoLibre = '', _pagina1 = true
  if (query && query.startsWith('{')) {
    try { const p = JSON.parse(query); _textoLibre = (p.title || '').trim(); _pagina1 = (parseInt(p.pg) || 1) <= 1 } catch(e) {}
  } else if (query && !query.startsWith('__seccion__')) {
    _textoLibre = query.trim()
  }

  // Delegar a MangaOni si es la fuente activa
  if (_activeMangaSource?.id === 'manga-oni') {
    let lista = await mangaOni.buscarManga(query)
    if (_textoLibre && _pagina1) {
      lista = await _buscarConTolerancia(_textoLibre, lista, async (clave) => {
        const qAmplio = query.startsWith('{') ? JSON.stringify({ ...JSON.parse(query), title: clave }) : clave
        return mangaOni.buscarManga(qAmplio)
      })
    }
    return _saveMangaCache(lista)
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
    let lista = extraerMangasZona($, 48)
    lista.forEach(m => { if (!m.imagen) m.imagen = lcCoverCache.get(m.link) || '' })
    if (_textoLibre && _pagina1) {
      lista = await _buscarConTolerancia(_textoLibre, lista, async (clave) => {
        const urlAmplia = url.replace(/title=[^&]*/, 'title=' + encodeURIComponent(clave))
        const htmlAmplio = await tmoBrowser(urlAmplia, 3000)
        if (!htmlAmplio) return []
        const $$ = cheerio.load(htmlAmplio)
        const listaAmplia = extraerMangasZona($$, 48)
        listaAmplia.forEach(m => { if (!m.imagen) m.imagen = lcCoverCache.get(m.link) || '' })
        return listaAmplia
      })
    }
    return _saveMangaCache(lista)
  } catch(e) { console.error('[buscar-manga]', e.message); return [] }
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
    const headers = MANGA_HEADERS
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
    // Delegar a MangaOni solo si la URL pertenece a ese dominio
    if (url && url.includes('manga-oni.com')) {
      return await mangaOni.getDetalle(url, tituloFallback)
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
  'manga-oni': { id: 'manga-oni', nombre: 'MangaOni', BASE: 'https://manga-oni.com' },
}
let _activeMangaSource = MANGA_SOURCES[appConfig?.['manga-source']] || MANGA_SOURCES['zonatmo']


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
  if (url && url.includes('manga-oni.com')) {
    return await mangaOni.getPaginas(url)
  }
  return tmoCapBrowser(url, 4500)
})

// ─── WINDOW / UI HANDLERS ─────────────────────────────────────────────────────
ipcMain.handle('is-maximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.on('set-win-bg', (_, color) => {
  try { if (mainWindow && color) mainWindow.setBackgroundColor(color) } catch(e) {}
})
// 'app-ready': el contenido terminó de cargar → mostrar la ventana ahora.
// El splash ya lleva corriendo varios segundos en background; el usuario
// verá la animación de puertas abriéndose con los animes ya cargados debajo.
ipcMain.on('app-ready', () => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
})
ipcMain.on('cfg-sync', (e) => { e.returnValue = appConfig })

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
      // AnimeFLV ya no es una fuente activa — sin módulo para chequear episodios
      // nuevos de favoritos viejos con link a animeflv.net, se saltean.
      if (item.url?.includes('animeflv.net')) continue
      if (item.url?.includes('monoschinos')) continue  // fuente eliminada
      const src = item.url?.includes('animeav1.com') ? animeav1 : latanime
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
})
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function initUpdater(win) {
  // La ventana puede haber sido cerrada/destruida para cuando llega un
  // evento del updater (p.ej. checkForUpdates tarda, el usuario cierra la
  // app antes) — sin este guard, webContents.send tira y como no hay nada
  // capturando el evento del EventEmitter, tumbaba todo el proceso.
  const _send = (channel, ...args) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }
  autoUpdater.on('update-available', (info) => {
    _versionDescargada = info?.version || null
    _send('update-available', info.version)
  })
  autoUpdater.on('download-progress', (p) => {
    _send('update-progress', Math.round(p.percent))
  })
  autoUpdater.on('update-downloaded', (info) => {
    _versionDescargada = info?.version || _versionDescargada
    _send('update-downloaded')
  })
  autoUpdater.on('error', (e) => {
    console.error('[Updater]', e.message)
    _send('update-error', e.message)
  })
  autoUpdater.on('update-not-available', () => {
    _send('update-error', 'update-not-available (ya tienes la última versión)')
  })
  // Chequear al abrir, con delay para no bloquear el splash
  setTimeout(() => autoUpdater.checkForUpdates().catch((e) => {
    _send('update-error', 'checkForUpdates catch: ' + e.message)
  }), 8000)
}

ipcMain.on('update-download', () => autoUpdater.downloadUpdate())
// ── Pantalla de "Actualizando..." durante la instalación silenciosa ────────
// Deja varios segundos sin NINGUNA ventana en pantalla mientras el instalador
// corre invisible, y el usuario no tiene forma de saber que la app sigue viva
// haciendo algo. Esta pantalla chiquita, sin bordes, siempre-encima, se
// muestra con un mini script de PowerShell + WinForms (viene incluido en
// Windows, no depende de que Electron siga vivo) justo antes de cerrar
// RYOKU, con una barra de progreso "marquee" (nativa de Windows, animada
// sola, no hay que programarle la animación a mano) y se autocierra pasados
// unos segundos -- para entonces la nueva ventana de RYOKU ya deberia estar
// al frente tapandola.
//
// Primer intento: una mini-pagina HTML mostrada con mshta.exe. Se descartó
// -- mshta usa el motor viejo de Internet Explorer, que sin forzar modo
// "Edge" renderiza en modo compatibilidad: ni el flexbox centraba nada, ni
// el @keyframes de la animación corría, ni el acento (color de acento en
// utf-8) se leía bien (bug de encoding, la tilde salía como "â€¦"). Un
// WinForms nativo evita todo eso de raíz.
// ── Lanzar un proceso TOTALMENTE independiente de Electron ─────────────────
// Confirmado con pruebas manuales: el mismo comando corrido a mano en una
// consola funciona perfecto e instantaneo -- el problema es especifico de
// lanzarlo desde dentro de RYOKU. La causa: Chromium/Electron mete todos sus
// procesos (y los que ellos mismos generan) en un "job object" de Windows
// configurado para matar a TODA la rama de un tiron apenas el proceso
// principal termina (limpieza de huerfanos). "detached: true" en Node NO
// saca al proceso de ese job en Windows -- solo evita que reciba senales
// como Ctrl+C. O sea que nuestro cmd.exe se lanzaba bien (`spawn` devolvia
// un pid valido) pero moria en silencio en el mismo instante en que
// Electron terminaba de cerrarse, antes de llegar a hacer nada util.
//
// La forma confiable de escapar de ese job object es no crear el proceso
// nosotros mismos: se lo pedimos a WMI (Invoke-CimMethod / Win32_Process.
// Create), que lo crea como hijo del servicio de WMI (WmiPrvSE.exe) --
// completamente afuera de nuestra rama de procesos, así que sobrevive sin
// problema a que RYOKU cierre.
// Devuelve una Promise que resuelve cuando el lanzador WMI YA TERMINO (o sea,
// cuando el proceso independiente que le pedimos a WMI ya quedo creado, o al
// menos el intento ya se resolvio). Antes esto era "fire and forget": se
// spawneaba el lanzador y el codigo seguia de largo sin esperar nada, dejando
// que app.quit() se llamara en paralelo. La mayoria de las veces ese lanzador
// (un powershell -Command de una sola linea) termina en pocos ms, pero
// intermitentemente -- carga del sistema, antivirus escaneando el proceso,
// lo que sea -- tarda un poco mas, y si Electron ya termino de cerrarse (el
// job object mata la rama completa) antes de que el lanzador alcance a
// pedirle a WMI que cree el proceso real, ni el splash ni el waiter llegan a
// existir: la actualizacion instala en silencio pero sin animacion ni
// reapertura automatica. Esperar aca a que el lanzador confirme (evento
// 'exit') antes de dejar que el caller llame a app.quit() cierra esa carrera.
function _lanzarProcesoIndependiente(commandLine, etiqueta) {
  return new Promise((resolve) => {
    try {
      // Ventana de consola visible: en Windows 11 la terminal por defecto es
      // Windows Terminal, que ignora "-WindowStyle Hidden" y deja abierta una
      // pestaña negra vacía mientras corren el splash y el waiter. Para que no
      // aparezca nada:
      //  1. Se envuelve en "conhost.exe --headless" (Win10 1809+), que corre la
      //     consola sin ventana y sin pasársela a Windows Terminal. Las ventanas
      //     WinForms del splash no se ven afectadas.
      //  2. Se le pide a WMI que cree el proceso oculto (ShowWindow=0). Si eso
      //     falla por lo que sea, se cae al Create simple de antes.
      let cmdFinal = commandLine
      try {
        const build = parseInt(String(require('os').release()).split('.')[2] || '0', 10)
        const conhost = require('path').join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'conhost.exe')
        if (build >= 17763 && fs.existsSync(conhost)) cmdFinal = `"${conhost}" --headless ${commandLine}`
      } catch (_) {}
      const cmdLineEscapado = cmdFinal.replace(/"/g, '""')
      const psCreate =
        `$c = "${cmdLineEscapado}"; ` +
        `try { ` +
          `$si = New-CimInstance -ClassName Win32_ProcessStartup -Namespace root/cimv2 -ClientOnly -Property @{ShowWindow=[uint16]0}; ` +
          `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$c; ProcessStartupInformation=$si} -ErrorAction Stop; ` +
          `if ($r.ReturnValue -ne 0) { throw 'rv' } ` +
        `} catch { ` +
          `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$c} | Out-Null ` +
        `}`
      const launcher = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', psCreate],
        { stdio: 'ignore', windowsHide: true }
      )
      launcher.on('error', (e) => {
        _logQuit(`error lanzando ${etiqueta} via WMI: ` + e.message)
        resolve(false)
      })
      launcher.on('exit', (code) => {
        _logQuit(`${etiqueta}: lanzador WMI termino, code=${code}`)
        resolve(code === 0)
      })
      _logQuit(`${etiqueta}: lanzador WMI arrancado, pid=` + launcher.pid)
    } catch (e) {
      _logQuit(`excepcion lanzando ${etiqueta} via WMI: ` + e.message)
      resolve(false)
    }
  })
}

// Espera una promesa hasta `ms` -- si tarda mas, sigue de largo igual (mejor
// arriesgarse a la carrera vieja en ese caso raro que colgar la actualizacion
// para siempre si por lo que sea el lanzador nunca dispara 'exit').
function _conTimeout(promesa, ms, etiqueta) {
  return Promise.race([
    promesa,
    new Promise((resolve) => setTimeout(() => {
      _logQuit(`${etiqueta}: timeout de ${ms}ms esperando confirmacion, sigo de largo igual`)
      resolve(false)
    }, ms))
  ])
}

// ── Marcas de coordinación de la actualización ──────────────────────────────
// Archivos vacíos en %TEMP% para encadenar las piezas sin tiempos fijos:
//  - el splash nativo crea _MARCA_SPLASH_VISIBLE apenas está en pantalla, y
//    recién ahí se cierra la ventana de RYOKU. Antes se cerraba primero y el
//    splash aparecía ~5 s después (lanzarlo vía WMI tarda eso): pantalla vacía.
//  - la app NUEVA crea _MARCA_APP_ABIERTA al mostrar su ventana (ver
//    createWindow), y recién ahí se cierra el splash. Antes se cerraba a los
//    12 s fijos y la app reabría a los ~30 s: otro hueco sin nada en pantalla.
const _MARCA_SPLASH_VISIBLE = path.join(os.tmpdir(), 'ryoku-update-splash-visible.flag')
const _MARCA_APP_ABIERTA    = path.join(os.tmpdir(), 'ryoku-update-app-abierta.flag')
let _versionDescargada = null

function _esperarArchivo(ruta, maxMs) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const tick = () => {
      if (fs.existsSync(ruta)) return resolve(true)
      if (Date.now() - t0 >= maxMs) return resolve(false)
      setTimeout(tick, 100)
    }
    tick()
  })
}

function _lanzarSplashActualizando() {
  try {
    const ps1Path = path.join(os.tmpdir(), 'ryoku-actualizando.ps1')
    const ps1 = `$marcaVisible = '${_MARCA_SPLASH_VISIBLE}'
$marcaAbierta = '${_MARCA_APP_ABIERTA}'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "RYOKU"
$form.ClientSize = New-Object System.Drawing.Size(300, 130)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "None"
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(13, 21, 37)

$border = New-Object System.Windows.Forms.Panel
$border.Dock = "Fill"
$border.Padding = New-Object System.Windows.Forms.Padding(1)
$border.BackColor = [System.Drawing.Color]::FromArgb(51, 65, 85)
$form.Controls.Add($border)

$inner = New-Object System.Windows.Forms.Panel
$inner.Dock = "Fill"
$inner.BackColor = [System.Drawing.Color]::FromArgb(13, 21, 37)
$border.Controls.Add($inner)

$label = New-Object System.Windows.Forms.Label
$label.Text = "Actualizando RYOKU..."
$label.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$label.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$label.TextAlign = "MiddleCenter"
$label.Dock = "Top"
$label.Height = 70
$inner.Controls.Add($label)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Style = "Marquee"
$progress.MarqueeAnimationSpeed = 25
$progress.Size = New-Object System.Drawing.Size(240, 10)
$progress.Location = New-Object System.Drawing.Point(28, 78)
$inner.Controls.Add($progress)

# Avisar a RYOKU que el splash ya se ve (recien ahi cierra su ventana)
$form.Add_Shown({ try { Set-Content -Path $marcaVisible -Value '1' } catch {} })

# Cerrar cuando la app nueva ya muestra su ventana (tope de seguridad: 3 min)
$inicio = Get-Date
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
  if ((Test-Path $marcaAbierta) -or (((Get-Date) - $inicio).TotalSeconds -gt 180)) { $timer.Stop(); $form.Close() }
})
$timer.Start()

[void]$form.ShowDialog()
`
    fs.writeFileSync(ps1Path, ps1, 'utf-8')
    const comando = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ps1Path}"`
    return _lanzarProcesoIndependiente(comando, 'splash de actualizacion')
  } catch (e) {
    _logQuit('excepcion creando/lanzando splash de actualizacion: ' + e.message)
    return Promise.resolve(false)
  }
}

// Proceso independiente (sobrevive al cierre de RYOKU) que espera a que RYOKU
// cierre del todo, corre el instalador silencioso, confirma que el .exe ya es
// la versión nueva y abre la app. Historia de por qué es así (job object de
// Windows, "timeout" sin consola, NSIS que devuelve el control antes de
// terminar de copiar): ver _lanzarProcesoIndependiente y el log de quit.
function _lanzarWaiterActualizacion(installerPath) {
  // /S (silencioso) + --force-run: lo que pide el NSIS de electron-builder
  // para el instalador "assisted" (oneClick:false) en modo actualización.
  const args = ['--updated', '/S']
  if (autoUpdater.autoRunAppAfterInstall) args.push('--force-run')
  const exePath = process.execPath   // mismo directorio tras actualizar
  const logPath = 'D:\\Programas\\anime-app\\ryoku-quit-debug.log'
  const argsPs = args.map((a) => `'${a}'`).join(',')
  const ps1WaiterPath = path.join(os.tmpdir(), 'ryoku-updater-waiter.ps1')
  const ps1Waiter = `$exePath = '${exePath}'
$installerPath = '${installerPath}'
$logPath = '${logPath}'
$versionNueva = '${_versionDescargada || ''}'

function Log($msg) {
  $linea = '[' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') + '] ' + $msg
  Add-Content -Path $logPath -Value $linea -Encoding utf8
}

# 1) Esperar a que no quede NINGUN proceso RYOKU (principal + GPU/utility).
#    RYOKU sigue abierto hasta que el splash se ve, por eso el tope es amplio.
$intentos = 0
while ((Get-Process -Name 'RYOKU' -ErrorAction SilentlyContinue) -and ($intentos -lt 240)) {
  Start-Sleep -Milliseconds 250
  $intentos++
}
Start-Sleep -Milliseconds 800   # margen para que Windows libere los archivos
Log 'relanzador: RYOKU cerrado, corriendo instalador'

# 2) Instalar y esperar a que el proceso del instalador termine.
Start-Process -FilePath $installerPath -ArgumentList @(${argsPs}) -Wait

# 3) Confirmar que el .exe ya es la version nueva -- por VERSION del archivo.
#    Antes se miraba la fecha de modificacion, pero el instalador conserva la
#    fecha original del build: esa espera nunca se cumplia y sumaba 14 s
#    fijos a cada actualizacion. Solo hace falta si NSIS devolvio el control
#    antes de terminar de copiar (pasa a veces, por eso se reintenta).
if ($versionNueva) {
  $v = 0
  $pv = ''
  while ($v -lt 40) {
    try { $pv = (Get-Item $exePath).VersionInfo.ProductVersion } catch { $pv = '' }
    if ($pv -eq $versionNueva -or $pv -eq ($versionNueva + '.0')) { break }
    Start-Sleep -Milliseconds 250
    $v++
  }
  Log ('relanzador: version del exe = ' + $pv + ' (esperada ' + $versionNueva + ', reintentos ' + $v + ')')
}

# 4) Abrir la app actualizada.
Start-Process -FilePath $exePath
Log 'relanzador: app abierta'
`
  try {
    fs.writeFileSync(ps1WaiterPath, ps1Waiter, 'utf-8')
  } catch (e) {
    _logQuit('excepcion escribiendo waiter: ' + e.message)
    return Promise.resolve(false)
  }
  _logQuit('waiter ps1 escrito en ' + ps1WaiterPath + ' (version nueva=' + (_versionDescargada || '?') + ')')
  const comandoWaiter = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ps1WaiterPath}"`
  return _lanzarProcesoIndependiente(comandoWaiter, 'waiter de actualizacion')
}

ipcMain.on('update-install', () => {
  _logQuit('update-install recibido, ventanas abiertas: ' + BrowserWindow.getAllWindows().length)
  // Saltear el cierre normal (que espera al renderer con un timer de hasta
  // 4s, ver _requestQuit/_doQuit): para actualizar, el cierre lo maneja este
  // flujo de punta a punta.
  if (_quitTimer) { clearTimeout(_quitTimer); _quitTimer = null }
  if (_quitting) return
  _quitting = true

  const installerPath = autoUpdater.installerPath
  _logQuit('installerPath=' + installerPath)

  // Guardado del renderer (progreso + nube), con tope de 1.5 s.
  const _guardado = new Promise((resolve) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      ipcMain.once('save-before-quit-done', () => resolve(true))
      mainWindow.webContents.send('save-before-quit')
    } else resolve(false)
    setTimeout(() => resolve(false), 1500)
  })

  if (!installerPath) {
    // Sin ruta del instalador ya descargado: camino original de electron-updater.
    _logQuit('sin installerPath, usando quitAndInstall original de electron-updater')
    _guardado.then(() => {
      app.removeAllListeners('window-all-closed')
      autoUpdater.quitAndInstall()
    })
    return
  }

  // 1) Arrancar YA, en paralelo con el guardado: el splash y el waiter.
  try { fs.unlinkSync(_MARCA_SPLASH_VISIBLE) } catch (e) {}
  try { fs.unlinkSync(_MARCA_APP_ABIERTA) } catch (e) {}
  const _splashPromise = _lanzarSplashActualizando()
  const _waiterPromise = _lanzarWaiterActualizacion(installerPath)

  // 2) Cerrar RYOKU recién cuando: el guardado terminó, los dos procesos ya
  //    existen (lanzadores WMI confirmados -- ver _lanzarProcesoIndependiente)
  //    y el splash ya está en pantalla. Todo con topes de seguridad.
  Promise.all([
    _guardado,
    _conTimeout(_splashPromise, 8000, 'splash de actualizacion'),
    _conTimeout(_waiterPromise, 8000, 'waiter de actualizacion'),
  ])
    .then(() => _esperarArchivo(_MARCA_SPLASH_VISIBLE, 5000))
    .then((visible) => {
      _logQuit('splash ' + (visible ? 'visible' : 'NO confirmado (sigo igual)') + ', cerrando RYOKU')
      app.removeAllListeners('window-all-closed')
      BrowserWindow.getAllWindows().forEach((w) => {
        try { if (!w.isDestroyed()) w.destroy() } catch (e) {}
      })
      app.on('quit', () => _logQuit('evento quit disparado'))
      app.quit()
    })
})
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('check-for-updates', () => autoUpdater.checkForUpdates().catch((e) => { throw e }))

// ─── GOOGLE AUTH — abre en navegador del sistema ──────────────────────────────
let _pendingGoogleAuthResolve = null
// El usuario puede cerrar la pestaña del navegador del sistema (shell.openExternal)
// sin que eso le avise a Electron de ninguna forma — no es una BrowserWindow que
// podamos escuchar. Por eso el renderer, cuando cierra el modal de cuenta con un
// login en curso, manda esto para destrabar el botón al toque en vez de esperar
// el timeout de más abajo.
ipcMain.on('google-auth-cancel', () => {
  if (_pendingGoogleAuthResolve) _pendingGoogleAuthResolve({ error: 'cancelled' })
})

ipcMain.handle('google-auth', () => {
  return new Promise((resolve) => {
    let resolved = false

    // Sin esto, si el usuario cierra la pestaña del navegador sin terminar el
    // login (o nunca la abre) Y tampoco cierra el modal de cuenta (lo que
    // dispara google-auth-cancel), nada llama a doResolve(): la promesa de
    // window.api.googleAuth() en el renderer queda colgada para siempre (el
    // botón de "Continuar con Google" se traba) y el server HTTP local sigue
    // escuchando en su puerto sin cerrarse nunca, acumulándose con cada
    // intento fallido. Este timeout es la red de seguridad final.
    const TIMEOUT_MS = 5 * 60 * 1000 // 5 min — suficiente para elegir cuenta/2FA
    const timeoutTimer = setTimeout(() => doResolve({ error: 'timeout' }), TIMEOUT_MS)

    function doResolve (data) {
      if (resolved) return
      resolved = true
      clearTimeout(timeoutTimer)
      if (_pendingGoogleAuthResolve === doResolve) _pendingGoogleAuthResolve = null
      try { server.close() } catch (e) {}
      resolve(data)
    }
    _pendingGoogleAuthResolve = doResolve

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
      }).then(function() {
        box.innerHTML = '<h2 class="ok">&#10003; Sesion iniciada</h2><p>Puedes cerrar esta pestana y volver a RYOKU.</p>'
      })
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
