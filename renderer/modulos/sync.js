'use strict'

// ─── Debug helper (temporal) ─────────────────────────────────────────────────
function _d(msg) {
  try {
    var el = document.getElementById('_dbg')
    if (!el) return
    var d = document.createElement('div')
    d.style.color = '#0ff'
    d.textContent = new Date().toISOString().slice(11,19) + ' ' + msg
    el.appendChild(d)
    el.scrollTop = el.scrollHeight
  } catch(e) {}
}

// ─── Sync Firestore ───────────────────────────────────────────────────────────
let _syncInited   = false
let _autoSaveTimer = null

function _getDb()   { return window._ryokuDb }
function _getUser() { return window._ryokuAuth?.currentUser || null }

// Devuelve el dominio base de la fuente activa (para filtrar favs/hist por fuente)
const _ANIME_DOMAINS = {
  latanime:    'latanime.org',
  animeflv:    'animeflv.net',
  monoschinos: 'monoschinos.st',
}
async function _srcDomain() {
  const id = await window.api?.getAnimeSource?.() || 'latanime'
  return _ANIME_DOMAINS[id] || ''
}
function _favMatchesDomain(fav, domain) {
  if (!domain) return true
  return (fav.url || '').includes(domain)
}
function _histMatchesDomain(h, domain) {
  if (!domain) return true
  return (h.link || '').includes(domain)
}

async function _getDoc(uid, col) {
  try {
    const snap = await _getDb().collection('users').doc(uid).collection('data').doc(col).get()
    return snap.exists ? snap.data() : null
  } catch(e) { _d('[sync] getDoc ERROR ' + col + ': ' + String(e)); console.warn('[sync] getDoc error', col, e); return null }
}

async function _setDoc(uid, col, data) {
  try {
    await _getDb().collection('users').doc(uid).collection('data').doc(col).set(data)
  } catch(e) { console.warn('[sync] setDoc error', col, e); throw e }
}

// ─── Manga localStorage — solo claves relevantes (excluir manga-leidos que puede ser enorme) ──
const _MANGA_KEYS_ALLOWED = ['manga-favs', 'manga-historial', 'manga-progreso']

function _getMangaLocalStorage() {
  const result = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    const allowed = _MANGA_KEYS_ALLOWED.some(prefix => key.startsWith(prefix))
    if (!allowed) continue
    try { result[key] = JSON.parse(localStorage.getItem(key)) }
    catch(e) { result[key] = localStorage.getItem(key) }
  }
  return result
}

function _setMangaLocalStorage(data) {
  if (!data || typeof data !== 'object') return
  for (const [key, val] of Object.entries(data)) {
    const allowed = _MANGA_KEYS_ALLOWED.some(prefix => key.startsWith(prefix))
    if (!allowed) continue
    try { localStorage.setItem(key, JSON.stringify(val)) }
    catch(e) {}
  }
}

