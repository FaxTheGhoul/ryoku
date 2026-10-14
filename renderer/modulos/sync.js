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

// ─── Fuentes eliminadas de la app (Monoschinos, NovelCool) ───────────────────
// Todas las funciones de mezcla de este archivo descartan lo que pertenezca a
// estas fuentes, venga de este dispositivo o de la nube. Así sus favoritos,
// historial, progreso, "al día" y datos de manga desaparecen de la nube en el
// próximo guardado, y no vuelven a bajar a ningún dispositivo.
// (ehentai / e-hentai.org / lectorhentai: fuentes de prueba que se movieron a
// otra app; se borran sus datos locales para que nunca se suban a la nube)
const _FUENTES_ELIMINADAS = ['monoschinos', 'novelcool', 'ehentai', 'e-hentai.org', 'lectorhentai']
function _esDeFuenteEliminada(v) { return !!v && _FUENTES_ELIMINADAS.some(d => String(v).includes(d)) }
function _sinFuentesEliminadas(obj) {
  const o = {}
  for (const [k, v] of Object.entries(obj || {})) if (!_esDeFuenteEliminada(k)) o[k] = v
  return o
}
// Limpieza local (una vez por arranque): claves de localStorage de NovelCool
// (manga-favs-novelcool, manga-historial-novelcool, manga-leidos-novelcool...)
// y entradas de esas fuentes en "al día" y en los tombstones de manga.
;(function _borrarLocalFuentesEliminadas() {
  try {
    const claves = []
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && _esDeFuenteEliminada(k)) claves.push(k) }
    claves.forEach(k => localStorage.removeItem(k))
    for (const k of ['ryoku-al-dia-anime', 'ryoku-al-dia-manga']) {
      const v = JSON.parse(localStorage.getItem(k) || 'null')
      if (v && typeof v === 'object') localStorage.setItem(k, JSON.stringify(_sinFuentesEliminadas(v)))
    }
    const t = JSON.parse(localStorage.getItem('manga-tombstones') || 'null')
    if (t && typeof t === 'object') {
      for (const tipo of Object.keys(t)) t[tipo] = _sinFuentesEliminadas(t[tipo])
      localStorage.setItem('manga-tombstones', JSON.stringify(t))
    }
  } catch (e) {}
})()

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
const _MANGA_KEYS_ALLOWED = ['manga-favs', 'manga-historial', 'manga-progreso', 'manga-tombstones']

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

// ── Merge de manga (arreglo de bug: antes esto se subía/bajaba como un
// documento único reemplazado por completo -- guardarEnCloud subía SOLO
// el localStorage de este dispositivo tal cual, pisando en la nube
// cualquier favorito/historial/progreso de otra fuente o dispositivo que
// este no tuviera localmente; cargarDesdeCloud hacía lo mismo al revés,
// pisando el localStorage local con lo que hubiera en la nube. Con dos
// dispositivos usando fuentes de manga distintas (o con un simple orden
// de sincronizado desfavorable), esto borraba en silencio favoritos
///historial/progreso reales. Se mergea key por key igual que ya se hace
// con favoritos/historial/progreso de anime. ─────────────────────────────
function _mergeMangaArrayByKey(local, cloud, keyField) {
  return _unionPorClave(local, cloud, keyField)
}
function _mergeMangaProgresoObj(local, cloud) {
  // Por capLink: gana el que tenga el "ts" (timestamp) más reciente.
  const merged = Object.assign({}, cloud || {})
  for (const [link, lp] of Object.entries(local || {})) {
    const cp = merged[link]
    if (!cp || (lp?.ts || 0) >= (cp?.ts || 0)) merged[link] = lp
  }
  return merged
}
// Tope de entradas de progreso de páginas por fuente: crecía sin límite (una
// por capítulo abierto) y todo va en el doc manga_data, que Firestore corta
// en 1 MB -- pasado ese tamaño, guardar el manga en la nube fallaría entero.
// Se conservan las 1000 más recientes; las viejas solo guardaban la página
// de capítulos de hace mucho (lo "leído" se guarda aparte, en manga-leidos).
const _MANGA_PROG_MAX = 1000
function _recortarProgresoManga(obj) {
  const entradas = Object.entries(obj || {})
  if (entradas.length <= _MANGA_PROG_MAX) return obj
  entradas.sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0))
  return Object.fromEntries(entradas.slice(0, _MANGA_PROG_MAX))
}
function _mergeMangaData(localData, cloudData) {
  const out = {}
  const claves = new Set([...Object.keys(localData || {}), ...Object.keys(cloudData || {})])
  for (const key of claves) {
    if (key === 'manga-tombstones' || _esDeFuenteEliminada(key)) continue
    const lv = localData?.[key]
    const cv = cloudData?.[key]
    if (key.startsWith('manga-progreso')) out[key] = _recortarProgresoManga(_mergeMangaProgresoObj(lv, cv))
    // Historial: orden cronológico (más viejo primero, como lo escribe
    // manga.js con push) y el mismo tope de 60 que usa manga.js. Antes la
    // unión ponía al final lo que venía solo de la nube aunque fuera más
    // viejo, y el historial crecía sin tope con cada sync.
    else if (key.startsWith('manga-historial')) out[key] = _mergeMangaArrayByKey(lv, cv, 'link')
      .sort((a, b) => (a?.ts || 0) - (b?.ts || 0)).slice(-60)
    else if (key.startsWith('manga-favs')) out[key] = _mergeMangaArrayByKey(lv, cv, 'url')
    else out[key] = lv !== undefined ? lv : cv  // clave inesperada -- no se pierde, local gana
  }
  // Tombstones (borrados) -- mismo criterio que anime: se unen local + nube,
  // se descarta el que tenga un ítem re-agregado después (ts más nuevo) y lo
  // que quede se aplica a todas las fuentes. Sin esto lo borrado en manga
  // (favoritos, historial) volvía desde la nube en cada sync.
  const tomb = _mergeTomb(localData?.['manga-tombstones'], cloudData?.['manga-tombstones'])
  for (const [key, val] of Object.entries(out)) {
    if (key.startsWith('manga-favs')) _podarTomb(tomb, [val], [], [])
    else if (key.startsWith('manga-historial')) _podarTomb(tomb, [], [val], [])
    else if (key.startsWith('manga-progreso')) _podarTomb(tomb, [], [], [val])
  }
  for (const key of Object.keys(out)) {
    if (key.startsWith('manga-favs')) out[key] = (out[key] || []).filter(f => !(f?.url && tomb.favs[f.url]))
    else if (key.startsWith('manga-historial')) out[key] = (out[key] || []).filter(h => !(h?.link && tomb.hist[h.link]))
    else if (key.startsWith('manga-progreso')) {
      const p = { ...(out[key] || {}) }
      for (const l of Object.keys(tomb.prog)) delete p[l]
      out[key] = p
    }
  }
  out['manga-tombstones'] = tomb  // siempre: así el store local queda igual al podado
  return out
}

