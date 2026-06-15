'use strict'
;(function () {

var _db          = null
var _auth        = null
var _currentUser = null
var _viewingUid  = null
var _isOwn       = false
var _profileData = {}
var _favPicker   = false

var BANNER_COLORS = [
  '#1e1b4b','#1e3a5f','#1a3a2a','#3b1f1f',
  '#2d1b4e','#1f2d3b','#3b2a1a','#1f3b35'
]

// Normaliza cualquier valor CSS de posición a [pctX, pctY] (0-100)
function _normPos(pos) {
  if (!pos) return [50, 50]
  var kw = { left: 0, center: 50, right: 100, top: 0, bottom: 100 }
  var parts = pos.trim().split(/\s+/)
  function toNum(s) {
    if (s.indexOf('%') !== -1) return parseFloat(s)
    return kw[s] !== undefined ? kw[s] : 50
  }
  if (parts.length === 1) return [toNum(parts[0]), 50]
  return [toNum(parts[0]), toNum(parts[1])]
}

function _init() {
  var tryInit = function () {
    _db   = window._ryokuDb
    _auth = window._ryokuAuth
    if (!_db || !_auth) { setTimeout(tryInit, 500); return }
    _auth.onAuthStateChanged(function (u) { _currentUser = u })
  }
  tryInit()
}

// ─── Abrir perfil ─────────────────────────────────────────────────────────────
window.abrirPerfil = async function (uid, isOwn) {
  if (!_db) return
  _viewingUid = uid || (_currentUser && _currentUser.uid)
  if (!_viewingUid) return
  _isOwn = isOwn !== undefined ? isOwn : (_currentUser && _currentUser.uid === _viewingUid)

  var ov = document.getElementById('overlay-perfil')
  if (!ov) return
  ov.style.display = 'flex'
  _renderSkeleton()

  try {
    var doc = await _db.collection('users').doc(_viewingUid).get()
    _profileData = doc.data() || {}
    var historial = []
    try { historial = (await window.api.getHistorial()) || [] } catch(e){}
    _profileData._historial = historial
    // Sincronizar foto de perfil en sidebar al abrir perfil propio
    if (_isOwn && _profileData.avatarURL && window._authSetAvatarURL) {
      window._authSetAvatarURL(_profileData.avatarURL)
    }
    _renderPerfil()
  } catch (e) {
    console.error('[profile] load error', e)
  }
}

window.cerrarPerfil = function () {
  var ov = document.getElementById('overlay-perfil')
  if (ov) ov.style.display = 'none'
  _favPicker = false
  _viewingUid = null
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function _renderSkeleton() {
  var panel = document.getElementById('perfil-panel')
  if (!panel) return
  panel.innerHTML =
    '<div class="pf-banner" style="background:#1e1b4b"></div>' +
    '<div class="pf-header">' +
      '<div class="pf-avatar-wrap"><div class="pf-avatar pf-sk" style="width:72px;height:72px;border-radius:50%"></div></div>' +
      '<div style="padding:0 20px 20px">' +
        '<div class="pf-sk" style="width:140px;height:18px;border-radius:6px;margin-bottom:8px"></div>' +
        '<div class="pf-sk" style="width:90px;height:13px;border-radius:6px"></div>' +
      '</div>' +
    '</div>'
}

// ─── Render principal ─────────────────────────────────────────────────────────
function _renderPerfil() {
  var panel = document.getElementById('perfil-panel')
  if (!panel) return

  var d         = _profileData
  var name      = d.customName || d.displayName || 'Usuario'
  var uname     = d.username   ? '@' + d.username : ''
  var bio       = d.bio        || ''
  var banner    = d.bannerColor || BANNER_COLORS[0]
  var accent    = d.accentColor || '#7C3AED'
  var frame      = d.frameColor  || accent
  var isAnimFrame = frame.indexOf('animated:') === 0
  if (isAnimFrame) _ensureAnimFrameStyles()
  // @usuario badge: usa el color del marco (c1 para animados, el color sólido, o accent como fallback)
  var badgeColor
  if (isAnimFrame) {
    var _animF2 = FRAME_ANIMATED.filter(function(f){ return f.id === frame })[0]
    badgeColor = _animF2 ? _animF2.c1 : accent
  } else if (frame === 'none' || frame.indexOf('gradient') !== -1) {
    badgeColor = accent
  } else {
    badgeColor = frame
  }
  // Color del nombre visible: opción independiente guardada por el usuario
  var nameColor = d.nameColor || '#ffffff'
  var favorites = d.favorites  || []
  var historial = d._historial || []
  var pub       = d.profilePublic !== false
  var bannerPos   = d.bannerPosition || 'center center'
  var avatarPos   = d.avatarPosition || 'center center'
  var bannerScale = d.bannerScale || 1

  // Stats — completados desde localStorage
  var animeCompletados = []
  var mangaCompletados = []
  try { animeCompletados = JSON.parse(localStorage.getItem('ryoku-completados-anime') || '[]') } catch (e) {}
  try { mangaCompletados = JSON.parse(localStorage.getItem('ryoku-completados-manga') || '[]') } catch (e) {}

  var epsCount = historial.length

  // Avatar
  var photoURL   = d.avatarURL || d.photoURL || (_currentUser && _isOwn ? _currentUser.photoURL : null)
  var avatarScale = d.avatarScale || 1
  var avatarHTML = photoURL
    ? '<div style="width:100%;height:100%;border-radius:50%;background-image:url(' + photoURL + ');background-size:' + Math.round(avatarScale * 100) + '%;background-position:' + avatarPos + ';background-repeat:no-repeat;"></div>'
    : '<span style="font-size:26px;font-weight:500;color:#fff">' + name.slice(0,2).toUpperCase() + '</span>'

  // Edit button (own profile)
  var editBannerBtn = _isOwn
    ? '<button class="pf-banner-edit-btn" onclick="window._profileEditBanner()" title="Cambiar banner">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        ' Editar banner' +
      '</button>'
    : ''

  // Favorites HTML
  var favsHTML = ''
  for (var i = 0; i < 4; i++) {
    var fav = favorites[i]
    if (fav) {
      var removeBtn = _isOwn
        ? '<button class="pf-fav-remove" onclick="window._profileRemoveFav(' + i + ')" title="Quitar">✕</button>'
        : ''
      favsHTML += '<div class="pf-fav-slot filled" style="position:relative">' +
        (fav.image ? '<img src="' + fav.image + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px" />' :
          '<div style="width:100%;height:100%;border-radius:8px;background:#2a2a3a;display:flex;align-items:center;justify-content:center;font-size:11px;color:rgba(255,255,255,.5);text-align:center;padding:4px">' + fav.title + '</div>') +
        '<div class="pf-fav-title">' + fav.title + '</div>' +
        removeBtn +
      '</div>'
    } else {
      favsHTML += _isOwn
        ? '<div class="pf-fav-slot empty" onclick="window._profileOpenFavPicker(' + i + ')">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
          '</div>'
        : '<div class="pf-fav-slot empty" style="cursor:default;opacity:.3"></div>'
    }
  }

  // Privacy badge (own only)
  var privHTML = _isOwn
    ? '<button class="pf-privacy-btn" id="pf-privacy-btn" onclick="window._profileTogglePrivacy()">' +
        (pub ? '🌐 Perfil público' : '🔒 Solo amigos') +
      '</button>'
    : ''

  panel.innerHTML =
    '<div class="pf-banner" style="background:' + banner + (_profileData.bannerURL ? ';background-image:url(' + _profileData.bannerURL + ');background-size:' + Math.round(bannerScale*100) + '%;background-position:' + bannerPos + ';background-repeat:no-repeat' : '') + '">' +
      editBannerBtn +
      '<button class="pf-close-btn" onclick="window.cerrarPerfil()">✕</button>' +
      '<div class="pf-avatar-in-banner">' +
        '<div class="pf-avatar" style="' + (isAnimFrame ? 'border:none;position:relative;overflow:visible;' : frame === 'none' ? 'border:none;' : frame.indexOf('gradient') !== -1 ? 'border:3px solid transparent;background-image:linear-gradient(var(--bg-2,#111827),var(--bg-2,#111827)),' + frame + ';background-origin:border-box;background-clip:padding-box,border-box;' : 'border-color:' + frame + ';') + (_isOwn ? 'cursor:pointer;' : '') + '" ' + (_isOwn ? 'onclick="window._profileEditAvatar()" title="Cambiar avatar"' : '') + '>' + avatarHTML + (_isOwn ? '<div class="pf-avatar-overlay"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>' : '') + (isAnimFrame ? _getAnimatedFrameSVG(frame) : '') + '</div>' +
      '</div>' +
    '</div>' +

    '<div class="pf-header">' +
      '<div class="pf-info">' +
        (_isOwn
          ? '<span class="pf-name pf-name-editable" title="Clic para editar" onclick="window._profileEditName(this)" style="color:' + nameColor + '">' + _escapeHtml(name) + '</span>'
          : '<span class="pf-name" style="color:' + nameColor + '">' + _escapeHtml(name) + '</span>') +
        '<div class="pf-meta-row">' +
          (uname
            ? (_isOwn
                ? '<span class="pf-uname pf-uname-editable" title="Clic para editar" onclick="window._profileEditUname(this)" style="color:' + badgeColor + ';background:' + badgeColor + '22;border-color:' + badgeColor + '44">' + _escapeHtml(uname) + '</span>'
                : '<span class="pf-uname" style="color:' + badgeColor + ';background:' + badgeColor + '22;border-color:' + badgeColor + '44">' + _escapeHtml(uname) + '</span>')
            : (_isOwn ? '<span class="pf-uname pf-uname-editable" style="opacity:.5" title="Agregar nombre de usuario" onclick="window._profileEditUname(this)">+ @usuario</span>' : '')) +
          privHTML +
        '</div>' +
        (bio
          ? '<p class="pf-bio" id="pf-bio-text"' + (_isOwn ? ' onclick="window._profileEditBio()" title="Clic para editar" style="cursor:pointer"' : '') + '>' + _escapeHtml(bio) + '</p>'
          : (_isOwn
              ? '<p class="pf-bio pf-bio-placeholder" id="pf-bio-text" onclick="window._profileEditBio()">+ Agregar bio</p>'
              : '')) +
        (_isOwn
          ? '<div class="pf-edit-row">' +
              '<button class="pf-edit-btn" onclick="window._profileOpenFramePicker()">Marco del avatar</button>' +
            '</div>'
          : '') +
      '</div>' +
    '</div>' +

    '<div class="pf-stats-row">' +
      '<div class="pf-stat"><div class="pf-stat-n">' + animeCompletados.length + '</div><div class="pf-stat-l">Anime</div></div>' +
      '<div class="pf-stat"><div class="pf-stat-n">' + mangaCompletados.length + '</div><div class="pf-stat-l">Manga</div></div>' +
      '<div class="pf-stat"><div class="pf-stat-n">' + epsCount + '</div><div class="pf-stat-l">Eps vistos</div></div>' +
    '</div>' +

    '<div class="pf-section">' +
      '<div class="pf-section-label">Favoritos</div>' +
      '<div class="pf-favs-grid">' + favsHTML + '</div>' +
    '</div>' +

    '<div id="pf-bio-form" style="display:none" class="pf-section">' +
      '<textarea id="pf-bio-input" class="pf-bio-input" placeholder="Escribe algo sobre ti... (hasta 300 caracteres)" maxlength="300"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="pf-save-btn" onclick="window._profileSaveBio()">Guardar</button>' +
        '<button class="pf-cancel-btn" onclick="window._profileCancelBio()">Cancelar</button>' +
      '</div>' +
    '</div>' +

    '<div id="pf-color-picker" style="display:none" class="pf-section">' +
      '<div class="pf-section-label">Color de acento del perfil</div>' +
      '<div class="pf-color-row">' + _colorPickerHTML(accent) + '</div>' +
    '</div>' +

    '<div id="pf-frame-picker" style="display:none" class="pf-section">' +
      '<div class="pf-section-label">Marco del avatar</div>' +
      '<div class="pf-color-row" style="flex-wrap:wrap;gap:10px">' + _framePickerHTML(frame) + '</div>' +
    '</div>' +

    '<div id="pf-banner-picker" style="display:none" class="pf-section">' +
      '<div class="pf-section-label">Banner — color</div>' +
      '<div class="pf-color-row">' + _bannerPickerHTML(banner) + '</div>' +
      '<div class="pf-section-label" style="margin-top:10px">Banner — imagen o GIF (URL)</div>' +
      '<div style="display:flex;gap:8px">' +
        '<input id="pf-banner-url-input" class="pf-bio-input" style="min-height:auto;padding:8px 10px;font-size:13px;flex:1" type="text" placeholder="https://..." value="' + (_profileData.bannerURL || '') + '" />' +
        '<button class="pf-save-btn" style="flex:0;padding:8px 14px" onclick="window._profileSaveBannerURL()">OK</button>' +
      '</div>' +
      (_profileData.bannerURL
        ? '<div id="pf-banner-pos-btn-wrap" style="margin-top:10px">' +
            '<button class="pf-edit-btn" onclick="window._profileOpenPosModal(\'banner\')">✦ Ajustar encuadre del banner</button>' +
          '</div>'
        : '') +
    '</div>' +

    '<div id="pf-fav-picker" style="display:none" class="pf-section">' +
      '<div class="pf-section-label">Seleccionar favorito</div>' +
      '<div id="pf-fav-list" class="pf-fav-picker-list"></div>' +
    '</div>'
}

function _escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ─── Color pickers ────────────────────────────────────────────────────────────
var ACCENT_COLORS = ['#7C3AED','#2563EB','#E11D48','#059669','#EA580C','#0891B2','#D97706','#DB2777']
var FRAME_COLORS  = [
  'none',
  '#7C3AED','#2563EB','#06B6D4','#10B981','#22C55E',
  '#F59E0B','#EF4444','#EC4899','#F97316',
  '#ffffff','#94A3B8','#1E293B',
  'linear-gradient(135deg,#f97316,#ec4899)',
  'linear-gradient(135deg,#7C3AED,#2563EB)',
  'linear-gradient(135deg,#06B6D4,#10B981)',
  'linear-gradient(135deg,#F59E0B,#EF4444)'
]
var FRAME_ANIMATED = [
  { id: 'animated:miku', label: 'Hatsune Miku', c1: '#39C5BB', c2: '#00BFFF', c3: '#86CECB', bg: '#030f10' },
  { id: 'animated:neru', label: 'Akita Neru',   c1: '#F5D800', c2: '#FF8C00', c3: '#FFD700', bg: '#110d00' },
  { id: 'animated:teto', label: 'Kasane Teto',  c1: '#FF4444', c2: '#FF88AA', c3: '#FFB3B3', bg: '#1a0005' }
]

function _ensureAnimFrameStyles() {
  if (document.getElementById('pf-anim-frame-style')) return
  var s = document.createElement('style')
  s.id = 'pf-anim-frame-style'
  s.textContent =
    '@keyframes pf-sp{to{transform:rotate(360deg)}}' +
    '@keyframes pf-tw{0%,100%{opacity:.2;transform:scale(.6)}50%{opacity:1;transform:scale(1)}}' +
    '@keyframes pf-nt{0%,100%{opacity:.4;transform:translateY(0)}50%{opacity:1;transform:translateY(-4px)}}'
  document.head.appendChild(s)
}

function _getAnimatedFrameSVG(frameId) {
  var f = FRAME_ANIMATED.filter(function(x){ return x.id === frameId })[0]
  if (!f) return ''
  // SVG 96×96, center (48,48), avatar r=38, rings r=42 (pegados al borde)
  return '<svg id="pf-anim-frame-svg" viewBox="0 0 96 96" width="96" height="96" xmlns="http://www.w3.org/2000/svg" ' +
    'style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:10;overflow:visible">' +
    // anillo 1 principal
    '<circle cx="48" cy="48" r="42" fill="none" stroke="' + f.c1 + '" stroke-width="3" stroke-dasharray="35 54" stroke-linecap="round" ' +
      'style="transform-origin:48px 48px;animation:pf-sp 11s linear infinite"/>' +
    // anillo 2 contra-giro
    '<circle cx="48" cy="48" r="42" fill="none" stroke="' + f.c2 + '" stroke-width="1.6" stroke-dasharray="15 107" stroke-linecap="round" opacity=".85" ' +
      'style="transform-origin:48px 48px;animation:pf-sp 8s linear infinite reverse"/>' +
    // anillo 3 puntos finos
    '<circle cx="48" cy="48" r="42" fill="none" stroke="' + f.c3 + '" stroke-width="1" stroke-dasharray="4 157" stroke-linecap="round" opacity=".7" ' +
      'style="transform-origin:48px 48px;animation:pf-sp 5s linear infinite"/>' +
    // punto top
    '<circle cx="48" cy="4"  r="3" fill="' + f.c1 + '"/>' +
    '<circle cx="48" cy="4"  r="3" fill="none" stroke="#fff" stroke-width=".5" opacity=".4"/>' +
    // puntos laterales
    '<circle cx="92" cy="48" r="2.5" fill="' + f.c2 + '"/>' +
    '<circle cx="4"  cy="48" r="2.5" fill="' + f.c2 + '"/>' +
    // punto bottom
    '<circle cx="48" cy="92" r="2.5" fill="' + f.c3 + '"/>' +
    // diamantes diagonales
    '<g transform="translate(13,13) rotate(45)"><rect x="-3" y="-3" width="6" height="6" fill="' + f.c1 + '"/></g>' +
    '<g transform="translate(83,13) rotate(45)"><rect x="-3" y="-3" width="6" height="6" fill="' + f.c2 + '"/></g>' +
    '<g transform="translate(13,83) rotate(45)"><rect x="-3" y="-3" width="6" height="6" fill="' + f.c2 + '"/></g>' +
    '<g transform="translate(83,83) rotate(45)"><rect x="-3" y="-3" width="6" height="6" fill="' + f.c1 + '"/></g>' +
    // destello top-right
    '<g transform="translate(83,20)" style="animation:pf-tw 2s ease-in-out infinite">' +
      '<line x1="0" y1="-4" x2="0" y2="4" stroke="' + f.c3 + '" stroke-width="1.1" stroke-linecap="round"/>' +
      '<line x1="-4" y1="0" x2="4" y2="0" stroke="' + f.c3 + '" stroke-width="1.1" stroke-linecap="round"/>' +
    '</g>' +
    // destello bottom-left
    '<g transform="translate(13,77)" style="animation:pf-tw 2.4s ease-in-out infinite .6s">' +
      '<line x1="0" y1="-4" x2="0" y2="4" stroke="' + f.c2 + '" stroke-width="1.1" stroke-linecap="round"/>' +
      '<line x1="-4" y1="0" x2="4" y2="0" stroke="' + f.c2 + '" stroke-width="1.1" stroke-linecap="round"/>' +
    '</g>' +
    '</svg>'
}

function _getAnimFrameJP(frameId) {
  if (frameId === 'animated:miku') return '初音ミク'
  if (frameId === 'animated:neru') return '亞北ネル'
  if (frameId === 'animated:teto') return '重音テト'
  return ''
}

function _colorPickerHTML(current) {
  return ACCENT_COLORS.map(function (c) {
    var active = c === current ? 'pf-color-dot active' : 'pf-color-dot'
    return '<div class="' + active + '" style="background:' + c + '" onclick="window._profileSetAccent(\'' + c + '\')" title="' + c + '"></div>'
  }).join('')
}

function _bannerPickerHTML(current) {
  return BANNER_COLORS.map(function (c) {
    var active = c === current ? 'pf-color-dot active' : 'pf-color-dot'
    return '<div class="' + active + '" style="background:' + c + ';width:32px;height:32px" onclick="window._profileSetBanner(\'' + c + '\')" title="' + c + '"></div>'
  }).join('')
}

function _framePickerHTML(current) {
  var html = FRAME_COLORS.map(function (c) {
    if (c === 'none') {
      var active = (c === current || !current || current.indexOf('animated:') !== 0) && current !== 'none' ? '' : (c === current || !current) ? ' active' : ''
      // 'none' activo solo si frame es exactamente 'none' o vacío
      var isActive = (!current || current === 'none') ? ' active' : ''
      return '<div class="pf-color-dot pf-frame-none' + isActive + '" onclick="window._profileSetFrame(\'none\')" title="Sin marco" style="background:var(--bg-4);border:2px dashed var(--border);position:relative">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</div>'
    }
    var isGrad = c.indexOf('gradient') !== -1
    var active = c === current ? ' active' : ''
    return '<div class="pf-color-dot' + active + '" style="background:' + c + ';width:28px;height:28px;border-radius:50%" onclick="window._profileSetFrame(\'' + c.replace(/'/g,'\\\'') + '\')" title="Marco"></div>'
  }).join('')
  // Sección de marcos animados
  html += '<div style="width:100%;font-size:11px;color:var(--text-2,#9ca3af);margin-top:8px;margin-bottom:4px;letter-spacing:.5px">✦ Marcos animados</div>'
  html += FRAME_ANIMATED.map(function (f) {
    var active = current === f.id ? ' active' : ''
    return '<div class="pf-color-dot' + active + '" title="' + f.label + '" ' +
      'onclick="window._profileSetFrame(\'' + f.id + '\')" ' +
      'style="background:linear-gradient(135deg,' + f.c1 + ',' + f.c2 + ');width:28px;height:28px;border-radius:50%;' +
      'display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1">✦</div>'
  }).join('')
  // Sección color del nombre
  var currentNameColor = (_profileData && _profileData.nameColor) || '#ffffff'
  var NAME_COLORS = ['#ffffff','#7C3AED','#2563EB','#06B6D4','#10B981','#22C55E','#F59E0B','#EF4444','#EC4899','#39C5BB','#F5D800','#FF4444']
  html += '<div style="width:100%;font-size:11px;color:var(--text-2,#9ca3af);margin-top:12px;margin-bottom:4px;letter-spacing:.5px">Color del nombre</div>'
  html += NAME_COLORS.map(function (c) {
    var isActive = c === currentNameColor ? ' active' : ''
    return '<div class="pf-color-dot' + isActive + '" title="' + c + '" ' +
      'onclick="window._profileSetNameColor(\'' + c + '\')" ' +
      'style="background:' + c + ';width:28px;height:28px;border-radius:50%;' + (c === '#ffffff' ? 'border:1px solid rgba(255,255,255,.2)' : '') + '"></div>'
  }).join('')
  return html
}

// ─── Bio ──────────────────────────────────────────────────────────────────────
window._profileEditBio = function () {
  var form  = document.getElementById('pf-bio-form')
  var input = document.getElementById('pf-bio-input')
  if (!form || !input) return
  input.value = _profileData.bio || ''
  form.style.display = 'block'
  input.focus()
}
window._profileCancelBio = function () {
  var form = document.getElementById('pf-bio-form')
  if (form) form.style.display = 'none'
}
window._profileSaveBio = async function () {
  if (!_currentUser || !_db) return
  var input = document.getElementById('pf-bio-input')
  if (!input) return
  var val = input.value.trim()
  await _db.collection('users').doc(_currentUser.uid).set({ bio: val }, { merge: true })
  _profileData.bio = val
  document.getElementById('pf-bio-form').style.display = 'none'
  var bioEl = document.getElementById('pf-bio-text')
  if (bioEl) {
    bioEl.textContent = val || '+ Agregar bio'
    bioEl.classList.toggle('pf-bio-placeholder', !val)
  }
}

// ─── Accent color ─────────────────────────────────────────────────────────────
window._profileOpenColorPicker = function () {
  var el = document.getElementById('pf-color-picker')
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'
  // close frame picker if open
  var fp = document.getElementById('pf-frame-picker')
  if (fp) fp.style.display = 'none'
}
window._profileOpenFramePicker = function () {
  var el = document.getElementById('pf-frame-picker')
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'
  // close accent picker if open
  var ap = document.getElementById('pf-color-picker')
  if (ap) ap.style.display = 'none'
}
window._profileSetFrame = async function (frameVal) {
  if (!_currentUser || !_db) return
  await _db.collection('users').doc(_currentUser.uid).set({ frameColor: frameVal }, { merge: true })
  _profileData.frameColor = frameVal

  var isAnim = frameVal.indexOf('animated:') === 0
  var avatar = document.querySelector('.pf-avatar')
  var wrap   = document.querySelector('.pf-avatar-in-banner')

  // Quitar SVG animado previo si existe
  var oldSvg = document.getElementById('pf-anim-frame-svg')
  if (oldSvg) oldSvg.remove()

  if (isAnim) {
    // Marco animado: sin borde + inyectar SVG dentro del propio .pf-avatar
    if (avatar) {
      avatar.style.border = 'none'
      avatar.style.backgroundImage = ''
      avatar.style.position = 'relative'
      avatar.style.overflow = 'visible'
      _ensureAnimFrameStyles()
      avatar.insertAdjacentHTML('beforeend', _getAnimatedFrameSVG(frameVal))
    }
  } else {
    var frame = frameVal === 'none' || !frameVal ? 'none' : frameVal
    if (avatar) {
      if (frame === 'none') {
        avatar.style.border = 'none'
        avatar.style.backgroundImage = ''
      } else if (frame.indexOf('gradient') !== -1) {
        avatar.style.border = '3px solid transparent'
        avatar.style.backgroundImage = 'linear-gradient(var(--bg-2,#111827),var(--bg-2,#111827)),' + frame
        avatar.style.backgroundOrigin = 'border-box'
        avatar.style.backgroundClip = 'padding-box,border-box'
      } else {
        avatar.style.border = ''
        avatar.style.borderColor = frame
        avatar.style.backgroundImage = ''
      }
    }
  }

  // Marcar swatch activo
  document.querySelectorAll('#pf-frame-picker .pf-color-dot').forEach(function (d) {
    d.classList.remove('active')
  })
  if (isAnim) {
    // Swatch animado: buscar por title
    var animInfo = FRAME_ANIMATED.filter(function(f){ return f.id === frameVal })[0]
    if (animInfo) {
      document.querySelectorAll('#pf-frame-picker .pf-color-dot').forEach(function (d) {
        if (d.title === animInfo.label) d.classList.add('active')
      })
    }
  } else {
    var swatchIdx = FRAME_COLORS.indexOf(frameVal)
    var swatches = document.querySelectorAll('#pf-frame-picker .pf-color-dot')
    if (swatches[swatchIdx]) swatches[swatchIdx].classList.add('active')
  }

  // Actualizar color del badge @username inmediatamente
  var _bc
  if (isAnim) {
    var _animInfoBc = FRAME_ANIMATED.filter(function(f){ return f.id === frameVal })[0]
    _bc = _animInfoBc ? _animInfoBc.c1 : (_profileData.accentColor || '#7C3AED')
  } else if (frameVal === 'none' || !frameVal || frameVal.indexOf('gradient') !== -1) {
    _bc = _profileData.accentColor || '#7C3AED'
  } else {
    _bc = frameVal
  }
  var unameEl = document.querySelector('.pf-uname')
  if (unameEl) {
    unameEl.style.color       = _bc
    unameEl.style.background  = _bc + '22'
    unameEl.style.borderColor = _bc + '44'
  }
}
window._profileSetNameColor = async function (color) {
  if (!_currentUser || !_db) return
  await _db.collection('users').doc(_currentUser.uid).set({ nameColor: color }, { merge: true })
  _profileData.nameColor = color
  // Actualizar inmediatamente sin re-render completo
  var nameEl = document.querySelector('.pf-name')
  if (nameEl) nameEl.style.color = color
  // Marcar swatch activo
  document.querySelectorAll('#pf-frame-picker .pf-color-dot[title^="#"]').forEach(function (d) {
    d.classList.toggle('active', d.title === color)
  })
}
window._profileSetAccent = async function (color) {
  if (!_currentUser || !_db) return
  await _db.collection('users').doc(_currentUser.uid).set({ accentColor: color }, { merge: true })
  _profileData.accentColor = color
  var avatar = document.querySelector('.pf-avatar')
  if (avatar) avatar.style.borderColor = color
  document.querySelectorAll('#pf-color-picker .pf-color-dot').forEach(function (d) {
    d.classList.toggle('active', d.style.background === color || d.title === color)
  })
}

// ─── Banner color ─────────────────────────────────────────────────────────────
window._profileEditBanner = function () {
  var el = document.getElementById('pf-banner-picker')
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'
}
window._profileSaveBannerURL = function () {
  var input = document.getElementById('pf-banner-url-input')
  if (!input || !_currentUser || !_db) return
  var url = input.value.trim()
  _db.collection('users').doc(_currentUser.uid).set({ bannerURL: url }, { merge: true })
    .then(function () {
      _profileData.bannerURL = url
      var bannerEl = document.querySelector('.pf-banner')
      if (bannerEl) {
        if (url) {
          bannerEl.style.backgroundImage = 'url(' + url + ')'
          bannerEl.style.backgroundSize = Math.round((_profileData.bannerScale||1)*100) + '%'
          bannerEl.style.backgroundPosition = _profileData.bannerPosition || 'center center'
          bannerEl.style.backgroundRepeat   = 'no-repeat'
        } else {
          bannerEl.style.backgroundImage    = ''
          bannerEl.style.backgroundSize     = ''
          bannerEl.style.backgroundPosition = ''
          bannerEl.style.backgroundRepeat   = ''
        }
      }
      // Mostrar/ocultar botón de ajuste de encuadre dinámicamente
      var pickerEl = document.getElementById('pf-banner-picker')
      if (pickerEl) {
        var existing = document.getElementById('pf-banner-pos-btn-wrap')
        if (url && !existing) {
          var wrap = document.createElement('div')
          wrap.id = 'pf-banner-pos-btn-wrap'
          wrap.style.marginTop = '10px'
          wrap.innerHTML = '<button class="pf-edit-btn" onclick="window._profileOpenPosModal(\'banner\')">✦ Ajustar encuadre del banner</button>'
          pickerEl.appendChild(wrap)
        } else if (!url && existing) {
          existing.remove()
        }
      }
    }).catch(function(e){ console.error('[profile] banner url error', e) })
}
window._profileSetBanner = async function (color) {
  if (!_currentUser || !_db) return
  await _db.collection('users').doc(_currentUser.uid).set({ bannerColor: color }, { merge: true })
  _profileData.bannerColor = color
  var banner = document.querySelector('.pf-banner')
  if (banner) banner.style.background = color
  document.querySelectorAll('#pf-banner-picker .pf-color-dot').forEach(function (d) {
    d.classList.toggle('active', d.title === color)
  })
}

// ─── Privacy ──────────────────────────────────────────────────────────────────
window._profileTogglePrivacy = async function () {
  if (!_currentUser || !_db) return
  var pub = _profileData.profilePublic !== false
  var newVal = !pub
  await _db.collection('users').doc(_currentUser.uid).set({ profilePublic: newVal }, { merge: true })
  _profileData.profilePublic = newVal
  var btn = document.getElementById('pf-privacy-btn')
  if (btn) btn.textContent = newVal ? '🌐 Perfil público' : '🔒 Solo amigos'
}

// ─── Edición inline de nombre visible ────────────────────────────────────────
window._profileEditName = function (span) {
  if (!_isOwn) return
  var current = _profileData.customName || _profileData.displayName || ''
  var input = document.createElement('input')
  input.className  = 'pf-inline-input pf-name-input'
  input.value      = current
  input.maxLength  = 30
  input.spellcheck = false
  span.replaceWith(input)
  input.focus()
  input.select()

  async function save() {
    var val = input.value.trim()
    if (!val || val === current) { _renderPerfil(); return }
    if (!_currentUser || !_db) { _renderPerfil(); return }
    try {
      await _db.collection('users').doc(_currentUser.uid).set({ customName: val }, { merge: true })
      _profileData.customName = val
      if (window._authSaveCustomNameDirect) window._authSaveCustomNameDirect(val)
    } catch(e) { console.error('[profile] save name error', e) }
    _renderPerfil()
  }

  input.addEventListener('blur', save)
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { input.blur() }
    if (e.key === 'Escape') { _renderPerfil() }
  })
}

// ─── Edición inline de @username ─────────────────────────────────────────────
window._profileEditUname = function (span) {
  if (!_isOwn) return
  var current = _profileData.username || ''
  var input = document.createElement('input')
  input.className  = 'pf-inline-input pf-uname-input'
  input.value      = current
  input.maxLength  = 20
  input.placeholder = '@usuario'
  input.spellcheck  = false
  span.replaceWith(input)
  input.focus()
  input.select()

  async function save() {
    var raw = input.value.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!raw || raw === current) { _renderPerfil(); return }
    if (raw.length < 3) { _renderPerfil(); return }
    if (!_currentUser || !_db) { _renderPerfil(); return }
    try {
      var snap = await _db.collection('users').where('username', '==', raw).limit(1).get()
      if (!snap.empty && snap.docs[0].id !== _currentUser.uid) {
        // ya en uso — revertir sin cambiar
        _renderPerfil(); return
      }
      await _db.collection('users').doc(_currentUser.uid).set({ username: raw }, { merge: true })
      _profileData.username = raw
    } catch(e) { console.error('[profile] save username error', e) }
    _renderPerfil()
  }

  input.addEventListener('blur', save)
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { input.blur() }
    if (e.key === 'Escape') { _renderPerfil() }
  })
}


