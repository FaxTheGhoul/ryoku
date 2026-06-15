// modulos/core.js — Navegación, módulos, configuración, temas, fondo
// Requiere: utils.js

let _moduloActivo  = 'anime'


function navegar(pagina) {
  const esManga = pagina.startsWith('manga-')
  const appId   = esManga ? 'app-manga' : 'app-anime'
  const app     = document.getElementById(appId)
  if (!app) return

  app.querySelectorAll('.pagina').forEach(p => p.classList.remove('activa'))
  if (pagina === 'manga-lector') app.scrollTop = 0
  const page = document.getElementById(`page-${pagina}`)
  if (page) page.classList.add('activa')
  // Mostrar botones en titlebar solo en páginas de detalle
  const tbBtns = document.getElementById('titlebar-page-btns')
  if (tbBtns) tbBtns.style.display = (pagina==='anime'||pagina==='manga-detalle') ? 'flex' : 'none'

  const sidebarId = esManga ? 'sidebar-manga' : 'sidebar-anime'
  document.querySelectorAll(`#${sidebarId} .nav-btn`).forEach(b => {
    b.classList.toggle('activo', b.dataset.page === pagina)
  })

  if (pagina === 'favoritos') cargarFavoritos()
  if (pagina === 'historial') cargarHistorial()
  if (pagina === 'calendario') cargarCalendario()
  if (pagina === 'manga-inicio') { app.scrollTop = 0; cargarMangaTendencias() }
  if (pagina === 'manga-favoritos') cargarMangaFavoritos()
  if (pagina === 'manga-historial') cargarMangaHistorial()
}

function abrirSwitcherModulos() {
  const sw = document.querySelector('.sidebar-logo.mod-switcher')
  if (sw) { sw.classList.remove('clicked'); void sw.offsetWidth; sw.classList.add('clicked'); setTimeout(() => sw.classList.remove('clicked'), 580) }
  // Siempre volver al paso 1 al abrir
  document.getElementById('mod-ov-track')?.classList.remove('paso-2', 'paso-3')
  _syncModOverlaySrc()
  const ov = document.getElementById('overlay-modulos')
  ov.style.display = 'block'
  ov.classList.remove('closing')
  ov.classList.add('opening')
  // Cerrar chat y amigos al abrir el switcher
  if (window._chatClose)    window._chatClose()
  if (window._friendsClose) window._friendsClose()
}

function cerrarSwitcherModulos() {
  const ov = document.getElementById('overlay-modulos')
  ov.classList.remove('opening')
  ov.classList.add('closing')
  setTimeout(() => {
    ov.style.display = 'none'
    ov.classList.remove('closing')
  }, 200)
}

// ── Flujo de dos pasos para selección de fuente manga ─────────────────────
function abrirSeleccionFuenteManga() {
  _syncModOverlaySrc()
  document.getElementById('mod-ov-track')?.classList.add('paso-2')
}

function modOverlayBack() {
  document.getElementById('mod-ov-track')?.classList.remove('paso-2')
}

async function seleccionarFuenteManga(id) {
  if (window.api?.setMangaSource) await window.api.setMangaSource(id)
  window._activeMangaSource = id   // namespace para localStorage de manga
  if (typeof mnResetHomeCache === 'function') mnResetHomeCache()  // forzar recarga de tendencias
  if (typeof _mnBibSyncSource === 'function') _mnBibSyncSource(id)
  _syncModOverlaySrc(id)
  cerrarSwitcherModulos()
  activarModulo('manga')
}

async function _syncModOverlaySrc(idOverride) {
  const id = idOverride !== undefined ? idOverride : (await window.api?.getMangaSource?.())
  const srcMap = { zonatmo: 'zonatmo.org', novelcool: 'es.novelcool.com' }
  const srcEl = document.getElementById('modcard-manga-src')
  if (srcEl) srcEl.textContent = id ? srcMap[id] || id : 'Elige fuente'
  ;['zonatmo','novelcool'].forEach(s => {
    document.getElementById('modcard-src-' + s)?.classList.toggle('activo', s === id)
  })
  // Sync anime source display
  _syncAnimeOverlaySrc()
}

