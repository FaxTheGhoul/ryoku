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

// Ajusta la altura del panel al paso visible para evitar espacio vacío
function _syncModHeight() {
  const track = document.getElementById('mod-ov-track')
  if (!track) return
  const views = track.parentElement  // .mod-ov-views
  if (!views) return
  const idx = track.classList.contains('paso-3') ? 2 : track.classList.contains('paso-2') ? 1 : 0
  const viewEl = track.children[idx]
  if (viewEl) views.style.height = viewEl.scrollHeight + 'px'
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
  requestAnimationFrame(_syncModHeight)
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
  requestAnimationFrame(_syncModHeight)
}

function modOverlayBack() {
  document.getElementById('mod-ov-track')?.classList.remove('paso-2')
  requestAnimationFrame(_syncModHeight)
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
  const srcMap = { latanime: 'latanime.org', monoschinos: 'monoschinos.st' }
  const effectiveId = id || 'latanime'
  const srcEl = document.getElementById('modcard-anime-src')
  if (srcEl) srcEl.textContent = srcMap[effectiveId] || effectiveId
  ;['latanime','monoschinos'].forEach(s => {
    document.getElementById('modcard-src-' + s)?.classList.toggle('activo', s === effectiveId)
  })
  // Reflect on the parent anime card too
  document.getElementById('modcard-anime')?.classList.toggle('activo', _moduloActivo === 'anime')
}

function abrirSeleccionFuenteAnime() {
  _syncModOverlaySrc()
  const track = document.getElementById('mod-ov-track')
  if (track) { track.classList.remove('paso-2'); track.classList.add('paso-3') }
  requestAnimationFrame(_syncModHeight)
}

function modOverlayAnimeBack() {
  document.getElementById('mod-ov-track')?.classList.remove('paso-3')
  requestAnimationFrame(_syncModHeight)
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
  miku:   { primary:'#39C5BB', hover:'#4DD6CB', glow:'#7FF0E4', dim:'rgba(57,197,187,0.18)', rgb:'57,197,187' },
  neru:   { primary:'#F2A30E', hover:'#FFC94D', glow:'#FFE29A', dim:'rgba(242,163,14,0.18)', rgb:'242,163,14' },
}
const MODOS = {
  oscuro: { main:'#0F172A', secondary:'#1E293B', card:'#111827', border:'#334155', textMain:'#F8FAFC', textSecondary:'#CBD5E1', textMuted:'#64748B' },
  claro:  { main:'#F1F5F9', secondary:'#E2E8F0', card:'#FFFFFF',  border:'#CBD5E1', textMain:'#0F172A', textSecondary:'#334155', textMuted:'#64748B' },
  oled:   { main:'#000000', secondary:'#0D1117', card:'#0A0A0A',  border:'#1F2937', textMain:'#F8FAFC', textSecondary:'#CBD5E1', textMuted:'#64748B' },
}

// ── Utilidades de color (para acento personalizado) ─────────────────────
function _hexToRgbArr(hex) {
  const h = (hex || '#2563EB').replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full, 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function _mezclarColor([r, g, b], target, pct) {
  const mix = (c, t) => Math.round(c + (t - c) * pct)
  return [mix(r, target[0]), mix(g, target[1]), mix(b, target[2])]
}
function _rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')
}
function _derivarAccent(hex) {
  const rgb = _hexToRgbArr(hex)
  const hover = _mezclarColor(rgb, [255, 255, 255], 0.18)
  const glow  = _mezclarColor(rgb, [255, 255, 255], 0.38)
  return {
    primary: _rgbToHex(rgb),
    hover:   _rgbToHex(hover),
    glow:    _rgbToHex(glow),
    dim:     `rgba(${rgb.join(',')},0.15)`,
    rgb:     rgb.join(','),
  }
}
function _rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  const d = max - min
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case r: h = 60 * (((g - b) / d) % 6); break
      case g: h = 60 * ((b - r) / d + 2); break
      case b: h = 60 * ((r - g) / d + 4); break
    }
  }
  if (h < 0) h += 360
  return [h, s * 100, l * 100]
}
function _hslToRgb(h, s, l) {
  s /= 100; l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let rp = 0, gp = 0, bp = 0
  if (h < 60)       { rp = c; gp = x; bp = 0 }
  else if (h < 120) { rp = x; gp = c; bp = 0 }
  else if (h < 180) { rp = 0; gp = c; bp = x }
  else if (h < 240) { rp = 0; gp = x; bp = c }
  else if (h < 300) { rp = x; gp = 0; bp = c }
  else              { rp = c; gp = 0; bp = x }
  return [Math.round((rp + m) * 255), Math.round((gp + m) * 255), Math.round((bp + m) * 255)]
}
// Versión saturada "neón" del color de acento — no es un simple aclarado con
// blanco (eso da pastel), sube la saturación al máximo manteniendo el matiz.
function _neonColor(hex) {
  const [h] = _rgbToHsl(_hexToRgbArr(hex))
  return _rgbToHex(_hslToRgb(h, 100, 58))
}

