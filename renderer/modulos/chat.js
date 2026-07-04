'use strict'
;(function () {

// ─── Estado ──────────────────────────────────────────────────────────────────
var _db          = null
var _auth        = null
var _currentUser = null
var _panelOpen   = false
var _currentTab  = 'dms'       // 'dms' | 'sala'
var _currentView = 'list'      // 'list' | 'dm' | 'sala-msg' | 'sala-create'
var _currentDmFriend = null    // { uid, displayName, photoURL }
var _currentRoomId   = null
var _msgsUnsub   = null
var _typingUnsub = null
var _roomsUnsub  = null
var _convosUnsubs = []
var _convos      = {}          // dmId -> metadata
var _rooms       = []
var _unreadTotal = 0
var _replyTo     = null        // { id, text, fromName }
var _typingTimer = null
var _searchMode  = false
var _lastMsgDocs = []          // cache última snapshot para búsqueda
var _ctxMenu     = null        // menú contextual activo
var _friendLastRead = 0        // ms — cuándo leyó el amigo por última vez
var _friendLastSeen = {}       // uid -> ms
var _presenceInterval = null

// ─── Helpers ─────────────────────────────────────────────────────────────────
function _dmId(uid1, uid2) { return [uid1, uid2].sort().join('_') }

function _lastReadKey(id) { return 'ryoku-chat-read-' + id }
function _getLastRead(id) {
  try { return parseInt(localStorage.getItem(_lastReadKey(id)) || '0', 10) } catch (e) { return 0 }
}
function _setLastRead(id) {
  try { localStorage.setItem(_lastReadKey(id), Date.now().toString()) } catch (e) {}
}

function _tsToMs(ts) {
  if (!ts) return 0
  if (ts.toMillis) return ts.toMillis()
  if (typeof ts === 'number') return ts
  return 0
}

function _timeLabel(ts) {
  var ms = _tsToMs(ts)
  var d  = Date.now() - ms
  if (d < 60000)    return 'ahora'
  if (d < 3600000)  return Math.floor(d / 60000)  + 'min'
  if (d < 86400000) return Math.floor(d / 3600000) + 'h'
  return Math.floor(d / 86400000) + 'd'
}

function _timeHM(ts) {
  var ms = _tsToMs(ts)
  if (!ms) return ''
  var d = new Date(ms)
  var h = d.getHours()
  var m = d.getMinutes()
  var ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm
}

function _dateDayStr(ts) {
  var ms = _tsToMs(ts)
  if (!ms) return ''
  var d = new Date(ms)
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate()
}

function _dateSepLabel(ts) {
  var ms = _tsToMs(ts)
  if (!ms) return ''
  var now  = new Date()
  var d    = new Date(ms)
  var diff = Math.floor((Date.now() - ms) / 86400000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Ayer'
  var days   = ['dom','lun','mar','mié','jue','vie','sáb']
  var months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  if (diff < 7) return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()]
  return d.getDate() + ' ' + months[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '')
}

function _esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// JSON seguro para usar dentro de atributos HTML onclick="..."
function _jsonAttr(v) {
  return JSON.stringify(v).replace(/"/g, '&quot;')
}

// Detectar si un texto es una URL de imagen o GIF
function _isImageUrl(text) {
  if (!text) return false
  text = text.trim()
  if (!/^https?:\/\//i.test(text)) return false
  if (/\.(jpg|jpeg|png|gif|webp|gifv|avif)(\?[^\s]*)?$/i.test(text)) return true
  if (/^https?:\/\/(media\.giphy\.com|i\.imgur\.com|media\d*\.tenor\.com)/i.test(text)) return true
  return false
}

// Obtener DocumentReference desde ruta completa: "col/doc/col/doc/..."
function _docRef(path) {
  var parts = path.split('/')
  var ref   = _db
  parts.forEach(function (seg, i) {
    ref = (i % 2 === 0) ? ref.collection(seg) : ref.doc(seg)
  })
  return ref
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function _init() {
  var tryInit = function () {
    _db   = window._ryokuDb
    _auth = window._ryokuAuth
    if (!_db || !_auth) { setTimeout(tryInit, 500); return }
    if (window.firebase && firebase.database) {
      try { _rtdb = firebase.database() } catch (e) {}
    }
    _auth.onAuthStateChanged(_onAuthChange)
  }
  tryInit()
}

function _onAuthChange(user) {
  _currentUser = user
  _cleanupListeners()
  if (user) { _listenConvos(); _listenRooms(); _startPresence() }
  _updateFAB()
}

function _cleanupListeners() {
  if (_msgsUnsub)   { _msgsUnsub();   _msgsUnsub   = null }
  if (_typingUnsub) { _typingUnsub(); _typingUnsub = null }
  if (_roomsUnsub)  { _roomsUnsub();  _roomsUnsub  = null }
  _convosUnsubs.forEach(function (u) { u() })
  _convosUnsubs = []
  _convos      = {}
  _rooms       = []
  _unreadTotal = 0
}

// ─── Presence ────────────────────────────────────────────────────────────────
var _rtdb            = null   // Firebase Realtime Database
var _presenceRefs    = {}     // uid → ref (para limpiar listeners)

function _startPresence() {
  // Obtener RTDB si está disponible
  if (!_rtdb && window.firebase && firebase.database) {
    try { _rtdb = firebase.database() } catch (e) {}
  }
  // friends.js ya gestiona la presencia propia vía RTDB; aquí no hace falta duplicarlo
}

function _listenFriendPresence(friends) {
  if (!_rtdb) return
  // Limpiar listeners anteriores
  Object.keys(_presenceRefs).forEach(function (uid) {
    try { _presenceRefs[uid].off() } catch (e) {}
  })
  _presenceRefs = {}
  _friendLastSeen = {}

  friends.forEach(function (f) {
    var ref = _rtdb.ref('presence/' + f.uid)
    ref.on('value', function (snap) {
      var pres = snap.val() || {}
      _friendLastSeen[f.uid] = { online: !!pres.online, lastSeen: pres.lastSeen || 0 }
      // Re-renderizar lista de DMs si está abierta
      if (_panelOpen && _currentView === 'list' && _currentTab === 'dms') {
        _renderDmList(document.getElementById('cw-body'))
      }
    })
    _presenceRefs[f.uid] = ref
  })
}

function _activityHtml(uid) {
  // 1. Usar datos de RTDB si ya los tenemos
  var pres = _friendLastSeen[uid]
  if (pres && typeof pres === 'object') {
    if (pres.online) return '<span class="cw-status-dot online" title="En línea"></span>'
    if (pres.lastSeen) {
      var diff = Date.now() - pres.lastSeen
      if (diff < 3600000) return '<span class="cw-status-dot away" title="Hace ' + Math.floor(diff / 60000) + 'min"></span>'
    }
    return '<span class="cw-status-dot offline" title="Desconectado"></span>'
  }
  // 2. Fallback: datos de friends.js (ya calculados por RTDB)
  var friends = window._ryokuGetFriends ? window._ryokuGetFriends() : []
  var f = friends.find(function (x) { return x.uid === uid })
  if (f) {
    if (f.online) return '<span class="cw-status-dot online" title="En línea"></span>'
    if (f.lastSeen) {
      var d2 = Date.now() - f.lastSeen
      if (d2 < 3600000) return '<span class="cw-status-dot away" title="Hace ' + Math.floor(d2 / 60000) + 'min"></span>'
    }
    return '<span class="cw-status-dot offline" title="Desconectado"></span>'
  }
  return '<span class="cw-status-dot offline"></span>'
}

// ─── DM convos ───────────────────────────────────────────────────────────────
function _listenConvos() {
  // Intento inmediato, luego retry rápido hasta que haya amigos cargados,
  // después mantiene un intervalo largo para amigos nuevos
  var _retries = 0
  function _tryListen() {
    var friends = window._ryokuGetFriends ? window._ryokuGetFriends() : []
    _refreshConvoListeners()
    if (!friends.length && _retries < 20) {
      _retries++
      setTimeout(_tryListen, 500)
    } else {
      setInterval(_refreshConvoListeners, 15000)
    }
  }
  _tryListen()
}

function _refreshConvoListeners() {
  if (!_currentUser || !_db) return
  var friends = window._ryokuGetFriends ? window._ryokuGetFriends() : []
  friends.forEach(function (f) {
    var dmId = _dmId(_currentUser.uid, f.uid)
    if (_convos[dmId] && _convos[dmId]._listening) return
    if (!_convos[dmId]) _convos[dmId] = {}
    _convos[dmId]._listening  = true
    _convos[dmId].friendUid   = f.uid
    _convos[dmId].friendName  = f.displayName
    _convos[dmId].friendPhoto = f.photoURL || ''
    var _prevLastAt = null
    var unsub = _db.collection('dms').doc(dmId).onSnapshot(function (doc) {
      if (!doc.exists) return
      var data   = doc.data()
      var prevAt = _prevLastAt
      var newAt  = data.lastAt || null
      _prevLastAt = newAt
      _convos[dmId] = Object.assign(_convos[dmId] || {}, {
        lastMessage: data.lastMessage || '',
        lastAt:      newAt,
        lastFrom:    data.lastFrom    || '',
        friendUid:   f.uid,
        friendName:  f.displayName,
        friendPhoto: f.photoURL || '',
        _listening:  true
      })
      var isNew = newAt && prevAt && data.lastFrom !== _currentUser.uid &&
        _tsToMs(newAt) > _tsToMs(prevAt)
      if (isNew) _showFloatMsg(f.displayName || 'Usuario', data.lastMessage || '', f.photoURL || '', { type: 'dm', uid: f.uid })
      _recalcUnread()
      if (_panelOpen && _currentView === 'list' && _currentTab === 'dms') _renderBody()
    })
    _convosUnsubs.push(unsub)
  })
}

function _recalcUnread() {
  if (!_currentUser) return
  var total = 0
  Object.keys(_convos).forEach(function (dmId) {
    var c = _convos[dmId]
    if (!c.lastAt || !c.lastMessage) return
    if (c.lastFrom === _currentUser.uid) return
    if (_tsToMs(c.lastAt) > _getLastRead(dmId)) total++
  })
  _unreadTotal = total
  _updateFAB()
}

// ─── Rooms ───────────────────────────────────────────────────────────────────
function _listenRooms() {
  if (!_currentUser || !_db) return
  if (_roomsUnsub) { _roomsUnsub(); _roomsUnsub = null }
  var _prevRoomLastAt = {}
  var _handleRoomSnap = function (snap) {
    snap.docs.forEach(function (doc) {
      var data  = doc.data()
      var prev  = _prevRoomLastAt[doc.id] || null
      var newAt = data.lastAt || null
      _prevRoomLastAt[doc.id] = newAt
      var isNew = newAt && prev && data.lastFrom !== _currentUser.uid &&
        _tsToMs(newAt) > _tsToMs(prev)
      if (isNew) _showFloatMsg(
        (data.name || 'Grupo') + ' · ' + (data.lastFromName || 'Usuario'),
        data.lastMessage || '',
        data.lastFromPhoto || '',
        { type: 'sala', roomId: doc.id }
      )
    })
    _rooms = snap.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()) }).filter(function (r) { return !r.deleted })
    if (_panelOpen && _currentView === 'list' && _currentTab === 'sala') _renderBody()
  }
  _roomsUnsub = _db.collection('rooms')
    .where('members', 'array-contains', _currentUser.uid)
    .orderBy('lastAt', 'desc')
    .onSnapshot(_handleRoomSnap, function () {
      _db.collection('rooms').where('members', 'array-contains', _currentUser.uid).onSnapshot(_handleRoomSnap)
    })
}

// ─── Typing ──────────────────────────────────────────────────────────────────
function _sendTypingStatus() {
  if (!_currentUser || !_db || _currentView !== 'dm' || !_currentDmFriend) return
  var dmId = _dmId(_currentUser.uid, _currentDmFriend.uid)
  var upd  = {}
  upd['typing.' + _currentUser.uid] = firebase.firestore.FieldValue.serverTimestamp()
  _db.collection('dms').doc(dmId).set(upd, { merge: true }).catch(function () {})
  if (_typingTimer) clearTimeout(_typingTimer)
  _typingTimer = setTimeout(_clearTypingStatus, 3000)
}

function _clearTypingStatus() {
  if (!_currentUser || !_db || !_currentDmFriend) return
  var dmId = _dmId(_currentUser.uid, _currentDmFriend.uid)
  var upd  = {}
  upd['typing.' + _currentUser.uid] = firebase.firestore.FieldValue.delete
    ? firebase.firestore.FieldValue.delete()
    : null
  _db.collection('dms').doc(dmId).set(upd, { merge: true }).catch(function () {})
}

function _listenTyping(dmId) {
  if (_typingUnsub) { _typingUnsub(); _typingUnsub = null }
  if (!_currentDmFriend) return
  var friendUid = _currentDmFriend.uid
  _typingUnsub = _db.collection('dms').doc(dmId).onSnapshot(function (doc) {
    if (!doc.exists) return
    var data       = doc.data() || {}
    var typing     = data.typing || {}
    var friendTypAt = _tsToMs(typing[friendUid])
    var isTyping   = friendTypAt && (Date.now() - friendTypAt) < 5000
    var el = document.getElementById('cw-typing')
    if (el) el.style.display = isTyping ? 'flex' : 'none'
    // Read receipts: lastRead.{friendUid} = cuando el amigo abrió la conv
    var lastRead    = data.lastRead || {}
    var prevRead    = _friendLastRead
    _friendLastRead = _tsToMs(lastRead[friendUid]) || 0
    // Re-renderear ticks solo si el valor cambió y hay mensajes en pantalla
    if (_friendLastRead !== prevRead && _currentView === 'dm' && _lastMsgDocs.length) {
      _renderDmMessages(document.getElementById('cw-body'), _lastMsgDocs)
    }
  })
}

// ─── Reply ───────────────────────────────────────────────────────────────────
function _setReply(docId, text, fromName) {
  _replyTo = { id: docId, text: text, fromName: fromName }
  var bar = document.getElementById('cw-reply-bar')
  if (bar) {
    bar.style.display = 'flex'
    var nameEl = bar.querySelector('.crb-name')
    var textEl = bar.querySelector('.crb-text')
    if (nameEl) nameEl.textContent = fromName
    if (textEl) textEl.textContent = text.slice(0, 60) + (text.length > 60 ? '…' : '')
  }
  var inp = document.getElementById('cw-input')
  if (inp) inp.focus()
}

function _clearReply() {
  _replyTo = null
  var bar = document.getElementById('cw-reply-bar')
  if (bar) bar.style.display = 'none'
}

// ─── Context menu ────────────────────────────────────────────────────────────
function _showCtxMenu(e, docId, docPath, text, mine) {
  e.preventDefault()
  e.stopPropagation()
  _hideCtxMenu()
  var fromName = mine
    ? (_currentUser.displayName || 'Yo')
    : (_currentDmFriend ? _currentDmFriend.displayName : 'Usuario')
  var items = [
    { icon: 'ti-mood-smile', label: 'Reaccionar', fn: function () {
      _showEmojiPicker(e.clientX, e.clientY - 10, docPath)
    }},
    { icon: 'ti-corner-up-left', label: 'Responder', fn: function () { _setReply(docId, text, fromName) } },
    { icon: 'ti-copy', label: 'Copiar', fn: function () {
      try { navigator.clipboard.writeText(text) } catch (ex) {}
    }}
  ]
  if (mine && text) {
    items.push({ icon: 'ti-pencil', label: 'Editar', fn: function () { _editMsg(docPath, text, docId) } })
    items.push({ icon: 'ti-trash', label: 'Eliminar', danger: true, fn: function () { _deleteMsg(docPath, docId) } })
  }
  var menu = document.createElement('div')
  menu.id        = 'cw-ctx-menu'
  menu.className = 'cw-ctx-menu'
  menu.innerHTML = items.map(function (item) {
    return '<button class="cw-ctx-item' + (item.danger ? ' danger' : '') + '">' +
      '<i class="ti ' + item.icon + '" aria-hidden="true"></i>' + item.label +
    '</button>'
  }).join('')
  menu.querySelectorAll('.cw-ctx-item').forEach(function (btn, i) {
    btn.addEventListener('click', function () { items[i].fn(); _hideCtxMenu() })
  })
  var _ctn = _fsContainer()
  _ctn.appendChild(menu)
  _ctxMenu = menu
  var _ctnW = (_ctn !== document.body && _ctn.clientWidth)  ? _ctn.clientWidth  : window.innerWidth
  var _ctnH = (_ctn !== document.body && _ctn.clientHeight) ? _ctn.clientHeight : window.innerHeight
  var x = Math.min(e.clientX, _ctnW - 170)
  var y = Math.min(e.clientY, _ctnH - (items.length * 38 + 12))
  menu.style.left = x + 'px'
  menu.style.top  = y + 'px'
  setTimeout(function () {
    document.addEventListener('click', _hideCtxMenu, { once: true })
  }, 0)
}

function _hideCtxMenu() {
  if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null }
  // NO eliminamos el emoji picker aquí — tiene su propio listener de cierre
}

// ─── Reactions ───────────────────────────────────────────────────────────────
window._chatAddReaction = function (docPath, emoji) {
  if (!_currentUser || !_db) return
  var uid = _currentUser.uid
  var ref = _docRef(docPath)
  ref.get().then(function (doc) {
    if (!doc.exists) return
    var data      = doc.data() || {}
    var reactions = JSON.parse(JSON.stringify(data.reactions || {}))
    var users     = reactions[emoji] ? reactions[emoji].slice() : []
    var idx       = users.indexOf(uid)
    if (idx >= 0) users.splice(idx, 1)
    else          users.push(uid)
    if (users.length === 0) delete reactions[emoji]
    else reactions[emoji] = users
    return ref.update({ reactions: reactions })
  }).catch(function (e) { console.error('[chat] reaction error', docPath, e) })
}

function _showEmojiPicker(px, py, docPath) {
  var existing = document.getElementById('cw-emoji-picker')
  if (existing) { existing.remove(); return }
  var emojis = ['😂', '❤️', '🔥', '😱', '👍', '😭']
  var el = document.createElement('div')
  el.id        = 'cw-emoji-picker'
  el.className = 'cw-emoji-picker'
  el.innerHTML = emojis.map(function (em) {
    return '<button class="cw-emoji-btn">' + em + '</button>'
  }).join('')
  el.querySelectorAll('.cw-emoji-btn').forEach(function (btn, i) {
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation()
      window._chatAddReaction(docPath, emojis[i])
      el.remove()
    })
  })
  var _ctn2 = _fsContainer()
  _ctn2.appendChild(el)
  var _ctn2W = (_ctn2 !== document.body && _ctn2.clientWidth) ? _ctn2.clientWidth : window.innerWidth
  el.style.left = Math.min(px, _ctn2W - 220) + 'px'
  el.style.top  = Math.max(8, py - 52) + 'px'
  setTimeout(function () {
    document.addEventListener('click', function () { if (el.parentNode) el.remove() }, { once: true })
  }, 0)
}

