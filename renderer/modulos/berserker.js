// ── Tema "Berserker" — efectos especiales ─────────────────────────────────
// Mismo mecanismo que miku.js/neru.js (partículas de fondo + cursor
// temático + chispas al marcar visto/favorito + sonido + hook de tema), en
// la paleta rojo sangre / negro de Berserker: en vez de flores/notas caen
// brasas y cenizas, y el sonido es más grave y metálico que el de Miku/Neru.
;(function () {
  let contenedor = null
  let intervalId = null
  let activo = false

  function crearContenedor() {
    if (contenedor && document.body.contains(contenedor)) return contenedor
    contenedor = document.createElement('div')
    contenedor.id = 'berserker-particulas'
    contenedor.setAttribute('aria-hidden', 'true')
    document.body.appendChild(contenedor)
    return contenedor
  }

  function spawnParticula() {
    if (!activo || !contenedor) return
    // Con el reproductor abierto no se ven y solo gastan GPU/CPU detrás del
    // video (cada partícula es una animación con brillo). Se retoman solas
    // al cerrarlo; las que ya estaban terminan su recorrido.
    if (document.getElementById('overlay-player')?.classList.contains('activo')) return
    const el = document.createElement('span')
    const esBrasa = Math.random() < 0.6
    el.className = esBrasa ? 'berserker-brasa' : 'berserker-ceniza'
    el.style.color = esBrasa ? '#C1121F' : '#9CA3AF'
    const izq = Math.random() * 100
    const duracion = 9 + Math.random() * 7
    const deriva = (Math.random() * 70 - 35).toFixed(0)
    el.style.left = izq + '%'
    el.style.setProperty('--miku-dur', duracion.toFixed(1) + 's')
    el.style.setProperty('--miku-drift', deriva + 'px')
    const tam = esBrasa ? (3 + Math.random() * 4).toFixed(0) : (2 + Math.random() * 3).toFixed(0)
    el.style.width = tam + 'px'
    el.style.height = tam + 'px'
    el.style.background = esBrasa ? '#C1121F' : '#9CA3AF'
    contenedor.appendChild(el)
    setTimeout(() => el.remove(), (duracion + 0.6) * 1000)
  }

  function iniciar() {
    crearContenedor()
    if (activo) return
    activo = true
    contenedor.classList.add('activo')
    for (let i = 0; i < 6; i++) setTimeout(spawnParticula, i * 380)
    intervalId = setInterval(spawnParticula, 1100)
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

  // ── Cursor temático — imagen de Guts con la armadura Berserker provista
  // por el usuario (32x32, transparencia real). Se oculta el cursor nativo
  // en todo el tema y se reemplaza por #berserker-cursor-fx, que sigue al
  // mouse. Mismo mecanismo que #miku-cursor-fx/#neru-cursor-fx. ──────────
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

  function iniciarCursor() {
    crearCursor()
    if (!cursorListenersListos) {
      document.addEventListener('mousemove', _berserkerCursorMove, { passive: true })
      document.addEventListener('mouseleave', _berserkerCursorOcultar)
      cursorListenersListos = true
    }
  }

  function detenerCursor() {
    _berserkerCursorOcultar()
  }

  // ── Golpe sintetizado (Web Audio API, sin archivos) — mismo interruptor
  // "Sonido del tema" que Miku/Neru (_ryokuMikuSonido), timbre propio: onda
  // sawtooth y tono grave, más metálico/agresivo que el blip de los otros
  // dos temas, acorde con la vibra de Berserker. ─────────────────────────
  let audioCtx = null
  function _berserkerBeep() {
    if (window._ryokuMikuSonido === false) return
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
      const t0 = audioCtx.currentTime
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(220, t0)
      osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.12)
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.10, t0 + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.28)
    } catch (e) {}
  }

  // ── Sonido de entrada — clip propio al activar el tema desde Configuración
  // (reemplaza el arpegio sintetizado; respeta el mismo switch de sonido) ──
  let _berserkerChimeAudio = new Audio('assets/berserker-chime.mp3')
  _berserkerChimeAudio.preload = 'auto'
  _berserkerChimeAudio.volume = 0.6
  try { _berserkerChimeAudio.load() } catch (e) {}
  function _berserkerChimeEntrada() {
    if (window._ryokuMikuSonido === false) return
    try {
      _berserkerChimeAudio.currentTime = 0
      _berserkerChimeAudio.play().catch(() => {})
    } catch (e) {}
  }
  window._berserkerTemaChime = _berserkerChimeEntrada

  // Llamado por core.js (aplicarPreset / initConfig / _setTemaId) y sync.js
  // al bajar config de otra sesión
  window._berserkerTemaAplicado = function (id) {
    if (id === 'berserker') iniciar()
    else detener()
  }

  // ── Chispas — micro-interacción al marcar visto / favorito ───────────
  window._berserkerSparkle = function (origen) {
    if (!activo) return
    if (!origen || typeof origen.getBoundingClientRect !== 'function') return
    _berserkerBeep()
    const rect = origen.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const N = 10
    for (let i = 0; i < N; i++) {
      const s = document.createElement('span')
      s.className = 'berserker-spark-burst'
      const ang = (Math.PI * 2 * i) / N + Math.random() * 0.4
      const dist = 24 + Math.random() * 28
      const dx = (Math.cos(ang) * dist).toFixed(0)
      const dy = (Math.sin(ang) * dist).toFixed(0)
      s.style.left = cx + 'px'
      s.style.top = cy + 'px'
      s.style.setProperty('--sx', dx + 'px')
      s.style.setProperty('--sy', dy + 'px')
      s.style.background = i % 2 === 0 ? '#C1121F' : '#9CA3AF'
      document.body.appendChild(s)
      setTimeout(() => s.remove(), 750)
    }
  }
})()