// ── Fondos: presets de gradiente ────────────────────────────────────────
const BG_GRADIENTS = {
  sakura:     { nombre: 'Sakura',     css: 'linear-gradient(135deg, #ffdde1 0%, #ee9ca7 100%)' },
  cyberpunk:  { nombre: 'Cyberpunk',  css: 'linear-gradient(135deg, #0f2027 0%, #203a43 55%, #ff2fb0 130%)' },
  atardecer:  { nombre: 'Atardecer',  css: 'linear-gradient(135deg, #ff9966 0%, #ff5e62 100%)' },
  aurora:     { nombre: 'Aurora',     css: 'linear-gradient(135deg, #43cea2 0%, #185a9d 100%)' },
  medianoche: { nombre: 'Medianoche', css: 'linear-gradient(135deg, #232526 0%, #3f2b96 100%)' },
  miku:       { nombre: 'Hatsune Miku', css: "url('assets/miku-bg.jpg')", posDefault: '48.6% 13.2%', scaleDefault: 1.2 },
  // posDefault/scaleDefault: encuadre de fábrica para este fondo — el que
  // dejó el usuario con la herramienta de "Ajustar encuadre" (drag+zoom).
  // _aplicarBg() los usa como fallback SOLO mientras no haya un encuadre
  // manual propio guardado (_appBgPosition/_appBgScale) — si el usuario
  // ajusta el encuadre después, eso sigue mandando como siempre.
  neru:       { nombre: 'Akita Neru', css: "url('assets/neru-bg.jpg')", posDefault: '48.3% 55%', scaleDefault: 1 },
}

// ── Temas completos (presets curados) ─────────────────────────────────────
const PRESETS = {
  clasico:    { nombre: 'Clásico',            modo: 'oscuro', accent: 'blue',   bg: null,         neon: false },
  medianoche: { nombre: 'Medianoche violeta', modo: 'oscuro', accent: 'purple', bg: 'medianoche', neon: true  },
  sakura:     { nombre: 'Sakura',             modo: 'claro',  accent: 'pink',   bg: 'sakura',      neon: false },
  cyberpunk:  { nombre: 'Cyberpunk',          modo: 'oled',   accent: 'cyan',   bg: 'cyberpunk',   neon: true  },
  esmeralda:  { nombre: 'Esmeralda',          modo: 'oscuro', accent: 'green',  bg: 'aurora',      neon: false },
  atardecer:  { nombre: 'Atardecer',          modo: 'oscuro', accent: 'orange', bg: 'atardecer',   neon: false },
  miku:       { nombre: 'Hatsune Miku',       modo: 'oled',   accent: 'miku',   bg: 'miku',        neon: true  },
  neru:       { nombre: 'Akita Neru',          modo: 'claro',  accent: 'neru',   bg: 'neru',        neon: true  },
}