// ─── Subir a Firestore (GUARDAR) ──────────────────────────────────────────────
async function guardarEnCloud() {
  const user = _getUser()
  if (!user || !_getDb()) { _setStatus('Sin sesión', 'error'); return }

  _setStatus('Guardando...', 'loading')
  try {
    // Fase 1: leer TODAS las fuentes locales + cloud actual + config en paralelo
    // getAllFavsFlat/getAllHistFlat/getAllProgFlat devuelven datos de todas las fuentes
    // combinados; si no están disponibles (versión antigua), se usa solo la activa.
    const _getAllFavs  = window.api?.getAllFavsFlat?.() ?? window.api?.getFavs?.() ?? Promise.resolve([])
    const _getAllHist  = window.api?.getAllHistFlat?.() ?? window.api?.getHistorial?.() ?? Promise.resolve([])
    const _getAllProg  = window.api?.getAllProgFlat?.() ?? window.api?.getTodosProgresos?.() ?? Promise.resolve({})
    const _getAllTomb  = window.api?.getAllTombstonesFlat?.() ?? Promise.resolve({ favs: {}, hist: {}, prog: {} })
    const [allLocalFavs, oldFavDoc, allLocalHist, oldHistDoc, allLocalProg, oldProgDoc, localTomb, cloudTombDoc, cfg] = await Promise.all([
      Promise.resolve(_getAllFavs).catch(() => []),
      _getDoc(user.uid, 'anime_favoritos'),
      Promise.resolve(_getAllHist).catch(() => []),
      _getDoc(user.uid, 'anime_historial'),
      Promise.resolve(_getAllProg).catch(() => ({})),
      _getDoc(user.uid, 'anime_progresos'),
      Promise.resolve(_getAllTomb).catch(() => ({ favs: {}, hist: {}, prog: {} })),
      _getDoc(user.uid, 'anime_tombstones'),
      window.api?.configGet?.().catch(() => ({})) || Promise.resolve({}),
    ])

    // Merge: datos locales (todas las fuentes) + datos cloud (para no perder ítems
    // que existen solo en cloud, p.ej. favoritos añadidos desde Android)
    const allCloudFavs = oldFavDoc?.lista && Array.isArray(oldFavDoc.lista) ? oldFavDoc.lista : []
    const allCloudHist = oldHistDoc?.lista && Array.isArray(oldHistDoc.lista) ? oldHistDoc.lista : []
    const allCloudProg = oldProgDoc?.datos && typeof oldProgDoc.datos === 'object' ? oldProgDoc.datos : {}
    const cloudTomb = cloudTombDoc && typeof cloudTombDoc === 'object' ? cloudTombDoc : { favs: {}, hist: {}, prog: {} }
    // 1er arg = "local" (gana en caso de duplicado), 2do = "cloud"
    const mergedTomb = _mergeTomb(localTomb, cloudTomb)
    // Un tombstone representa un borrado real. Si el ítem SIGUE existiendo
    // en los datos locales ahora mismo (p.ej. un episodio que se desmarcó y
    // se volvió a marcar como visto después), ese tombstone quedó obsoleto.
    // _mergeTomb es pura unión y nunca "olvida" un tombstone una vez creado
    // -- sin podar acá, un tombstone viejo de la nube se resubía a Firestore
    // (y se reaplicaba localmente vía restoreAllTombstones más abajo) en
    // cada guardado, borrando para siempre un progreso recién marcado por
    // más veces que se volviera a marcar. Se descarta cualquier tombstone
    // cuyo ítem exista en los datos locales actuales, antes de aplicar/subir.
    for (const f of allLocalFavs) { if (f?.url) delete mergedTomb.favs[f.url] }
    for (const h of allLocalHist) { if (h?.link) delete mergedTomb.hist[h.link] }
    for (const link of Object.keys(allLocalProg)) delete mergedTomb.prog[link]
    let mergedFavs = _mergeFavs(allLocalFavs, allCloudFavs)
    let mergedHist = _mergeHist(allLocalHist, allCloudHist)
    // Antes esto se guardaba directo (allLocalProg) pisando el doc de cloud
    // entero — si dos dispositivos habían avanzado episodios distintos, el
    // último en guardar borraba el progreso del otro. Mergear igual que
    // favoritos/historial (ya se usaba _mergeProg, pero solo al CARGAR).
    let mergedProg = _mergeProg(allLocalProg, allCloudProg)
    // Aplicar tombstones DESPUÉS del merge: si otro dispositivo borró un ítem
    // (tombstone en la nube) que este dispositivo todavía tiene local sin
    // sincronizar, el merge de arriba lo hubiera vuelto a subir — esto lo
    // saca antes de escribir a Firestore.
    ;({ favs: mergedFavs, hist: mergedHist, prog: mergedProg } = _aplicarTomb(mergedFavs, mergedHist, mergedProg, mergedTomb))

    // Configuración
    const cfgKeys = ['app-modo', 'app-accent', 'app-18', 'sidebar-autohide', 'app-accent-custom-hex', 'app-corners', 'app-densidad', 'app-glass', 'app-bg-gradient', 'app-bg-mode', 'app-bg-blur', 'app-bg-position', 'app-bg-scale', 'sidebar-neon', 'neon-intensidad', 'app-tema-id', 'app-miku-sonido']
    const cfgData = {}
    const cfgObj = cfg || {}
    for (const k of cfgKeys) { if (cfgObj[k] !== undefined) cfgData[k] = cfgObj[k] }

    // Manga (localStorage — sync, sin await)
    const manga = _getMangaLocalStorage()

    // Fase 2: todas las escrituras en paralelo
    const writes = [
      _setDoc(user.uid, 'anime_favoritos',  { lista: mergedFavs }),
      _setDoc(user.uid, 'anime_historial',  { lista: mergedHist }),
      _setDoc(user.uid, 'anime_progresos',  { datos: mergedProg }),
      _setDoc(user.uid, 'anime_tombstones', mergedTomb),
    ]
    if (Object.keys(manga).length > 0)   writes.push(_setDoc(user.uid, 'manga_data', { datos: manga }))
    if (Object.keys(cfgData).length > 0) writes.push(_setDoc(user.uid, 'config',     { data: cfgData }))
    if (window.api?.restoreAllTombstones) writes.push(Promise.resolve(window.api.restoreAllTombstones(mergedTomb)).catch(() => {}))
    await Promise.all(writes)

    _setStatus('Guardado ✓', 'ok')
    console.log('[sync] datos guardados en cloud')
    setTimeout(() => _setStatus('Listo', ''), 3000)
  } catch(e) {
    console.warn('[sync] error guardando', e)
    _setStatus('Error al guardar', 'error')
  }
}