// ── Fuente anime ──────────────────────────────────────────────────────────
async function _syncAnimeOverlaySrc(idOverride) {
  const id = idOverride !== undefined ? idOverride : (await window.api?.getAnimeSource?.())
  const srcMap = { latanime: 'latanime.org', animeflv: 'animeflv.net' }
  const effectiveId = id || 'latanime'
  const srcEl = document.getElementById('modcard-anime-src')
  if (srcEl) srcEl.textContent = srcMap[effectiveId] || effectiveId
  ;['latanime','animeflv'].forEach(s => {
    document.getElementById('modcard-src-' + s)?.classList.toggle('activo', s === effectiveId)
  })
  // Reflect on the parent anime card too
  document.getElementById('modcard-anime')?.classList.toggle('activo', _moduloActivo === 'anime')
}

function abrirSeleccionFuenteAnime() {
  _syncModOverlaySrc()
  const track = document.getElementById('mod-ov-track')
  if (track) { track.classList.remove('paso-2'); track.classList.add('paso-3') }
}

function modOverlayAnimeBack() {
  document.getElementById('mod-ov-track')?.classList.remove('paso-3')
}

async function seleccionarFuenteAnime(id) {
  if (window.api?.setAnimeSource) await window.api.setAnimeSource(id)
  _syncAnimeOverlaySrc(id)
  cerrarSwitcherModulos()
  activarModulo('anime')
}

// Listeners nav-btn de ANIME
document.querySelectorAll('#sidebar-anime .nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.page === 'anime-biblioteca') abrirAnimeBiblioteca()
    else navegar(btn.dataset.page)
  })
})

// Listeners nav-btn de MANGA
document.querySelectorAll('#sidebar-manga .nav-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    // Si no hay fuente seleccionada, forzar selección primero
    const src = await window.api?.getMangaSource?.()
    if (!src) { abrirSwitcherModulos(); abrirSeleccionFuenteManga(); return }
    if (btn.dataset.page === 'manga-biblioteca') _mnBibAbrirConQuery('')
    else navegar(btn.dataset.page)
  })
})


function activarModulo(modulo) {
  cerrarSwitcherModulos()
  // Cerrar panel de amigos al cambiar de módulo
  if (window._friendsClose) window._friendsClose()
  _moduloActivo = modulo
  window.api?.configSet?.('lastModulo', modulo)
  // Discord: limpiar presencia al cambiar de módulo (no mostrar "Explorando...")
  if (window._ryokuDiscordActivity !== false) window.api?.discordClear?.()

  const appAnime = document.getElementById('app-anime')
  const appManga = document.getElementById('app-manga')
  appAnime.classList.toggle('activo', modulo === 'anime')
  appManga.classList.toggle('activo', modulo === 'manga')
  // Forzar display por si el CSS falla
  appAnime.style.setProperty('display', modulo === 'anime' ? 'block' : 'none', 'important')
  appManga.style.setProperty('display', modulo === 'manga' ? 'block' : 'none', 'important')

  // Mostrar sidebar correcto
  document.getElementById('sidebar-anime').style.display = modulo === 'anime' ? '' : 'none'
  document.getElementById('sidebar-manga').style.display = modulo === 'manga' ? '' : 'none'

  // Actualizar cards del overlay
  document.getElementById('modcard-anime')?.classList.toggle('activo', modulo === 'anime')
  document.getElementById('modcard-manga')?.classList.toggle('activo', modulo === 'manga')

  // Animación del switcher al cambiar módulo
  const sw = document.querySelector('.sidebar-logo.mod-switcher')
  if (sw) { sw.classList.remove('clicked'); void sw.offsetWidth; sw.classList.add('clicked'); setTimeout(() => sw.classList.remove('clicked'), 580) }

  // Cambiar icono del switcher
  const icon = document.getElementById('mod-switcher-icon')
  // Ocultar/mostrar PIP según módulo activo
  const _pip = document.getElementById('manga-pip')
  if (_pip) _pip.style.display = modulo === 'manga' ? '' : 'none'

  if (modulo === 'manga') {
    icon.innerHTML = `<img src="../assets/Manga.png" width="36" height="36" style="border-radius:8px;object-fit:contain" />`
    appManga.scrollTop = 0
    document.querySelectorAll('#app-manga .pagina').forEach(p => p.classList.remove('activa'))
    document.getElementById('page-manga-inicio')?.classList.add('activa')
    document.querySelectorAll('#sidebar-manga .nav-btn').forEach(b => b.classList.toggle('activo', b.dataset.page === 'manga-inicio'))
    _mostrarModuloLoading(
      `<img src="../assets/Manga.png" width="56" height="56" style="border-radius:14px;object-fit:contain" />`,
      'Cargando manga'
    )
    cargarMangaTendencias(_ocultarModuloLoading)
  } else {
    icon.innerHTML = `<img src="../assets/icon.png" width="36" height="36" style="border-radius:8px" />`
    document.querySelectorAll('#app-anime .pagina').forEach(p => p.classList.remove('activa'))
    document.getElementById('page-inicio')?.classList.add('activa')
    document.querySelectorAll('#sidebar-anime .nav-btn').forEach(b => b.classList.toggle('activo', b.dataset.page === 'inicio'))
    _mostrarModuloLoading(
      `<img src="../assets/icon.png" width="56" height="56" style="border-radius:14px" />`,
      'Cargando anime'
    )
    cargarRecientes(_ocultarModuloLoading)
  }
  // Refrescar avatar por si un evento transitorio de Firebase lo limpió durante el cambio
  if (window._authRefreshAvatar) window._authRefreshAvatar()
}

