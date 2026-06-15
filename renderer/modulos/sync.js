'use strict'

// ─── Sync Firestore (usa compat SDK) ─────────────────────────────────────────
let _syncInited = false

function _getDb() { return window._ryokuDb }

async function _getDoc(uid, coleccion) {
  try {
    const db  = _getDb()
    if (!db) return null
    const ref  = db.collection('users').doc(uid).collection('data').doc(coleccion)
    const snap = await ref.get()
    return snap.exists ? snap.data() : null
  } catch(e) {
    console.warn('[sync] getDoc error', coleccion, e)
    return null
  }
}

async function _setDoc(uid, coleccion, data) {
  try {
    const db = _getDb()
    if (!db) return
    const ref = db.collection('users').doc(uid).collection('data').doc(coleccion)
    await ref.set(data, { merge: true })
  } catch(e) {
    console.warn('[sync] setDoc error', coleccion, e)
  }
}

// ─── Cargar datos desde Firestore ─────────────────────────────────────────────
async function _cargarDesdeCloud(uid) {
  console.log('[sync] cargando desde cloud...')

  const favA = await _getDoc(uid, 'anime_favoritos')
  if (favA?.lista) {
    try { localStorage.setItem('ryoku-favs', JSON.stringify(favA.lista)) } catch(e) {}
  }

  const favM = await _getDoc(uid, 'manga_favoritos')
  if (favM?.lista) {
    try { localStorage.setItem('ryoku-manga-favs', JSON.stringify(favM.lista)) } catch(e) {}
  }

  const histA = await _getDoc(uid, 'anime_historial')
  if (histA?.lista) {
    try { await window.api?.configSet?.('historial', histA.lista) } catch(e) {}
  }

  const cfg = await _getDoc(uid, 'config')
  if (cfg?.data) {
    try {
      const claves = ['app-modo','app-accent','app-18','sidebar-autohide']
      for (const k of claves) {
        if (cfg.data[k] !== undefined) await window.api?.configSet?.(k, cfg.data[k])
      }
    } catch(e) {}
  }

  console.log('[sync] datos cargados desde cloud')
  _actualizarSyncStatus('Sincronizado')
}

// ─── Subir datos locales a Firestore ─────────────────────────────────────────
async function subirACloud(uid) {
  if (!uid || !_getDb()) return
  _actualizarSyncStatus('Sincronizando...')
  try {
    const favsRaw = localStorage.getItem('ryoku-favs')
    if (favsRaw) await _setDoc(uid, 'anime_favoritos', { lista: JSON.parse(favsRaw) })

    const favsMRaw = localStorage.getItem('ryoku-manga-favs')
    if (favsMRaw) await _setDoc(uid, 'manga_favoritos', { lista: JSON.parse(favsMRaw) })

    const hist = await window.api?.configGet?.()
    if (hist?.historial) await _setDoc(uid, 'anime_historial', { lista: hist.historial })

    if (hist) {
      const cfgData = {}
      for (const k of ['app-modo','app-accent','app-18','sidebar-autohide']) {
        if (hist[k] !== undefined) cfgData[k] = hist[k]
      }
      await _setDoc(uid, 'config', { data: cfgData })
    }

    _actualizarSyncStatus('Sincronizado')
    console.log('[sync] datos subidos a cloud')
  } catch(e) {
    console.warn('[sync] error subiendo datos', e)
    _actualizarSyncStatus('Error al sincronizar')
  }
}

function _actualizarSyncStatus(texto) {
  const el = document.getElementById('acm-sync-status')
  if (!el) return
  const span = el.querySelector('span')
  if (span) span.textContent = texto
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function initSync() {
  if (_syncInited) return
  _syncInited = true

  const _waitAuth = setInterval(() => {
    if (typeof onAuthChange === 'function') {
      clearInterval(_waitAuth)
      onAuthChange(async user => {
        if (user) {
          await _cargarDesdeCloud(user.uid)
          await subirACloud(user.uid)
        }
      })
    }
  }, 200)

  _watchLocalChanges()
}

function _watchLocalChanges() {
  const _orig = localStorage.setItem.bind(localStorage)
  localStorage.setItem = function(key, value) {
    _orig(key, value)
    if ((key === 'ryoku-favs' || key === 'ryoku-manga-favs') && window._ryokuAuth?.currentUser) {
      clearTimeout(window._syncTimer)
      window._syncTimer = setTimeout(() => subirACloud(window._ryokuAuth.currentUser.uid), 1500)
    }
  }

  setInterval(() => {
    const user = window._ryokuAuth?.currentUser
    if (user) subirACloud(user.uid)
  }, 5 * 60 * 1000)
}

window.addEventListener('DOMContentLoaded', initSync)
window._syncSubir = subirACloud