// ─── "Al día" (anime/manga vistos automáticamente) — sync ────────────────────
// Espejo simple de lo que ya hacen anime.js/manga.js en localStorage
// (ryoku-al-dia-anime / ryoku-al-dia-manga): {url: {titulo,imagen,totalEps|totalCaps,fecha}}.
// Se sincroniza como cualquier otro dato del usuario para que el perfil de
// un AMIGO muestre SU propio avance real y no el de quien esté viendo el
// perfil en ese momento.
function _getAlDiaLocal(tipo) {
  try { return JSON.parse(localStorage.getItem('ryoku-al-dia-' + tipo) || '{}') } catch(e) { return {} }
}
function _setAlDiaLocal(tipo, datos) {
  try { localStorage.setItem('ryoku-al-dia-' + tipo, JSON.stringify(datos || {})) } catch(e) {}
}
// Por url: gana la entrada con "fecha" más reciente (igual criterio que el
// resto de merges de este archivo, p.ej. _mergeMangaProgresoObj).
function _mergeAlDia(local, cloud) {
  const merged = _sinFuentesEliminadas(cloud)
  for (const [url, entry] of Object.entries(_sinFuentesEliminadas(local))) {
    const c = merged[url]
    if (!c || (entry?.fecha || 0) >= (c?.fecha || 0)) merged[url] = entry
  }
  return merged
}

let _alDiaSyncTimer = null
// Llamada por anime.js/manga.js cada vez que cambia el estado "al día" local.
// Debounced: junta varios cambios seguidos (p.ej. maratonear episodios) en
// una sola escritura a Firestore en vez de una por episodio.
window._ryokuMarcarSyncPendiente = function () {
  if (!_getUser() || !_getDb()) return
  if (_alDiaSyncTimer) clearTimeout(_alDiaSyncTimer)
  _alDiaSyncTimer = setTimeout(async () => {
    const user = _getUser()
    if (!user) return
    try {
      const [animeCloudDoc, mangaCloudDoc] = await Promise.all([
        _getDoc(user.uid, 'anime_al_dia'),
        _getDoc(user.uid, 'manga_al_dia'),
      ])
      const animeMerged = _mergeAlDia(_getAlDiaLocal('anime'), animeCloudDoc?.datos || {})
      const mangaMerged = _mergeAlDia(_getAlDiaLocal('manga'), mangaCloudDoc?.datos || {})
      _setAlDiaLocal('anime', animeMerged)
      _setAlDiaLocal('manga', mangaMerged)
      await Promise.all([
        _setDoc(user.uid, 'anime_al_dia', { datos: animeMerged }),
        _setDoc(user.uid, 'manga_al_dia', { datos: mangaMerged }),
      ])
    } catch(e) { console.warn('[sync] error subiendo al-dia', e) }
  }, 4000)
}