window._chatShowEmoji = function (e, docPath) {
  e.stopPropagation()
  var rect = (e.target || e.currentTarget).getBoundingClientRect()
  _showEmojiPicker(rect.left, rect.top, docPath)
}

// ─── Delete / Edit ───────────────────────────────────────────────────────────
function _deleteMsg(docPath, docId) {
  // Cambio visual inmediato (optimistic update)
  var row = docId ? document.querySelector('[data-doc-id="' + CSS.escape(docId) + '"]') : null
  var wrap = null
  if (row) {
    wrap = row.querySelector('.cw-msg-wrap')
    if (wrap) wrap.innerHTML =
      '<div class="cw-bubble-deleted"><i class="ti ti-ban" aria-hidden="true"></i> Mensaje eliminado</div>'
  }
  // Persistir en Firestore
  if (!_db) return
  _docRef(docPath).update({ deleted: true, text: '[eliminado]' })
    .then(function () {
      // Extraer dmId del path: "dms/{dmId}/messages/{msgId}"
      var parts = docPath.split('/')
      var dmId  = parts.length >= 2 ? parts[1] : null
      if (!dmId || !_db) return
      // Buscar el último mensaje no eliminado para actualizar el preview
      _db.collection('dms').doc(dmId).collection('messages')
        .orderBy('createdAt', 'desc').limit(10)
        .get().then(function (snap) {
          var lastMsg = null
          snap.forEach(function (d) { if (!lastMsg && !d.data().deleted) lastMsg = d })
          _db.collection('dms').doc(dmId).update({
            lastMessage: lastMsg ? (lastMsg.data().text || '') : '',
            lastFrom:    lastMsg ? (lastMsg.data().from  || '') : '',
            lastAt:      lastMsg ? (lastMsg.data().createdAt || null) : null
          }).catch(function () {})
        })
    })
    .catch(function (e) {
      console.error('[chat] delete error', docPath, e)
      // Revertir visual si Firestore rechaza
      if (row && wrap) {
        wrap.innerHTML = '<div style="font-size:11px;color:#ef4444;padding:4px 0">Error al eliminar</div>'
        setTimeout(function () { if (_lastMsgDocs.length) _renderDmMessages(document.getElementById('cw-body'), _lastMsgDocs) }, 2000)
      }
    })
}

function _editMsg(docPath, currentText, docId) {
  // Buscar la burbuja por data-doc-id
  var row = document.querySelector('[data-doc-id="' + CSS.escape(docId) + '"]')
  var bubbleEl = row ? row.querySelector('.cw-bubble-text') : null
  if (!bubbleEl) return
  var ref = _docRef(docPath)
  var inp = document.createElement('textarea')
  inp.className = 'cw-inline-edit'
  inp.value     = currentText
  inp.rows      = Math.max(1, currentText.split('\n').length)
  bubbleEl.replaceWith(inp)
  inp.focus()
  inp.select()
  inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      var val = inp.value.trim()
      if (val && val !== currentText) {
        ref.update({ text: val, edited: true })
          .catch(function (err) { console.error('[chat] edit error', err) })
        // Actualizar visualmente hasta que llegue el snapshot
        var span = document.createElement('span')
        span.className   = 'cw-bubble-text'
        span.textContent = val
        inp.replaceWith(span)
      } else {
        var span2 = document.createElement('span')
        span2.className   = 'cw-bubble-text'
        span2.textContent = currentText
        inp.replaceWith(span2)
      }
    }
    if (e.key === 'Escape') {
      var span3 = document.createElement('span')
      span3.className   = 'cw-bubble-text'
      span3.textContent = currentText
      inp.replaceWith(span3)
    }
  })
}

// ─── Search ──────────────────────────────────────────────────────────────────
function _toggleSearch() {
  _searchMode = !_searchMode
  var bar = document.getElementById('cw-search-bar')
  var inp = document.getElementById('cw-search-input')
  if (bar) bar.style.display = _searchMode ? 'flex' : 'none'
  if (_searchMode && inp) { inp.value = ''; inp.focus() }
  else { _renderDmMessages(document.getElementById('cw-body'), _lastMsgDocs) }
}

window._chatSearch = function (query) {
  query = (query || '').toLowerCase().trim()
  if (!query) {
    _renderDmMessages(document.getElementById('cw-body'), _lastMsgDocs)
    return
  }
  var filtered = _lastMsgDocs.filter(function (doc) {
    var text = (doc.data().text || '').toLowerCase()
    return text.includes(query)
  })
  _renderDmMessages(document.getElementById('cw-body'), filtered, query)
}

