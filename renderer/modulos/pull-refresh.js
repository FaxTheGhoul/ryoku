'use strict'

// ─── Pull-to-Refresh ─────────────────────────────────────────────────────────
// Patrón estándar Android: arrastrar hacia abajo desde el tope para recargar
// Solo activo en Android (Capacitor), en PC se omite.

;(function _initPullToRefresh() {
  // Solo en móvil (no en Electron/PC). window.api.isElectron y
  // window.__ELECTRON__ nunca se llegan a setear en ningún lado del código —
  // el flag real vive en window._apiBridge.isElectron (api-bridge.js), y la
  // forma auto-contenida de detectarlo sin depender del orden de carga de
  // scripts es la misma que usa api-bridge.js para calcularlo: presencia de
  // window.api.getRecientes (expuesto solo por el preload de Electron). Con
  // el chequeo viejo, este guard nunca cortaba nada — en PC solo "funcionaba"
  // de casualidad porque un Windows sin pantalla táctil tampoco tiene
  // ontouchstart; en una PC/laptop táctil el gesto se activaba igual.
  if (window._apiBridge?.isElectron || (window.api && window.api.getRecientes)) return
  if (!('ontouchstart' in window)) return

  const THRESHOLD   = 72   // px de arrastre para disparar recarga
  const MAX_PULL    = 100  // px máximos de desplazamiento visual
  const INDICATOR_SIZE = 40

  // ── Mapa: página activa → función de recarga ────────────────────────────
  const PAGE_RELOAD = {
    'page-inicio'           : () => typeof cargarRecientes       === 'function' && cargarRecientes(),
    'page-favoritos'        : () => typeof cargarFavoritos       === 'function' && cargarFavoritos(),
    'page-calendario'       : () => typeof cargarCalendario      === 'function' && cargarCalendario(),
    'page-manga-inicio'     : () => typeof cargarMangaTendencias === 'function' && cargarMangaTendencias(),
    'page-manga-favoritos'  : () => typeof cargarMangaFavoritos  === 'function' && cargarMangaFavoritos(),
    'page-manga-historial'  : () => typeof cargarMangaHistorial  === 'function' && cargarMangaHistorial(),
    'page-anime-biblioteca' : () => typeof animeBibRecargar      === 'function' && animeBibRecargar(),
  }

  // ── Indicador visual ────────────────────────────────────────────────────
  const indicator = document.createElement('div')
  indicator.id = 'ptr-indicator'
  indicator.innerHTML = `<img src="assets/icon.png" width="${INDICATOR_SIZE}" height="${INDICATOR_SIZE}" style="border-radius:10px;display:block" />`

  Object.assign(indicator.style, {
    position      : 'fixed',
    top           : '-56px',
    left          : '50%',
    transform     : 'translateX(-50%) scale(0.8)',
    width         : INDICATOR_SIZE + 'px',
    height        : INDICATOR_SIZE + 'px',
    zIndex        : '9998',
    pointerEvents : 'none',
    transition    : 'none',
    opacity       : '0',
    willChange    : 'top, opacity, transform',
  })

  const style = document.createElement('style')
  style.textContent = `
    #ptr-indicator.ptr-spin img {
      animation: ptr-spin 0.7s linear infinite;
    }
    @keyframes ptr-spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    #ptr-indicator.ptr-done {
      transition: top 0.3s cubic-bezier(0.4,0,0.2,1),
                  opacity 0.3s ease,
                  transform 0.3s cubic-bezier(0.4,0,0.2,1) !important;
    }
  `
  document.head.appendChild(style)
  document.body.appendChild(indicator)

  // ── Estado ──────────────────────────────────────────────────────────────
  let touchStartY  = 0
  let pulling      = false
  let triggered    = false
  let currentDelta = 0

  function _getScrollContainer() {
    const appAnime = document.getElementById('app-anime')
    const appManga = document.getElementById('app-manga')
    if (appAnime && appAnime.style.display !== 'none' && appAnime.classList.contains('activo')) return appAnime
    if (appManga && appManga.style.display !== 'none' && appManga.classList.contains('activo')) return appManga
    return null
  }

  function _getActivePage() {
    const container = _getScrollContainer()
    if (!container) return null
    const active = container.querySelector('.pagina.activa')
    return active ? active.id : null
  }

  function _showIndicator(deltaY) {
    // Resistencia tipo rubber-band: cuanto más jala, más lento sube
    const pull  = Math.min(deltaY * 0.55, MAX_PULL)
    const ratio = pull / THRESHOLD
    const topPx = -INDICATOR_SIZE + pull * 0.9

    indicator.style.transition = 'none'
    indicator.style.top        = topPx + 'px'
    indicator.style.opacity    = Math.min(ratio * 1.2, 1).toString()
    indicator.style.transform  = `translateX(-50%) scale(${0.7 + ratio * 0.3})`
  }

  function _triggerRefresh() {
    triggered = true
    indicator.classList.add('ptr-spin')
    indicator.style.transition = 'none'
    indicator.style.top        = '12px'
    indicator.style.opacity    = '1'
    indicator.style.transform  = 'translateX(-50%) scale(1)'

    const pageId = _getActivePage()
    const reload = pageId ? PAGE_RELOAD[pageId] : null

    const finish = () => {
      indicator.classList.add('ptr-done')
      indicator.style.top       = '-56px'
      indicator.style.opacity   = '0'
      indicator.style.transform = 'translateX(-50%) scale(0.8)'
      setTimeout(() => {
        indicator.classList.remove('ptr-spin', 'ptr-done')
        triggered = false
        pulling   = false
      }, 320)
    }

    if (reload) {
      // Espera mínima de 600ms para que el spinner sea visible
      const result = reload()
      const wait   = result instanceof Promise ? result : Promise.resolve()
      Promise.race([wait, new Promise(r => setTimeout(r, 1500))]).finally(() => {
        setTimeout(finish, 200)
      })
    } else {
      setTimeout(finish, 500)
    }
  }

  function _resetIndicator() {
    indicator.classList.add('ptr-done')
    indicator.style.top       = '-56px'
    indicator.style.opacity   = '0'
    indicator.style.transform = 'translateX(-50%) scale(0.8)'
    setTimeout(() => {
      indicator.classList.remove('ptr-done')
      pulling   = false
      triggered = false
    }, 300)
  }

  // ── Touch handlers ──────────────────────────────────────────────────────
  function _isBlocked(target) {
    // Player o lector activo
    const player = document.getElementById('overlay-player')
    if (player && player.classList.contains('activo')) return true
    const lector = document.getElementById('page-manga-lector')
    if (lector && lector.classList.contains('activa')) return true

    // Overlays abiertos
    const cfgOv = document.getElementById('overlay-config')
    if (cfgOv && cfgOv.classList.contains('is-open')) return true
    const srvOv = document.getElementById('overlay-servidor')
    if (srvOv && srvOv.classList.contains('activo')) return true

    // Modales visibles
    for (const id of ['overlay-modulos','overlay-perfil','account-modal']) {
      const el = document.getElementById(id)
      if (el && el.style.display !== 'none' && el.style.display !== '') return true
    }

    // Toque dentro de elemento flotante (chat, amigos, FABs, draggables)
    if (target) {
      if (target.closest('#chat-fab,#friends-fab,.chat-window,.friends-window,[data-draggable],.draggable-window,.floating-panel'))
        return true
      // Cualquier fixed con z-index ≥ 500 que contenga el toque
      let el = target
      while (el && el !== document.body) {
        const st = window.getComputedStyle(el)
        if (st.position === 'fixed' && parseInt(st.zIndex || '0') >= 500) return true
        el = el.parentElement
      }
    }

    return false
  }

  document.addEventListener('touchstart', e => {
    if (triggered) return
    if (_isBlocked(e.target)) return
    const container = _getScrollContainer()
    if (!container || container.scrollTop > 2) return

    touchStartY  = e.touches[0].clientY
    pulling      = false
    currentDelta = 0
  }, { passive: true })

  document.addEventListener('touchmove', e => {
    if (triggered) return
    if (_isBlocked(e.target)) { pulling = false; return }
    const container = _getScrollContainer()
    if (!container || container.scrollTop > 2) { pulling = false; return }

    const deltaY = e.touches[0].clientY - touchStartY
    if (deltaY <= 0) { pulling = false; return }

    // Empezar a tirar
    pulling      = true
    currentDelta = deltaY
    _showIndicator(deltaY)
  }, { passive: true })

  document.addEventListener('touchend', () => {
    if (!pulling || triggered) return
    if (currentDelta >= THRESHOLD) {
      _triggerRefresh()
    } else {
      _resetIndicator()
    }
  }, { passive: true })

})()