// ── Capítulos leídos de manga (manga-leidos-*) ───────────────────────────
// Antes no se sincronizaban (se excluían por tamaño), así que el ojito de
// "leído" no aparecía en el otro dispositivo. Van en un doc propio
// (manga_leidos) para no inflar manga_data hacia el límite de 1 MB de
// Firestore. Valor = cuándo se marcó (los viejos tienen 1); desmarcar deja
// un tombstone 'leidos' en manga-tombstones (ver _mnMarcarBorrado en manga.js).
function _getMangaLeidosLocal() {
  const out = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith('manga-leidos')) continue
    try { out[k] = JSON.parse(localStorage.getItem(k) || '{}') } catch (e) {}
  }
  return out
}
function _setMangaLeidosLocal(data) {
  for (const [k, v] of Object.entries(data || {})) {
    if (!k.startsWith('manga-leidos')) continue
    try { localStorage.setItem(k, JSON.stringify(v || {})) } catch (e) {}
  }
}
// tomb = los tombstones de manga ya mergeados (se modifican en el lugar).
function _mergeMangaLeidos(local, cloud, tomb) {
  const t = (tomb && typeof tomb === 'object') ? tomb : {}
  t.leidos = t.leidos || {}
  const out = {}
  const claves = new Set([...Object.keys(local || {}), ...Object.keys(cloud || {})])
  for (const k of claves) {
    if (_esDeFuenteEliminada(k)) continue
    const m = { ...((cloud || {})[k] || {}) }
    for (const [link, v] of Object.entries((local || {})[k] || {})) {
      m[link] = Math.max(Number(v) || 0, Number(m[link]) || 0) || 1
    }
    out[k] = m
  }
  // Un "desmarcado" pierde contra una marca posterior; si no, gana y se aplica.
  for (const m of Object.values(out)) for (const [link, v] of Object.entries(m)) {
    if (t.leidos[link] && (Number(v) || 0) > t.leidos[link]) delete t.leidos[link]
  }
  for (const m of Object.values(out)) for (const link of Object.keys(t.leidos)) delete m[link]
  return out
}