// CONTROLES VENTANA
// Inicializar botones titlebar con tb-line
;['btn-min','btn-max','btn-close'].forEach(id => {
  const b = document.getElementById(id); if(!b)return
  if(!b.querySelector('.tb-line')) { const l=document.createElement('span'); l.className='tb-line'; b.appendChild(l) }
})

// ── SISTEMA DE CONFIGURACIÓN GLOBAL ─────────────────────────────────────
const ACCENTS = {
  blue:   { primary:'#2563EB', hover:'#3B82F6', glow:'#60A5FA', dim:'rgba(37,99,235,0.15)', rgb:'37,99,235' },
  purple: { primary:'#7C3AED', hover:'#8B5CF6', glow:'#A78BFA', dim:'rgba(124,58,237,0.15)', rgb:'124,58,237' },
  rose:   { primary:'#E11D48', hover:'#F43F5E', glow:'#FB7185', dim:'rgba(225,29,72,0.15)', rgb:'225,29,72' },
  green:  { primary:'#059669', hover:'#10B981', glow:'#34D399', dim:'rgba(5,150,105,0.15)', rgb:'5,150,105' },
  orange: { primary:'#EA580C', hover:'#F97316', glow:'#FB923C', dim:'rgba(234,88,12,0.15)', rgb:'234,88,12' },
  cyan:   { primary:'#0891B2', hover:'#06B6D4', glow:'#22D3EE', dim:'rgba(8,145,178,0.15)', rgb:'8,145,178' },
  gold:   { primary:'#D97706', hover:'#F59E0B', glow:'#FCD34D', dim:'rgba(217,119,6,0.15)', rgb:'217,119,6' },
  pink:   { primary:'#DB2777', hover:'#EC4899', glow:'#F472B6', dim:'rgba(219,39,119,0.15)', rgb:'219,39,119' },
}
const MODOS = {
  oscuro: { main:'#0F172A', secondary:'#1E293B', card:'#111827', border:'#334155', textMain:'#F8FAFC', textSecondary:'#CBD5E1', textMuted:'#64748B' },
  claro:  { main:'#F1F5F9', secondary:'#E2E8F0', card:'#FFFFFF',  border:'#CBD5E1', textMain:'#0F172A', textSecondary:'#334155', textMuted:'#64748B' },
  oled:   { main:'#000000', secondary:'#0D1117', card:'#0A0A0A',  border:'#1F2937', textMain:'#F8FAFC', textSecondary:'#CBD5E1', textMuted:'#64748B' },
}

// Valores por defecto — se sobreescriben en initConfig()
let _appModo   = 'oscuro'
let _appAccent = 'blue'
let _app18             = false
let _activityShare     = true
let _discordActivity   = true
let _sidebarAutohide   = false
let _portadasMaxActual = 0  // 0 = automático
let _searchbarAutohide = false
let _appBgImage = null   // dataUrl de la imagen de fondo (cargada desde disco)

function setSidebarAutohide(val) {
  _sidebarAutohide = val; window.api.configSet('sidebar-autohide', val); _aplicarSidebarAutohide()
}