// ─── Cargar desde Firestore (CARGAR) ─────────────────────────────────────────
// ─── Helpers de merge ────────────────────────────────────────────────────────
function _mergeFavs(local, cloud) {
  // Unión por url: si está en cualquiera de los dos, se incluye
  const map = {}
  // Cloud primero, luego local sobreescribe (local tiene prioridad para orden)
  ;(cloud || []).forEach(f => { if (f?.url) map[f.url] = f })
  ;(local || []).forEach(f => { if (f?.url) map[f.url] = f })
  return Object.values(map)
}

function _mergeHist(local, cloud) {
  // Unión por link, más recientes primero (local tiene prioridad)
  const map = {}
  ;(cloud || []).forEach(h => { if (h?.link) map[h.link] = h })
  ;(local || []).forEach(h => { if (h?.link) map[h.link] = h })
  return Object.values(map).slice(0, 500)
}

function _mergeProg(local, cloud) {
  // Por link: gana el que tenga mayor currentTime
  const merged = Object.assign({}, cloud || {})
  for (const [link, lp] of Object.entries(local || {})) {
    const cp = merged[link]
    if (!cp || (lp?.currentTime || 0) >= (cp?.currentTime || 0)) {
      merged[link] = lp
    }
  }
  return merged
}

// Une dos sets de tombstones {favs:{key:ts}, hist:{...}, prog:{...}}, quedándose
// con el timestamp más reciente por clave (por si el mismo ítem se borró en dos
// dispositivos distintos en momentos distintos).
function _mergeTomb(a, b) {
  const out = { favs: {}, hist: {}, prog: {} }
  for (const tipo of ['favs', 'hist', 'prog']) {
    Object.assign(out[tipo], (a && a[tipo]) || {})
    for (const [key, ts] of Object.entries((b && b[tipo]) || {})) {
      if (!out[tipo][key] || ts > out[tipo][key]) out[tipo][key] = ts
    }
  }
  return out
}

// Filtra favs/hist/prog ya mergeados descartando cualquier ítem cuya clave
// tenga un tombstone — así un favorito borrado en OTRO dispositivo no se
// vuelve a subir/restaurar solo porque este dispositivo todavía lo tenía.
function _aplicarTomb(favs, hist, prog, tomb) {
  const favsOk = (favs || []).filter(f => !(f?.url && tomb.favs[f.url]))
  const histOk = (hist || []).filter(h => !(h?.link && tomb.hist[h.link]))
  const progOk = {}
  for (const [link, p] of Object.entries(prog || {})) {
    if (!tomb.prog[link]) progOk[link] = p
  }
  return { favs: favsOk, hist: histOk, prog: progOk }
}