// ─── Favoritos ────────────────────────────────────────────────────────────────
var _favSlotIndex = 0

window._profileOpenFavPicker = async function (slotIdx) {
  _favSlotIndex = slotIdx
  var picker = document.getElementById('pf-fav-picker')
  var list   = document.getElementById('pf-fav-list')
  if (!picker || !list) return
  picker.style.display = 'block'
  list.innerHTML = '<div style="color:rgba(255,255,255,.4);font-size:13px;padding:8px 0">Cargando...</div>'

  // Cargar solo favoritos guardados
  var items = []
  try {
    var favs = (await window.api.getFavs()) || []
    favs.forEach(function (f) {
      items.push({ type: 'anime', title: f.titulo || f.title || '', image: f.imagen || f.image || '', url: f.link || f.url || '' })
    })
  } catch(e){}

  if (!items.length) {
    list.innerHTML = '<div style="color:rgba(255,255,255,.4);font-size:13px;padding:8px 0">No hay items en tu biblioteca todavía.</div>'
    return
  }

  list.innerHTML = items.map(function (item, idx) {
    return '<div class="pf-fav-pick-item" onclick="window._profileSelectFav(' + idx + ')">' +
      (item.image
        ? '<img src="' + item.image + '" />'
        : '<div class="pf-fav-pick-thumb-empty">🎬</div>') +
      '<span class="pf-fav-pick-title">' + _escapeHtml(item.title) + '</span>' +
    '</div>'
  }).join('')

  // Store items temporarily
  window._pfPickerItems = items
}