// ── Config: huella de lo último sincronizado ─────────────────────────────
// La config (tema, acento, etc.) se subía en CADA guardado, incluido el
// automático -- así un dispositivo pisaba en la nube, minutos después, el
// tema que acababas de cambiar en el otro. Ahora solo se sube si cambió acá
// desde la última vez que este dispositivo la sincronizó.
const _CFG_HUELLA_KEY = 'ryoku-cfg-sync-huella'
function _leerHuellaCfg() { try { return localStorage.getItem(_CFG_HUELLA_KEY) || '' } catch (e) { return '' } }
function _guardarHuellaCfg(h) { try { localStorage.setItem(_CFG_HUELLA_KEY, h) } catch (e) {} }

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
    const _getAllTomb     = window.api?.getAllTombstonesFlat?.() ?? Promise.resolve({ favs: {}, hist: {}, prog: {} })
    const _getAllCarpetas = window.api?.getAllCarpetasFlat?.() ?? Promise.resolve({})
    const [allLocalFavs, oldFavDoc, allLocalHist, oldHistDoc, allLocalProg, oldProgDoc, localTomb, cloudTombDoc, oldMangaDoc, localCarpetas, cloudCarpetasDoc, cfg, oldAnimeAlDiaDoc, oldMangaAlDiaDoc] = await Promise.all([
      Promise.resolve(_getAllFavs).catch(() => []),
      _getDoc(user.uid, 'anime_favoritos'),
      Promise.resolve(_getAllHist).catch(() => []),
      _getDoc(user.uid, 'anime_historial'),
      Promise.resolve(_getAllProg).catch(() => ({})),
      _getDoc(user.uid, 'anime_progresos'),
      Promise.resolve(_getAllTomb).catch(() => ({ favs: {}, hist: {}, prog: {} })),
      _getDoc(user.uid, 'anime_tombstones'),
      _getDoc(user.uid, 'manga_data'),
      Promise.resolve(_getAllCarpetas).catch(() => ({})),
      _getDoc(user.uid, 'anime_favs_carpetas'),
      window.api?.configGet?.().catch(() => ({})) || Promise.resolve({}),
      _getDoc(user.uid, 'anime_al_dia'),
      _getDoc(user.uid, 'manga_al_dia'),
    ])
    // "Al día" (anime/manga vistos automáticamente) — merge por fecha reciente,
    // igual criterio que el resto de este archivo, y se escribe de vuelta al
    // localStorage para que este dispositivo quede al tanto de lo visto en otros.
    const mergedAnimeAlDia = _mergeAlDia(_getAlDiaLocal('anime'), oldAnimeAlDiaDoc?.datos || {})
    const mergedMangaAlDia = _mergeAlDia(_getAlDiaLocal('manga'), oldMangaAlDiaDoc?.datos || {})
    _setAlDiaLocal('anime', mergedAnimeAlDia)
    _setAlDiaLocal('manga', mergedMangaAlDia)

    // Merge: datos locales (todas las fuentes) + datos cloud (para no perder ítems
    // que existen solo en cloud, p.ej. favoritos añadidos desde Android)
    const allCloudFavs = oldFavDoc?.lista && Array.isArray(oldFavDoc.lista) ? oldFavDoc.lista : []
    const allCloudHist = oldHistDoc?.lista && Array.isArray(oldHistDoc.lista) ? oldHistDoc.lista : []
    const allCloudProg = oldProgDoc?.datos && typeof oldProgDoc.datos === 'object' ? oldProgDoc.datos : {}
    const cloudTomb = cloudTombDoc && typeof cloudTombDoc === 'object' ? cloudTombDoc : { favs: {}, hist: {}, prog: {} }
    const cloudCarpetas = cloudCarpetasDoc?.datos && typeof cloudCarpetasDoc.datos === 'object' ? cloudCarpetasDoc.datos : {}
    const _marcasCarp = _mergeMarcasCarpetas(_marcasCarpetasLocal(), cloudCarpetasDoc?.marcas)
    const mergedCarpetas = _aplicarMarcasCarpetas(_mergeCarpetasObj(localCarpetas, cloudCarpetas), _marcasCarp)
    try { localStorage.setItem('ryoku-carpetas-marcas', JSON.stringify(_marcasCarp)) } catch (e) {}
    // 1er arg = "local" (gana en caso de duplicado), 2do = "cloud"
    const mergedTomb = _mergeTomb(localTomb, cloudTomb)
    // Podar tombstones de ítems que se volvieron a agregar después del
    // borrado (ver _podarTomb), antes de aplicar/subir.
    _podarTomb(mergedTomb, [allLocalFavs, allCloudFavs], [allLocalHist, allCloudHist], [allLocalProg, allCloudProg])
    let mergedFavs = _mergeFavs(allLocalFavs, allCloudFavs, oldFavDoc?.ordenTs)
    const _ordenTsFinal = Math.max(_favsOrdenTsLocal(), Number(oldFavDoc?.ordenTs || 0) || 0)
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

    // Manga (localStorage) -- mergear con lo que ya haya en la nube ANTES
    // de subir, en vez de subir el localStorage de este dispositivo tal
    // cual (eso pisaba, para siempre, cualquier favorito/historial/
    // progreso de otra fuente u otro dispositivo que este no tuviera).
    // También se escribe el merge de vuelta al localStorage local, así este
    // dispositivo queda al día con lo que hubiera solo en la nube sin
    // esperar al próximo cargarDesdeCloud().
    const localManga = _getMangaLocalStorage()
    const cloudManga = oldMangaDoc?.datos && typeof oldMangaDoc.datos === 'object' ? oldMangaDoc.datos : {}
    const manga = _mergeMangaData(localManga, cloudManga)
    const oldLeidosDoc = await _getDoc(user.uid, 'manga_leidos')
    const mangaLeidos = _mergeMangaLeidos(_getMangaLeidosLocal(), oldLeidosDoc?.datos, manga['manga-tombstones'])
    _setMangaLeidosLocal(mangaLeidos)
    if (Object.keys(manga).length > 0) _setMangaLocalStorage(manga)

    // Fase 2: todas las escrituras en paralelo
    const writes = [
      _setDoc(user.uid, 'anime_favoritos',      { lista: mergedFavs, ordenTs: _ordenTsFinal }),
      _setDoc(user.uid, 'anime_historial',      { lista: mergedHist }),
      _setDoc(user.uid, 'anime_progresos',      { datos: mergedProg }),
      _setDoc(user.uid, 'anime_tombstones',     mergedTomb),
      _setDoc(user.uid, 'anime_favs_carpetas',  { datos: mergedCarpetas, marcas: _marcasCarp }),
      _setDoc(user.uid, 'anime_al_dia',         { datos: mergedAnimeAlDia }),
      _setDoc(user.uid, 'manga_al_dia',         { datos: mergedMangaAlDia }),
    ]
    if (Object.keys(manga).length > 0)   writes.push(_setDoc(user.uid, 'manga_data', { datos: manga }))
    if (Object.keys(mangaLeidos).length > 0) writes.push(_setDoc(user.uid, 'manga_leidos', { datos: mangaLeidos }))
    // Config: solo si cambió desde la última sync de este dispositivo. Se
    // mezcla con lo que ya hay en la nube para no borrar claves que solo usa
    // la otra plataforma (p.ej. PC y Android no guardan exactamente las mismas).
    const _cfgHuella = JSON.stringify(cfgData)
    if (Object.keys(cfgData).length > 0 && _cfgHuella !== _leerHuellaCfg()) {
      writes.push((async () => {
        const oldCfg = await _getDoc(user.uid, 'config')
        await _setDoc(user.uid, 'config', { data: { ...(oldCfg?.data || {}), ...cfgData } })
        _guardarHuellaCfg(_cfgHuella)
      })())
    }
    if (window.api?.restoreAllTombstones) writes.push(Promise.resolve(window.api.restoreAllTombstones(mergedTomb)).catch(() => {}))
    if (window.api?.restoreAllCarpetas)   writes.push(Promise.resolve(window.api.restoreAllCarpetas(mergedCarpetas, true)).catch(() => {}))
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
// Unión por clave: orden local primero, después lo que solo está en cloud.
// Si el ítem está en los dos lados, se queda la copia local pero con el ts
// más reciente de los dos (el ts decide contra tombstones, ver _podarTomb).
function _unionPorClave(local, cloud, campo) {
  const idx = new Map()
  const out = []
  ;(local || []).forEach(it => { const k = it?.[campo]; if (k && !idx.has(k) && !_esDeFuenteEliminada(k)) { idx.set(k, out.length); out.push(it) } })
  ;(cloud || []).forEach(it => {
    const k = it?.[campo]
    if (!k || _esDeFuenteEliminada(k)) return
    if (!idx.has(k)) { idx.set(k, out.length); out.push(it); return }
    const i = idx.get(k)
    if ((it.ts || 0) > (out[i].ts || 0)) out[i] = { ...out[i], ts: it.ts }
  })
  return out
}