async function cargarDesdeCloud() {
  const user = _getUser()
  _d('[sync] cargarDesdeCloud user=' + (user ? user.email : 'null') + ' db=' + !!_getDb())
  if (!user || !_getDb()) { _setStatus('Sin sesión', 'error'); _d('[sync] abort: sin sesion/db'); return }

  _setStatus('Cargando...', 'loading')
  try {
    // ── Tombstones: mergear ANTES que favs/hist/prog para poder filtrar
    // ítems ya borrados en otro dispositivo antes de restaurarlos acá ─────
    const tombDoc   = await _getDoc(user.uid, 'anime_tombstones')
    const localTomb = await (window.api?.getAllTombstonesFlat?.()) || { favs: {}, hist: {}, prog: {} }
    const cloudTomb = tombDoc && typeof tombDoc === 'object' ? tombDoc : { favs: {}, hist: {}, prog: {} }
    const mergedTomb = _mergeTomb(localTomb, cloudTomb)
    // Leer los datos locales ACTUALES (todas las fuentes) antes de aplicar
    // el merge de tombstones, para poder podarlo primero -- ver comentario
    // largo en guardarEnCloud() sobre por qué un tombstone viejo de la nube
    // no debe pisar para siempre un ítem que localmente sí existe ahora.
    const allLocalFavs = await (window.api?.getAllFavsFlat?.() ?? window.api?.getFavs?.()) || []
    const allLocalHist = await (window.api?.getAllHistFlat?.() ?? window.api?.getHistorial?.()) || []
    const allLocalProg = await (window.api?.getAllProgFlat?.() ?? window.api?.getTodosProgresos?.()) || {}
    for (const f of allLocalFavs) { if (f?.url) delete mergedTomb.favs[f.url] }
    for (const h of allLocalHist) { if (h?.link) delete mergedTomb.hist[h.link] }
    for (const link of Object.keys(allLocalProg)) delete mergedTomb.prog[link]
    // Adoptar el merge (ya podado) en el store local — esto también purga de
    // favs/hist/prog local cualquier ítem que sí siga borrado en otro lado.
    if (window.api?.restoreAllTombstones) await window.api.restoreAllTombstones(mergedTomb).catch(() => {})

    // ── Favs: merge cloud + local de TODAS las fuentes → restaurar todo ───
    // getAllFavsFlat devuelve favs de todas las fuentes; si no está disponible,
    // getFavs devuelve solo la fuente activa (fallback). Ya leídos arriba.
    const favDoc       = await _getDoc(user.uid, 'anime_favoritos')
    const allCloudFavs = favDoc?.lista && Array.isArray(favDoc.lista) ? favDoc.lista : []
    let allMergedFavs = _mergeFavs(allLocalFavs, allCloudFavs)  // local gana duplicados
    allMergedFavs = allMergedFavs.filter(f => !(f?.url && mergedTomb.favs[f.url]))
    _d('[sync] favs local=' + allLocalFavs.length + ' cloud=' + allCloudFavs.length + ' merged=' + allMergedFavs.length)
    if (allMergedFavs.length > 0) {
      // restoreAllFavs distribuye por URL a cada fuente; fallback: restoreFavs (solo activa)
      if (window.api?.restoreAllFavs) await window.api.restoreAllFavs(allMergedFavs)
      else await window.api?.restoreFavs?.(allMergedFavs)
      _d('[sync] favs restaurados (all)=' + allMergedFavs.length)
    }

    // ── Historial: idem — todas las fuentes ───────────────────────────────
    const histDoc      = await _getDoc(user.uid, 'anime_historial')
    const allCloudHist = histDoc?.lista && Array.isArray(histDoc.lista) ? histDoc.lista : []
    let allMergedHist = _mergeHist(allLocalHist, allCloudHist)
    allMergedHist = allMergedHist.filter(h => !(h?.link && mergedTomb.hist[h.link]))
    _d('[sync] hist local=' + allLocalHist.length + ' cloud=' + allCloudHist.length + ' merged=' + allMergedHist.length)
    if (allMergedHist.length > 0) {
      if (window.api?.restoreAllHist) await window.api.restoreAllHist(allMergedHist)
      else await window.api?.restoreHistorial?.(allMergedHist)
      _d('[sync] hist restaurados (all)=' + allMergedHist.length)
    }

    // ── Progreso: merge cloud + local, todas las fuentes ──────────────────
    const progDoc      = await _getDoc(user.uid, 'anime_progresos')
    const allCloudProg = progDoc?.datos && typeof progDoc.datos === 'object' ? progDoc.datos : {}
    let allMergedProg = _mergeProg(allLocalProg, allCloudProg)
    for (const link of Object.keys(mergedTomb.prog)) delete allMergedProg[link]
    if (Object.keys(allMergedProg).length > 0) {
      if (window.api?.restoreAllProg) await window.api.restoreAllProg(allMergedProg)
      else await window.api?.restoreProgresos?.(allMergedProg)
      _d('[sync] prog merged=' + Object.keys(allMergedProg).length)
    }

    // ── Manga → localStorage ───────────────────────────────────────────────
    const mangaDoc = await _getDoc(user.uid, 'manga_data')
    if (mangaDoc?.datos) _setMangaLocalStorage(mangaDoc.datos)

    // ── Configuración ──────────────────────────────────────────────────────
    const cfgDoc = await _getDoc(user.uid, 'config')
    if (cfgDoc?.data) {
      const claves = ['app-modo', 'app-accent', 'app-18', 'sidebar-autohide', 'app-accent-custom-hex', 'app-corners', 'app-densidad', 'app-glass', 'app-bg-gradient', 'app-bg-mode', 'app-bg-blur', 'app-bg-position', 'app-bg-scale', 'sidebar-neon', 'neon-intensidad', 'app-tema-id', 'app-miku-sonido']
      for (const k of claves) {
        if (cfgDoc.data[k] !== undefined) await window.api?.configSet?.(k, cfgDoc.data[k])
      }
      // Aplicar visualmente sin re-subir a Firestore
      const d = cfgDoc.data
      if (d['app-modo'] !== undefined && typeof setAppModo === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setAppModo(d['app-modo'])
        window._syncGuardar = _orig
      }
      if (d['app-accent'] !== undefined && typeof setAppAccent === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setAppAccent(d['app-accent'])
        window._syncGuardar = _orig
      }
      // Acento personalizado: si llegó como 'custom', re-aplicar con el hex sincronizado
      if (d['app-accent'] === 'custom' && d['app-accent-custom-hex'] !== undefined && typeof setAppAccentCustom === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setAppAccentCustom(d['app-accent-custom-hex'])
        window._syncGuardar = _orig
      }
      if (d['sidebar-neon'] !== undefined && typeof setSidebarNeon === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setSidebarNeon(!!d['sidebar-neon'])
        window._syncGuardar = _orig
      }
      if (d['neon-intensidad'] !== undefined && typeof setNeonIntensidad === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setNeonIntensidad(d['neon-intensidad'])
        window._syncGuardar = _orig
      }
      if (d['app-corners'] !== undefined && typeof setAppCorners === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setAppCorners(d['app-corners'])
        window._syncGuardar = _orig
      }
      if (d['app-densidad'] !== undefined && typeof setAppDensidad === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setAppDensidad(d['app-densidad'])
        window._syncGuardar = _orig
      }
      if (d['app-glass'] !== undefined && typeof setAppGlass === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setAppGlass(!!d['app-glass'])
        window._syncGuardar = _orig
      }
      if (d['app-tema-id'] !== undefined) {
        document.body.dataset.temaId = d['app-tema-id'] || ''
        document.querySelectorAll('.cfg-preset-btn').forEach(b => b.classList.toggle('activo', b.dataset.preset === d['app-tema-id']))
        if (typeof window._mikuTemaAplicado === 'function') window._mikuTemaAplicado(d['app-tema-id'])
        if (typeof window._neruTemaAplicado === 'function') window._neruTemaAplicado(d['app-tema-id'])
      }
      if (d['app-miku-sonido'] !== undefined && typeof setMikuSonido === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setMikuSonido(!!d['app-miku-sonido'])
        const _cfgMikuSonido = document.getElementById('cfg-tog-miku-sonido')
        if (_cfgMikuSonido) _cfgMikuSonido.checked = !!d['app-miku-sonido']
        window._syncGuardar = _orig
      }
      if (d['app-bg-gradient'] !== undefined && d['app-bg-mode'] === 'gradiente' && typeof setBgGradiente === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setBgGradiente(d['app-bg-gradient'])
        window._syncGuardar = _orig
      }
      if (d['app-bg-blur'] !== undefined && typeof setBgBlur === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setBgBlur(!!d['app-bg-blur'])
        window._syncGuardar = _orig
      }
      if ((d['app-bg-position'] !== undefined || d['app-bg-scale'] !== undefined) && typeof setBgEncuadre === 'function') {
        const _orig = window._syncGuardar; window._syncGuardar = null
        setBgEncuadre(d['app-bg-position'], d['app-bg-scale'])
        window._syncGuardar = _orig
      }
      // setConfig18 llama cargarRecientes() — aplicar directamente sin ese efecto
      if (d['app-18'] !== undefined) {
        await window.api?.configSet?.('app-18', d['app-18'])
        document.body.classList.toggle('show-18', !!d['app-18'])
      }
      // setSidebarAutohide es seguro, solo cambia CSS
      if (d['sidebar-autohide'] !== undefined && typeof setSidebarAutohide === 'function') setSidebarAutohide(d['sidebar-autohide'])
    }

    // ── Subir el merge a Firestore (ya contiene TODAS las fuentes) ─────────
    await _subirMerge(user, allMergedFavs, allMergedHist, allMergedProg, mergedTomb)

    _setStatus('Sincronizado ✓', 'ok')
    console.log('[sync] datos cargados desde cloud')
    setTimeout(() => _setStatus('Listo', ''), 3000)
  } catch(e) {
    console.warn('[sync] error cargando', e)
    _d('[sync] ERROR: ' + String(e))
    _setStatus('Error al sincronizar', 'error')
  }
}