// Debounce para sync cloud — evita disparar un sync por cada clic en config
let _syncGuardarTimer = null
function _syncGuardarDebounced() {
  clearTimeout(_syncGuardarTimer)
  _syncGuardarTimer = setTimeout(() => {
    if (typeof window._syncGuardar === 'function') window._syncGuardar()
  }, 2000)
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
let _appBgGradient = null // nombre del gradiente preset activo (o null)
let _appBgMode  = 'ninguno' // 'imagen' | 'gradiente' | 'ninguno'
let _appBgBlur  = false
let _appBgPosition = null // 'X% Y%' guardado por el usuario, o null = por defecto (centrado)
let _appBgScale    = null // factor de zoom (1 = 100%) guardado por el usuario, o null = por defecto
let _appAccentCustomHex = '#2563EB'
let _appCorners  = 'redondeado' // 'redondeado' | 'cuadrado'
let _appDensidad = 'comoda'
let _appTemaId = ''
let _appMikuSonido = true     // sonido del tema Miku (on/off)
let _appGlass    = true

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
let _sidebarRafPending = false
function _sidebarMouseMove(e) {
  const x = e.clientX
  if (_sidebarRafPending) return
  _sidebarRafPending = true
  requestAnimationFrame(() => {
    _sidebarRafPending = false
    const sidebar = document.getElementById('main-sidebar')
    if (!sidebar) return
    const playerAbierto = document.getElementById('overlay-player')?.classList.contains('activo')
    const mangaAbierto  = document.getElementById('page-manga-lector')?.classList.contains('activa')
    if (playerAbierto || mangaAbierto) {
      sidebar.classList.remove('visible')
      document.body.classList.remove('sidebar-open')
      return
    }
    if (x <= 60) {
      sidebar.classList.add('visible')
      document.body.classList.add('sidebar-open')
    } else if (x > 80) {
      sidebar.classList.remove('visible')
      document.body.classList.remove('sidebar-open')
    }
  })
}
// mantener compatibilidad
let _sidebarJustLeft = false
function _sidebarShow() {}
function _sidebarHide() {}

// ── FABs de chat/amigos en PC — autoocultar con la misma idea que la
// sidebar de arriba: acercar el mouse a la esquina inferior derecha los
// revela, alejarse los vuelve a ocultar. (La versión mobile usa un tap +
// temporizador de 10s porque ahí no hay cursor que "se acerque"; en
// escritorio si hay mouse, así que tiene más sentido esto que un timer.)
let _socialEdgeRafPending = false
function _socialEdgeMouseMove(e) {
  if (document.body.classList.contains('mobile-mode')) return
  if (_socialEdgeRafPending) return
  _socialEdgeRafPending = true
  requestAnimationFrame(() => {
    _socialEdgeRafPending = false
    const chatFab    = document.getElementById('chat-fab')
    const friendsFab = document.getElementById('friends-fab')
    const algunoVisible =
      (chatFab    && chatFab.style.display    !== 'none') ||
      (friendsFab && friendsFab.style.display !== 'none')
    if (!algunoVisible) { document.body.classList.remove('social-edge-visible'); return }
    const desdeDerecha = window.innerWidth  - e.clientX
    const desdeAbajo   = window.innerHeight - e.clientY
    // Zona de aparición: cubre ambos botones + un margen cómodo para
    // "acercarse". Zona de ocultado: más amplia todavía (histéresis, igual
    // que el x<=60 / x>80 de la sidebar) para que no parpadee justo en el borde.
    if (desdeDerecha <= 90 && desdeAbajo <= 170) {
      document.body.classList.add('social-edge-visible')
    } else if (desdeDerecha > 120 || desdeAbajo > 210) {
      document.body.classList.remove('social-edge-visible')
    }
  })
}
document.addEventListener('mousemove', _socialEdgeMouseMove, { passive: true })

function setSearchbarAutohide(val) {
  _searchbarAutohide = val; window.api.configSet('searchbar-autohide', val)
  document.body.classList.toggle('searchbar-autohide', val)
}

let _sidebarNeon = false
let _neonIntensidad = 'medio' // 'sutil' | 'medio' | 'intenso'
function setSidebarNeon(val) {
  _sidebarNeon = val; window.api.configSet('sidebar-neon', val)
  document.body.classList.toggle('sidebar-neon', val)
}
function setNeonIntensidad(val) {
  _neonIntensidad = val
  window.api.configSet('neon-intensidad', val)
  document.body.dataset.neonIntensidad = val
  document.querySelectorAll('.cfg-neon-btn').forEach(b => b.classList.toggle('activo', b.dataset.val === val))
  _syncGuardarDebounced()
}

// ── Esquinas / densidad / vidrio esmerilado ───────────────────────────────
function _syncGuardarInmediato() {
  clearTimeout(_syncGuardarTimer)
  if (typeof window._syncGuardar === 'function') window._syncGuardar()
}
function setAppCorners(val) {
  _appCorners = val
  window.api.configSet('app-corners', val)
  document.body.dataset.esquinas = val
  document.querySelectorAll('.cfg-corners-btn').forEach(b => b.classList.toggle('activo', b.dataset.val === val))
  _syncGuardarInmediato()
}
function setAppDensidad(val) {
  _appDensidad = val
  window.api.configSet('app-densidad', val)
  document.body.dataset.densidad = val
  document.querySelectorAll('.cfg-densidad-btn').forEach(b => b.classList.toggle('activo', b.dataset.val === val))
  _syncGuardarInmediato()
}
function setAppGlass(val) {
  _appGlass = val
  window.api.configSet('app-glass', val)
  document.body.classList.toggle('sin-vidrio', !val)
  _syncGuardarInmediato()
}
function setMikuSonido(val) {
  _appMikuSonido = val
  window._ryokuMikuSonido = val
  window.api.configSet('app-miku-sonido', val)
  _syncGuardarInmediato()
}

function _aplicarTema() {
  const m = MODOS[_appModo]   || MODOS.oscuro
  const a = _appAccent === 'custom' ? _derivarAccent(_appAccentCustomHex) : (ACCENTS[_appAccent] || ACCENTS.blue)
  // Clase de modo en <body> -- permite overrides puntuales de CSS que no
  // pueden resolverse solo con variables (p.ej. degradés oscuros pensados
  // para texto blanco, que en modo claro hay que invertir a claros con
  // texto oscuro en vez de heredar el mismo negro siempre).
  document.body.classList.remove('modo-oscuro', 'modo-claro', 'modo-oled')
  document.body.classList.add('modo-' + (MODOS[_appModo] ? _appModo : 'oscuro'))
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
  const neonHex = _neonColor(a.primary)
  const neonRgb = _hexToRgbArr(neonHex)
  r.style.setProperty('--primary-neon', neonHex)
  r.style.setProperty('--primary-neon-rgb', neonRgb.join(','))
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
  _syncGuardarDebounced()
}
function setAppAccent(accent) {
  _appAccent = accent
  window.api.configSet('app-accent', accent)
  _aplicarTema()
  document.querySelectorAll('.cfg-color').forEach(b => b.classList.toggle('activo', b.dataset.accent === accent))
  _syncGuardarDebounced()
}
function setAppAccentCustom(hex) {
  _appAccent = 'custom'
  _appAccentCustomHex = hex
  window.api.configSet('app-accent', 'custom')
  window.api.configSet('app-accent-custom-hex', hex)
  _aplicarTema()
  document.querySelectorAll('.cfg-color').forEach(b => b.classList.toggle('activo', b.dataset.accent === 'custom'))
  _syncGuardarDebounced()
}

function aplicarPreset(nombre) {
  const p = PRESETS[nombre]
  if (!p) return
  setAppModo(p.modo)
  setAppAccent(p.accent)
  setSidebarNeon(!!p.neon)
  document.getElementById('cfg-tog-neon') && (document.getElementById('cfg-tog-neon').checked = !!p.neon)
  if (p.bg) setBgGradiente(p.bg)
  else quitarBgImagen()
  _setTemaId(nombre)
  if (nombre === 'miku' && typeof window._mikuTemaChime === 'function') window._mikuTemaChime()
  if (nombre === 'neru' && typeof window._neruTemaChime === 'function') window._neruTemaChime()
  _mostrarToast(`Tema aplicado: ${p.nombre}`)
}
// ── Identidad del tema aplicado (para efectos especiales tipo Miku) ──────
function _setTemaId(id) {
  document.body.dataset.temaId = id || ''
  window.api.configSet('app-tema-id', id || '')
  document.querySelectorAll('.cfg-preset-btn').forEach(b => b.classList.toggle('activo', b.dataset.preset === id))
  if (typeof window._mikuTemaAplicado === 'function') window._mikuTemaAplicado(id)
  if (typeof window._neruTemaAplicado === 'function') window._neruTemaAplicado(id)
  _syncGuardarInmediato()
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
  const layer = document.getElementById('app-bg-layer')
  let bgCss = null
  if (_appBgMode === 'gradiente' && _appBgGradient && BG_GRADIENTS[_appBgGradient]) {
    bgCss = BG_GRADIENTS[_appBgGradient].css
  } else if (_appBgMode === 'imagen' && _appBgImage) {
    bgCss = `url("${_appBgImage}")`
  }
  // Encuadre manual (drag + zoom, igual que la foto de perfil) — aplica a
  // imágenes propias y también a presets tipo "miku"/"neru" (son fotos
  // disfrazadas de degradé). El resto de los degradés reales siguen siendo
  // cover/centro. Si el usuario todavía no ajustó un encuadre propio, se
  // usa el de fábrica del degradé actual (posDefault/scaleDefault en
  // BG_GRADIENTS), si tiene uno definido.
  const esEncuadrable = _bgEsEncuadrable()
  const _gradActual = (_appBgMode === 'gradiente' && _appBgGradient) ? BG_GRADIENTS[_appBgGradient] : null
  const sizeCss = (esEncuadrable && _appBgScale)    ? (Math.round(_appBgScale * 100) + '%')
                : (esEncuadrable && _gradActual?.scaleDefault) ? (Math.round(_gradActual.scaleDefault * 100) + '%')
                : 'cover'
  const posCss  = (esEncuadrable && _appBgPosition) ? _appBgPosition
                : (esEncuadrable && _gradActual?.posDefault) ? _gradActual.posDefault
                : 'center center'
  if (bgCss) {
    document.documentElement.style.setProperty('--app-bg-image', bgCss)
    document.documentElement.style.setProperty('--app-bg-opacity', _appBgOpacity / 100)
    document.documentElement.style.setProperty('--app-bg-size', sizeCss)
    document.documentElement.style.setProperty('--app-bg-position', posCss)
    document.body.classList.add('has-bg')
    if (layer) {
      layer.style.backgroundImage = bgCss
      if (esEncuadrable && (_appBgScale || _appBgPosition)) {
        layer.style.backgroundSize     = sizeCss
        layer.style.backgroundPosition = posCss
      } else {
        layer.style.backgroundSize     = ''
        layer.style.backgroundPosition = ''
      }
    }
  } else {
    document.documentElement.style.setProperty('--app-bg-image', 'none')
    document.documentElement.style.setProperty('--app-bg-opacity', '0')
    document.documentElement.style.setProperty('--app-bg-size', 'cover')
    document.documentElement.style.setProperty('--app-bg-position', 'center center')
    document.body.classList.remove('has-bg')
    if (layer) { layer.style.backgroundImage = ''; layer.style.backgroundSize = ''; layer.style.backgroundPosition = '' }
  }
  document.body.classList.toggle('bg-blur', !!(bgCss && _appBgBlur))
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
  _appBgMode = 'imagen'
  window.api.configSet('app-bg-mode', 'imagen')
  await window.api.bgSet(_appBgImage)
  _aplicarBg()
  _syncBgUI()
  _mostrarToast('Fondo aplicado')
}

async function quitarBgImagen() {
  _appBgPending = null
  _appBgImage = null
  _appBgGradient = null
  _appBgMode = 'ninguno'
  window.api.configSet('app-bg-mode', 'ninguno')
  window.api.configSet('app-bg-gradient', '')
  await window.api.bgSet(null)
  _aplicarBg()
  _syncBgUI()
}

function setBgGradiente(nombre) {
  if (!BG_GRADIENTS[nombre]) return
  _appBgPending = null
  _appBgGradient = nombre
  _appBgMode = 'gradiente'
  // Al cambiar de fondo (nuevo degradé o tema) el encuadre manual que
  // hubiera quedado de OTRA imagen ya no tiene sentido -- se resetea para
  // que entre el encuadre de fábrica del fondo nuevo (posDefault/
  // scaleDefault en BG_GRADIENTS), aunque el usuario ya hubiera ajustado
  // el encuadre antes con otro fondo/tema activo.
  _appBgPosition = null
  _appBgScale    = null
  window.api.configSet('app-bg-position', '')
  window.api.configSet('app-bg-scale', '')
  window.api.configSet('app-bg-gradient', nombre)
  window.api.configSet('app-bg-mode', 'gradiente')
  _aplicarBg()
  _syncBgUI()
  _syncGuardarDebounced()
}

function setBgBlur(val) {
  _appBgBlur = val
  window.api.configSet('app-bg-blur', val)
  _aplicarBg()
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

// ─── Encuadre del fondo (drag-to-pan + zoom, igual que la foto de perfil) ──
// El preset "miku" vive en BG_GRADIENTS pero en realidad es una foto
// (url(...)), no un degradé real -- por eso también cuenta como encuadrable.
function _bgEsUrlPlana(css) {
  return typeof css === 'string' && /^\s*url\(/i.test(css)
}
function _bgEsEncuadrable() {
  if (_appBgMode === 'imagen' && _appBgImage) return true
  if (_appBgMode === 'gradiente' && _appBgGradient && BG_GRADIENTS[_appBgGradient]) {
    return _bgEsUrlPlana(BG_GRADIENTS[_appBgGradient].css)
  }
  return false
}
function _bgUrlActual() {
  if (_appBgMode === 'imagen' && _appBgImage) return _appBgImage
  if (_appBgMode === 'gradiente' && _appBgGradient && BG_GRADIENTS[_appBgGradient]) {
    const m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(BG_GRADIENTS[_appBgGradient].css)
    if (m) return m[1]
  }
  return null
}

function setBgEncuadre(pos, scale) {
  _appBgPosition = pos || null
  _appBgScale    = scale ? parseFloat(scale) : null
  window.api.configSet('app-bg-position', _appBgPosition || '')
  window.api.configSet('app-bg-scale', _appBgScale ? String(_appBgScale) : '')
  _aplicarBg()
}

function _bgNaturalSize(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload  = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 })
    img.onerror = () => resolve({ w: 0, h: 0 })
    img.src = url
  })
}