// ── Orden y carpetas de favoritos entre dispositivos ─────────────────────
// Antes el merge siempre dejaba el orden y la carpeta del dispositivo que
// sincronizaba: si movías o reordenabas en el celular, la PC nunca se
// enteraba (y al revés). Ahora:
//  - Orden: cada dispositivo guarda cuándo reordenó por última vez
//    ('ryoku-favs-orden-ts'); la nube guarda el de quien subió. Gana el orden
//    más reciente. Lo agregado acá DESPUÉS de ese reordenamiento queda arriba.
//  - Carpeta: cada favorito guarda cuándo se cambió su carpeta (carpetaTs);
//    gana la asignación más reciente, venga del dispositivo que venga.
function _favsOrdenTsLocal() { try { return Number(localStorage.getItem('ryoku-favs-orden-ts') || 0) || 0 } catch (e) { return 0 } }
function _guardarFavsOrdenTs(ts) { try { if (ts) localStorage.setItem('ryoku-favs-orden-ts', String(ts)) } catch (e) {} }
function _mergeFavs(local, cloud, cloudOrdenTs) {
  const localTs = _favsOrdenTsLocal(), cTs = Number(cloudOrdenTs || 0) || 0
  const cloudPrimero = cTs > localTs
  const out = cloudPrimero ? _unionPorClave(cloud, local, 'url') : _unionPorClave(local, cloud, 'url')
  const masNuevo = new Map()
  for (const f of [...(local || []), ...(cloud || [])]) {
    if (!f?.url) continue
    const p = masNuevo.get(f.url)
    if (!p || (f.carpetaTs || 0) > (p.carpetaTs || 0)) masNuevo.set(f.url, f)
  }
  let res = out.map(f => {
    const g = masNuevo.get(f.url)
    return g && (g.carpetaTs || 0) > (f.carpetaTs || 0) ? { ...f, carpeta: g.carpeta || '', carpetaTs: g.carpetaTs } : f
  })
  // Lo que solo existe del otro lado y se agregó DESPUÉS del orden que se
  // usó como base va arriba (es lo más nuevo), en vez de quedar al final.
  const enBase = new Set((cloudPrimero ? cloud : local || []).map(c => c?.url))
  const tsBase = cloudPrimero ? cTs : localTs
  // (solo si ya hay un orden establecido; en la primera sincronización se respeta el orden tal cual)
  const nuevos = tsBase > 0 && enBase.size ? res.filter(f => !enBase.has(f.url) && (f.ts || 0) > tsBase) : []
  if (nuevos.length) {
    nuevos.sort((a, b) => (b.ts || 0) - (a.ts || 0))
    const s = new Set(nuevos.map(f => f.url)); res = [...nuevos, ...res.filter(f => !s.has(f.url))]
  }
  return res
}

// Une las carpetas de favoritos de dos dispositivos (arrays de nombres, por
// fuente). Es una unión simple que preserva el orden local y agrega al
// final los nombres nuevos que solo existan en cloud. NOTA: el borrado de
// una carpeta no tiene tombstone propio (a diferencia de favs/hist/prog) --
// si se borra una carpeta en un dispositivo mientras otro todavía no
// sincronizó, esta unión puede volver a traerla. Es una limitación menor
// aceptada: el nombre de la carpeta reaparece pero vacío (ya que los favs
// que apuntaban a ella se limpian con \`carpeta:''\` al borrarla).
function _mergeCarpetas(local, cloud) {
  const vistos = new Set()
  const out = []
  ;(local || []).forEach(c => { if (c && !vistos.has(c)) { vistos.add(c); out.push(c) } })
  ;(cloud || []).forEach(c => { if (c && !vistos.has(c)) { vistos.add(c); out.push(c) } })
  return out
}

// Borrados/creaciones de carpetas entre dispositivos. Antes una carpeta
// borrada en un dispositivo volvía a aparecer al sincronizar (los nombres
// solo se unían). Ahora cada dispositivo anota cuándo creó o borró cada
// carpeta ('ryoku-carpetas-marcas' = { fuente: { nombre: { c, b } } }) y la
// nube guarda la unión: una carpeta se quita si su borrado es más nuevo que
// su creación (así también se puede volver a crear con el mismo nombre).
function _marcasCarpetasLocal() { try { return JSON.parse(localStorage.getItem('ryoku-carpetas-marcas') || '{}') || {} } catch (e) { return {} } }
window._ryokuCarpetaMarca = function (tipo, fuente, nombre) {
  if (!fuente || !nombre) return
  const m = _marcasCarpetasLocal(), k = String(nombre).trim().toLowerCase()
  m[fuente] = m[fuente] || {}; m[fuente][k] = m[fuente][k] || {}
  m[fuente][k][tipo === 'borrada' ? 'b' : 'c'] = Date.now()
  try { localStorage.setItem('ryoku-carpetas-marcas', JSON.stringify(m)) } catch (e) {}
}
function _mergeMarcasCarpetas(a, b) {
  const out = {}
  for (const src of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    out[src] = {}
    for (const k of new Set([...Object.keys(a?.[src] || {}), ...Object.keys(b?.[src] || {})])) {
      const x = a?.[src]?.[k] || {}, y = b?.[src]?.[k] || {}
      out[src][k] = { c: Math.max(x.c || 0, y.c || 0), b: Math.max(x.b || 0, y.b || 0) }
    }
  }
  return out
}
function _aplicarMarcasCarpetas(obj, marcas) {
  const out = {}
  for (const [src, lista] of Object.entries(obj || {})) {
    out[src] = (lista || []).filter(n => { const m = marcas?.[src]?.[String(n).trim().toLowerCase()]; return !(m && (m.b || 0) > (m.c || 0)) })
  }
  return out
}