// ── Portadas visibles unificada (anime + manga) ─────────────────────────────
function setPortadasMax(n) {
  _portadasMaxActual = n
  // Actualizar anime
  if (typeof setContinuarMax === 'function') setContinuarMax(n)
  // Actualizar manga
  if (typeof setMnContinuarMax === 'function') setMnContinuarMax(n)
  // Resaltar botón en el nuevo grupo unificado (usa data-val para soportar "Auto" = 0)
  document.querySelectorAll('#cfg-portadas-max-group .cfg-num-btn').forEach(b => {
    b.classList.toggle('activo', parseInt(b.dataset.val ?? b.textContent) === n)
  })
}

// ── Estilo de listas (tarjetas / lista) ─────────────────────────────────────
function setListaEstilo(estilo) {
  window.api.configSet('lista-estilo', estilo)
  _aplicarListaEstilo(estilo)
  // Marcar botón activo
  document.querySelectorAll('#cfg-lista-estilo-group .cfg-num-btn').forEach(b => {
    b.classList.toggle('activo', (b.dataset.val || b.textContent.toLowerCase()) === estilo)
  })
}
function _aplicarListaEstilo(estilo) {
  document.body.dataset.listaEstilo = estilo || 'tarjetas'
}
function _aplicarSidebarAutohide() {
  const sidebar = document.getElementById('main-sidebar')
  if (!sidebar) return
  document.removeEventListener('mousemove', _sidebarMouseMove)
  if (_sidebarAutohide) {
    document.body.classList.add('sidebar-autohide')
    sidebar.classList.remove('visible')
    document.addEventListener('mousemove', _sidebarMouseMove)
  } else {
    document.body.classList.remove('sidebar-autohide')
    sidebar.classList.remove('visible')
  }
}
function _sidebarMouseMove(e) {
  const sidebar = document.getElementById('main-sidebar')
  if (!sidebar) return
  const playerAbierto = document.getElementById('overlay-player')?.classList.contains('activo')
  const mangaAbierto  = document.getElementById('page-manga-lector')?.classList.contains('activa')
  if (playerAbierto || mangaAbierto) {
    sidebar.classList.remove('visible')
    document.body.classList.remove('sidebar-open')
    return
  }
  if (e.clientX <= 60) {
    sidebar.classList.add('visible')
    document.body.classList.add('sidebar-open')
  } else if (e.clientX > 80) {
    sidebar.classList.remove('visible')
    document.body.classList.remove('sidebar-open')
  }
}
// mantener compatibilidad
let _sidebarJustLeft = false
function _sidebarShow() {}
function _sidebarHide() {}

function setSearchbarAutohide(val) {
  _searchbarAutohide = val; window.api.configSet('searchbar-autohide', val)
  document.body.classList.toggle('searchbar-autohide', val)
}

let _sidebarNeon = false
function setSidebarNeon(val) {
  _sidebarNeon = val; window.api.configSet('sidebar-neon', val)
  document.body.classList.toggle('sidebar-neon', val)
}

function _aplicarTema() {
  const m = MODOS[_appModo]   || MODOS.oscuro
  const a = ACCENTS[_appAccent] || ACCENTS.blue
  const r = document.documentElement
  r.style.setProperty('--bg-main',       m.main)
  r.style.setProperty('--bg-secondary',  m.secondary)
  r.style.setProperty('--bg-card',       m.card)
  r.style.setProperty('--bg-0',          m.main)
  r.style.setProperty('--bg-1',          m.main)
  r.style.setProperty('--bg-2',          m.card)
  r.style.setProperty('--bg-3',          m.secondary)
  r.style.setProperty('--border',        m.border)
  r.style.setProperty('--text-main',     m.textMain)
  r.style.setProperty('--text-secondary',m.textSecondary)
  r.style.setProperty('--text-1',        m.textMain)
  r.style.setProperty('--text-2',        m.textSecondary)
  r.style.setProperty('--text-3',        m.textMuted)
  r.style.setProperty('--text-muted',    m.textMuted)
  r.style.setProperty('--primary',       a.primary)
  r.style.setProperty('--primary-hover', a.hover)
  r.style.setProperty('--primary-glow',  a.glow)
  r.style.setProperty('--blue',          a.primary)
  r.style.setProperty('--blue-hover',    a.hover)
  r.style.setProperty('--blue-light',    a.glow)
  r.style.setProperty('--blue-dim',      a.dim)
  if (a.rgb) r.style.setProperty('--primary-rgb', a.rgb)
  // Marcar el modo en el body para CSS contextual
  document.body.dataset.tema = _appModo
  // Titlebar sigue el tema
  const tb = document.querySelector('.titlebar')
  if (tb) tb.style.background = m.main
}

