// ── Tema "Metaphor: ReFantazio" — efectos especiales ─────────────────────
// Mismo mecanismo que miku.js/neru.js/berserker.js (partículas de fondo +
// cursor temático + chispas al marcar visto/favorito + sonido + hook de
// tema), en la paleta del logo oficial: turquesa #227178 (mitad izquierda
// del wordmark "META") + carmesí #B04950 (mitad derecha, degradé hacia
// "PHOR"), con el ámbar del fuego del arte de fondo (#F8923D) como color
// extra para las partículas -- en vez de flores/notas caen brasas
// carmesí y chispas turquesa, como cenizas del meteoro del fondo.
;(function () {
  let contenedor = null
  let intervalId = null
  let activo = false

  function crearContenedor() {
    if (contenedor && document.body.contains(contenedor)) return contenedor
    contenedor = document.createElement('div')
    contenedor.id = 'metaphor-particulas'
    contenedor.setAttribute('aria-hidden', 'true')
    document.body.appendChild(contenedor)
    return contenedor
  }

  function spawnParticula() {
    if (!activo || !contenedor) return
    if (window._ryokuParticulas === false) return
    // Con el reproductor abierto no se ven y solo gastan GPU/CPU detrás del
    // video (cada partícula es una animación con brillo). Se retoman solas
    // al cerrarlo; las que ya estaban terminan su recorrido.
    if (document.getElementById('overlay-player')?.classList.contains('activo')) return
    const el = document.createElement('span')
    const esBrasa = Math.random() < 0.55
    const color = esBrasa ? '#B04950' : '#65CED7'
    el.className = esBrasa ? 'metaphor-brasa' : 'metaphor-chispa-flot'
    const izq = Math.random() * 100
    const duracion = 10 + Math.random() * 8
    const deriva = (Math.random() * 70 - 35).toFixed(0)
    el.style.left = izq + '%'
    el.style.setProperty('--miku-dur', duracion.toFixed(1) + 's')
    el.style.setProperty('--miku-drift', deriva + 'px')
    el.style.color = color
    const tam = (3 + Math.random() * 4).toFixed(0)
    el.style.width = tam + 'px'
    el.style.height = tam + 'px'
    el.style.background = color
    contenedor.appendChild(el)
    setTimeout(() => el.remove(), (duracion + 0.6) * 1000)
  }

  function iniciar() {
    crearContenedor()
    if (activo) return
    activo = true
    contenedor.classList.add('activo')
    for (let i = 0; i < 3; i++) setTimeout(spawnParticula, i * 600)
    intervalId = setInterval(spawnParticula, 2400)
    iniciarCursor()
  }

  function detener() {
    activo = false
    if (intervalId) clearInterval(intervalId)
    intervalId = null
    if (contenedor) {
      contenedor.classList.remove('activo')
      contenedor.innerHTML = ''
    }
    detenerCursor()
  }

  // ── Cursor temático — gema turquesa/carmesí (generada a partir de la
  // paleta del logo, sin arte de personaje disponible para este tema).
  // Se oculta el cursor nativo del sistema en todo el tema y se reemplaza
  // por #metaphor-cursor-fx, que sigue al mouse. Mismo mecanismo que
  // #miku-cursor-fx/#neru-cursor-fx/#berserker-cursor-fx. ───────────────
  let cursorEl = null
  let cursorListenersListos = false

  function crearCursor() {
    if (cursorEl && document.body.contains(cursorEl)) return cursorEl
    cursorEl = document.createElement('div')
    cursorEl.id = 'metaphor-cursor-fx'
    cursorEl.setAttribute('aria-hidden', 'true')
    document.body.appendChild(cursorEl)
    // Si ya estábamos en pantalla completa al cambiar de tema, reubicar de
    // una dentro del elemento fullscreen -- si no, hasta el próximo
    // fullscreenchange quedaría colgado de <body> e invisible (ver core.js).
    if (typeof window._reubicarCursorTematicoFullscreen === 'function') window._reubicarCursorTematicoFullscreen()
    return cursorEl
  }

  function _metaphorCursorMove(e) {
    if (!activo || !cursorEl) return
    cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
    cursorEl.classList.add('activo')
  }

  function _metaphorCursorOcultar() {
    if (cursorEl) cursorEl.classList.remove('activo')
  }

  function iniciarCursor() {
    crearCursor()
    if (!cursorListenersListos) {
      document.addEventListener('mousemove', _metaphorCursorMove, { passive: true })
      document.addEventListener('mouseleave', _metaphorCursorOcultar)
      cursorListenersListos = true
    }
  }

  function detenerCursor() {
    _metaphorCursorOcultar()
  }

  // ── Fanfarria sintetizada (Web Audio API, sin archivos) — mismo
  // interruptor "Sonido del tema" que Miku/Neru/Berserker (_ryokuMikuSonido).
  // Onda cuadrada (retro/orquestal, más "de proclamación real" que el blip
  // fino de Miku), tono medio-agudo con ataque rápido. ───────────────────
  let audioCtx = null
  function _metaphorBeep() {
    if (window._ryokuMikuSonido === false) return
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
      const t0 = audioCtx.currentTime
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'square'
      osc.frequency.setValueAtTime(659.25, t0)
      osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.09)
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.28)
    } catch (e) {}
  }

  // ── Sonido de entrada — clip propio al activar el tema desde Configuración
  // (reemplaza el arpegio sintetizado; respeta el mismo switch de sonido) ──
  let _metaphorChimeAudio = new Audio('assets/metaphor-chime.wav')
  _metaphorChimeAudio.preload = 'auto'
  _metaphorChimeAudio.volume = 0.6
  try { _metaphorChimeAudio.load() } catch (e) {}
  function _metaphorChimeEntrada() {
    if (window._ryokuMikuSonido === false) return
    try {
      _metaphorChimeAudio.currentTime = 0
      _metaphorChimeAudio.play().catch(() => {})
    } catch (e) {}
  }
  window._metaphorTemaChime = _metaphorChimeEntrada

  // Llamado por core.js (aplicarPreset / initConfig / _setTemaId) y sync.js
  // al bajar config de otra sesión
  window._metaphorTemaAplicado = function (id) {
    if (id === 'metaphor') iniciar()
    else detener()
  }

  // ── Chispas — micro-interacción al marcar visto / favorito ───────────
  window._metaphorSparkle = function (origen) {
    if (!activo) return
    if (!origen || typeof origen.getBoundingClientRect !== 'function') return
    _metaphorBeep()
    const rect = origen.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const N = 10
    for (let i = 0; i < N; i++) {
      const s = document.createElement('span')
      s.className = 'metaphor-spark-burst'
      const ang = (Math.PI * 2 * i) / N + Math.random() * 0.4
      const dist = 24 + Math.random() * 28
      const dx = (Math.cos(ang) * dist).toFixed(0)
      const dy = (Math.sin(ang) * dist).toFixed(0)
      s.style.left = cx + 'px'
      s.style.top = cy + 'px'
      s.style.setProperty('--sx', dx + 'px')
      s.style.setProperty('--sy', dy + 'px')
      s.style.background = i % 2 === 0 ? '#B04950' : '#65CED7'
      document.body.appendChild(s)
      setTimeout(() => s.remove(), 750)
    }
  }
})()
