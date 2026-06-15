'use strict'

// ─── Firebase config ──────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBJHAIT0LWoapssUbvUKzlYeB82ud54-HA",
  authDomain:        "ryoku-app-53e5c.firebaseapp.com",
  databaseURL:       "https://ryoku-app-53e5c-default-rtdb.firebaseio.com",
  projectId:         "ryoku-app-53e5c",
  storageBucket:     "ryoku-app-53e5c.firebasestorage.app",
  messagingSenderId: "616976179183",
  appId:             "1:616976179183:web:2b1240f258faf6bb0d601a"
}

// ─── Estado ───────────────────────────────────────────────────────────────────
let _firebaseApp  = null
let _auth         = null
let _db           = null
let _currentUser  = null
let _authReady    = false
let _username     = null
let _customName   = null
let _avatarURL    = null
let _avatarURLStable = null  // cache que no se borra en eventos transitorios de auth
let _userDocUnsub = null     // unsuscribir del onSnapshot del doc de usuario
const _listeners  = []

// ─── Init Firebase (usa compat SDK cargado via CDN) ───────────────────────────
function _initFirebase() {
  if (_firebaseApp) return
  try {
    if (!window.firebase) {
      console.error('[auth] Firebase CDN no cargado todavía')
      return
    }
    if (firebase.apps && firebase.apps.length > 0) {
      _firebaseApp = firebase.apps[0]
    } else {
      _firebaseApp = firebase.initializeApp(FIREBASE_CONFIG)
    }
    _auth = firebase.auth()
    _db   = firebase.firestore()

    window._ryokuAuth = _auth
    window._ryokuDb   = _db

    // Persistir sesión entre reinicios de la app
    _auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(e) {
      console.warn('[auth] setPersistence error', e)
    })

    _auth.onAuthStateChanged(user => {
      _currentUser = user
      _authReady   = true

      // Cancelar listener anterior del documento de usuario
      if (_userDocUnsub) { _userDocUnsub(); _userDocUnsub = null }

      if (user && _db) {
        // onSnapshot en lugar de .get() → recibe datos iniciales Y actualizaciones
        // en tiempo real (ej: cuando profile.js guarda avatarURL en Firestore)
        _userDocUnsub = _db.collection('users').doc(user.uid).onSnapshot(doc => {
          const data    = doc.data() || {}
          _username     = data.username   || null
          _customName   = data.customName || null
          const _fetched = data.avatarURL || null
          _avatarURL    = _fetched
          if (_fetched) _avatarURLStable = _fetched
          if (_currentUser) {
            _actualizarUI(_currentUser)
            const _modal = document.getElementById('account-modal')
            if (_modal && _modal.style.display !== 'none') _renderModal(_currentUser)
          }
        }, err => { console.warn('[auth] userDoc listener error', err) })
      } else {
        _username   = null
        _customName = null
        _avatarURL  = null
      }

      _listeners.forEach(fn => fn(user))
      _actualizarUI(user)
      // Si el modal está abierto, actualizarlo con el nuevo estado
      const _modal = document.getElementById('account-modal')
      if (_modal && _modal.style.display !== 'none') {
        const _body = document.getElementById('account-modal-body')
        if (_body) _renderModal(user)
      }
    })
  } catch(e) {
    console.error('[auth] init error', e)
  }
}