function setAppModo(modo) {
  window.api.configSet('app-modo', modo)
  if (modo === 'sistema') {
    _appModo = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'
  } else {
    _appModo = modo
  }
  _aplicarTema()
  // Actualizar color de fondo de la ventana Electron para que cualquier flash sea del mismo color
  const _modos = { oscuro:'#0F172A', claro:'#F1F5F9', oled:'#000000' }
  if (window.api?.setWinBg) window.api.setWinBg(_modos[_appModo] || '#0F172A')
  document.querySelectorAll('.cfg-mode-btn').forEach(b => b.classList.toggle('activo', b.id === `cfg-modo-${modo}`))
}
function setAppAccent(accent) {
  _appAccent = accent
  window.api.configSet('app-accent', accent)
  _aplicarTema()
  document.querySelectorAll('.cfg-color').forEach(b => b.classList.toggle('activo', b.dataset.accent === accent))
}
function setConfig18(val) {
  _app18 = val
  window.api.configSet('app-18', val)
  document.body.classList.toggle('show-18', val)
  // Mostrar/ocultar botón +18 en dropdown de géneros
  const _b18 = document.getElementById('anime-gen-18-btn')
  if (_b18) _b18.style.display = val ? '' : 'none'
  // Si se desactiva con el filtro +18 activo, limpiarlo
  if (!val && typeof _animeBibGenero !== 'undefined' && _animeBibGenero === 'hentai') {
    if (typeof animeBibReset === 'function') animeBibReset()
  }
  cargarRecientes()
}

function setActivityShare(val) {
  _activityShare = val
  window._ryokuActivityShare = val
  window.api.configSet('activity-share', val)
  if (!val && window._friendsSetActivity) window._friendsSetActivity(null)
}

function setDiscordActivity(val) {
  _discordActivity = val
  window._ryokuDiscordActivity = val
  window.api.configSet('discord-activity', val)
  if (!val) window.api?.discordUpdate?.({ state: '' , details: '' })
}

// Exportar para que anime.js/manga.js puedan consultarlo antes de llamar a discordUpdate
window._ryokuDiscordActivity = true

// ── FONDO PERSONALIZADO ───────────────────────────────────────────────────
let _appBgOpacity = 20
let _appBgPending = null   // imagen seleccionada pero no aplicada aún

function _aplicarBg() {
  const img   = _appBgImage
  const layer = document.getElementById('app-bg-layer')
  if (img) {
    document.documentElement.style.setProperty('--app-bg-image', `url("${img}")`)
    document.documentElement.style.setProperty('--app-bg-opacity', _appBgOpacity / 100)
    document.body.classList.add('has-bg')
    if (layer) layer.style.backgroundImage = `url("${img}")`
  } else {
    document.documentElement.style.setProperty('--app-bg-image', 'none')
    document.documentElement.style.setProperty('--app-bg-opacity', '0')
    document.body.classList.remove('has-bg')
    if (layer) layer.style.backgroundImage = ''
  }
}

async function setBgImagen() {
  const dataUrl = await window.api.openBgImage()
  if (!dataUrl) return
  _appBgPending = dataUrl
  _syncBgUI()
}

async function aplicarBgImagen() {
  if (!_appBgPending) return
  _appBgImage = _appBgPending
  _appBgPending = null
  await window.api.bgSet(_appBgImage)
  _aplicarBg()
  _syncBgUI()
  _mostrarToast('Fondo aplicado')
}

async function quitarBgImagen() {
  _appBgPending = null
  _appBgImage = null
  await window.api.bgSet(null)
  _aplicarBg()
  _syncBgUI()
}

function setBgOpacidad(val) {
  _appBgOpacity = parseInt(val)
  window.api.configSet('app-bg-opacity', val)
  // Aplicar opacidad directo al layer
  const layer = document.getElementById('app-bg-layer')
  if (layer) layer.style.opacity = _appBgOpacity / 100
  document.documentElement.style.setProperty('--app-bg-opacity', _appBgOpacity / 100)
  const valEl = document.getElementById('cfg-bg-opacity-val')
  if (valEl) valEl.textContent = val + '%'
}