// ─── Compartir anime ─────────────────────────────────────────────────────────
window._chatShareAnime = function () {
  if (!_currentUser || !_db) return
  var info = window._rpGetCurrentInfo ? window._rpGetCurrentInfo() : null
  if (!info || !info.animeTitle) { console.warn('[chat] no hay anime activo'); return }

  var friends = window._ryokuGetFriends ? window._ryokuGetFriends() : []
  if (!friends.length) return

  // Abrir panel en lista de DMs mostrando el picker
  window._pendingShare = info
  if (_panelOpen && _currentView === 'dm') {
    // Si estamos en un DM, volver a la lista para elegir
    _currentView = 'list'
  }
  if (!_panelOpen) _togglePanel()
  else _renderBody()
}

// Enviar share directamente a un amigo (desde el picker)
window._chatSendShareTo = async function (friendUid) {
  var info = window._pendingShare
  if (!info || !_currentUser || !_db) return
  window._pendingShare = null

  var friends = window._ryokuGetFriends ? window._ryokuGetFriends() : []
  var friend  = friends.find(function (f) { return f.uid === friendUid })
  if (!friend) return

  var dmId = _dmId(_currentUser.uid, friendUid)
  var ts   = firebase.firestore.FieldValue.serverTimestamp()
  var msg  = '🎬 ' + info.animeTitle + (info.ep ? ' · Ep ' + info.ep : '')
  try {
    await _db.collection('dms').doc(dmId).set({
      members:     [_currentUser.uid, friendUid],
      lastMessage: msg,
      lastAt:      ts,
      lastFrom:    _currentUser.uid
    }, { merge: true })
    await _db.collection('dms').doc(dmId).collection('messages').add({
      type:      'share-anime',
      text:      msg,
      from:      _currentUser.uid,
      fromName:  _currentUser.displayName || 'Yo',
      fromPhoto: (window._authGetAvatarURL && window._authGetAvatarURL()) || _currentUser.photoURL || '',
      animeData: {
        title: info.animeTitle,
        ep:    info.ep    || '',
        img:   info.img   || '',
        url:   info.url   || ''
      },
      createdAt: ts
    })
    // Abrir el DM correctamente (listener + scroll)
    window._chatOpenDm(friendUid)
  } catch (e) { console.error('[chat] share anime error', e) }
}

// Cancelar share pendiente
window._chatCancelShare = function () {
  window._pendingShare = null
  _renderBody()
}

async function _doShareAnime(info) {
  if (!_currentDmFriend || !_currentUser || !_db) return
  var dmId = _dmId(_currentUser.uid, _currentDmFriend.uid)
  var ts   = firebase.firestore.FieldValue.serverTimestamp()
  var msg  = '🎬 ' + info.animeTitle + (info.ep ? ' · Ep ' + info.ep : '')
  try {
    await _db.collection('dms').doc(dmId).set({
      members:     [_currentUser.uid, _currentDmFriend.uid],
      lastMessage: msg,
      lastAt:      ts,
      lastFrom:    _currentUser.uid
    }, { merge: true })
    await _db.collection('dms').doc(dmId).collection('messages').add({
      type:      'share-anime',
      text:      msg,
      from:      _currentUser.uid,
      fromName:  _currentUser.displayName || 'Yo',
      fromPhoto: (window._authGetAvatarURL && window._authGetAvatarURL()) || _currentUser.photoURL || '',
      animeData: {
        title: info.animeTitle,
        ep:    info.ep    || '',
        img:   info.img   || '',
        url:   info.url   || ''
      },
      createdAt: ts
    })
  } catch (e) { console.error('[chat] share anime error', e) }
}

// ─── FAB ─────────────────────────────────────────────────────────────────────
function _isPlayerActive() {
  var player = document.getElementById('overlay-player')
  var lector = document.getElementById('page-manga-lector')
  return !!(
    (player && player.classList.contains('activo')) ||
    (lector && lector.classList.contains('activa'))
  )
}

function _updateFAB() {
  var fab   = document.getElementById('chat-fab')
  var badge = document.getElementById('chat-fab-badge')
  if (!fab) return
  var appAnime   = document.getElementById('app-anime')
  var pageInicio = document.getElementById('page-inicio')
  var appManga   = document.getElementById('app-manga')
  var pageManga  = document.getElementById('page-manga-inicio')
  var animeHome  = !!(appAnime && appAnime.style.display !== 'none' && pageInicio && pageInicio.classList.contains('activa'))
  var mangaHome  = !!(appManga && appManga.style.display !== 'none' && pageManga && pageManga.classList.contains('activa'))
  var inPlayer   = _isPlayerActive()
  var isLoading  = !!(document.getElementById('modulo-loading-ov')?.classList.contains('mlo-visible'))
  var visible    = !!(_currentUser && (animeHome || mangaHome) && !inPlayer && !isLoading)
  fab.style.display = visible ? 'flex' : 'none'
  if (!visible && !inPlayer && _panelOpen) _closePanel()
  if (badge) {
    badge.textContent   = _unreadTotal
    badge.style.display = _unreadTotal > 0 ? 'flex' : 'none'
  }
  var rpBadge = document.getElementById('rp-chat-badge')
  if (rpBadge) rpBadge.style.display = (_unreadTotal > 0 && inPlayer) ? 'block' : 'none'
  var win = document.getElementById('chat-window')
  if (win) {
    var wasInPlayer = win.classList.contains('in-player')
    win.classList.toggle('in-player', inPlayer)
    if (wasInPlayer !== inPlayer) _applyContextPos()
  }
  _updateFloatOverlay()
}

// ─── Mensajes flotantes ───────────────────────────────────────────────────────
function _updateFloatOverlay() {
  var overlay = document.getElementById('chat-float-overlay')
  if (!overlay) return
  var show = _isPlayerActive() && !_panelOpen && !!_currentUser
  overlay.style.display = show ? 'flex' : 'none'
}

function _showFloatMsg(senderName, text, senderPhoto, ctx) {
  if (_panelOpen) return
  var avatarHtml = senderPhoto
    ? '<img class="fp-avatar" src="' + _esc(senderPhoto) + '" onerror="this.style.display=\'none\'" />'
    : '<span class="fp-avatar fp-avatar-init">' + _esc((senderName || '?')[0].toUpperCase()) + '</span>'

  // Al hacer click: abrir el DM/sala correspondiente
  function _onPillClick() {
    if (!ctx) { _togglePanel(); return }
    if (!_panelOpen) _togglePanel()
    if (ctx.type === 'dm' && ctx.uid) {
      setTimeout(function () { window._chatOpenDm(ctx.uid) }, 50)
    } else if (ctx.type === 'sala' && ctx.roomId) {
      setTimeout(function () { window._chatOpenRoom(ctx.roomId) }, 50)
    }
  }

  function _makePill(cls) {
    var el = document.createElement('div')
    el.className = cls
    el.innerHTML = avatarHtml +
      '<div class="fp-body">' +
        '<span class="fp-name">' + _esc(senderName) + '</span>' +
        '<span class="fp-text">' + _esc(text) + '</span>' +
      '</div>'
    el.style.cursor = 'pointer'
    el.addEventListener('click', _onPillClick)
    return el
  }

  if (_isPlayerActive()) {
    var overlay = document.getElementById('chat-float-overlay')
    if (!overlay) return
    overlay.style.display = 'flex'
    var pill = _makePill('chat-float-pill')
    overlay.appendChild(pill)
    var pills = overlay.querySelectorAll('.chat-float-pill')
    if (pills.length > 4) pills[0].remove()
    setTimeout(function () {
      pill.classList.add('fading')
      setTimeout(function () { if (pill.parentNode) pill.remove() }, 400)
    }, 5000)
  } else {
    var wrap = document.getElementById('chat-home-notif')
    if (!wrap) {
      wrap = document.createElement('div')
      wrap.id = 'chat-home-notif'
      document.body.appendChild(wrap)
    }
    var toast = _makePill('chat-home-pill')
    wrap.appendChild(toast)
    var toasts = wrap.querySelectorAll('.chat-home-pill')
    if (toasts.length > 3) toasts[0].remove()
    setTimeout(function () {
      toast.classList.add('fading')
      setTimeout(function () { if (toast.parentNode) toast.remove() }, 400)
    }, 5000)
  }
}

function _clearFloatMsgs() {
  var overlay = document.getElementById('chat-float-overlay')
  if (overlay) overlay.innerHTML = ''
}

// ─── Panel ───────────────────────────────────────────────────────────────────
function _togglePanel() {
  _panelOpen = !_panelOpen
  var win = document.getElementById('chat-window')
  if (!win) return
  if (_panelOpen) {
    _clearFloatMsgs()
    win.classList.remove('cw-hidden')
    _currentView = 'list'
    _currentTab  = 'dms'
    _refreshConvoListeners()
    _renderTabs()
    _updateHeaderBack()
    _renderBody()
    _updateFloatOverlay()
  } else {
    _closePanel()
  }
}

function _closePanel() {
  _panelOpen = false
  var win = document.getElementById('chat-window')
  if (win) win.classList.add('cw-hidden')
  if (_msgsUnsub)   { _msgsUnsub();   _msgsUnsub   = null }
  if (_typingUnsub) { _typingUnsub(); _typingUnsub = null }
  _clearReply()
  if (_searchMode) _toggleSearch()
  _hideCtxMenu()
  _updateFloatOverlay()
}

function _switchTab(tab) {
  _currentTab      = tab
  _currentView     = 'list'
  _currentDmFriend = null
  _currentRoomId   = null
  if (_msgsUnsub)   { _msgsUnsub();   _msgsUnsub   = null }
  if (_typingUnsub) { _typingUnsub(); _typingUnsub = null }
  _clearReply()
  _renderTabs()
  _updateHeaderBack()
  _renderBody()
}

function _back() {
  if (_msgsUnsub)   { _msgsUnsub();   _msgsUnsub   = null }
  if (_typingUnsub) { _typingUnsub(); _typingUnsub = null }
  _clearReply()
  if (_searchMode) _toggleSearch()
  _currentDmFriend = null
  _currentRoomId   = null
  _currentView     = 'list'
  _renderTabs()
  _updateHeaderBack()
  _renderBody()
}

// ─── Header ──────────────────────────────────────────────────────────────────
function _renderTabs() {
  document.querySelectorAll('.cw-tab').forEach(function (t) { t.classList.remove('active') })
  var el = document.getElementById('cw-tab-' + _currentTab)
  if (el) el.classList.add('active')
  var tabs  = document.getElementById('cw-tabs')
  var title = document.getElementById('cw-title')
  var inConv = (_currentView === 'dm' || _currentView === 'sala-msg' || _currentView === 'sala-create' || _currentView === 'grupo-settings')
  if (tabs)  tabs.style.display  = inConv ? 'none' : 'flex'
  if (title) {
    if (_currentView === 'dm' && _currentDmFriend)
      title.textContent = _currentDmFriend.displayName || 'DM'
    else if (_currentView === 'sala-msg' && _currentRoomId) {
      var r = _rooms.find(function (x) { return x.id === _currentRoomId })
      title.textContent = (r && r.name) ? r.name : 'Grupo'
    } else if (_currentView === 'sala-create')
      title.textContent = 'Nuevo grupo'
    else if (_currentView === 'grupo-settings')
      title.textContent = 'Editar grupo'
    else
      title.textContent = 'Mensajes'
  }
}

function _updateHeaderBack() {
  var btn       = document.getElementById('cw-back-btn')
  var composer  = document.getElementById('cw-composer')
  var searchBtn = document.getElementById('cw-search-btn')
  var groupBtn  = document.getElementById('cw-group-btn')
  var inConv    = (_currentView === 'dm' || _currentView === 'sala-msg')
  var inChild   = (_currentView !== 'list')
  if (btn)       btn.style.display       = inChild  ? 'flex' : 'none'
  if (composer)  composer.style.display  = inConv   ? 'flex' : 'none'
  if (searchBtn) searchBtn.style.display = inConv   ? 'flex' : 'none'
  if (groupBtn)  groupBtn.style.display  = 'none'   // Solo se usa right-click en lista
  if (inConv) setTimeout(function () {
    var inp = document.getElementById('cw-input')
    if (inp) inp.focus()
  }, 80)
}