// ─── Login con Google ─────────────────────────────────────────────────────────
async function loginGoogle() {
  _initFirebase()
  if (!_auth) return null
  try {
    if (!window.api?.googleAuth) {
      console.error('[auth] window.api.googleAuth no disponible')
      return null
    }
    const result = await window.api.googleAuth()
    if (!result || result.error) {
      if (result?.error !== 'cancelled') console.error('[auth] OAuth error:', result?.error)
      return null
    }
    const credential = firebase.auth.GoogleAuthProvider.credential(result.idToken, result.accessToken)
    const userCred   = await _auth.signInWithCredential(credential)
    return userCred.user
  } catch(e) {
    console.error('[auth] login error', e)
    return null
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────
async function logout() {
  if (!_auth) return
  try { await _auth.signOut() } catch(e) { console.error('[auth] logout error', e) }
}

// ─── Suscribirse a cambios de auth ────────────────────────────────────────────
function onAuthChange(fn) {
  _listeners.push(fn)
  if (_authReady) fn(_currentUser)
}

function getUser() { return _currentUser }

// ─── Actualizar botón del sidebar ─────────────────────────────────────────────
function _actualizarUI(user) {
  const btn    = document.getElementById('account-btn')
  const dot    = document.getElementById('account-dot')
  const avatar = document.getElementById('account-avatar')
  if (!btn) return

  if (user) {
    btn.classList.add('logged-in')
    if (dot) dot.style.display = 'block'
    if (avatar) {
      const _photoSrc = _avatarURL || _avatarURLStable || user.photoURL
      if (_photoSrc) {
        avatar.innerHTML = `<img src="${_photoSrc}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />`
      } else {
        const initials = (user.displayName || user.email || 'U').slice(0,2).toUpperCase()
        avatar.innerHTML = initials
      }
    }
  } else {
    btn.classList.remove('logged-in')
    if (dot) dot.style.display = 'none'
    if (avatar) {
      avatar.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    }
  }

  _actualizarModal(user)
}

// ─── Modal de cuenta ──────────────────────────────────────────────────────────
function _actualizarModal(user) {
  const modal = document.getElementById('account-modal')
  if (!modal || modal.style.display === 'none') return
  _renderModal(user)
}

function _renderModal(user) {
  const body = document.getElementById('account-modal-body')
  if (!body) return

  if (!user) {
    body.innerHTML = `
      <div class="acm-nologin">
        <div class="acm-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
        <p class="acm-title">Inicia sesión</p>
        <p class="acm-desc">Guarda tus favoritos, historial y configuración en la nube y accede desde cualquier dispositivo.</p>
        <button class="acm-google-btn" onclick="window._authLoginGoogle()">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continuar con Google
        </button>
      </div>`
  } else {
    const _fotoSrc = _avatarURL || user.photoURL
    const foto = _fotoSrc
      ? `<img src="${_fotoSrc}" class="acm-avatar-img" />`
      : `<div class="acm-initials">${(user.displayName||user.email||'U').slice(0,2).toUpperCase()}</div>`

    const editIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`

    body.innerHTML = `
      <div class="acm-loggedin">

        <!-- ── Header ── -->
        <div class="acm-header">
          ${foto}
          <div class="acm-header-info">
            <p class="acm-name">${_customName || user.displayName || 'Usuario'}</p>
            <p class="acm-email">${user.email || ''}</p>
            ${_username ? `<span class="acm-username-pill">@${_username}</span>` : ''}
          </div>
        </div>

        <!-- ── Filas de datos ── -->
        <div class="acm-rows">

          <div class="acm-row">
            <div class="acm-row-left">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span>Nombre de usuario</span>
            </div>
            <div class="acm-row-right" id="acm-uname-display">
              <span class="acm-row-val ${_username ? 'accent' : 'muted'}">${_username ? '@'+_username : 'Sin configurar'}</span>
              <button class="acm-uname-edit-btn" onclick="window._authEditUsername()" title="Editar">${editIcon}</button>
            </div>
          </div>
          <div id="acm-uname-form" class="acm-inline-form" style="display:none">
            <input id="acm-uname-input" class="acm-uname-input" type="text" placeholder="nombre_usuario" maxlength="20" oninput="window._authUsernameInput(this)" />
            <div class="acm-uname-hint">Letras, números y _ · 3-20 caracteres</div>
            <div id="acm-uname-msg" class="acm-uname-msg"></div>
            <div style="display:flex;gap:6px;margin-top:8px">
              <button class="acm-uname-save" onclick="window._authSaveUsername()">Guardar</button>
              <button class="acm-uname-cancel" onclick="window._authCancelUsername()">Cancelar</button>
            </div>
          </div>

          <div class="acm-row">
            <div class="acm-row-left">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              <span>Nombre visible</span>
            </div>
            <div class="acm-row-right" id="acm-cname-display">
              <span class="acm-row-val ${_customName ? '' : 'muted'}">${_customName || 'Sin configurar'}</span>
              <button class="acm-uname-edit-btn" onclick="window._authEditCustomName()" title="Editar">${editIcon}</button>
            </div>
          </div>
          <div id="acm-cname-form" class="acm-inline-form" style="display:none">
            <input id="acm-cname-input" class="acm-uname-input" type="text" placeholder="Tu nombre visible..." maxlength="30" />
            <div class="acm-uname-hint">Visible para tus amigos · Hasta 30 caracteres</div>
            <div id="acm-cname-msg" class="acm-uname-msg"></div>
            <div style="display:flex;gap:6px;margin-top:8px">
              <button class="acm-uname-save" onclick="window._authSaveCustomName()">Guardar</button>
              <button class="acm-uname-cancel" onclick="window._authCancelCustomName()">Cancelar</button>
            </div>
          </div>

          <div class="acm-row" id="acm-sync-status">
            <div class="acm-row-left" style="color:#22c55e">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              <span style="color:var(--text-2)">Sincronizado</span>
            </div>
            <span class="acm-sync-pill">Al día</span>
          </div>

        </div>

        <!-- ── Botones ── -->
        <div class="acm-actions">
          <button class="acm-profile-btn" onclick="cerrarAccountModal();window.abrirPerfil(null,true)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Ver mi perfil
          </button>
          <button class="acm-logout-btn" onclick="window._authLogout()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Cerrar sesión
          </button>
        </div>

      </div>`
  }
}

function abrirAccountModal() {
  _initFirebase()
  const modal = document.getElementById('account-modal')
  if (!modal) return
  modal.style.display = 'flex'
  _renderModal(_currentUser)

  // Siempre traer datos frescos de Firestore al abrir el modal
  if (_currentUser && _db) {
    _db.collection('users').doc(_currentUser.uid).get().then(function(doc) {
      const data = doc.data() || {}
      _username   = data.username   || null
      _customName = data.customName || null
      const _fetched = data.avatarURL || null
      _avatarURL  = _fetched
      if (_fetched) _avatarURLStable = _fetched
      const m = document.getElementById('account-modal')
      if (m && m.style.display !== 'none') _renderModal(_currentUser)
    }).catch(function(e) {
      console.warn('[auth] fetch modal data error', e)
    })
  }
}

function cerrarAccountModal() {
  const modal = document.getElementById('account-modal')
  if (modal) modal.style.display = 'none'
}

// ─── Funciones de username ────────────────────────────────────────────────────
window._authEditUsername = function() {
  const display = document.getElementById('acm-uname-display')
  const form    = document.getElementById('acm-uname-form')
  const input   = document.getElementById('acm-uname-input')
  if (!display || !form) return
  display.style.display = 'none'
  form.style.display    = 'block'
  if (input) { input.value = _username || ''; input.focus() }
}

window._authCancelUsername = function() {
  const display = document.getElementById('acm-uname-display')
  const form    = document.getElementById('acm-uname-form')
  if (display) display.style.display = ''
  if (form)    form.style.display    = 'none'
}

window._authUsernameInput = function(el) {
  // Solo permitir letras, números y _
  el.value = el.value.toLowerCase().replace(/[^a-z0-9_]/g, '')
}

window._authSaveUsername = async function() {
  if (!_currentUser || !_db) return
  const input = document.getElementById('acm-uname-input')
  const msg   = document.getElementById('acm-uname-msg')
  const btn   = document.querySelector('.acm-uname-save')
  if (!input || !msg) return

  const val = input.value.trim()
  if (val.length < 3) { msg.textContent = 'Mínimo 3 caracteres'; msg.style.color = '#ef4444'; return }
  if (val.length > 20) { msg.textContent = 'Máximo 20 caracteres'; msg.style.color = '#ef4444'; return }

  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...' }
  msg.textContent = ''; msg.style.color = ''

  try {
    // Verificar unicidad
    const snap = await _db.collection('users').where('username', '==', val).limit(1).get()
    if (!snap.empty && snap.docs[0].id !== _currentUser.uid) {
      msg.textContent = 'Nombre ya en uso'
      msg.style.color = '#ef4444'
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar' }
      return
    }
    await _db.collection('users').doc(_currentUser.uid).set({ username: val }, { merge: true })
    _username = val
    msg.textContent = '¡Guardado!'
    msg.style.color = '#22c55e'
    setTimeout(() => { _renderModal(_currentUser) }, 800)
  } catch(e) {
    msg.textContent = 'Error al guardar'
    msg.style.color = '#ef4444'
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar' }
  }
}

// ─── Funciones de nombre visible ─────────────────────────────────────────────
window._authEditCustomName = function() {
  const display = document.getElementById('acm-cname-display')
  const form    = document.getElementById('acm-cname-form')
  const input   = document.getElementById('acm-cname-input')
  if (!display || !form) return
  display.style.display = 'none'
  form.style.display    = 'block'
  if (input) { input.value = _customName || ''; input.focus() }
}

window._authCancelCustomName = function() {
  const display = document.getElementById('acm-cname-display')
  const form    = document.getElementById('acm-cname-form')
  if (display) display.style.display = ''
  if (form)    form.style.display    = 'none'
}

window._authSaveCustomName = async function() {
  if (!_currentUser || !_db) return
  const input = document.getElementById('acm-cname-input')
  const msg   = document.getElementById('acm-cname-msg')
  const btn   = document.querySelector('#acm-cname-form .acm-uname-save')
  if (!input || !msg) return

  const val = input.value.trim()
  if (!val) { msg.textContent = 'Ingresa un nombre'; msg.style.color = '#ef4444'; return }
  if (val.length > 30) { msg.textContent = 'Máximo 30 caracteres'; msg.style.color = '#ef4444'; return }

  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...' }
  msg.textContent = ''

  try {
    await _db.collection('users').doc(_currentUser.uid).set({ customName: val }, { merge: true })
    _customName = val
    msg.textContent = '¡Guardado!'
    msg.style.color = '#22c55e'
    setTimeout(() => { _renderModal(_currentUser) }, 800)
  } catch(e) {
    msg.textContent = 'Error al guardar'
    msg.style.color = '#ef4444'
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar' }
  }
}

// ─── Exponer globalmente ──────────────────────────────────────────────────────
window._abrirAccountModal  = abrirAccountModal
window._cerrarAccountModal = cerrarAccountModal

window._authLoginGoogle = async () => {
  const btn = document.querySelector('.acm-google-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Conectando...' }
  await loginGoogle()
  if (!_currentUser) {
    const body = document.getElementById('account-modal-body')
    if (body) _renderModal(null)
  }
}
window._authLogout = async () => { await logout() }

// ─── Auto-init al cargar (para restaurar sesión sin abrir modal) ──────────────
document.addEventListener('DOMContentLoaded', function() {
  // Pequeño delay para asegurar que Firebase CDN esté cargado
  var tryAutoInit = function(attempts) {
    if (window.firebase) {
      _initFirebase()
    } else if (attempts > 0) {
      setTimeout(function() { tryAutoInit(attempts - 1) }, 300)
    }
  }
  tryAutoInit(20)
})

// Permite a profile.js actualizar el avatar sin recargar auth
window._authSetAvatarURL = function(url) {
  _avatarURL = url || null
  _avatarURLStable = url || null  // si se borra explícitamente, también limpia el cache
  if (_currentUser) _actualizarUI(_currentUser)
}

// Reaplica el avatar actual al sidebar (útil para llamar tras cambio de módulo)
window._authRefreshAvatar = function() {
  if (_currentUser) _actualizarUI(_currentUser)
}

// Devuelve la URL del avatar personalizado del usuario actual
window._authGetAvatarURL = function() {
  return _avatarURL || _avatarURLStable || null
}
