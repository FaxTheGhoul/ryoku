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
    // Anime favs (main process)
    const favs = await window.api?.getFavs?.() || []
    await _setDoc(user.uid, 'anime_favoritos', { lista: favs })

    // Anime historial (main process)
    const hist = await window.api?.getHistorial?.() || []
    await _setDoc(user.uid, 'anime_historial', { lista: hist })

    // Anime progresos (main process)
    const prog = await window.api?.getTodosProgresos?.() || {}
    await _setDoc(user.uid, 'anime_progresos', { datos: prog })

    // Manga (localStorage — sin leidos)
    const manga = _getMangaLocalStorage()
    if (Object.keys(manga).length > 0) {
      await _setDoc(user.uid, 'manga_data', { datos: manga })
    }

    // Configuración
    const cfg = await window.api?.configGet?.() || {}
    const cfgKeys = ['app-modo', 'app-accent', 'app-18', 'sidebar-autohide']
    const cfgData = {}
    for (const k of cfgKeys) { if (cfg[k] !== undefined) cfgData[k] = cfg[k] }
    if (Object.keys(cfgData).length > 0) await _setDoc(user.uid, 'config', { data: cfgData })

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

async function cargarDesdeCloud() {
  const user = _getUser()
  _d('[sync] cargarDesdeCloud user=' + (user ? user.email : 'null') + ' db=' + !!_getDb())
  if (!user || !_getDb()) { _setStatus('Sin sesión', 'error'); _d('[sync] abort: sin sesion/db'); return }

  _setStatus('Cargando...', 'loading')
  try {
    // ── Favs: merge cloud + local ──────────────────────────────────────────
    const favDoc   = await _getDoc(user.uid, 'anime_favoritos')
    const localFavs = await window.api?.getFavs?.() || []
    const cloudFavs = favDoc?.lista && Array.isArray(favDoc.lista) ? favDoc.lista : []
    _d('[sync] favs local=' + localFavs.length + ' cloud=' + cloudFavs.length)
    const mergedFavs = _mergeFavs(localFavs, cloudFavs)
    if (mergedFavs.length > 0) {
      await window.api?.restoreFavs?.(mergedFavs)
      _d('[sync] favs merged=' + mergedFavs.length)
    }

    // ── Historial: merge cloud + local ─────────────────────────────────────
    const histDoc    = await _getDoc(user.uid, 'anime_historial')
    const localHist  = await window.api?.getHistorial?.() || []
    const cloudHist  = histDoc?.lista && Array.isArray(histDoc.lista) ? histDoc.lista : []
    _d('[sync] hist local=' + localHist.length + ' cloud=' + cloudHist.length)
    const mergedHist = _mergeHist(localHist, cloudHist)
    if (mergedHist.length > 0) {
      await window.api?.restoreHistorial?.(mergedHist)
      _d('[sync] hist merged=' + mergedHist.length)
    }

    // ── Progreso: merge cloud + local ──────────────────────────────────────
    const progDoc    = await _getDoc(user.uid, 'anime_progresos')
    const localProg  = await window.api?.getTodosProgresos?.() || {}
    const cloudProg  = progDoc?.datos && typeof progDoc.datos === 'object' ? progDoc.datos : {}
    const mergedProg = _mergeProg(localProg, cloudProg)
    if (Object.keys(mergedProg).length > 0) {
      await window.api?.restoreProgresos?.(mergedProg)
      _d('[sync] prog merged=' + Object.keys(mergedProg).length)
    }

    // ── Manga → localStorage ───────────────────────────────────────────────
    const mangaDoc = await _getDoc(user.uid, 'manga_data')
    if (mangaDoc?.datos) _setMangaLocalStorage(mangaDoc.datos)

    // ── Configuración ──────────────────────────────────────────────────────
    const cfgDoc = await _getDoc(user.uid, 'config')
    if (cfgDoc?.data) {
      const claves = ['app-modo', 'app-accent', 'app-18', 'sidebar-autohide']
      for (const k of claves) {
        if (cfgDoc.data[k] !== undefined) await window.api?.configSet?.(k, cfgDoc.data[k])
      }
    }

    // ── Subir el merge a Firestore para que otros dispositivos lo tengan ───
    await _subirMerge(user, mergedFavs, mergedHist, mergedProg)

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
async function _subirMerge(user, favs, hist, prog) {
  try {
    if (favs.length > 0)               await _setDoc(user.uid, 'anime_favoritos', { lista: favs })
    if (hist.length > 0)               await _setDoc(user.uid, 'anime_historial',  { lista: hist })
    if (Object.keys(prog).length > 0)  await _setDoc(user.uid, 'anime_progresos',  { datos: prog })
  } catch(e) { console.warn('[sync] error subiendo merge', e) }
}

// ─── Auto-save periódico (cada 5 minutos mientras hay sesión) ─────────────────
function _iniciarAutoSave() {
  if (_autoSaveTimer) clearInterval(_autoSaveTimer)
  _autoSaveTimer = setInterval(async () => {
    if (!_getUser()) return
    // No auto-guardar si no hay datos locales — evita sobrescribir cloud con vacíos
    const hist = await window.api?.getHistorial?.() || []
    const favs = await window.api?.getFavs?.() || []
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
  window.api?.onSaveBeforeQuit?.(() => {
    const overlay = document.getElementById('ryoku-quit-overlay')
    if (overlay) overlay.classList.add('visible')
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