function _syncBgUI() {
  const applied    = _appBgImage
  const displayImg = _appBgPending || applied
  const preview    = document.getElementById('cfg-bg-preview')
  const label      = document.getElementById('cfg-bg-label')
  const applyBtn   = document.getElementById('cfg-bg-apply')
  const removeBtn  = document.getElementById('cfg-bg-remove')
  const opacityRow = document.getElementById('cfg-bg-opacity-row')
  const slider     = document.getElementById('cfg-bg-opacity')
  const valEl      = document.getElementById('cfg-bg-opacity-val')

  if (displayImg) {
    if (preview) {
      preview.style.backgroundImage   = `url("${displayImg}")`
      preview.style.backgroundSize    = 'cover'
      preview.style.backgroundPosition = 'center'
    }
    if (label) label.style.display = 'none'
  } else {
    if (preview) preview.style.backgroundImage = ''
    if (label)   label.style.display = ''
  }

  if (applyBtn)   applyBtn.style.display  = _appBgPending ? '' : 'none'
  if (removeBtn)  removeBtn.style.display = displayImg    ? '' : 'none'
  if (opacityRow) opacityRow.style.display = applied      ? '' : 'none'
  if (slider && applied) slider.value     = _appBgOpacity
  if (valEl  && applied) valEl.textContent = _appBgOpacity + '%'
}

function abrirConfig() {
  const ov = document.getElementById('overlay-config')
  ov.style.display = 'block'
  cfgMostrarVista('menu')
  document.querySelectorAll('.cfg-mode-btn').forEach(b => {
    b.classList.toggle('activo', b.id === `cfg-modo-${_appModo}`)
  })
  document.querySelectorAll('.cfg-color').forEach(b => b.classList.toggle('activo', b.dataset.accent === _appAccent))
  const tog18 = document.getElementById('cfg-tog-18'); if (tog18) tog18.checked = _app18
  const togSb = document.getElementById('cfg-tog-sidebar'); if (togSb) togSb.checked = _sidebarAutohide
  const togNeon = document.getElementById('cfg-tog-neon'); if (togNeon) togNeon.checked = _sidebarNeon
  const togActivity = document.getElementById('cfg-tog-activity'); if (togActivity) togActivity.checked = _activityShare
  const togDiscord  = document.getElementById('cfg-tog-discord');  if (togDiscord)  togDiscord.checked  = _discordActivity
  // Portadas max
  const _pm = typeof _portadasMaxActual !== 'undefined' ? _portadasMaxActual : 0
  document.querySelectorAll('#cfg-portadas-max-group .cfg-num-btn').forEach(b => {
    b.classList.toggle('activo', parseInt(b.dataset.val ?? b.textContent) === _pm)
  })
  // Estilo listas
  const _le = document.body.dataset.listaEstilo || 'tarjetas'
  document.querySelectorAll('#cfg-lista-estilo-group .cfg-num-btn').forEach(b => {
    b.classList.toggle('activo', (b.dataset.val || b.textContent.toLowerCase()) === _le)
  })
  _syncBgUI()
  requestAnimationFrame(() => ov.querySelector('.cfg-panel')?.classList.add('open'))
}
const _cfgTitulos = { menu:'Configuración', apariencia:'Apariencia', interfaz:'Interfaz', contenido:'Contenido', cache:'Caché', creditos:'Créditos' }
function cfgMostrarVista(id, back=false) {
  document.querySelectorAll('.cfg-view').forEach(v => { v.style.display='none'; v.className='cfg-view' })
  const vista = document.getElementById('cfg-view-'+id); if (!vista) return
  vista.style.display='block'; void vista.offsetWidth
  vista.classList.add(back ? 'entrando-back' : 'entrando')
  const tEl = document.getElementById('cfg-titulo'); if (tEl) tEl.textContent = _cfgTitulos[id]||id
  const bk = document.getElementById('cfg-back'); if (bk) bk.style.display = id==='menu'?'none':'flex'
}
function cfgIr(s) { cfgMostrarVista(s) }
function cfgVolver() { cfgMostrarVista('menu',true) }
function cerrarConfig() {
  const ov = document.getElementById('overlay-config')
  const panel = ov.querySelector('.cfg-panel')
  panel?.classList.remove('open')
  setTimeout(() => { ov.style.display = 'none' }, 200)
}