window._profileSelectFav = async function (itemIdx) {
  if (!_currentUser || !_db) return
  var items = window._pfPickerItems || []
  var item  = items[itemIdx]
  if (!item) return

  var favorites = (_profileData.favorites || []).slice()
  while (favorites.length < 4) favorites.push(null)
  favorites[_favSlotIndex] = { type: item.type, title: item.title, image: item.image, url: item.url }

  await _db.collection('users').doc(_currentUser.uid).set({ favorites: favorites }, { merge: true })
  _profileData.favorites = favorites
  document.getElementById('pf-fav-picker').style.display = 'none'
  _renderPerfil()
}

window._profileRemoveFav = async function (idx) {
  if (!_currentUser || !_db) return
  var favorites = (_profileData.favorites || []).slice()
  favorites[idx] = null
  await _db.collection('users').doc(_currentUser.uid).set({ favorites: favorites }, { merge: true })
  _profileData.favorites = favorites
  _renderPerfil()
}

// ─── Avatar URL ──────────────────────────────────────────────────────────────────
window._profileEditAvatar = function () {
  var existing = document.getElementById('pf-avatar-url-section')
  if (existing) { existing.style.display = existing.style.display === 'none' ? 'block' : 'none'; return }
  // Inject inline form below the header
  var header = document.querySelector('.pf-header')
  if (!header) return
  var section = document.createElement('div')
  section.id = 'pf-avatar-url-section'
  section.className = 'pf-section'
  section.style.borderTop = '1px solid rgba(255,255,255,.06)'
  section.innerHTML =
    '<div class="pf-section-label">URL de avatar (imagen o GIF)</div>' +
    '<input id="pf-avatar-url-input" class="pf-bio-input" style="min-height:auto;padding:8px 10px;font-size:13px" ' +
      'type="text" placeholder="https://..." value="' + (_profileData.avatarURL || '') + '" />' +
    '<div style="display:flex;gap:8px;margin-top:8px">' +
      '<button class="pf-save-btn" onclick="window._profileSaveAvatarURL()">Guardar</button>' +
      '<button class="pf-cancel-btn" onclick="window._profileHideAvatarForm()">Cancelar</button>' +
    '</div>' +
    (_profileData.avatarURL
      ? '<div style="margin-top:8px">' +
          '<button class="pf-edit-btn" onclick="window._profileOpenPosModal(\'avatar\')">✦ Ajustar encuadre del avatar</button>' +
        '</div>'
      : '')
  header.after(section)
  document.getElementById('pf-avatar-url-input').focus()
}

