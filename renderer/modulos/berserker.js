// ── Tema "Berserker" — cursor temático ────────────────────────────────────
// A diferencia de Miku/Neru (que suman partículas + sonido + chispas), acá
// solo se pidió el cursor personalizado -- mismo mecanismo que
// #miku-cursor-fx/#neru-cursor-fx en miku.js/neru.js: se oculta el cursor
// nativo del sistema en todo el tema (ver styles.css) y se reemplaza por un
// div que sigue al mouse con la imagen de Guts con la armadura Berserker.
;(function () {
  let activo = false
  let cursorEl = null
  let cursorListenersListos = false

  function crearCursor() {
    if (cursorEl && document.body.contains(cursorEl)) return cursorEl
    cursorEl = document.createElement('div')
    cursorEl.id = 'berserker-cursor-fx'
    cursorEl.setAttribute('aria-hidden', 'true')
    document.body.appendChild(cursorEl)
    // Si ya estábamos en pantalla completa al cambiar de tema, reubicar de
    // una dentro del elemento fullscreen -- si no, hasta el próximo
    // fullscreenchange quedaría colgado de <body> e invisible (ver core.js).
    if (typeof window._reubicarCursorTematicoFullscreen === 'function') window._reubicarCursorTematicoFullscreen()
    return cursorEl
  }

  function _berserkerCursorMove(e) {
    if (!activo || !cursorEl) return
    cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
    cursorEl.classList.add('activo')
  }

  function _berserkerCursorOcultar() {
    if (cursorEl) cursorEl.classList.remove('activo')
  }

  function iniciar() {
    if (activo) return
    activo = true
    crearCursor()
    if (!cursorListenersListos) {
      document.addEventListener('mousemove', _berserkerCursorMove, { passive: true })
      document.addEventListener('mouseleave', _berserkerCursorOcultar)
      cursorListenersListos = true
    }
  }

  function detener() {
    activo = false
    _berserkerCursorOcultar()
  }

  // Llamado por core.js (aplicarPreset / initConfig) y sync.js al bajar config
  window._berserkerTemaAplicado = function (id) {
    if (id === 'berserker') iniciar()
    else detener()
  }
})()