async function limpiarCache() {
  const btn = document.getElementById('cfg-btn-cache')
  if (!btn) return
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Borrando...`
  btn.disabled = true

  const r = await window.api.clearCache()

  if (r.ok) {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Caché borrado (${r.borrados} registros)`
    // Toast visible
    _mostrarToast(`✓ Caché borrado — ${r.borrados} registros eliminados`)
  } else {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Error al borrar`
  }
  btn.disabled = false
  setTimeout(() => {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Borrar caché`
  }, 3000)
}

// ── OVERLAY DE CARGA AL CAMBIAR MÓDULO ───────────────────────────────────
let _moduloLoadingMaxTimer = null
let _moduloLoadingShownAt = 0
const MLO_MIN_MS = 3000  // mínimo 3 segundos al cambiar fuente/módulo
function _mostrarModuloLoading(icono, texto) {
  // Cerrar chat y amigos antes de mostrar la pantalla de carga
  if (window._chatClose)   window._chatClose()
  if (window._friendsClose) window._friendsClose()
  let ov = document.getElementById('modulo-loading-ov')
  if (!ov) {
    ov = document.createElement('div')
    ov.id = 'modulo-loading-ov'
    document.body.appendChild(ov)
  }
  ov.innerHTML = `
    <div class="mlo-icon">${icono}</div>
    <div class="mlo-spinner-lg"></div>
    <div class="mlo-label">${texto}</div>
  `
  ov.classList.remove('mlo-out')
  void ov.offsetWidth
  ov.classList.add('mlo-visible')
  _moduloLoadingShownAt = Date.now()
  // Fallback máximo: 15s (home) + 2s retry delay + tiempo de red = hasta ~35s en zonas lentas
  clearTimeout(_moduloLoadingMaxTimer)
  _moduloLoadingMaxTimer = setTimeout(_ocultarModuloLoading, 35000)
}
function _ocultarModuloLoading() {
  clearTimeout(_moduloLoadingMaxTimer)
  const ov = document.getElementById('modulo-loading-ov')
  if (!ov || !ov.classList.contains('mlo-visible')) return
  const elapsed = Date.now() - _moduloLoadingShownAt
  const remaining = MLO_MIN_MS - elapsed
  if (remaining > 0) {
    _moduloLoadingMaxTimer = setTimeout(_ocultarModuloLoading, remaining)
    return
  }
  ov.classList.add('mlo-out')
  setTimeout(() => {
    ov.classList.remove('mlo-visible', 'mlo-out')
    if (window._chatUpdateFAB) window._chatUpdateFAB()
  }, 500)
}

function _mostrarToast(msg) {
  let toast = document.getElementById('ryoku-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'ryoku-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = msg
  toast.classList.add('visible')
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => toast.classList.remove('visible'), 3000)
}

// Inicialización asíncrona — carga config desde disco antes de aplicar el tema
// ── Overlay de transición con screenshot difuminado ──────────────────────────
// Cubre el flash del backgroundColor hasta que el contenido esté pintado
;(function _initSplashOverlay() {
  if (!window.api?.onSplashBg) return
  window.api.onSplashBg((screenshotUrl) => {
    const ov = document.createElement('div')
    ov.id = 'splash-transition-overlay'
    ov.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background-size:cover', 'background-position:center',
      `background-image:url("${screenshotUrl}")`,
      'opacity:1', 'pointer-events:none',
      'transition:opacity 0.7s cubic-bezier(0.4,0,0.2,1)',
    ].join(';')
    // El filter se aplica después de que initConfig cargue el tema
    document.body.appendChild(ov)
    window._splashOverlay = ov

    // Race condition: si appReady ya se llamó antes de que llegara la screenshot,
    // remover el overlay inmediatamente (con el fade normal)
    if (window._appReadyDone) {
      requestAnimationFrame(() => {
        ov.style.opacity = '0'
        setTimeout(() => { if (ov.parentNode) ov.remove(); window._splashOverlay = null }, 750)
      })
      return
    }

    // Fallback de seguridad: remover el overlay después de 12s sin importar qué
    setTimeout(() => {
      if (window._splashOverlay === ov && ov.parentNode) {
        ov.style.opacity = '0'
        setTimeout(() => { if (ov.parentNode) ov.remove(); window._splashOverlay = null }, 750)
      }
    }, 12000)
  })
})()