// ─── Render body ─────────────────────────────────────────────────────────────
function _renderBody() {
  var body = document.getElementById('cw-body')
  if (!body) return
  if (_currentView === 'dm')              { _renderDmMessages(body);        return }
  if (_currentView === 'sala-msg')        { _renderRoomMessages(body);      return }
  if (_currentView === 'sala-create')     { _renderSalaCreate(body);        return }
  if (_currentView === 'grupo-settings')  { _renderGrupoSettings(body);     return }
  if (_currentTab  === 'dms')             { _renderDmList(body);            return }
  _renderSalaList(body)
}

// ─── DM list ─────────────────────────────────────────────────────────────────
function _renderDmList(body) {
  var friends = window._ryokuGetFriends ? window._ryokuGetFriends() : []
  if (!friends.length) {
    body.innerHTML = '<div class="cw-empty">Aún no tienes amigos.<br>Agrégalos desde el panel de amigos.</div>'
    return
  }
  // Activar listeners de presencia RTDB si aún no están corriendo
  if (Object.keys(_presenceRefs).length !== friends.length) {
    _listenFriendPresence(friends)
  }
  var pendingShare = !!window._pendingShare
  var banner = pendingShare
    ? '<div class="cw-share-banner">' +
        '<i class="ti ti-send" aria-hidden="true"></i>' +
        '<span>¿A quién quieres enviar?</span>' +
        '<button class="cw-share-cancel" onclick="window._chatCancelShare()">' +
          '<i class="ti ti-x" aria-hidden="true"></i>' +
        '</button>' +
      '</div>'
    : ''
  var rows = friends.map(function (f) {
    var dmId      = _dmId(_currentUser.uid, f.uid)
    var c         = _convos[dmId] || {}
    var preview   = c.lastMessage
      ? (c.lastFrom === _currentUser.uid ? 'Tú: ' : '') + c.lastMessage
      : ('lastMessage' in c ? 'Sin mensajes aún' : '…')   // '…' = listener activo pero Firestore no respondió aún
    // Truncar previews de share-anime
    if (c.lastMessage && preview.startsWith('🎬')) preview = preview.slice(0, 40) + '…'
    var timeStr   = c.lastAt ? _timeLabel(c.lastAt) : ''
    var ms        = _tsToMs(c.lastAt)
    var hasUnread = c.lastMessage && c.lastFrom !== _currentUser.uid && ms > _getLastRead(dmId)
    var avatarInner = f.photoURL
      ? '<img src="' + _esc(f.photoURL) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />'
      : _esc((f.displayName || 'U').slice(0, 2).toUpperCase())
    // En modo "share picker", un click directo envía sin abrir el DM
    var clickFn = pendingShare
      ? 'window._chatSendShareTo(\'' + f.uid + '\')'
      : 'window._chatOpenDm(\'' + f.uid + '\')'
    return '<div class="cw-dm-row' + (pendingShare ? ' share-pick' : '') + '" onclick="' + clickFn + '">' +
      '<div class="cw-dm-avatar-wrap">' +
        '<div class="cw-dm-avatar">' + avatarInner + '</div>' +
        _activityHtml(f.uid) +
      '</div>' +
      '<div class="cw-dm-info">' +
        '<div class="cw-dm-name">' + _esc(f.displayName || 'Usuario') + '</div>' +
        '<div class="cw-dm-preview' + (hasUnread ? ' unread' : '') + '">' + _esc(preview) + '</div>' +
      '</div>' +
      '<div class="cw-dm-meta">' +
        (pendingShare ? '<i class="ti ti-send" style="opacity:.5;font-size:14px"></i>' : '') +
        (!pendingShare && timeStr   ? '<span class="cw-dm-time">' + timeStr + '</span>' : '') +
        (!pendingShare && hasUnread ? '<span class="cw-dm-unread"></span>' : '') +
      '</div>' +
    '</div>'
  })
  body.innerHTML = banner + rows.join('')
}

// ─── Grupo list ───────────────────────────────────────────────────────────────
function _renderSalaList(body) {
  var newBtn = '<div style="padding:8px 10px 4px">' +
    '<button onclick="window._chatNewRoom()" class="cw-new-room-btn">' +
      '<i class="ti ti-plus" aria-hidden="true"></i> Nuevo grupo' +
    '</button>' +
  '</div>'
  if (!_rooms.length) {
    body.innerHTML = newBtn + '<div class="cw-empty">No tienes grupos aún.<br>Crea uno e invita a tus amigos.</div>'
    return
  }
  var rows = _rooms.map(function (r) {
    var membCount = (r.members || []).length
    var preview   = r.lastMessage || 'Sin mensajes aún'
    var timeStr   = r.lastAt ? _timeLabel(r.lastAt) : ''
    var avatarInner = r.photoURL
      ? '<div style="width:100%;height:100%;border-radius:8px;background-image:url(' + _esc(r.photoURL) + ');background-size:' + Math.round((r.photoScale||1)*100) + '%;background-position:' + _esc(r.photoPosition||'50% 50%') + ';background-repeat:no-repeat"></div>'
      : _esc((r.name || 'G').slice(0, 1).toUpperCase())
    return '<div class="cw-dm-row" onclick="window._chatOpenRoom(\'' + r.id + '\')" oncontextmenu="event.preventDefault();event.stopPropagation();window._chatRoomCtxMenu(event,\'' + r.id + '\')">' +
      '<div class="cw-dm-avatar cw-room-avatar">' + avatarInner + '</div>' +
      '<div class="cw-dm-info">' +
        '<div class="cw-dm-name">' + _esc(r.name || 'Grupo') + '</div>' +
        '<div class="cw-dm-preview">' + _esc(preview) + ' · ' + membCount + ' miembros</div>' +
      '</div>' +
      '<div class="cw-dm-meta">' +
        (timeStr ? '<span class="cw-dm-time">' + timeStr + '</span>' : '') +
      '</div>' +
    '</div>'
  })
  body.innerHTML = newBtn + rows.join('')
}

// ─── Grupo create ─────────────────────────────────────────────────────────────
function _renderSalaCreate(body) {
  var friends = window._ryokuGetFriends ? window._ryokuGetFriends() : []
  var friendRows = friends.map(function (f) {
    var av = f.photoURL
      ? '<img src="' + _esc(f.photoURL) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />'
      : _esc((f.displayName || 'U').slice(0, 2).toUpperCase())
    return '<label class="cw-create-friend-row">' +
      '<div class="cw-dm-avatar" style="width:28px;height:28px;font-size:10px">' + av + '</div>' +
      '<span style="flex:1;font-size:13px;color:var(--text-1)">' + _esc(f.displayName || 'Usuario') + '</span>' +
      '<input type="checkbox" class="cw-create-check" value="' + _esc(f.uid) + '" />' +
    '</label>'
  }).join('')
  body.innerHTML =
    '<div style="padding:10px 12px;display:flex;flex-direction:column;gap:10px">' +
      '<input id="cw-room-name" class="cw-input" style="border-radius:8px;padding:8px 12px" placeholder="Nombre del grupo..." maxlength="40" />' +
      '<input id="cw-room-photo" class="cw-input" style="border-radius:8px;padding:8px 12px" placeholder="URL de foto del grupo (opcional)..." />' +
      (friends.length
        ? '<div style="font-size:11px;color:var(--text-2);margin-bottom:-4px">Agregar amigos</div>' +
          '<div style="display:flex;flex-direction:column;gap:2px">' + friendRows + '</div>'
        : '<div style="font-size:12px;color:var(--text-3)">Agrega amigos primero.</div>'
      ) +
      '<button onclick="window._chatCreateRoom()" class="cw-send" style="width:100%;border-radius:8px;height:36px;font-size:13px;font-weight:500">Crear grupo</button>' +
    '</div>'
}

// ─── Open DM ─────────────────────────────────────────────────────────────────
window._chatOpenDm = function (uid) {
  var friends = window._ryokuGetFriends ? window._ryokuGetFriends() : []
  var f = friends.find(function (x) { return x.uid === uid }) || {}
  _currentView     = 'dm'
  _currentTab      = 'dms'
  _currentDmFriend = { uid: uid, displayName: f.displayName || 'Usuario', photoURL: f.photoURL || '' }
  _friendLastRead  = 0
  _lastMsgDocs     = []
  var dmId = _dmId(_currentUser.uid, uid)
  _setLastRead(dmId)
  _recalcUnread()
  _renderTabs()
  _updateHeaderBack()
  var body = document.getElementById('cw-body')
  if (body) body.innerHTML = '<div class="cw-empty" style="padding-top:40px">Cargando…</div>'
  if (_msgsUnsub) { _msgsUnsub(); _msgsUnsub = null }
  // Marcar lastRead en Firestore para ticks de lectura
  var readUpd = {}
  readUpd['lastRead.' + _currentUser.uid] = firebase.firestore.FieldValue.serverTimestamp()
  _db.collection('dms').doc(dmId).set(readUpd, { merge: true }).catch(function () {})
  _listenTyping(dmId)
  _msgsUnsub = _db.collection('dms').doc(dmId).collection('messages')
    .orderBy('createdAt', 'asc').limitToLast(60)
    .onSnapshot(function (snap) {
      _lastMsgDocs = snap.docs
      _renderDmMessages(document.getElementById('cw-body'), _lastMsgDocs)
      _setLastRead(dmId)
      _recalcUnread()
      // Actualizar lastRead en Firestore cada vez que llegan mensajes nuevos
      _db.collection('dms').doc(dmId).set(readUpd, { merge: true }).catch(function () {})
    })
}