// Sube el resultado del merge a Firestore (solo si hay algo que subir)
async function _subirMerge(user, favs, hist, prog, tomb) {
  try {
    if (favs.length > 0)               await _setDoc(user.uid, 'anime_favoritos', { lista: favs })
    if (hist.length > 0)               await _setDoc(user.uid, 'anime_historial',  { lista: hist })
    if (Object.keys(prog).length > 0)  await _setDoc(user.uid, 'anime_progresos',  { datos: prog })
    if (tomb) await _setDoc(user.uid, 'anime_tombstones', tomb)
  } catch(e) { console.warn('[sync] error subiendo merge', e) }
}

// ─── Auto-save periódico (cada 5 minutos mientras hay sesión) ─────────────────
function _iniciarAutoSave() {
  if (_autoSaveTimer) clearInterval(_autoSaveTimer)
  _autoSaveTimer = setInterval(async () => {
    if (!_getUser()) return
    // No auto-guardar si no hay datos locales — evita sobrescribir cloud con vacíos.
    // Antes este chequeo miraba solo getHistorial()/getFavs() (la fuente ACTIVA nada
    // más), mientras que guardarEnCloud() de verdad sube TODAS las fuentes — un
    // usuario con datos solo en animeflv/monoschinos pero con latanime activa nunca
    // pasaba este chequeo y jamás se autoguardaba nada. Usar los mismos getters
    // "flat" que usa guardarEnCloud().
    const hist = await (window.api?.getAllHistFlat?.() ?? window.api?.getHistorial?.()) || []
    const favs = await (window.api?.getAllFavsFlat?.() ?? window.api?.getFavs?.()) || []
    if (!hist.length && !favs.length) { console.log('[sync] auto-save omitido: sin datos locales'); return }
    guardarEnCloud()
  }, 5 * 60 * 1000)
}