function _mergeCarpetasObj(localObj, cloudObj) {
  const out = {}
  const fuentes = new Set([...Object.keys(localObj || {}), ...Object.keys(cloudObj || {})])
  for (const s of fuentes) if (!_esDeFuenteEliminada(s)) out[s] = _mergeCarpetas(localObj?.[s], cloudObj?.[s])
  return out
}

function _mergeHist(local, cloud) {
  // Unión por link. Antes esto armaba un objeto con cloud primero y local
  // pisando encima -- el MISMO bug de orden ya documentado y arreglado en
  // _mergeFavs más abajo (ver ese comentario): como JS conserva la posición
  // de inserción de una clave ya existente aunque se le reasigne el valor,
  // el array resultante de Object.values(map) quedaba siempre en el orden
  // de CLOUD (el más viejo), no en el orden real de "visto más reciente" --
  // así que "Continuar viendo" podía mostrarse desordenado después de cada
  // sync. Se arma igual que _mergeFavs: local primero (su orden es la
  // fuente de verdad, más reciente primero -- ver cargarContinuarViendo en
  // anime.js, que depende del ORDEN del array), cloud al final solo para
  // los links que no existan local.
  // Más reciente primero según ts (cuándo se vio). Antes lo que venía solo
  // de la nube quedaba al final aunque fuera lo último que viste en el otro
  // dispositivo. Entradas viejas sin ts van al final en su orden actual
  // (sort estable), así que el orden de siempre se conserva para ellas.
  return _unionPorClave(local, cloud, 'link')
    .sort((a, b) => (b?.ts || 0) - (a?.ts || 0))
    .slice(0, 500)
}

function _mergeProg(local, cloud) {
  // Por link: gana el que tenga mayor currentTime -- EXCEPTO cuando uno de
  // los dos lados ya está completado (>=95%). El marcado a mano ("ojito")
  // guarda un valor sentinel currentTime:1000/duration:1000 para representar
  // 100% -- ese 1000 es un número bajo comparado con la duración real de
  // muchos episodios (20-25 min = 1200-1500s), así que antes perdía esta
  // comparación contra cualquier progreso real de reproducción más largo
  // guardado en el otro lado (aunque ese otro lado NO estuviera completo),
  // revirtiendo en silencio un episodio recién marcado como visto a mano en
  // cuanto se sincronizaba con la nube. Un episodio completado nunca debe
  // perder el merge contra uno que no lo está, sin importar el currentTime.
  const merged = _sinFuentesEliminadas(cloud)
  for (const [link, lp] of Object.entries(_sinFuentesEliminadas(local))) {
    const cp = merged[link]
    const lpDone = (lp?.porcentaje || 0) >= 95
    const cpDone = (cp?.porcentaje || 0) >= 95
    const tsMax = Math.max(lp?.ts || 0, cp?.ts || 0)
    let elegido = cp
    if (lpDone && !cpDone) elegido = lp
    else if (cpDone && !lpDone) elegido = cp
    else if (!cp || (lp?.currentTime || 0) >= (cp?.currentTime || 0)) elegido = lp
    merged[link] = tsMax ? { ...elegido, ts: tsMax } : elegido
  }
  return merged
}

// Une dos sets de tombstones {favs:{key:ts}, hist:{...}, prog:{...}}, quedándose
// con el timestamp más reciente por clave (por si el mismo ítem se borró en dos
// dispositivos distintos en momentos distintos).
function _mergeTomb(a, b) {
  const out = { favs: {}, hist: {}, prog: {} }
  // Además de favs/hist/prog acepta cualquier otro tipo que venga (p.ej.
  // 'leidos' en los tombstones de manga) en vez de descartarlo.
  const tipos = new Set(['favs', 'hist', 'prog', ...Object.keys(a || {}), ...Object.keys(b || {})])
  for (const tipo of tipos) {
    if (!out[tipo]) out[tipo] = {}
    Object.assign(out[tipo], _sinFuentesEliminadas((a && a[tipo]) || {}))
    for (const [key, ts] of Object.entries(_sinFuentesEliminadas((b && b[tipo]) || {}))) {
      if (!out[tipo][key] || ts > out[tipo][key]) out[tipo][key] = ts
    }
  }
  return out
}