// ─── Render mensaje individual ────────────────────────────────────────────────
function _renderMsgRow(doc, mine, friendPhoto, friendName, prevDayStr) {
  var d      = doc.data()
  var docId  = doc.id
  var docPath = doc.ref.path
  var dayStr = _dateDayStr(d.createdAt)
  var sepHtml = (dayStr && dayStr !== prevDayStr)
    ? '<div class="cw-date-sep"><span>' + _dateSepLabel(d.createdAt) + '</span></div>'
    : ''

  // Mensaje eliminado
  if (d.deleted) {
    return {
      html: sepHtml + '<div class="cw-msg-row ' + (mine ? 'mine' : 'theirs') + ' cw-deleted">' +
        '<div class="cw-bubble-deleted"><i class="ti ti-ban" aria-hidden="true"></i> Mensaje eliminado</div>' +
      '</div>',
      dayStr: dayStr
    }
  }

  // Share-anime card
  if (d.type === 'share-anime' && d.animeData) {
    var ad = d.animeData
    var onClickAttr = ad.url
      ? 'onclick="if(window._animeAbrirDesdeChat)window._animeAbrirDesdeChat(' + _jsonAttr(ad.url) + ',' + _jsonAttr(ad.title || '') + ')"'
      : ''
    var shareText = d.text || ('🎬 ' + (ad.title || ''))
    var ctxAttr = mine
      ? 'oncontextmenu="window._chatCtxMenu(event,' + _jsonAttr(docId) + ',' + _jsonAttr(docPath) + ',' + _jsonAttr(shareText) + ',true)"'
      : 'oncontextmenu="window._chatCtxMenu(event,' + _jsonAttr(docId) + ',' + _jsonAttr(docPath) + ',' + _jsonAttr(shareText) + ',false)"'
    var shareReactHtml = ''
    if (d.reactions && Object.keys(d.reactions).length) {
      shareReactHtml = '<div class="cw-reactions">'
      Object.keys(d.reactions).forEach(function (emoji) {
        var count = (d.reactions[emoji] || []).length
        if (!count) return
        var isMine2 = (d.reactions[emoji] || []).indexOf(_currentUser.uid) >= 0
        shareReactHtml += '<button class="cw-react-pill' + (isMine2 ? ' mine' : '') + '" ' +
          'onclick="window._chatAddReaction(' + _jsonAttr(docPath) + ',' + _jsonAttr(emoji) + ')">' +
          emoji + ' ' + count +
        '</button>'
      })
      shareReactHtml += '</div>'
    }
    var shareAvatarPhoto = mine
      ? ((window._authGetAvatarURL && window._authGetAvatarURL()) || _currentUser.photoURL || '')
      : (d.fromPhoto || friendPhoto)
    var shareAvatarName = mine ? (_currentUser.displayName || 'Yo') : (d.fromName || friendName)
    var shareAvatarHtml = shareAvatarPhoto
      ? '<img class="cw-avatar" src="' + _esc(shareAvatarPhoto) + '" alt="" onerror="this.style.display=\'none\'">'
      : '<div class="cw-avatar cw-avatar-init">' + _esc((shareAvatarName || '?')[0].toUpperCase()) + '</div>'
    return {
      html: sepHtml +
        '<div class="cw-msg-row ' + (mine ? 'mine' : 'theirs') + '" data-doc-id="' + _esc(docId) + '" ' + ctxAttr + '>' +
          (!mine ? shareAvatarHtml : '') +
          '<div class="cw-msg-wrap">' +
            '<div class="cw-share-card" ' + onClickAttr + '>' +
              (ad.img ? '<img class="cw-share-img" src="' + _esc(ad.img) + '" alt="" />' : '') +
              '<div class="cw-share-info">' +
                '<div class="cw-share-tag"><i class="ti ti-device-tv" aria-hidden="true"></i> ' + (mine ? 'Estoy viendo' : 'Está viendo') + '</div>' +
                '<div class="cw-share-title">' + _esc(ad.title || '') + '</div>' +
                (ad.ep ? '<div class="cw-share-ep">Episodio ' + _esc(String(ad.ep)) + '</div>' : '') +
              '</div>' +
            '</div>' +
            '<div class="cw-msg-meta">' +
              shareReactHtml +
              '<span class="cw-time">' + _timeHM(d.createdAt) + '</span>' +
            '</div>' +
          '</div>' +
          (mine ? shareAvatarHtml : '') +
        '</div>',
      dayStr: dayStr
    }
  }

  // Mensaje normal
  var photo = mine
    ? ((window._authGetAvatarURL && window._authGetAvatarURL()) || _currentUser.photoURL || '')
    : (d.fromPhoto || friendPhoto)
  var name   = mine ? (_currentUser.displayName || 'Yo') : (d.fromName || friendName)
  var timeStr = _timeHM(d.createdAt)
  var ts      = _tsToMs(d.createdAt)

  // Ticks (solo para mis mensajes)
  var tickHtml = ''
  if (mine) {
    var isRead = _friendLastRead && ts && ts < _friendLastRead
    tickHtml = '<span class="cw-tick' + (isRead ? ' read' : '') + '">✓✓</span>'
  }

  // Reply quote
  var replyHtml = ''
  if (d.replyTo && d.replyTo.text) {
    replyHtml = '<div class="cw-reply-quote">' +
      '<span class="crq-name">' + _esc(d.replyTo.fromName || '') + '</span>' +
      '<span class="crq-text">' + _esc((d.replyTo.text || '').slice(0, 80)) + '</span>' +
    '</div>'
  }

  // Reactions
  var reactHtml = ''
  if (d.reactions && Object.keys(d.reactions).length) {
    reactHtml = '<div class="cw-reactions">'
    Object.keys(d.reactions).forEach(function (emoji) {
      var count = (d.reactions[emoji] || []).length
      if (!count) return
      var isMine2 = (d.reactions[emoji] || []).indexOf(_currentUser.uid) >= 0
      reactHtml += '<button class="cw-react-pill' + (isMine2 ? ' mine' : '') + '" ' +
        'onclick="window._chatAddReaction(' + _jsonAttr(docPath) + ',' + _jsonAttr(emoji) + ')">' +
        emoji + ' ' + count +
      '</button>'
    })
    reactHtml += '</div>'
  }

  // Avatar
  var avatarHtml = photo
    ? '<img class="cw-avatar" src="' + _esc(photo) + '" alt="" onerror="this.style.display=\'none\'">'
    : '<div class="cw-avatar cw-avatar-init">' + _esc((name || '?')[0].toUpperCase()) + '</div>'

  var ctxArgs = _jsonAttr(docId) + ',' + _jsonAttr(docPath) + ',' +
    _jsonAttr((d.text || '').slice(0, 300)) + ',' + (mine ? 'true' : 'false')

  var html = sepHtml +
    '<div class="cw-msg-row ' + (mine ? 'mine' : 'theirs') + '" ' +
      'data-doc-id="' + _esc(docId) + '" ' +
      'oncontextmenu="window._chatCtxMenu(event,' + ctxArgs + ')">' +
      (!mine ? avatarHtml : '') +
      '<div class="cw-msg-wrap">' +
        '<div class="cw-bubble ' + (mine ? 'mine' : 'theirs') + ((d.type === 'image' || _isImageUrl(d.text)) ? ' cw-bubble-img' : '') + '">' +
          replyHtml +
          ((d.type === 'image' || _isImageUrl(d.text))
            ? '<a href="' + _esc(d.text) + '" target="_blank" rel="noopener noreferrer">' +
              '<img class="cw-msg-img" src="' + _esc(d.text) + '" alt="imagen" loading="lazy" ' +
              'onerror="this.style.display=\'none\'" />' +
              '</a>'
            : '<span class="cw-bubble-text">' + _esc(d.text || '') + '</span>' +
              (d.edited ? '<span class="cw-edited"> · editado</span>' : '')) +
        '</div>' +
        '<div class="cw-msg-meta">' +
          reactHtml +
          (timeStr ? '<span class="cw-time">' + timeStr + '</span>' : '') +
          tickHtml +
        '</div>' +
      '</div>' +
      (mine ? avatarHtml : '') +
    '</div>'

  return { html: html, dayStr: dayStr }
}

// Scroll al fondo esperando imágenes
function _scrollToBottom(body) {
  if (!body) return
  var doScroll = function () { body.scrollTop = body.scrollHeight }
  // Primer intento inmediato
  doScroll()
  // Segundo intento tras layout
  requestAnimationFrame(function () {
    doScroll()
    // Tercer intento tras cargar imágenes pendientes (avatares, share-img, msg-img)
    var imgs = body.querySelectorAll('img')
    var pending = 0
    imgs.forEach(function (img) {
      if (!img.complete) {
        pending++
        img.addEventListener('load',  function () { doScroll() }, { once: true })
        img.addEventListener('error', function () { doScroll() }, { once: true })
      }
    })
    // Fallbacks encadenados para imágenes lentas
    if (pending > 0) {
      setTimeout(doScroll, 300)
      setTimeout(doScroll, 800)
    } else {
      // Sin imágenes pendientes, un fallback extra por si hay reflow tardío
      setTimeout(doScroll, 100)
    }
  })
}

function _renderDmMessages(body, docs, searchQuery) {
  if (!body) return
  var msgs = docs || []
  if (!msgs.length) {
    body.innerHTML = '<div class="cw-empty">' +
      (searchQuery ? 'Sin resultados para "' + _esc(searchQuery) + '"' : 'Aún no hay mensajes.<br>¡Manda el primero!') +
    '</div>'
    return
  }
  var friendPhoto = _currentDmFriend ? (_currentDmFriend.photoURL || '') : ''
  var friendName  = _currentDmFriend ? (_currentDmFriend.displayName || 'Usuario') : 'Usuario'
  var prevDay = ''
  var html = '<div class="cw-messages">'
  msgs.forEach(function (doc) {
    var d    = doc.data()
    var mine = d.from === _currentUser.uid
    var result = _renderMsgRow(doc, mine, friendPhoto, friendName, prevDay)
    html += result.html
    if (result.dayStr) prevDay = result.dayStr
  })
  // Typing indicator
  html += '<div id="cw-typing" class="cw-typing" style="display:none">' +
    (friendPhoto
      ? '<img class="cw-avatar" src="' + _esc(friendPhoto) + '" alt="" />'
      : '<div class="cw-avatar cw-avatar-init">' + _esc((friendName||'?')[0]) + '</div>') +
    '<div class="cw-typing-dots"><span></span><span></span><span></span></div>' +
  '</div>'
  html += '</div>'
  body.innerHTML = html
  // Resaltar búsqueda
  if (searchQuery) {
    body.querySelectorAll('.cw-bubble-text').forEach(function (el) {
      var orig = el.textContent
      var idx  = orig.toLowerCase().indexOf(searchQuery.toLowerCase())
      if (idx < 0) return
      el.innerHTML = _esc(orig.slice(0, idx)) +
        '<mark class="cw-highlight">' + _esc(orig.slice(idx, idx + searchQuery.length)) + '</mark>' +
        _esc(orig.slice(idx + searchQuery.length))
    })
  }
  _scrollToBottom(body)
}

// ─── Open Room ────────────────────────────────────────────────────────────────
window._chatOpenRoom = function (roomId) {
  _currentView   = 'sala-msg'
  _currentTab    = 'sala'
  _currentRoomId = roomId
  _renderTabs()
  _updateHeaderBack()
  var body = document.getElementById('cw-body')
  if (body) body.innerHTML = '<div class="cw-empty" style="padding-top:40px">Cargando…</div>'
  if (_msgsUnsub) { _msgsUnsub(); _msgsUnsub = null }
  _msgsUnsub = _db.collection('rooms').doc(roomId).collection('messages')
    .orderBy('createdAt', 'asc').limitToLast(60)
    .onSnapshot(function (snap) {
      _renderRoomMessages(document.getElementById('cw-body'), snap.docs)
    })
}

function _renderRoomMessages(body, docs) {
  if (!body) return
  var msgs = docs || []
  if (!msgs.length) {
    body.innerHTML = '<div class="cw-empty">Grupo creado.<br>¡Escribe algo!</div>'
    return
  }
  var prevDay = ''
  var html = '<div class="cw-messages">'
  msgs.forEach(function (doc) {
    var d    = doc.data()
    var mine = d.from === _currentUser.uid
    var docId   = doc.id
    var docPath = doc.ref.path
    var dayStr  = _dateDayStr(d.createdAt)
    if (dayStr !== prevDay) {
      html += '<div class="cw-date-sep"><span>' + _dateSepLabel(d.createdAt) + '</span></div>'
      prevDay = dayStr
    }
    if (d.deleted) {
      html += '<div class="cw-msg-row ' + (mine ? 'mine' : 'theirs') + ' cw-deleted">' +
        '<div class="cw-bubble-deleted"><i class="ti ti-ban" aria-hidden="true"></i> Mensaje eliminado</div>' +
      '</div>'
      return
    }
    var photo = mine
      ? ((window._authGetAvatarURL && window._authGetAvatarURL()) || _currentUser.photoURL || '')
      : (d.fromPhoto || '')
    var name    = mine ? (_currentUser.displayName || 'Yo') : (d.fromName || 'Usuario')
    var timeStr = _timeHM(d.createdAt)
    var avatarHtml = photo
      ? '<img class="cw-avatar" src="' + _esc(photo) + '" alt="" onerror="this.style.display=\'none\'">'
      : '<div class="cw-avatar cw-avatar-init">' + _esc((name||'?')[0].toUpperCase()) + '</div>'
    var ctxArgs = _jsonAttr(docId) + ',' + _jsonAttr(docPath) + ',' +
      _jsonAttr((d.text || '').slice(0, 300)) + ',' + (mine ? 'true' : 'false')
    var reactHtml = ''
    if (d.reactions && Object.keys(d.reactions).length) {
      reactHtml = '<div class="cw-reactions">'
      Object.keys(d.reactions).forEach(function (emoji) {
        var count = (d.reactions[emoji] || []).length
        if (!count) return
        var isMine2 = (d.reactions[emoji] || []).indexOf(_currentUser.uid) >= 0
        reactHtml += '<button class="cw-react-pill' + (isMine2 ? ' mine' : '') + '" onclick="window._chatAddReaction(' + _jsonAttr(docPath) + ',' + _jsonAttr(emoji) + ')">' + emoji + ' ' + count + '</button>'
      })
      reactHtml += '</div>'
    }
    html +=
      '<div class="cw-msg-row ' + (mine ? 'mine' : 'theirs') + '" data-doc-id="' + _esc(docId) + '" oncontextmenu="window._chatCtxMenu(event,' + ctxArgs + ')">' +
        (!mine ? avatarHtml : '') +
        '<div class="cw-msg-wrap">' +
          '<div class="cw-bubble ' + (mine ? 'mine' : 'theirs') + ((d.type === 'image' || _isImageUrl(d.text)) ? ' cw-bubble-img' : '') + '">' +
            (!mine ? '<div class="cw-room-sender">' + _esc(name) + '</div>' : '') +
            ((d.type === 'image' || _isImageUrl(d.text))
              ? '<a href="' + _esc(d.text) + '" target="_blank" rel="noopener noreferrer">' +
                '<img class="cw-msg-img" src="' + _esc(d.text) + '" alt="imagen" loading="lazy" ' +
                'onerror="this.style.display=\'none\'" />' +
                '</a>'
              : '<span class="cw-bubble-text">' + _esc(d.text || '') + '</span>' +
                (d.edited ? '<span class="cw-edited"> · editado</span>' : '')) +
          '</div>' +
          '<div class="cw-msg-meta">' +
            reactHtml +
            (timeStr ? '<span class="cw-time">' + timeStr + '</span>' : '') +
          '</div>' +
        '</div>' +
        (mine ? avatarHtml : '') +
      '</div>'
  })
  html += '</div>'
  body.innerHTML = html
  _scrollToBottom(body)
}

