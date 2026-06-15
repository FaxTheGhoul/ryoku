'use strict'
;(function () {

var _db           = null
var _auth         = null
var _rtdb         = null
var _currentUser  = null
var _friendsUnsub  = null
var _requestsUnsub = null
var _activityUnsubs = []
var _presenceRefs   = []
var _currentTab  = 'online'
var _friends     = []
var _requests    = []
var _panelOpen   = false
var _currentPage = 'inicio'

function _init() {
  var tryInit = function() {
    _db   = window._ryokuDb
    _auth = window._ryokuAuth
    if (!_db || !_auth) { setTimeout(tryInit, 500); return }
    if (window.firebase && firebase.database) {
      _rtdb = firebase.database()
    }
    _auth.onAuthStateChanged(_onAuthChange)
  }
  tryInit()
}

function _onAuthChange(user) {
  _currentUser = user
  _cleanup()
  if (user) {
    _setupPresence(user.uid)
    _upsertProfile(user)
    _listenFriends(user.uid)
    _listenRequests(user.uid)
  }
  _updateFAB()
  if (_panelOpen) _renderBody()
}

function _cleanup() {
  if (_friendsUnsub)  { _friendsUnsub();  _friendsUnsub  = null }
  if (_requestsUnsub) { _requestsUnsub(); _requestsUnsub = null }
  _activityUnsubs.forEach(function(u){ u() })
  _activityUnsubs = []
  _presenceRefs.forEach(function(r){ r.off() })
  _presenceRefs = []
  _friends  = []
  _requests = []
}

function _setupPresence(uid) {
  if (!_rtdb) return
  var presRef = _rtdb.ref('presence/' + uid)
  var connRef = _rtdb.ref('.info/connected')
  connRef.on('value', function(snap) {
    if (snap.val()) {
      presRef.onDisconnect().set({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP })
      presRef.set({ online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP })
    }
  })
}

function _upsertProfile(user) {
  if (!_db) return
  _db.collection('users').doc(user.uid).set({
    displayName: user.displayName || '',
    email:       user.email       || '',
    photoURL:    user.photoURL    || '',
    updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
}

function _listenFriends(uid) {
  _friendsUnsub = _db.collection('users').doc(uid).collection('friends')
    .onSnapshot(async function(snap) {
      _presenceRefs.forEach(function(r){ r.off() })
      _presenceRefs = []
      _activityUnsubs.forEach(function(u){ u() })
      _activityUnsubs = []
      _friends = []

      for (var i = 0; i < snap.docs.length; i++) {
        var docSnap = snap.docs[i]
        var fuid = docSnap.id;
        (function(fuid) {
          _db.collection('users').doc(fuid).get().then(function(profileDoc) {
            var p = profileDoc.data() || {}
            var friend = {
              uid:         fuid,
              displayName: p.customName || p.displayName || 'Usuario',
              photoURL:    p.avatarURL   || p.photoURL  || '',
              email:       p.email       || '',
              online:      false,
              lastSeen:    null,
              activity:    p.currentActivity || null
            }
            _friends.push(friend)

            if (_rtdb) {
              var pRef = _rtdb.ref('presence/' + fuid)
              pRef.on('value', function(presSnap) {
                var pres = presSnap.val() || {}
                var f = _friends.find(function(x){ return x.uid === fuid })
                if (f) { f.online = !!pres.online; f.lastSeen = pres.lastSeen || null }
                if (_panelOpen) _renderBody()
              })
              _presenceRefs.push(pRef)
            }

            var unsub = _db.collection('users').doc(fuid).onSnapshot(function(d) {
              var data = d.data() || {}
              var f = _friends.find(function(x){ return x.uid === fuid })
              if (f) {
                f.displayName = data.customName || data.displayName || f.displayName
                f.photoURL    = data.avatarURL || data.photoURL || f.photoURL
                f.activity    = data.currentActivity || null
              }
              if (_panelOpen) _renderBody()
            })
            _activityUnsubs.push(unsub)

            if (_panelOpen) _renderBody()
          })
        })(fuid)
      }
    })
}

function _listenRequests(uid) {
  _requestsUnsub = _db.collection('friendRequests')
    .where('to',     '==', uid)
    .where('status', '==', 'pending')
    .onSnapshot(async function(snap) {
      _requests = []
      for (var i = 0; i < snap.docs.length; i++) {
        var doc = snap.docs[i];
        (function(doc) {
          var data = doc.data()
          _db.collection('users').doc(data.from).get().then(function(profileDoc) {
            var p = profileDoc.data() || {}
            _requests.push({
              requestId:   doc.id,
              uid:         data.from,
              displayName: p.displayName || 'Usuario',
              photoURL:    p.avatarURL || p.photoURL || '',
              email:       p.email       || ''
            })
            _updateFAB()
            if (_panelOpen) _renderBody()
          })
        })(doc)
      }
      if (!snap.docs.length) { _updateFAB(); if (_panelOpen) _renderBody() }
    })
}

async function _addFriend(emailInput) {
  if (!_currentUser || !_db) return { error: 'No autenticado' }
  var val = (emailInput || '').trim()
  if (!val) return { error: 'Ingresa un email o nombre de usuario' }

  var isEmail = val.indexOf('@') > 0
  var snap
  if (isEmail) {
    snap = await _db.collection('users').where('email', '==', val).limit(1).get()
  } else {
    snap = await _db.collection('users').where('username', '==', val.toLowerCase()).limit(1).get()
  }
  if (snap.empty) return { error: isEmail ? 'Email no encontrado' : 'Nombre de usuario no encontrado' }

  var targetUid  = snap.docs[0].id
  var targetData = snap.docs[0].data()
  if (targetUid === _currentUser.uid) return { error: 'No puedes agregarte a ti mismo' }

  var alreadyFriend = await _db.collection('users').doc(_currentUser.uid)
    .collection('friends').doc(targetUid).get()
  if (alreadyFriend.exists) return { error: 'Ya son amigos' }

  var existingReq = await _db.collection('friendRequests')
    .where('from',   '==', _currentUser.uid)
    .where('to',     '==', targetUid)
    .where('status', '==', 'pending')
    .limit(1).get()
  if (!existingReq.empty) return { error: 'Solicitud ya enviada' }

  await _db.collection('friendRequests').add({
    from:      _currentUser.uid,
    to:        targetUid,
    status:    'pending',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  })
  return { success: true, name: targetData.displayName || val }
}

async function _acceptRequest(requestId, fromUid) {
  if (!_currentUser || !_db) return
  var batch = _db.batch()
  batch.update(_db.collection('friendRequests').doc(requestId), { status: 'accepted' })
  batch.set(
    _db.collection('users').doc(_currentUser.uid).collection('friends').doc(fromUid),
    { addedAt: firebase.firestore.FieldValue.serverTimestamp() }
  )
  batch.set(
    _db.collection('users').doc(fromUid).collection('friends').doc(_currentUser.uid),
    { addedAt: firebase.firestore.FieldValue.serverTimestamp() }
  )
  await batch.commit()
}

async function _rejectRequest(requestId) {
  if (!_db) return
  await _db.collection('friendRequests').doc(requestId).update({ status: 'rejected' })
}

function _updateFAB() {
  var fab   = document.getElementById('friends-fab')
  var badge = document.getElementById('friends-fab-badge')
  if (!fab) return
  // Check actual DOM: home page active AND anime module visible
  var appAnime    = document.getElementById('app-anime')
  var pageInicio  = document.getElementById('page-inicio')
  var appManga    = document.getElementById('app-manga')
  var pageManga   = document.getElementById('page-manga-inicio')
  var animeActive = !!(appAnime && appAnime.style.display !== 'none' &&
    pageInicio && pageInicio.classList.contains('activa'))
  var mangaActive = !!(appManga && appManga.style.display !== 'none' &&
    pageManga && pageManga.classList.contains('activa'))
  var homeActive = animeActive || mangaActive
  var visible = !!(_currentUser && homeActive)
  fab.style.display = visible ? 'flex' : 'none'
  if (!visible && _panelOpen) {
    _panelOpen = false
    var win = document.getElementById('friends-window')
    if (win) win.classList.add('fw-hidden')
  }
  if (badge) {
    badge.textContent   = _requests.length
    badge.style.display = _requests.length > 0 ? 'flex' : 'none'
  }
}

function _togglePanel() {
  _panelOpen = !_panelOpen
  var win = document.getElementById('friends-window')
  if (!win) return
  if (_panelOpen) {
    win.classList.remove('fw-hidden')
    _renderBody()
  } else {
    win.classList.add('fw-hidden')
  }
}

function _switchTab(tab) {
  _currentTab = tab
  document.querySelectorAll('.fw-tab').forEach(function(t){ t.classList.remove('active') })
  var el = document.getElementById('fw-tab-' + tab)
  if (el) el.classList.add('active')
  var addRow = document.getElementById('fw-add-row')
  var addMsg = document.getElementById('fw-add-msg')
  if (addRow) addRow.style.display = (tab === 'agregar') ? 'flex' : 'none'
  if (addMsg && tab !== 'agregar') addMsg.textContent = ''
  _renderBody()
}

function _renderBody() {
  var body = document.getElementById('fw-body')
  if (!body) return
  var filter = ((document.getElementById('fw-search-input') || {}).value || '').toLowerCase()
  var list = _friends.filter(function(f) {
    return f.displayName.toLowerCase().includes(filter) || f.email.toLowerCase().includes(filter)
  })

  if (_currentTab === 'online') {
    var on = list.filter(function(f){ return f.online })
    body.innerHTML = on.length
      ? '<div class="fw-section-label">En linea ' + on.length + '</div>' + on.map(_rowHTML).join('')
      : '<div class="fw-empty">Ningun amigo en linea</div>'

  } else if (_currentTab === 'todos') {
    if (!list.length) { body.innerHTML = '<div class="fw-empty">Aun no tienes amigos</div>'; return }
    var onF  = list.filter(function(f){ return  f.online })
    var offF = list.filter(function(f){ return !f.online })
    body.innerHTML =
      (onF.length  ? '<div class="fw-section-label">En linea ' + onF.length + '</div>' + onF.map(_rowHTML).join('') : '') +
      (offF.length ? '<div class="fw-section-label">Desconectados ' + offF.length + '</div>' + offF.map(function(f){ return _rowHTML(f, true) }).join('') : '')

  } else if (_currentTab === 'solicitudes') {
    if (!_requests.length) { body.innerHTML = '<div class="fw-empty">Sin solicitudes pendientes</div>'; return }
    body.innerHTML = _requests.map(_requestRowHTML).join('')

  } else if (_currentTab === 'agregar') {
    body.innerHTML = '<div class="fw-empty" style="text-align:left;padding:10px 12px 4px">Ingresa el email de tu amigo.</div>'
  }

  var badge = document.getElementById('fw-req-badge')
  if (badge) {
    badge.textContent   = _requests.length
    badge.style.display = _requests.length ? 'inline-flex' : 'none'
  }
}

function _rowHTML(f, dimmed) {
  var opStyle = dimmed ? 'style="opacity:0.45"' : ''
  var dot = f.online ? '<span class="fw-online-dot"></span>' : ''
  var avatar = f.photoURL
    ? '<img src="' + f.photoURL + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />'
    : '<span class="fw-av-initials">' + (f.displayName || 'U').slice(0, 2).toUpperCase() + '</span>'

  var actLine = ''
  if (f.online && f.activity) {
    var a = f.activity
    if (a.type === 'anime')      actLine = 'Viendo: ' + a.title + (a.episode ? ' ep ' + a.episode : '')
    else if (a.type === 'manga') actLine = 'Leyendo: ' + a.title + (a.chapter ? ' cap ' + a.chapter : '')
    else if (a.label)            actLine = a.label
  } else if (!f.online && f.lastSeen) {
    var d = Date.now() - f.lastSeen
    if      (d < 60000)    actLine = 'Hace un momento'
    else if (d < 3600000)  actLine = 'Hace ' + Math.floor(d / 60000)  + ' min'
    else if (d < 86400000) actLine = 'Hace ' + Math.floor(d / 3600000) + 'h'
    else                   actLine = 'Hace ' + Math.floor(d / 86400000) + 'd'
  }

  return '<div class="fw-friend-row" ' + opStyle + ' onclick="window.abrirPerfil(\'' + f.uid + '\',false)" style="cursor:pointer">' +
    '<div class="fw-avatar-wrap"><div class="fw-avatar">' + avatar + '</div>' + dot + '</div>' +
    '<div class="fw-info">' +
      '<div class="fw-fname">' + f.displayName + '</div>' +
      (actLine ? '<div class="fw-factivity">' + actLine + '</div>' : '') +
    '</div>' +
  '</div>'
}

function _requestRowHTML(r) {
  var avatar = r.photoURL
    ? '<img src="' + r.photoURL + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />'
    : '<span class="fw-av-initials">' + (r.displayName || 'U').slice(0, 2).toUpperCase() + '</span>'
  return '<div class="fw-friend-row">' +
    '<div class="fw-avatar">' + avatar + '</div>' +
    '<div class="fw-info">' +
      '<div class="fw-fname">' + r.displayName + '</div>' +
      '<div class="fw-factivity">' + r.email + '</div>' +
    '</div>' +
    '<div class="fw-req-btns">' +
      '<button class="fw-btn-accept" onclick="window._friendsAccept(\'' + r.requestId + '\',\'' + r.uid + '\')">Aceptar</button>' +
      '<button class="fw-btn-reject" onclick="window._friendsReject(\'' + r.requestId + '\')">Ignorar</button>' +
    '</div>' +
  '</div>'
}

window._friendsToggle       = _togglePanel
window._friendsClose        = function () {
  if (!_panelOpen) return
  _panelOpen = false
  var win = document.getElementById('friends-window')
  if (win) win.classList.add('fw-hidden')
}
window._friendsSwitchTab    = _switchTab
window._friendsFilterChange = function() { _renderBody() }
window._ryokuGetFriends     = function() { return _friends }

window._friendsAccept = async function(reqId, fromUid) {
  await _acceptRequest(reqId, fromUid)
}
window._friendsReject = async function(reqId) {
  await _rejectRequest(reqId)
}
window._friendsAdd = async function() {
  var input = document.getElementById('fw-add-input')
  var msg   = document.getElementById('fw-add-msg')
  if (!input || !msg) return
  msg.textContent = 'Enviando...'
  msg.style.color = 'var(--text-muted)'
  var result = await _addFriend(input.value)
  if (result.success) {
    msg.textContent = 'Solicitud enviada a ' + result.name
    msg.style.color = '#22c55e'
    input.value = ''
  } else {
    msg.textContent = result.error
    msg.style.color = '#ef4444'
  }
}

window._friendsSetActivity = function(activityObj) {
  if (!_currentUser || !_db) return
  if (activityObj && window._ryokuActivityShare === false) return
  var update = activityObj
    ? { currentActivity: activityObj }
    : { currentActivity: firebase.firestore.FieldValue.delete() }
  _db.collection('users').doc(_currentUser.uid).update(update).catch(function(){})
}

function _initFriendsDrag() {
  var win      = document.getElementById('friends-window')
  var titlebar = win ? win.querySelector('.fw-titlebar') : null
  if (!win || !titlebar) return

  // Restaurar posición guardada usando right/bottom
  try {
    var saved = JSON.parse(localStorage.getItem('ryoku-friends-pos-v7') || 'null')
    if (saved && typeof saved.right === 'number' && typeof saved.bottom === 'number') {
      var maxR = Math.max(0, window.innerWidth  - win.offsetWidth)
      var maxB = Math.max(0, window.innerHeight - win.offsetHeight)
      win.style.left   = 'auto'
      win.style.top    = 'auto'
      win.style.right  = Math.max(0, Math.min(maxR, saved.right))  + 'px'
      win.style.bottom = Math.max(0, Math.min(maxB, saved.bottom)) + 'px'
    } else if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      // Migrar formato antiguo
      var r2 = Math.max(0, window.innerWidth  - saved.left - win.offsetWidth)
      var b2 = Math.max(0, window.innerHeight - saved.top  - win.offsetHeight)
      win.style.left   = 'auto'
      win.style.top    = 'auto'
      win.style.right  = r2 + 'px'
      win.style.bottom = b2 + 'px'
    }
  } catch (e) {}

  var dragging = false
  var startX, startY, startLeft, startTop

  titlebar.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return
    if (e.target.closest('.fw-icon-btn, .fw-hdr-btn')) return
    // Convertir a left/top para arrastrar
    var rect  = win.getBoundingClientRect()
    startX    = e.clientX
    startY    = e.clientY
    startLeft = rect.left
    startTop  = rect.top
    win.style.right      = 'auto'
    win.style.bottom     = 'auto'
    win.style.left       = startLeft + 'px'
    win.style.top        = startTop  + 'px'
    win.style.transition = 'none'
    win.style.userSelect = 'none'
    dragging = true
    e.preventDefault()
  })

  document.addEventListener('mousemove', function (e) {
    if (!dragging) return
    var newLeft = Math.max(0, Math.min(window.innerWidth  - win.offsetWidth,  startLeft + (e.clientX - startX)))
    var newTop  = Math.max(0, Math.min(window.innerHeight - win.offsetHeight, startTop  + (e.clientY - startY)))
    win.style.left = newLeft + 'px'
    win.style.top  = newTop  + 'px'
  })

  document.addEventListener('mouseup', function () {
    if (!dragging) return
    dragging             = false
    win.style.transition = ''
    win.style.userSelect = ''
    // Convertir a right/bottom y guardar
    var r    = win.getBoundingClientRect()
    var rVal = Math.max(0, window.innerWidth  - r.right)
    var bVal = Math.max(0, window.innerHeight - r.bottom)
    win.style.left   = 'auto'
    win.style.top    = 'auto'
    win.style.right  = rVal + 'px'
    win.style.bottom = bVal + 'px'
    try { localStorage.setItem('ryoku-friends-pos-v7', JSON.stringify({ right: rVal, bottom: bVal })) } catch (e) {}
  })
}

window.addEventListener('DOMContentLoaded', function() {
  _init()
  _initFriendsDrag()
  if (window._initWindowResize) window._initWindowResize('friends-window', 240, 160, 'ryoku-friends-size-v1')
  // Watch page-inicio class AND app-anime/app-manga style for FAB visibility
  var pageInicio  = document.getElementById('page-inicio')
  var appAnime    = document.getElementById('app-anime')
  var pageMangaI  = document.getElementById('page-manga-inicio')
  var appManga    = document.getElementById('app-manga')
  if (pageInicio) {
    new MutationObserver(function() { _updateFAB() })
      .observe(pageInicio, { attributes: true, attributeFilter: ['class'] })
  }
  if (appAnime) {
    new MutationObserver(function() { _updateFAB() })
      .observe(appAnime, { attributes: true, attributeFilter: ['style'] })
  }
  if (pageMangaI) {
    new MutationObserver(function() { _updateFAB() })
      .observe(pageMangaI, { attributes: true, attributeFilter: ['class'] })
  }
  if (appManga) {
    new MutationObserver(function() { _updateFAB() })
      .observe(appManga, { attributes: true, attributeFilter: ['style'] })
  }
})

})();