async function initConfig() {
  try {
    let cfg = (await window.api.configGet()) || {}

    // ── Migración desde localStorage (primera vez con config en archivo) ──
    if (Object.keys(cfg).length === 0) {
      const KEYS = ['app-modo','app-accent','app-18','sidebar-autohide',
                    'searchbar-autohide','sidebar-neon','app-bg-opacity']
      const migrated = {}
      KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) migrated[k] = v })
      if (Object.keys(migrated).length > 0) {
        await window.api.configSetAll(migrated)
        cfg = migrated
      }
    }

    // Inicializar fuente de manga activa (namespace localStorage por fuente)
    const _savedMangaSrc = await window.api?.getMangaSource?.()
    if (_savedMangaSrc) {
      window._activeMangaSource = _savedMangaSrc
      if (typeof _mnBibSyncSource === 'function') _mnBibSyncSource(_savedMangaSrc)
    }

    _appModo   = cfg['app-modo']   || 'oscuro'
    _appAccent = cfg['app-accent'] || 'blue'
    _app18     = cfg['app-18'] === true || cfg['app-18'] === 'true'
    _sidebarAutohide   = cfg['sidebar-autohide']   === true || cfg['sidebar-autohide']   === 'true'
    _searchbarAutohide = cfg['searchbar-autohide'] === true || cfg['searchbar-autohide'] === 'true'
    _sidebarNeon       = cfg['sidebar-neon']       === true || cfg['sidebar-neon']       === 'true'
    _activityShare     = !(cfg['activity-share']   === false || cfg['activity-share']   === 'false')
    window._ryokuActivityShare  = _activityShare
    _discordActivity   = !(cfg['discord-activity'] === false || cfg['discord-activity'] === 'false')
    window._ryokuDiscordActivity = _discordActivity
    _appBgOpacity      = parseInt(cfg['app-bg-opacity'] || '20')
    // Portadas visibles unificada — usar el mismo valor para anime y manga
    // Prioridad: portadas-max > continuar-max > mn-continuar-max > 0 (automático)
    const _portMax = parseInt(cfg['portadas-max'] || cfg['continuar-max'] || cfg['mn-continuar-max'] || '0')
    _portadasMaxActual = _portMax || 0
    if (typeof _initContinuarMaxUI === 'function') _initContinuarMaxUI(_portadasMaxActual)
    if (typeof _initMnContinuarMaxUI === 'function') _initMnContinuarMaxUI(_portadasMaxActual)
    // Marcar botón activo en el grupo unificado
    document.querySelectorAll('#cfg-portadas-max-group .cfg-num-btn').forEach(b => {
      b.classList.toggle('activo', parseInt(b.dataset.val ?? b.textContent) === _portadasMaxActual)
    })

    // Estilo de listas
    _aplicarListaEstilo(cfg['lista-estilo'] || 'tarjetas')
    document.querySelectorAll('#cfg-lista-estilo-group .cfg-num-btn').forEach(b => {
      b.classList.toggle('activo', (b.dataset.val || b.textContent.toLowerCase()) === (cfg['lista-estilo'] || 'tarjetas'))
    })

    // ── Aplicar valores al DOM ──
    _aplicarTema()
    const _modosBg = { oscuro: '#0F172A', claro: '#F1F5F9', oled: '#000000' }
    if (window.api?.setWinBg) window.api.setWinBg(_modosBg[_appModo] || '#0F172A')

    document.body.classList.toggle('show-18', _app18)
    _aplicarSidebarAutohide()
    document.body.classList.toggle('searchbar-autohide', _searchbarAutohide)
    document.body.classList.toggle('sidebar-neon', _sidebarNeon)

    // Cargar fondo guardado
    if (window.api?.bgGet) {
      _appBgImage = await window.api.bgGet()
      _aplicarBg()
    }

  } catch(e) { console.error('[initConfig]', e) }

  // Restaurar módulo activo (se guarda en activarModulo)
  try {
    const cfg2 = (await window.api?.configGet?.()) || {}
    const lastModulo = cfg2['lastModulo']
    if (lastModulo === 'manga') {
      const src = await window.api?.getMangaSource?.()
      if (src) activarModulo('manga')
    }
  } catch(e) {}
}

initConfig()