// ─── New room ─────────────────────────────────────────────────────────────────
window._chatNewRoom = function () {
  _currentView = 'sala-create'
  _renderTabs()
  _updateHeaderBack()
  _renderBody()
}

window._chatCreateRoom = async function () {
  var nameEl  = document.getElementById('cw-room-name')
  var photoEl = document.getElementById('cw-room-photo')
  var name    = (nameEl  ? nameEl.value  : '').trim()
  var photo   = (photoEl ? photoEl.value : '').trim()
  if (!name) {
    if (nameEl) { nameEl.focus(); nameEl.style.borderColor = '#ef4444'; setTimeout(function () { nameEl.style.borderColor = '' }, 1500) }
    return
  }
  var checks  = document.querySelectorAll('.cw-create-check:checked')
  var invited = []
  checks.forEach(function (c) { invited.push(c.value) })
  var members = [_currentUser.uid].concat(invited)
  var ts = firebase.firestore.FieldValue.serverTimestamp()
  try {
    var data = { name: name, createdBy: _currentUser.uid, members: members, lastMessage: '', lastAt: ts, createdAt: ts }
    if (photo) data.photoURL = photo
    var ref = await _db.collection('rooms').add(data)
    window._chatOpenRoom(ref.id)
  } catch (e) { console.error('[chat] create room error', e) }
}

// ─── Send ─────────────────────────────────────────────────────────────────────
window._chatSend = async function () {
  var input = document.getElementById('cw-input')
  if (!input || !_currentUser || !_db) return
  var text = (input.value || '').trim()
  if (!text) return
  input.value = ''
  input.focus()
  if (_typingTimer) { clearTimeout(_typingTimer); _clearTypingStatus() }

  var ts      = firebase.firestore.FieldValue.serverTimestamp()
  var myPhoto = (window._authGetAvatarURL && window._authGetAvatarURL()) || _currentUser.photoURL || ''
  var replyPayload = _replyTo ? { id: _replyTo.id, text: _replyTo.text, fromName: _replyTo.fromName } : null
  var msgType = _isImageUrl(text) ? 'image' : 'text'
  _clearReply()

  if (_currentView === 'dm' && _currentDmFriend) {
    var dmId = _dmId(_currentUser.uid, _currentDmFriend.uid)
    try {
      await _db.collection('dms').doc(dmId).set({
        members: [_currentUser.uid, _currentDmFriend.uid],
        lastMessage: msgType === 'image' ? '🖼 Imagen' : text,
        lastAt: ts, lastFrom: _currentUser.uid
      }, { merge: true })
      var msgPayload = {
        text: text, type: msgType, from: _currentUser.uid,
        fromName: _currentUser.displayName || 'Yo',
        fromPhoto: myPhoto, createdAt: ts
      }
      if (replyPayload) msgPayload.replyTo = replyPayload
      await _db.collection('dms').doc(dmId).collection('messages').add(msgPayload)
    } catch (e) { console.error('[chat] DM send error', e) }
    return
  }

  if (_currentView === 'sala-msg' && _currentRoomId) {
    try {
      await _db.collection('rooms').doc(_currentRoomId).update({
        lastMessage: msgType === 'image' ? '🖼 Imagen' : text,
        lastAt: ts, lastFrom: _currentUser.uid,
        lastFromName: _currentUser.displayName || 'Yo', lastFromPhoto: myPhoto
      })
      var roomPayload = {
        text: text, type: msgType, from: _currentUser.uid,
        fromName: _currentUser.displayName || 'Yo',
        fromPhoto: myPhoto, createdAt: ts
      }
      if (replyPayload) roomPayload.replyTo = replyPayload
      await _db.collection('rooms').doc(_currentRoomId).collection('messages').add(roomPayload)
    } catch (e) { console.error('[chat] Room send error', e) }
  }
}

// ─── Enviar imagen/GIF por URL ───────────────────────────────────────────────
window._chatImageSend = function () {
  var bar = document.getElementById('cw-img-bar')
  if (!bar) return
  var visible = bar.style.display !== 'none'
  bar.style.display = visible ? 'none' : 'flex'
  if (!visible) {
    var inp = document.getElementById('cw-img-input')
    if (inp) { inp.value = ''; inp.focus() }
  }
}

window._chatSendImg = function () {
  var inp = document.getElementById('cw-img-input')
  if (!inp) return
  var url = inp.value.trim()
  if (!url) return
  inp.value = ''
  var bar = document.getElementById('cw-img-bar')
  if (bar) bar.style.display = 'none'
  // Meter en el input principal y enviar
  var mainInp = document.getElementById('cw-input')
  if (mainInp) {
    mainInp.value = url
    window._chatSend && window._chatSend()
  }
}

// ─── Keyboard + typing ────────────────────────────────────────────────────────
window._chatInputKey = function (e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window._chatSend() }
}
window._chatTyping = function () { _sendTypingStatus() }

// ─── Group context menu (right-click en lista) ────────────────────────────────
window._chatRoomCtxMenu = function (event, roomId) {
  if (!roomId || !_currentUser) return
  var room    = _rooms.find(function (r) { return r.id === roomId }) || {}
  var isOwner = room.createdBy === _currentUser.uid
  _hideCtxMenu()
  var items = [
    { icon: 'ti-edit', label: 'Editar grupo', fn: function () {
      _currentView    = 'grupo-settings'
      _currentRoomId  = roomId
      _currentTab     = 'sala'
      _renderTabs()
      _updateHeaderBack()
      _renderBody()
    }}
  ]
  if (isOwner) {
    items.push({ icon: 'ti-trash', label: 'Eliminar grupo', danger: true, fn: function () { window._chatDeleteRoom(roomId) } })
  } else {
    items.push({ icon: 'ti-door-exit', label: 'Salir del grupo', danger: true, fn: function () { window._chatLeaveRoom(roomId) } })
  }
  var menu = document.createElement('div')
  menu.id        = 'cw-ctx-menu'
  menu.className = 'cw-ctx-menu'
  menu.innerHTML = items.map(function (item) {
    return '<button class="cw-ctx-item' + (item.danger ? ' danger' : '') + '">' +
      '<i class="ti ' + item.icon + '" aria-hidden="true"></i>' + item.label +
    '</button>'
  }).join('')
  menu.querySelectorAll('.cw-ctx-item').forEach(function (btn, i) {
    btn.addEventListener('click', function () { items[i].fn(); _hideCtxMenu() })
  })
  var _ctn = _fsContainer()
  _ctn.appendChild(menu)
  _ctxMenu = menu
  var _ctnW = (_ctn !== document.body && _ctn.clientWidth) ? _ctn.clientWidth : window.innerWidth
  var _ctnH = (_ctn !== document.body && _ctn.clientHeight) ? _ctn.clientHeight : window.innerHeight
  var x = Math.min(event.clientX, _ctnW - 170)
  var y = Math.min(event.clientY, _ctnH - (items.length * 38 + 12))
  menu.style.left = x + 'px'
  menu.style.top  = y + 'px'
  setTimeout(function () {
    document.addEventListener('click', _hideCtxMenu, { once: true })
  }, 0)
}

// ─── Modal de encuadre de foto de grupo ──────────────────────────────────────
var _gsPhotoPos   = '50% 50%'
var _gsPhotoScale = 1