// Descarta un tombstone SOLO si el ítem se volvió a agregar DESPUÉS del
// borrado (ítem con ts más nuevo que el tombstone), mirando tanto los datos
// locales como los de la nube. Antes se descartaba cualquier tombstone cuyo
// ítem existiera localmente -- pero eso no distingue "lo volví a agregar"
// de "este dispositivo todavía no se enteró del borrado": si borrabas un
// favorito en el celular, la PC (que todavía lo tenía) descartaba el
// tombstone y lo volvía a subir, y así en loop entre dispositivos. Ítems
// viejos sin ts cuentan como más viejos que cualquier borrado.
function _podarTomb(tomb, listasFavs, listasHist, objsProg) {
  for (const lista of listasFavs || []) for (const f of lista || []) {
    const t = f?.url && tomb.favs[f.url]
    if (t && (f.ts || 0) > t) delete tomb.favs[f.url]
  }
  for (const lista of listasHist || []) for (const h of lista || []) {
    const t = h?.link && tomb.hist[h.link]
    if (t && (h.ts || 0) > t) delete tomb.hist[h.link]
  }
  for (const obj of objsProg || []) for (const [link, p] of Object.entries(obj || {})) {
    const t = tomb.prog[link]
    if (t && (p?.ts || 0) > t) delete tomb.prog[link]
  }
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
    const [tombDoc, favDoc, histDoc, progDoc] = await Promise.all([
      _getDoc(user.uid, 'anime_tombstones'),
      _getDoc(user.uid, 'anime_favoritos'),
      _getDoc(user.uid, 'anime_historial'),
      _getDoc(user.uid, 'anime_progresos'),
    ])
    const allCloudFavs = favDoc?.lista && Array.isArray(favDoc.lista) ? favDoc.lista : []
    const allCloudHist = histDoc?.lista && Array.isArray(histDoc.lista) ? histDoc.lista : []
    const allCloudProg = progDoc?.datos && typeof progDoc.datos === 'object' ? progDoc.datos : {}
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
    _podarTomb(mergedTomb, [allLocalFavs, allCloudFavs], [allLocalHist, allCloudHist], [allLocalProg, allCloudProg])
    // Adoptar el merge (ya podado) en el store local — esto también purga de
    // favs/hist/prog local cualquier ítem que sí siga borrado en otro lado.
    if (window.api?.restoreAllTombstones) await window.api.restoreAllTombstones(mergedTomb).catch(() => {})

    // ── Favs: merge cloud + local de TODAS las fuentes → restaurar todo ───
    // getAllFavsFlat devuelve favs de todas las fuentes; si no está disponible,
    // getFavs devuelve solo la fuente activa (fallback). Ya leídos arriba.
    let allMergedFavs = _mergeFavs(allLocalFavs, allCloudFavs, favDoc?.ordenTs)
    const _ordenTsFinal = Math.max(_favsOrdenTsLocal(), Number(favDoc?.ordenTs || 0) || 0)
    allMergedFavs = allMergedFavs.filter(f => !(f?.url && mergedTomb.favs[f.url]))
    _d('[sync] favs local=' + allLocalFavs.length + ' cloud=' + allCloudFavs.length + ' merged=' + allMergedFavs.length)
    if (allMergedFavs.length > 0) {
      // restoreAllFavs distribuye por URL a cada fuente; fallback: restoreFavs (solo activa)
      if (window.api?.restoreAllFavs) await window.api.restoreAllFavs(allMergedFavs)
      else await window.api?.restoreFavs?.(allMergedFavs)
      _guardarFavsOrdenTs(_ordenTsFinal)
      _d('[sync] favs restaurados (all)=' + allMergedFavs.length)
    }

    // ── Historial: idem — todas las fuentes ───────────────────────────────
    let allMergedHist = _mergeHist(allLocalHist, allCloudHist)
    allMergedHist = allMergedHist.filter(h => !(h?.link && mergedTomb.hist[h.link]))
    _d('[sync] hist local=' + allLocalHist.length + ' cloud=' + allCloudHist.length + ' merged=' + allMergedHist.length)
    if (allMergedHist.length > 0) {
      if (window.api?.restoreAllHist) await window.api.restoreAllHist(allMergedHist)
      else await window.api?.restoreHistorial?.(allMergedHist)
      _d('[sync] hist restaurados (all)=' + allMergedHist.length)
    }

    // ── Progreso: merge cloud + local, todas las fuentes ──────────────────
    let allMergedProg = _mergeProg(allLocalProg, allCloudProg)
    for (const link of Object.keys(mergedTomb.prog)) delete allMergedProg[link]
    if (Object.keys(allMergedProg).length > 0) {
      if (window.api?.restoreAllProg) await window.api.restoreAllProg(allMergedProg)
      else await window.api?.restoreProgresos?.(allMergedProg)
      _d('[sync] prog merged=' + Object.keys(allMergedProg).length)
    }

    // ── Carpetas de favoritos: merge cloud + local, todas las fuentes ─────
    const localCarpetas     = await (window.api?.getAllCarpetasFlat?.()) || {}
    const carpetasDoc       = await _getDoc(user.uid, 'anime_favs_carpetas')
    const cloudCarpetas     = carpetasDoc?.datos && typeof carpetasDoc.datos === 'object' ? carpetasDoc.datos : {}
    const _marcasCarp       = _mergeMarcasCarpetas(_marcasCarpetasLocal(), carpetasDoc?.marcas)
    const mergedCarpetas    = _aplicarMarcasCarpetas(_mergeCarpetasObj(localCarpetas, cloudCarpetas), _marcasCarp)
    try { localStorage.setItem('ryoku-carpetas-marcas', JSON.stringify(_marcasCarp)) } catch (e) {}
    if (window.api?.restoreAllCarpetas) await window.api.restoreAllCarpetas(mergedCarpetas, true).catch(() => {})

    // ── Manga → localStorage (merge, no pisar) ────────────────────────────
    // Antes esto escribía mangaDoc.datos directo encima del localStorage --
    // si la nube tenía menos/otras fuentes que este dispositivo (p.ej. cloud
    // desactualizada, o el último guardado fue de otro dispositivo con solo
    // una fuente de manga), se perdían favoritos/historial/progreso locales
    // que la nube no tenía. Se mergea igual que en guardarEnCloud().
    const mangaDoc    = await _getDoc(user.uid, 'manga_data')
    const localManga  = _getMangaLocalStorage()
    const cloudManga  = mangaDoc?.datos && typeof mangaDoc.datos === 'object' ? mangaDoc.datos : {}
    const mergedManga = _mergeMangaData(localManga, cloudManga)
    const leidosDoc   = await _getDoc(user.uid, 'manga_leidos')
    _setMangaLeidosLocal(_mergeMangaLeidos(_getMangaLeidosLocal(), leidosDoc?.datos, mergedManga['manga-tombstones']))
    if (Object.keys(mergedManga).length > 0) _setMangaLocalStorage(mergedManga)

    // ── "Al día" (anime/manga vistos automáticamente) — merge por fecha ───
    const [animeAlDiaDoc, mangaAlDiaDoc] = await Promise.all([
      _getDoc(user.uid, 'anime_al_dia'),
      _getDoc(user.uid, 'manga_al_dia'),
    ])
    const mergedAnimeAlDia = _mergeAlDia(_getAlDiaLocal('anime'), animeAlDiaDoc?.datos || {})
    const mergedMangaAlDia = _mergeAlDia(_getAlDiaLocal('manga'), mangaAlDiaDoc?.datos || {})
    _setAlDiaLocal('anime', mergedAnimeAlDia)
    _setAlDiaLocal('manga', mergedMangaAlDia)

    // ── Configuración ──────────────────────────────────────────────────────
    const cfgDoc = await _getDoc(user.uid, 'config')
    if (cfgDoc?.data) {
      const claves = ['app-modo', 'app-accent', 'app-18', 'sidebar-autohide', 'app-accent-custom-hex', 'app-corners', 'app-densidad', 'app-glass', 'app-bg-gradient', 'app-bg-mode', 'app-bg-blur', 'app-bg-position', 'app-bg-scale', 'sidebar-neon', 'neon-intensidad', 'app-tema-id', 'app-miku-sonido']
      for (const k of claves) {
        if (cfgDoc.data[k] !== undefined) await window.api?.configSet?.(k, cfgDoc.data[k])
      }
      // La config local ahora coincide con la nube: guardar la huella (mismo
      // formato que en guardarEnCloud) para no volver a subirla sin cambios.
      try {
        const cfgLocal = (await window.api?.configGet?.()) || {}
        const h = {}
        for (const k of claves) { if (cfgLocal[k] !== undefined) h[k] = cfgLocal[k] }
        _guardarHuellaCfg(JSON.stringify(h))
      } catch (e) {}
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
        if (typeof window._berserkerTemaAplicado === 'function') window._berserkerTemaAplicado(d['app-tema-id'])
        if (typeof window._metaphorTemaAplicado === 'function') window._metaphorTemaAplicado(d['app-tema-id'])
        if (typeof window._kanekiTemaAplicado === 'function') window._kanekiTemaAplicado(d['app-tema-id'])
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
    await _subirMerge(user, allMergedFavs, allMergedHist, allMergedProg, mergedTomb, mergedCarpetas, _ordenTsFinal)
    await Promise.all([
      _setDoc(user.uid, 'anime_al_dia', { datos: mergedAnimeAlDia }),
      _setDoc(user.uid, 'manga_al_dia', { datos: mergedMangaAlDia }),
    ]).catch(() => {})

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
async function _subirMerge(user, favs, hist, prog, tomb, carpetas, ordenTs) {
  try {
    if (favs.length > 0)               await _setDoc(user.uid, 'anime_favoritos', { lista: favs, ordenTs: ordenTs || 0 })
    if (hist.length > 0)               await _setDoc(user.uid, 'anime_historial',  { lista: hist })
    if (Object.keys(prog).length > 0)  await _setDoc(user.uid, 'anime_progresos',  { datos: prog })
    if (tomb) await _setDoc(user.uid, 'anime_tombstones', tomb)
    if (carpetas && Object.keys(carpetas).length > 0) await _setDoc(user.uid, 'anime_favs_carpetas', { datos: carpetas, marcas: _marcasCarpetasLocal() })
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