window._profileHideAvatarForm = function () {
  var s = document.getElementById('pf-avatar-url-section')
  if (s) s.style.display = 'none'
}

window._profileSaveAvatarURL = function () {
  var input = document.getElementById('pf-avatar-url-input')
  if (!input || !_currentUser || !_db) return
  var url = input.value.trim()
  _db.collection('users').doc(_currentUser.uid).set({ avatarURL: url }, { merge: true })
    .then(function () {
      _profileData.avatarURL = url
      if (window._authSetAvatarURL) window._authSetAvatarURL(url)
      _renderPerfil()
    }).catch(function (e) { console.error('[profile] avatar error', e) })
}

// ─── Modal de encuadre (drag-to-crop + zoom) ─────────────────────────────────
window._profileOpenPosModal = function (prefix) {
  if (document.getElementById('pf-pos-modal')) return
  var isAvatar = prefix === 'avatar'
  var url = isAvatar
    ? (_profileData.avatarURL || (_currentUser && _currentUser.photoURL) || '')
    : (_profileData.bannerURL || '')
  if (!url) return

  var saved = isAvatar ? (_profileData.avatarPosition || 'center center') : (_profileData.bannerPosition || 'center center')
  var xy    = _normPos(saved)
  var pctX  = xy[0]
  var pctY  = xy[1]
  var zoom  = parseFloat(isAvatar ? (_profileData.avatarScale || 1) : (_profileData.bannerScale || 1)) || 1

  // Preview: ambos usan background-image para uniformidad con zoom
  var previewStyle = isAvatar
    ? 'width:160px;height:160px;border-radius:50%;border:2px solid var(--border);cursor:grab;flex-shrink:0;user-select:none;'
    : 'width:100%;height:110px;border-radius:10px;border:1px solid var(--border);cursor:grab;user-select:none;'
  previewStyle += 'background-image:url(' + url + ');background-size:' + (zoom*100) + '%;background-position:' + pctX + '% ' + pctY + '%;background-repeat:no-repeat;'

  var modal = document.createElement('div')
  modal.id = 'pf-pos-modal'
  modal.innerHTML =
    '<div class="pf-pos-modal-box">' +
      '<div class="pf-pos-modal-title">' + (isAvatar ? 'Encuadrar foto de perfil' : 'Encuadrar banner') + '</div>' +
      '<div class="pf-pos-modal-hint">Arrastra para mover · Rueda del mouse para zoom</div>' +
      '<div id="pf-pos-preview-wrap" style="' + (isAvatar ? 'display:flex;justify-content:center' : '') + '">' +
        '<div id="pf-pos-el" style="' + previewStyle + '"></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:10px">' +
        '<i class="ti ti-zoom-out" style="color:var(--text-2);font-size:14px"></i>' +
        '<input id="pf-zoom-slider" type="range" min="100" max="400" step="5" value="' + Math.round(zoom*100) + '" style="flex:1;accent-color:var(--primary)">' +
        '<i class="ti ti-zoom-in" style="color:var(--text-2);font-size:14px"></i>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">' +
        '<button class="pf-cancel-btn" onclick="window._profileClosePosModal()">Cancelar</button>' +
        '<button class="pf-save-btn" onclick="window._profileSavePosFromModal(\'' + prefix + '\')">Guardar</button>' +
      '</div>' +
    '</div>'

  document.body.appendChild(modal)
  modal.addEventListener('mousedown', function (e) { if (e.target === modal) window._profileClosePosModal() })

  var el     = document.getElementById('pf-pos-el')
  var slider = document.getElementById('pf-zoom-slider')

  function applyTransform() {
    el.style.backgroundSize     = (zoom * 100) + '%'
    el.style.backgroundPosition = pctX + '% ' + pctY + '%'
    if (slider) slider.value = Math.round(zoom * 100)
  }

  // Slider
  slider.addEventListener('input', function () {
    zoom = parseFloat(slider.value) / 100
    applyTransform()
  })

  // Rueda → zoom
  el.addEventListener('wheel', function (e) {
    e.preventDefault()
    zoom = Math.max(1, Math.min(4, zoom - e.deltaY * 0.002))
    applyTransform()
  }, { passive: false })

  // Drag → pan
  el.addEventListener('mousedown', function (e) {
    e.preventDefault()
    el.style.cursor = 'grabbing'
    var rect = el.getBoundingClientRect()
    var sx = e.clientX, sy = e.clientY, spx = pctX, spy = pctY
    function onMove(e) {
      var dx = e.clientX - sx, dy = e.clientY - sy
      var sensitivity = 100 / zoom
      pctX = Math.round(Math.max(0, Math.min(100, spx - dx / rect.width  * sensitivity)) * 10) / 10
      pctY = Math.round(Math.max(0, Math.min(100, spy - dy / rect.height * sensitivity)) * 10) / 10
      applyTransform()
    }
    function onUp() {
      el.style.cursor = 'grab'
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  })
}

window._profileClosePosModal = function () {
  var m = document.getElementById('pf-pos-modal')
  if (m) m.remove()
}

window._profileSavePosFromModal = function (prefix) {
  var el     = document.getElementById('pf-pos-el')
  var slider = document.getElementById('pf-zoom-slider')
  if (!el) return
  var pos   = el.style.backgroundPosition || '50% 50%'
  var scale = slider ? parseFloat(slider.value) / 100 : 1
  window._profileClosePosModal()
  _profileSavePos(prefix, pos, scale)
}

function _profileSavePos(prefix, pos, scale) {
  if (!_currentUser || !_db) return
  scale = scale || 1
  var posKey   = prefix === 'banner' ? 'bannerPosition' : 'avatarPosition'
  var scaleKey = prefix === 'banner' ? 'bannerScale'    : 'avatarScale'
  var update   = {}
  update[posKey]   = pos
  update[scaleKey] = scale
  _db.collection('users').doc(_currentUser.uid).set(update, { merge: true })
    .catch(function (e) { console.error('[profile] savePos error', e) })
  _profileData[posKey]   = pos
  _profileData[scaleKey] = scale
  // Aplicar en vivo
  if (prefix === 'banner') {
    var bannerEl = document.querySelector('.pf-banner')
    if (bannerEl) {
      bannerEl.style.backgroundPosition = pos
      bannerEl.style.backgroundSize     = (scale * 100) + '%'
    }
  } else {
    var avatarDiv = document.querySelector('.pf-avatar div[style*="background-image"]')
    if (avatarDiv) {
      avatarDiv.style.backgroundPosition = pos
      avatarDiv.style.backgroundSize     = Math.round(scale * 100) + '%'
    }
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function () { _init() })

})()