window._openGroupCropModal = function (url, currentPos, currentScale) {
  if (!url || document.getElementById('gs-crop-modal')) return
  var pctX = 50, pctY = 50, zoom = parseFloat(currentScale) || 1
  if (currentPos) {
    var parts = currentPos.split(' ')
    if (parts.length === 2) { pctX = parseFloat(parts[0]) || 50; pctY = parseFloat(parts[1]) || 50 }
  }

  var modal = document.createElement('div')
  modal.id        = 'gs-crop-modal'
  modal.className = 'pf-pos-modal'
  modal.innerHTML =
    '<div class="pf-pos-modal-box">' +
      '<div class="pf-pos-modal-title">Encuadrar foto del grupo</div>' +
      '<div class="pf-pos-modal-hint">Arrastra para mover · Rueda del mouse para zoom</div>' +
      '<div style="display:flex;justify-content:center">' +
        '<div id="gs-crop-wrap" style="width:150px;height:150px;border-radius:50%;overflow:hidden;border:3px solid var(--primary);cursor:grab;flex-shrink:0;' +
          'background-image:url(' + _esc(url) + ');background-size:' + (zoom*100) + '%;background-position:' + pctX + '% ' + pctY + '%;background-repeat:no-repeat"></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:10px">' +
        '<i class="ti ti-zoom-out" style="color:var(--text-2);font-size:14px"></i>' +
        '<input id="gs-zoom-slider" type="range" min="100" max="400" step="5" value="' + Math.round(zoom*100) + '" style="flex:1;accent-color:var(--primary)">' +
        '<i class="ti ti-zoom-in" style="color:var(--text-2);font-size:14px"></i>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">' +
        '<button class="pf-cancel-btn" onclick="window._closeGroupCropModal()">Cancelar</button>' +
        '<button class="pf-save-btn" onclick="window._saveGroupCropModal()">Guardar</button>' +
      '</div>' +
    '</div>'
  document.body.appendChild(modal)
  modal.addEventListener('mousedown', function (e) { if (e.target === modal) window._closeGroupCropModal() })

  var wrap   = document.getElementById('gs-crop-wrap')
  var slider = document.getElementById('gs-zoom-slider')

  function applyTransform() {
    wrap.style.backgroundSize     = (zoom * 100) + '%'
    wrap.style.backgroundPosition = pctX + '% ' + pctY + '%'
    if (slider) slider.value = Math.round(zoom * 100)
  }

  // Slider de zoom
  slider.addEventListener('input', function () {
    zoom = parseFloat(slider.value) / 100
    applyTransform()
  })

  // Rueda del mouse → zoom
  wrap.addEventListener('wheel', function (e) {
    e.preventDefault()
    zoom = Math.max(1, Math.min(4, zoom - e.deltaY * 0.002))
    applyTransform()
  }, { passive: false })

  // Drag → pan
  wrap.addEventListener('mousedown', function (e) {
    e.preventDefault()
    wrap.style.cursor = 'grabbing'
    var sx = e.clientX, sy = e.clientY, spx = pctX, spy = pctY
    function onMove(e) {
      var dx = e.clientX - sx, dy = e.clientY - sy
      // A mayor zoom, menos desplazamiento por pixel de drag
      var sensitivity = 100 / zoom
      pctX = Math.round(Math.max(0, Math.min(100, spx - dx / 150 * sensitivity)) * 10) / 10
      pctY = Math.round(Math.max(0, Math.min(100, spy - dy / 150 * sensitivity)) * 10) / 10
      applyTransform()
    }
    function onUp() {
      wrap.style.cursor = 'grab'
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}

window._closeGroupCropModal = function () {
  var m = document.getElementById('gs-crop-modal')
  if (m) m.remove()
}

window._saveGroupCropModal = function () {
  var wrap   = document.getElementById('gs-crop-wrap')
  var slider = document.getElementById('gs-zoom-slider')
  if (wrap) {
    _gsPhotoPos   = wrap.style.backgroundPosition || '50% 50%'
    _gsPhotoScale = slider ? parseFloat(slider.value) / 100 : 1
    // Actualizar preview en el panel
    var prev = document.getElementById('gs-photo-preview')
    if (prev) {
      prev.style.backgroundSize     = (Math.round(_gsPhotoScale * 100)) + '%'
      prev.style.backgroundPosition = _gsPhotoPos
    }
  }
  window._closeGroupCropModal()
}

// ─── Group settings panel ─────────────────────────────────────────────────────
function _renderGrupoSettings(body) {
  var roomId  = _currentRoomId
  var room    = _rooms.find(function (r) { return r.id === roomId }) || {}
  var isOwner = room.createdBy === _currentUser.uid
  _gsPhotoPos   = room.photoPosition || '50% 50%'
  _gsPhotoScale = room.photoScale   || 1

  var previewBgStyle = room.photoURL
    ? 'background-image:url(' + _esc(room.photoURL) + ');background-size:' + Math.round(_gsPhotoScale*100) + '%;background-position:' + _esc(_gsPhotoPos) + ';background-repeat:no-repeat;'
    : ''
  var photoPreview = room.photoURL
    ? '<div id="gs-photo-preview" style="width:80px;height:80px;border-radius:50%;' + previewBgStyle + 'border:3px solid var(--primary);flex-shrink:0;cursor:pointer" ' +
        'title="Clic para encuadrar" onclick="window._gsOpenFrameFromInput()"></div>'
    : '<div id="gs-photo-preview" style="width:80px;height:80px;border-radius:50%;background:rgba(var(--primary-rgb),.15);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:var(--primary);flex-shrink:0">' + _esc((room.name || 'G').slice(0, 1).toUpperCase()) + '</div>'

  var deleteBtn = isOwner
    ? '<button onclick="window._chatDeleteRoom(\'' + roomId + '\')" style="width:100%;border-radius:8px;height:36px;font-size:13px;font-weight:500;background:rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.25);cursor:pointer">Eliminar grupo</button>'
    : '<button onclick="window._chatLeaveRoom(\'' + roomId + '\')" style="width:100%;border-radius:8px;height:36px;font-size:13px;font-weight:500;background:rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.25);cursor:pointer">Salir del grupo</button>'

  // ── Sección de miembros ──
  var friends    = window._ryokuGetFriends ? window._ryokuGetFriends() : []
  var memberUids = room.members || []
  var memberRows = memberUids.map(function (uid) {
    var isSelf = uid === _currentUser.uid
    var f      = friends.find(function (x) { return x.uid === uid })
    var name   = isSelf ? (_currentUser.displayName || 'Tú') : (f ? (f.displayName || 'Usuario') : 'Usuario')
    var photo  = isSelf
      ? ((window._authGetAvatarURL && window._authGetAvatarURL()) || _currentUser.photoURL || '')
      : (f ? (f.photoURL || '') : '')
    var av = photo
      ? '<img src="' + _esc(photo) + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0" />'
      : '<div style="width:28px;height:28px;border-radius:50%;background:rgba(var(--primary-rgb),.2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--primary);flex-shrink:0">' + _esc(name.slice(0,2).toUpperCase()) + '</div>'
    var removeBtn = (isOwner && !isSelf)
      ? '<button onclick="window._chatRemoveMember(\'' + roomId + '\',\'' + uid + '\')" ' +
          'style="margin-left:auto;background:none;border:none;color:var(--text-3);cursor:pointer;font-size:16px;padding:0 2px" title="Quitar">×</button>'
      : (isSelf ? '<span style="margin-left:auto;font-size:11px;color:var(--text-3)">tú</span>' : '')
    return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0">' +
      av +
      '<span style="font-size:13px;color:var(--text-1);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(name) + '</span>' +
      removeBtn +
    '</div>'
  }).join('')

  // Amigos que no están en el grupo
  var notInGroup = friends.filter(function (f) { return memberUids.indexOf(f.uid) === -1 })
  var addRows = notInGroup.map(function (f) {
    var photo = f.photoURL
      ? '<img src="' + _esc(f.photoURL) + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0" />'
      : '<div style="width:28px;height:28px;border-radius:50%;background:var(--bg-3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--text-2);flex-shrink:0">' + _esc((f.displayName||'U').slice(0,2).toUpperCase()) + '</div>'
    return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0">' +
      photo +
      '<span style="font-size:13px;color:var(--text-1);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(f.displayName || 'Usuario') + '</span>' +
      '<button onclick="window._chatAddMember(\'' + roomId + '\',\'' + f.uid + '\')" ' +
        'style="margin-left:auto;background:rgba(var(--primary-rgb),.12);border:1px solid rgba(var(--primary-rgb),.25);color:var(--primary);border-radius:6px;padding:2px 10px;font-size:12px;cursor:pointer">+ Añadir</button>' +
    '</div>'
  }).join('')

  body.innerHTML =
    '<div style="padding:14px 12px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;max-height:100%">' +
      '<div style="display:flex;align-items:center;gap:14px">' +
        photoPreview +
        '<div style="flex:1;display:flex;flex-direction:column;gap:6px">' +
          '<span style="font-size:12px;color:var(--text-2)">Foto del grupo</span>' +
          '<button onclick="window._gsOpenFrameFromInput()" class="cw-send" style="padding:5px 10px;font-size:12px;height:auto;width:auto;border-radius:6px">✂ Encuadrar foto</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:4px">' +
        '<label style="font-size:11px;color:var(--text-2)">Nombre del grupo</label>' +
        '<input id="gs-name" class="cw-input" style="border-radius:8px;padding:8px 12px" value="' + _esc(room.name || '') + '" maxlength="40" />' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:4px">' +
        '<label style="font-size:11px;color:var(--text-2)">URL de foto del grupo</label>' +
        '<input id="gs-photo" class="cw-input" style="border-radius:8px;padding:8px 12px" placeholder="https://..." value="' + _esc(room.photoURL || '') + '" />' +
      '</div>' +
      '<button onclick="window._chatSaveGroupSettings(\'' + roomId + '\')" class="cw-send" style="width:100%;border-radius:8px;height:36px;font-size:13px;font-weight:500">Guardar cambios</button>' +
      '<div style="display:flex;flex-direction:column;gap:6px">' +
        '<div style="font-size:11px;color:var(--text-2);font-weight:600;letter-spacing:.5px;text-transform:uppercase">Miembros · ' + memberUids.length + '</div>' +
        memberRows +
      '</div>' +
      (notInGroup.length
        ? '<div style="display:flex;flex-direction:column;gap:6px">' +
            '<div style="font-size:11px;color:var(--text-2);font-weight:600;letter-spacing:.5px;text-transform:uppercase">Añadir amigos</div>' +
            addRows +
          '</div>'
        : '') +
      '<div style="height:4px"></div>' +
      deleteBtn +
    '</div>'

  // Preview en tiempo real al escribir URL
  var photoInput = body.querySelector('#gs-photo')
  var previewEl  = body.querySelector('#gs-photo-preview')
  if (photoInput) {
    photoInput.addEventListener('input', function () {
      var v = photoInput.value.trim()
      var prev = document.getElementById('gs-photo-preview')
      if (!prev) return
      if (v) {
        prev.style.backgroundImage    = 'url(' + v + ')'
        prev.style.backgroundSize     = Math.round(_gsPhotoScale * 100) + '%'
        prev.style.backgroundPosition = _gsPhotoPos
        prev.style.backgroundRepeat   = 'no-repeat'
        prev.style.cursor             = 'pointer'
        if (!prev.onclick) prev.setAttribute('onclick', 'window._gsOpenFrameFromInput()')
        if (prev.tagName === 'DIV' && !prev.id) prev.id = 'gs-photo-preview'
      }
    })
  }
}

// Abre el modal de encuadre usando la URL actual del input
window._gsOpenFrameFromInput = function () {
  var photoEl = document.getElementById('gs-photo')
  var url = photoEl ? photoEl.value.trim() : ''
  if (!url) { if (photoEl) { photoEl.focus(); photoEl.style.borderColor='#ef4444'; setTimeout(function(){photoEl.style.borderColor=''},1500) } return }
  window._openGroupCropModal(url, _gsPhotoPos, _gsPhotoScale)
}

window._chatSaveGroupSettings = async function (roomId) {
  var nameEl  = document.getElementById('gs-name')
  var photoEl = document.getElementById('gs-photo')
  var name    = nameEl  ? nameEl.value.trim()  : ''
  var photo   = photoEl ? photoEl.value.trim() : ''
  if (!name) {
    if (nameEl) { nameEl.focus(); nameEl.style.borderColor = '#ef4444'; setTimeout(function () { nameEl.style.borderColor = '' }, 1500) }
    return
  }
  var upd = { name: name, photoURL: photo, photoPosition: photo ? _gsPhotoPos : '', photoScale: photo ? _gsPhotoScale : 1 }
  try {
    await _db.collection('rooms').doc(roomId).update(upd)
    _back()
  } catch (e) { console.error('[chat] save group settings error', e) }
}

// Modal de confirmación genérico (sin window.confirm, funciona en Electron)
function _chatConfirm(message, onYes) {
  var existing = document.getElementById('cw-confirm-modal')
  if (existing) existing.remove()
  var modal = document.createElement('div')
  modal.id = 'cw-confirm-modal'
  modal.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center'
  modal.innerHTML =
    '<div style="background:var(--bg-1);border:1px solid var(--border);border-radius:14px;padding:20px 22px;width:280px;max-width:calc(100vw - 40px);display:flex;flex-direction:column;gap:14px">' +
      '<div style="font-size:14px;color:var(--text-1);line-height:1.4">' + _esc(message) + '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button id="cw-confirm-no"  style="flex:1;padding:8px;border-radius:8px;background:var(--bg-3);border:none;color:var(--text-1);font-size:13px;cursor:pointer">Cancelar</button>' +
        '<button id="cw-confirm-yes" style="flex:1;padding:8px;border-radius:8px;background:#ef4444;border:none;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Confirmar</button>' +
      '</div>' +
    '</div>'
  document.body.appendChild(modal)
  document.getElementById('cw-confirm-no').addEventListener('click', function () { modal.remove() })
  document.getElementById('cw-confirm-yes').addEventListener('click', function () { modal.remove(); onYes() })
  modal.addEventListener('mousedown', function (e) { if (e.target === modal) modal.remove() })
}

window._chatDeleteRoom = function (roomId) {
  if (!roomId || !_db) return
  var room = _rooms.find(function (r) { return r.id === roomId }) || {}
  _chatConfirm('¿Eliminar el grupo "' + (room.name || 'este grupo') + '"? Esta acción no se puede deshacer.', function () {
    _db.collection('rooms').doc(roomId).update({ deleted: true }).then(function () {
      _currentView = 'list'; _currentRoomId = null
      _renderTabs(); _updateHeaderBack(); _renderBody()
    }).catch(function (e) { console.error('[chat] delete room error', e) })
  })
}

window._chatLeaveRoom = function (roomId) {
  if (!roomId || !_currentUser || !_db) return
  var room = _rooms.find(function (r) { return r.id === roomId }) || {}
  _chatConfirm('¿Salir del grupo "' + (room.name || 'este grupo') + '"?', function () {
    var newMembers = (room.members || []).filter(function (uid) { return uid !== _currentUser.uid })
    _db.collection('rooms').doc(roomId).update({ members: newMembers }).then(function () {
      _currentView = 'list'; _currentRoomId = null
      _renderTabs(); _updateHeaderBack(); _renderBody()
    }).catch(function (e) { console.error('[chat] leave room error', e) })
  })
}

window._chatRemoveMember = function (roomId, uid) {
  if (!roomId || !uid || !_currentUser || !_db) return
  var room = _rooms.find(function (r) { return r.id === roomId }) || {}
  var friends = window._ryokuGetFriends ? window._ryokuGetFriends() : []
  var friend  = friends.find(function (f) { return f.uid === uid })
  var name    = friend ? (friend.displayName || 'este usuario') : 'este usuario'
  _chatConfirm('¿Quitar a ' + name + ' del grupo?', function () {
    var newMembers = (room.members || []).filter(function (m) { return m !== uid })
    _db.collection('rooms').doc(roomId).update({ members: newMembers })
      .then(function () {
        // Re-renderizar el panel de settings con datos frescos
        _currentView = 'grupo-settings'
        _renderBody()
      })
      .catch(function (e) { console.error('[chat] remove member error', e) })
  })
}

window._chatAddMember = function (roomId, uid) {
  if (!roomId || !uid || !_db) return
  _db.collection('rooms').doc(roomId).update({
    members: firebase.firestore.FieldValue.arrayUnion(uid)
  }).then(function () {
    _currentView = 'grupo-settings'
    _renderBody()
  }).catch(function (e) { console.error('[chat] add member error', e) })
}

// ─── Expose ──────────────────────────────────────────────────────────────────
window._chatToggle       = _togglePanel
window._chatTab          = _switchTab
window._chatBack         = _back
window._chatUpdateFAB    = _updateFAB
window._chatClose        = _closePanel
window._chatToggleSearch = _toggleSearch
window._chatSetReply     = _setReply
window._chatClearReply   = _clearReply
window._chatCtxMenu      = _showCtxMenu

// Función para abrir anime desde una share-card
window._animeAbrirDesdeChat = function (url, titulo) {
  if (window._chatClose) window._chatClose()
  if (typeof abrirAnime === 'function') abrirAnime(url, titulo || '')
}

// ─── Draggable ────────────────────────────────────────────────────────────────
var _POS_KEY_HOME   = 'ryoku-chat-pos-home-v7'
var _POS_KEY_PLAYER = 'ryoku-chat-pos-player-v7'

function _posKey() { return _isPlayerActive() ? _POS_KEY_PLAYER : _POS_KEY_HOME }

function _applyContextPos() {
  var win = document.getElementById('chat-window')
  if (!win) return
  try {
    var saved = JSON.parse(localStorage.getItem(_posKey()) || 'null')
    if (saved && typeof saved.right === 'number' && typeof saved.bottom === 'number') {
      var maxR = Math.max(0, window.innerWidth  - win.offsetWidth)
      var maxB = Math.max(0, window.innerHeight - win.offsetHeight)
      win.style.left   = 'auto'
      win.style.top    = 'auto'
      win.style.right  = Math.max(0, Math.min(maxR, saved.right))  + 'px'
      win.style.bottom = Math.max(0, Math.min(maxB, saved.bottom)) + 'px'
    } else if (saved && typeof saved.left === 'number') {
      var r2 = Math.max(0, window.innerWidth  - saved.left - win.offsetWidth)
      var b2 = Math.max(0, window.innerHeight - saved.top  - win.offsetHeight)
      win.style.left   = 'auto'; win.style.top    = 'auto'
      win.style.right  = r2 + 'px'; win.style.bottom = b2 + 'px'
    } else {
      win.style.right = ''; win.style.bottom = ''; win.style.left = ''; win.style.top = ''
    }
  } catch (e) {}
}

function _initDrag() {
  var win      = document.getElementById('chat-window')
  var titlebar = win ? win.querySelector('.cw-titlebar') : null
  if (!win || !titlebar) return
  _applyContextPos()
  var dragging = false
  var startX, startY, startLeft, startTop
  titlebar.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return
    if (e.target.closest('.cw-icon-btn, .cw-back-btn')) return
    var rect  = win.getBoundingClientRect()
    startX    = e.clientX; startY    = e.clientY
    startLeft = rect.left; startTop  = rect.top
    win.style.right = 'auto'; win.style.bottom = 'auto'
    win.style.left  = startLeft + 'px'; win.style.top = startTop + 'px'
    win.style.transition = 'none'; win.style.userSelect = 'none'
    dragging = true; e.preventDefault()
  })
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return
    var newLeft = Math.max(0, Math.min(window.innerWidth  - win.offsetWidth,  startLeft + (e.clientX - startX)))
    var newTop  = Math.max(0, Math.min(window.innerHeight - win.offsetHeight, startTop  + (e.clientY - startY)))
    win.style.left = newLeft + 'px'; win.style.top = newTop + 'px'
  })
  document.addEventListener('mouseup', function () {
    if (!dragging) return
    dragging = false
    win.style.transition = ''; win.style.userSelect = ''
    var r    = win.getBoundingClientRect()
    var rVal = Math.max(0, window.innerWidth  - r.right)
    var bVal = Math.max(0, window.innerHeight - r.bottom)
    win.style.left = 'auto'; win.style.top = 'auto'
    win.style.right = rVal + 'px'; win.style.bottom = bVal + 'px'
    try { localStorage.setItem(_posKey(), JSON.stringify({ right: rVal, bottom: bVal })) } catch (e) {}
  })

  // ── Touch drag (mobile) ──────────────────────────────────────────────────
  titlebar.addEventListener('touchstart', function (e) {
    if (e.target.closest('.cw-icon-btn, .cw-back-btn')) return
    var t = e.touches[0]
    var rect  = win.getBoundingClientRect()
    startX    = t.clientX; startY    = t.clientY
    startLeft = rect.left; startTop  = rect.top
    win.style.right = 'auto'; win.style.bottom = 'auto'
    win.style.left  = startLeft + 'px'; win.style.top = startTop + 'px'
    win.style.transition = 'none'
    dragging = true
  }, { passive: true })
  document.addEventListener('touchmove', function (e) {
    if (!dragging) return
    var t = e.touches[0]
    var newLeft = Math.max(0, Math.min(window.innerWidth  - win.offsetWidth,  startLeft + (t.clientX - startX)))
    var newTop  = Math.max(0, Math.min(window.innerHeight - win.offsetHeight, startTop  + (t.clientY - startY)))
    win.style.left = newLeft + 'px'; win.style.top = newTop + 'px'
  }, { passive: true })
  document.addEventListener('touchend', function () {
    if (!dragging) return
    dragging = false
    win.style.transition = ''
    var r    = win.getBoundingClientRect()
    var rVal = Math.max(0, window.innerWidth  - r.right)
    var bVal = Math.max(0, window.innerHeight - r.bottom)
    win.style.left = 'auto'; win.style.top = 'auto'
    win.style.right = rVal + 'px'; win.style.bottom = bVal + 'px'
    try { localStorage.setItem(_posKey(), JSON.stringify({ right: rVal, bottom: bVal })) } catch (e) {}
  }, { passive: true })
}