function _detenerAutoSave() {
  if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null }
}

// ─── UI status ────────────────────────────────────────────────────────────────
function _setStatus(texto, tipo) {
  const el = document.getElementById('acm-sync-status')
  if (!el) return
  const span = el.querySelector('.acm-sync-text')
  if (span) span.textContent = texto
  el.dataset.syncTipo = tipo || ''
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function initSync() {
  _d('[sync] initSync called')
  if (_syncInited) return
  _syncInited = true

  const _wait = setInterval(() => {
    if (typeof onAuthChange === 'function') {
      clearInterval(_wait)
      _d('[sync] onAuthChange found, registering')
      onAuthChange(async user => {
        _d('[sync] callback fired user=' + (user ? user.email : 'null'))
        if (user) {
          await cargarDesdeCloud()
          _d('[sync] cargarDesdeCloud done')
          _iniciarAutoSave()
          if (typeof cargarContinuarViendo === 'function') cargarContinuarViendo()
          if (typeof cargarFavoritos === 'function') cargarFavoritos()
        } else {
          _detenerAutoSave()
          _setStatus('Listo', '')
        }
      })
    }
  }, 200)

  // Guardar al cerrar la app
  window.api?.onSaveBeforeQuit?.(async () => {
    const overlay = document.getElementById('ryoku-quit-overlay')
    if (overlay) overlay.classList.add('visible')
    // Si hay un episodio reproduciéndose, guardar su avance exacto ANTES que
    // nada — sin esto, cerrar la app (no el reproductor) a mitad de un
    // episodio podía perder hasta ~15s de avance (lo que tardaba el
    // intervalo periódico en tickear de nuevo), y ese progreso viejo era
    // encima lo que se subía a la nube en el paso siguiente.
    if (typeof window._rpFlushProgresoActual === 'function') {
      try { await window._rpFlushProgresoActual() } catch (e) {}
    }
    if (_getUser()) {
      guardarEnCloud().finally(() => window.api?.saveBeforeQuitDone?.())
    } else {
      window.api?.saveBeforeQuitDone?.()
    }
  })
}

window.addEventListener('DOMContentLoaded', initSync)

// Exponer globalmente para botones del modal
window._syncGuardar = guardarEnCloud
window._syncCargar  = cargarDesdeCloud