async function _bgOpenPosModal() {
  if (document.getElementById('bg-pos-modal')) return
  if (!_bgEsEncuadrable()) return
  const urlActual = _bgUrlActual()
  if (!urlActual) return

  const layer = document.getElementById('app-bg-layer')
  const rect  = layer ? layer.getBoundingClientRect() : null
  const boxAspect = (rect && rect.width > 0 && rect.height > 0) ? (rect.width / rect.height) : (16 / 9)

  // Punto de partida: si ya hay un encuadre guardado se usa ese. Si no, se
  // calcula el zoom mínimo que cubre la caja por completo (equivalente a
  // "cover"), para arrancar sin huecos y que el usuario solo ajuste a gusto.
  let pctX = 50, pctY = 50, zoomPct = 100
  if (_appBgPosition) {
    const xy = _appBgPosition.replace(/%/g, '').trim().split(/\s+/)
    pctX = parseFloat(xy[0]) || 50
    pctY = parseFloat(xy[1]) || 50
  }
  if (_appBgScale) {
    zoomPct = Math.round(_appBgScale * 100)
  } else {
    const nat = await _bgNaturalSize(urlActual)
    if (nat.w && nat.h) {
      const imgAspect = nat.w / nat.h
      const coverWidthPct = (imgAspect >= boxAspect) ? ((imgAspect / boxAspect) * 100) : 100
      zoomPct = Math.max(100, Math.round(coverWidthPct))
    }
  }
  if (document.getElementById('bg-pos-modal')) return // por si se abrió mientras se esperaba la imagen

  const previewW = 344 // 380px de caja - 2*18px de padding
  const previewH = Math.max(90, Math.min(260, Math.round(previewW / boxAspect)))

  const modal = document.createElement('div')
  modal.id = 'bg-pos-modal'
  modal.className = 'pf-pos-modal'
  modal.innerHTML =
    '<div class="pf-pos-modal-box">' +
      '<div class="pf-pos-modal-title">Encuadrar fondo</div>' +
      '<div class="pf-pos-modal-hint">Arrastra para mover · Rueda del mouse para zoom</div>' +
      '<div id="bg-pos-el" style="width:100%;height:' + previewH + 'px;border-radius:10px;border:1px solid var(--border);cursor:grab;user-select:none;background-repeat:no-repeat;background-image:url(' + urlActual + ');background-size:' + zoomPct + '%;background-position:' + pctX + '% ' + pctY + '%;"></div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:10px">' +
        '<i class="ti ti-zoom-out" style="color:var(--text-2);font-size:14px"></i>' +
        '<input id="bg-zoom-slider" type="range" min="100" max="400" step="5" value="' + zoomPct + '" style="flex:1;accent-color:var(--primary)">' +
        '<i class="ti ti-zoom-in" style="color:var(--text-2);font-size:14px"></i>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;align-items:center">' +
        '<button class="pf-cancel-btn" style="flex:none;padding:9px 12px;background:none;border:none;color:var(--text-muted);text-decoration:underline;cursor:pointer" onclick="_bgResetPos()">Restablecer</button>' +
        '<div style="flex:1"></div>' +
        '<button class="pf-cancel-btn" onclick="_bgClosePosModal()">Cancelar</button>' +
        '<button class="pf-save-btn" onclick="_bgSavePosFromModal()">Guardar</button>' +
      '</div>' +
    '</div>'
  document.body.appendChild(modal)
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) _bgClosePosModal() })

  const el     = document.getElementById('bg-pos-el')
  const slider = document.getElementById('bg-zoom-slider')

  function applyTransform() {
    el.style.backgroundSize     = zoomPct + '%'
    el.style.backgroundPosition = pctX + '% ' + pctY + '%'
    if (slider) slider.value = zoomPct
  }

  slider.addEventListener('input', () => {
    zoomPct = parseFloat(slider.value)
    applyTransform()
  })

  el.addEventListener('wheel', (e) => {
    e.preventDefault()
    zoomPct = Math.max(100, Math.min(400, zoomPct - e.deltaY * 0.2))
    applyTransform()
  }, { passive: false })

  el.addEventListener('mousedown', (e) => {
    e.preventDefault()
    el.style.cursor = 'grabbing'
    const r = el.getBoundingClientRect()
    const sx = e.clientX, sy = e.clientY, spx = pctX, spy = pctY
    function onMove(e2) {
      const dx = e2.clientX - sx, dy = e2.clientY - sy
      const sensitivity = 100 / (zoomPct / 100)
      pctX = Math.round(Math.max(0, Math.min(100, spx - dx / r.width  * sensitivity)) * 10) / 10
      pctY = Math.round(Math.max(0, Math.min(100, spy - dy / r.height * sensitivity)) * 10) / 10
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

function _bgClosePosModal() {
  const m = document.getElementById('bg-pos-modal')
  if (m) m.remove()
}

function _bgSavePosFromModal() {
  const el     = document.getElementById('bg-pos-el')
  const slider = document.getElementById('bg-zoom-slider')
  if (!el) return
  const pos   = el.style.backgroundPosition || '50% 50%'
  const scale = slider ? (parseFloat(slider.value) / 100) : 1
  _bgClosePosModal()
  setBgEncuadre(pos, scale)
  if (typeof _syncGuardarInmediato === 'function') _syncGuardarInmediato()
  if (typeof _mostrarToast === 'function') _mostrarToast('Encuadre del fondo guardado')
}

function _bgResetPos() {
  _bgClosePosModal()
  setBgEncuadre(null, null)
  if (typeof _syncGuardarInmediato === 'function') _syncGuardarInmediato()
  if (typeof _mostrarToast === 'function') _mostrarToast('Encuadre restablecido')
}

function _syncBgUI() {
  const modoImagen = _appBgMode === 'imagen'
  const modoGrad   = _appBgMode === 'gradiente'
  const displayImg = _appBgPending || (modoImagen ? _appBgImage : null)
  const activo     = !!((modoImagen && _appBgImage) || (modoGrad && _appBgGradient))
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
  } else if (modoGrad && _appBgGradient && BG_GRADIENTS[_appBgGradient]) {
    if (preview) {
      preview.style.backgroundImage    = BG_GRADIENTS[_appBgGradient].css
      preview.style.backgroundSize     = ''
      preview.style.backgroundPosition = ''
    }
    if (label) label.style.display = 'none'
  } else {
    if (preview) preview.style.backgroundImage = ''
    if (label)   label.style.display = ''
  }

  if (applyBtn)   applyBtn.style.display  = _appBgPending ? '' : 'none'
  if (removeBtn)  removeBtn.style.display = (activo || displayImg) ? '' : 'none'
  if (opacityRow) opacityRow.style.display = activo ? '' : 'none'
  const encuadreBtn = document.getElementById('cfg-bg-encuadre')
  if (encuadreBtn) encuadreBtn.style.display = _bgEsEncuadrable() ? '' : 'none'
  if (slider && activo) slider.value     = _appBgOpacity
  if (valEl  && activo) valEl.textContent = _appBgOpacity + '%'

  document.querySelectorAll('.cfg-bg-gradient-swatch').forEach(b => {
    b.classList.toggle('activo', modoGrad && b.dataset.grad === _appBgGradient)
  })
  const blurToggle = document.getElementById('cfg-tog-bgblur')
  if (blurToggle) blurToggle.checked = _appBgBlur
}

function abrirConfig() {
  const ov = document.getElementById('overlay-config')
  ov.classList.add('is-open')
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
  requestAnimationFrame(() => ov.querySelector('.cfg-panel')?.classList.add('open'))
}
const _cfgTitulos = { menu:'Configuración', apariencia:'Apariencia', interfaz:'Interfaz', contenido:'Contenido', cache:'Caché', creditos:'Créditos' }
function cfgMostrarVista(id, back=false) {
  document.querySelectorAll('.cfg-view').forEach(v => { v.style.display='none'; v.className='cfg-view' })
  const vista = document.getElementById('cfg-view-'+id); if (!vista) return
  vista.style.display='block'
  requestAnimationFrame(() => vista.classList.add(back ? 'entrando-back' : 'entrando'))
  const tEl = document.getElementById('cfg-titulo'); if (tEl) tEl.textContent = _cfgTitulos[id]||id
  const bk = document.getElementById('cfg-back'); if (bk) bk.style.display = id==='menu'?'none':'flex'
}
function cfgIr(s) { cfgMostrarVista(s); if (s === 'apariencia') setTimeout(_syncBgUI, 120) }
function cfgVolver() { cfgMostrarVista('menu',true) }
function cerrarConfig() {
  const ov = document.getElementById('overlay-config')
  const panel = ov.querySelector('.cfg-panel')
  panel?.classList.remove('open')
  setTimeout(() => { ov.classList.remove('is-open') }, 200)
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
    _neonIntensidad    = cfg['neon-intensidad'] || 'medio'
    _activityShare     = !(cfg['activity-share']   === false || cfg['activity-share']   === 'false')
    window._ryokuActivityShare  = _activityShare
    _discordActivity   = !(cfg['discord-activity'] === false || cfg['discord-activity'] === 'false')
    window._ryokuDiscordActivity = _discordActivity
    _appBgOpacity      = parseInt(cfg['app-bg-opacity'] || '20')
    _appAccentCustomHex = cfg['app-accent-custom-hex'] || '#2563EB'
    _appCorners         = cfg['app-corners']  || 'redondeado'
    _appDensidad        = cfg['app-densidad'] || 'comoda'
    _appGlass           = !(cfg['app-glass'] === false || cfg['app-glass'] === 'false')
    _appBgGradient       = cfg['app-bg-gradient'] || null
    _appBgMode           = cfg['app-bg-mode'] || null
    _appBgBlur           = cfg['app-bg-blur'] === true || cfg['app-bg-blur'] === 'true'
    _appBgPosition       = cfg['app-bg-position'] || null
    _appBgScale          = cfg['app-bg-scale'] ? parseFloat(cfg['app-bg-scale']) : null
    _appTemaId            = cfg['app-tema-id'] || ''
    _appMikuSonido        = !(cfg['app-miku-sonido'] === false || cfg['app-miku-sonido'] === 'false')
    window._ryokuMikuSonido = _appMikuSonido
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
    document.body.dataset.neonIntensidad = _neonIntensidad
    document.querySelectorAll('.cfg-neon-btn').forEach(b => b.classList.toggle('activo', b.dataset.val === _neonIntensidad))
    document.body.dataset.esquinas = _appCorners
    document.body.dataset.densidad = _appDensidad
    document.body.classList.toggle('sin-vidrio', !_appGlass)
    document.querySelectorAll('.cfg-corners-btn').forEach(b => b.classList.toggle('activo', b.dataset.val === _appCorners))
    document.querySelectorAll('.cfg-densidad-btn').forEach(b => b.classList.toggle('activo', b.dataset.val === _appDensidad))
    document.body.dataset.temaId = _appTemaId
    document.querySelectorAll('.cfg-preset-btn').forEach(b => b.classList.toggle('activo', b.dataset.preset === _appTemaId))
    if (typeof window._mikuTemaAplicado === 'function') window._mikuTemaAplicado(_appTemaId)
    if (typeof window._neruTemaAplicado === 'function') window._neruTemaAplicado(_appTemaId)
    const _cfgMikuSonido = document.getElementById('cfg-tog-miku-sonido')
    if (_cfgMikuSonido) _cfgMikuSonido.checked = _appMikuSonido
    document.querySelectorAll('.cfg-color').forEach(b => b.classList.toggle('activo', b.dataset.accent === _appAccent))
    const _cfgAccentCustomInput = document.getElementById('cfg-accent-custom-input')
    if (_cfgAccentCustomInput) _cfgAccentCustomInput.value = _appAccentCustomHex
    const _cfgBgBlurToggle = document.getElementById('cfg-tog-bgblur')
    if (_cfgBgBlurToggle) _cfgBgBlurToggle.checked = _appBgBlur

    // Cargar fondo guardado
    if (window.api?.bgGet) {
      _appBgImage = await window.api.bgGet()
      if (!_appBgMode) _appBgMode = _appBgImage ? 'imagen' : (_appBgGradient ? 'gradiente' : 'ninguno')
      _aplicarBg()
      _syncBgUI()
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

// ── Fullscreen + cursor temático (Miku/Neru) ─────────────────────────────
// #miku-cursor-fx / #neru-cursor-fx cuelgan directo de <body> (ver
// miku.js/neru.js). La Fullscreen API del navegador solo pinta el elemento
// que entra en pantalla completa (.rp-shell del reproductor) y sus
// descendientes -- cualquier otra cosa colgada de <body> por fuera de ese
// árbol deja de renderizarse aunque siga en el DOM. Como el cursor nativo
// del sistema también está oculto en estos temas (cursor:none), el
// resultado era un cursor completamente invisible dentro del reproductor
// en pantalla completa. Se reubica el div dentro del elemento fullscreen
// mientras dure, y se devuelve a <body> al salir.
function _reubicarCursorTematicoFullscreen() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.body
  ;['miku-cursor-fx', 'neru-cursor-fx'].forEach(id => {
    const el = document.getElementById(id)
    if (el && el.parentNode !== fsEl) fsEl.appendChild(el)
  })
}
document.addEventListener('fullscreenchange', _reubicarCursorTematicoFullscreen)
document.addEventListener('webkitfullscreenchange', _reubicarCursorTematicoFullscreen)
window._reubicarCursorTematicoFullscreen = _reubicarCursorTematicoFullscreen

initConfig()