// Contenedor correcto según si hay fullscreen activo
function _fsContainer() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.body
}

function _initFullscreenWatch() {
  function onFsChange() {
    // Solo mover el panel del chat; el float overlay ya vive dentro de .rp-shell
    var fs     = document.fullscreenElement || document.webkitFullscreenElement
    var target = fs || document.body
    var win    = document.getElementById('chat-window')
    if (win && win.parentNode !== target) target.appendChild(win)
    _updateFloatOverlay()
  }
  document.addEventListener('fullscreenchange',       onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
}

// ─── Resize ───────────────────────────────────────────────────────────────────
window._initWindowResize = function (winId, minW, minH, sizeKey) {
  var win = document.getElementById(winId)
  if (!win) return

  // Restaurar tamaño guardado
  try {
    var saved = JSON.parse(localStorage.getItem(sizeKey) || 'null')
    if (saved && saved.w >= minW && saved.h >= minH) {
      win.style.width  = saved.w + 'px'
      win.style.height = saved.h + 'px'
    }
  } catch (e) {}
  win.style.maxHeight = 'none'
  win.style.maxWidth  = 'none'

  // Inyectar handles
  ;['n','s','e','w','ne','nw','se','sw'].forEach(function (d) {
    var h = document.createElement('div')
    h.className = 'rz-handle rz-' + d
    h.dataset.rzDir = d
    win.appendChild(h)
  })

  var _rz = false, _dir, _sx, _sy, _sw, _sh, _sl, _st

  win.addEventListener('mousedown', function (e) {
    var handle = e.target.closest('.rz-handle')
    if (!handle) return
    e.preventDefault()
    e.stopPropagation()
    _rz   = true
    _dir  = handle.dataset.rzDir
    _sx   = e.clientX
    _sy   = e.clientY
    var r = win.getBoundingClientRect()
    _sw = r.width;  _sh = r.height
    _sl = r.left;   _st = r.top
    win.style.right  = 'auto'; win.style.bottom = 'auto'
    win.style.left   = _sl + 'px'; win.style.top = _st + 'px'
    win.style.width  = _sw + 'px'; win.style.height = _sh + 'px'
    win.style.transition = 'none'; win.style.userSelect = 'none'
  })

  document.addEventListener('mousemove', function (e) {
    if (!_rz) return
    var dx = e.clientX - _sx, dy = e.clientY - _sy
    var mxW = window.innerWidth - 20, mxH = window.innerHeight - 20
    var nW = _sw, nH = _sh, nL = _sl, nT = _st

    if (_dir.includes('e')) nW = Math.max(minW, Math.min(mxW, _sw + dx))
    if (_dir.includes('s')) nH = Math.max(minH, Math.min(mxH, _sh + dy))
    if (_dir.includes('w')) { nW = Math.max(minW, Math.min(mxW, _sw - dx)); nL = _sl + _sw - nW }
    if (_dir.includes('n')) { nH = Math.max(minH, Math.min(mxH, _sh - dy)); nT = _st + _sh - nH }

    win.style.width  = nW + 'px'; win.style.height = nH + 'px'
    win.style.left   = nL + 'px'; win.style.top    = nT + 'px'
  })

  document.addEventListener('mouseup', function () {
    if (!_rz) return
    _rz = false
    win.style.transition = ''
    win.style.userSelect = ''
    try { localStorage.setItem(sizeKey, JSON.stringify({ w: win.offsetWidth, h: win.offsetHeight })) } catch (e) {}
  })
}

// ─── Boot ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function () {
  _init()
  _initDrag()
  _initFullscreenWatch()
  if (window._initWindowResize) window._initWindowResize('chat-window', 280, 200, 'ryoku-chat-size-v1')

  var pageInicio = document.getElementById('page-inicio')
  var appAnime   = document.getElementById('app-anime')
  var pageMangaI = document.getElementById('page-manga-inicio')
  var appManga   = document.getElementById('app-manga')
  if (pageInicio) new MutationObserver(function () { _updateFAB() }).observe(pageInicio, { attributes: true, attributeFilter: ['class'] })
  if (appAnime)   new MutationObserver(function () { _updateFAB() }).observe(appAnime,   { attributes: true, attributeFilter: ['style'] })
  if (pageMangaI) new MutationObserver(function () { _updateFAB() }).observe(pageMangaI, { attributes: true, attributeFilter: ['class'] })
  if (appManga)   new MutationObserver(function () { _updateFAB() }).observe(appManga,   { attributes: true, attributeFilter: ['style'] })
})

})();
