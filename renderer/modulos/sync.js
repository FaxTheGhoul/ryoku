'use strict'

// ─── Sync Firestore ───────────────────────────────────────────────────────────
let _syncInited   = false
let _autoSaveTimer = null

function _getDb()   { return window._ryokuDb }
function _getUser() { return window._ryokuAuth?.currentUser || null }

async function _getDoc(uid, col) {
  try {
    const snap = await _getDb().collection('users').doc(uid).collection('data').doc(col).get()
    return snap.exists ? snap.data() : null
  } catch(e) { console.warn('[sync] getDoc error', col, e); return null }
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
async function cargarDesdeCloud() {
  const user = _getUser()
  if (!user || !_getDb()) { _setStatus('Sin sesión', 'error'); return }

  _setStatus('Cargando...', 'loading')
  try {
    // Anime favs → main process
    const favDoc = await _getDoc(user.uid, 'anime_favoritos')
    if (favDoc?.lista && Array.isArray(favDoc.lista)) {
      await window.api?.restoreFavs?.(favDoc.lista)
    }

    // Anime historial → main process
    const histDoc = await _getDoc(user.uid, 'anime_historial')
    if (histDoc?.lista && Array.isArray(histDoc.lista)) {
      await window.api?.restoreHistorial?.(histDoc.lista)
    }

    // Anime progresos → main process
    const progDoc = await _getDoc(user.uid, 'anime_progresos')
    if (progDoc?.datos && typeof progDoc.datos === 'object') {
      await window.api?.restoreProgresos?.(progDoc.datos)
    }

    // Manga → localStorage
    const mangaDoc = await _getDoc(user.uid, 'manga_data')
    if (mangaDoc?.datos) _setMangaLocalStorage(mangaDoc.datos)

    // Configuración
    const cfgDoc = await _getDoc(user.uid, 'config')
    if (cfgDoc?.data) {
      const claves = ['app-modo', 'app-accent', 'app-18', 'sidebar-autohide']
      for (const k of claves) {
        if (cfgDoc.data[k] !== undefined) await window.api?.configSet?.(k, cfgDoc.data[k])
      }
    }

    _setStatus('Cargado ✓', 'ok')
    console.log('[sync] datos cargados desde cloud')
    setTimeout(() => _setStatus('Listo', ''), 3000)
  } catch(e) {
    console.warn('[sync] error cargando', e)
    _setStatus('Error al cargar', 'error')
  }
}

// ─── Auto-save periódico (cada 5 minutos mientras hay sesión) ─────────────────
function _iniciarAutoSave() {
  if (_autoSaveTimer) clearInterval(_autoSaveTimer)
  _autoSaveTimer = setInterval(() => {
    if (_getUser()) guardarEnCloud()
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
  if (_syncInited) return
  _syncInited = true

  const _wait = setInterval(() => {
    if (typeof onAuthChange === 'function') {
      clearInterval(_wait)
      onAuthChange(async user => {
        if (user) {
          await cargarDesdeCloud()
          _iniciarAutoSave()
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
