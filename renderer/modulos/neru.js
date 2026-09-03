// ── Tema "Akita Neru" — efectos especiales ───────────────────────────────
// Mismo mecanismo que miku.js (partículas de fondo + cursor temático +
// chispas al marcar visto/favorito + hook de tema), en la paleta
// ámbar/verde de Neru.
;(function () {
  const FLORES = ['❀', '✿']
  let contenedor = null
  let intervalId = null
  let activo = false

  function crearContenedor() {
    if (contenedor && document.body.contains(contenedor)) return contenedor
    contenedor = document.createElement('div')
    contenedor.id = 'neru-particulas'
    contenedor.setAttribute('aria-hidden', 'true')
    document.body.appendChild(contenedor)
    return contenedor
  }

  function spawnParticula() {
    if (!activo || !contenedor) return
    const el = document.createElement('span')
    const usarFlor = Math.random() < 0.55
    const colorA = Math.random() < 0.5
    const color = colorA ? '#F2A30E' : '#8FBF3F'
    el.className = usarFlor ? 'neru-flor' : 'neru-chispa-flot'
    if (usarFlor) el.textContent = FLORES[Math.floor(Math.random() * FLORES.length)]
    const izq = Math.random() * 100
    const duracion = 10 + Math.random() * 8
    const deriva = (Math.random() * 70 - 35).toFixed(0)
    el.style.left = izq + '%'
    el.style.setProperty('--miku-dur', duracion.toFixed(1) + 's')
    el.style.setProperty('--miku-drift', deriva + 'px')
    el.style.color = color
    if (usarFlor) {
      el.style.fontSize = (12 + Math.random() * 11).toFixed(0) + 'px'
    } else {
      const tam = (3 + Math.random() * 4).toFixed(0)
      el.style.width = tam + 'px'
      el.style.height = tam + 'px'
      el.style.background = color
    }
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

  // ── Cursor temático — el chibi + flechita que subió el usuario (un solo
  // cuadro, 32x32, con transparencia real; el cursor nativo se oculta por
  // CSS en todo el tema Neru y este elemento sigue al mouse). Mismo
  // mecanismo que #miku-cursor-fx en miku.js. ───────────────────────────
  let cursorEl = null
  let cursorListenersListos = false

  function crearCursor() {
    if (cursorEl && document.body.contains(cursorEl)) return cursorEl
    cursorEl = document.createElement('div')
    cursorEl.id = 'neru-cursor-fx'
    cursorEl.setAttribute('aria-hidden', 'true')
    document.body.appendChild(cursorEl)
    // Si ya estábamos en pantalla completa (p.ej. se cambió de tema con el
    // reproductor fullscreen abierto), reubicar de una dentro del elemento
    // fullscreen -- si no, hasta el próximo fullscreenchange quedaría
    // colgado de <body> e invisible (ver core.js).
    if (typeof window._reubicarCursorTematicoFullscreen === 'function') window._reubicarCursorTematicoFullscreen()
    return cursorEl
  }

  function _neruCursorMove(e) {
    if (!activo || !cursorEl) return
    cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
    cursorEl.classList.add('activo')
  }

  function _neruCursorOcultar() {
    if (cursorEl) cursorEl.classList.remove('activo')
  }

  function iniciarCursor() {
    crearCursor()
    if (!cursorListenersListos) {
      document.addEventListener('mousemove', _neruCursorMove, { passive: true })
      document.addEventListener('mouseleave', _neruCursorOcultar)
      cursorListenersListos = true
    }
  }

  function detenerCursor() {
    _neruCursorOcultar()
  }

  // ── Blip sintetizado (Web Audio API, sin archivos) — mismo timbre que
  // usa Miku; es un blip genérico de UI, no algo "de Miku" en sí. ────────
  let audioCtx = null
  function _neruBeep() {
    if (window._ryokuMikuSonido === false) return
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
      const t0 = audioCtx.currentTime
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, t0)
      osc.frequency.exponentialRampToValueAtTime(1568, t0 + 0.09)
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.11, t0 + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.3)
    } catch (e) {}
  }

  // ── Acorde de entrada -- sonoridad propia al activar el tema desde
  // Configuración, distinta a la de Miku para que se note la variación al
  // cambiar de tema: onda triangular (más "electrónica/8-bit", acorde con
  // la vibra de Neru) y un arpegio DESCENDENTE (Miku usa uno ascendente en
  // seno puro) -- mismo mecanismo que _mikuChimeEntrada, timbre distinto.
  function _neruChimeEntrada() {
    if (window._ryokuMikuSonido === false) return
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
      const t0 = audioCtx.currentTime
      const notas = [880.00, 698.46, 587.33] // La5, Fa5, Re5 -- descendente
      notas.forEach((freq, i) => {
        const t = t0 + i * 0.11
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, t)
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.start(t)
        osc.stop(t + 0.34)
      })
    } catch (e) {}
  }
  window._neruTemaChime = _neruChimeEntrada

  // Llamado por core.js (aplicarPreset / initConfig) y sync.js al bajar config
  window._neruTemaAplicado = function (id) {
    if (id === 'neru') iniciar()
    else detener()
  }

  // ── Chispas — micro-interacción al marcar visto / favorito ───────────
  window._neruSparkle = function (origen) {
    if (!activo) return
    if (!origen || typeof origen.getBoundingClientRect !== 'function') return
    _neruBeep()
    const rect = origen.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const N = 10
    for (let i = 0; i < N; i++) {
      const s = document.createElement('span')
      s.className = 'neru-spark-burst'
      const ang = (Math.PI * 2 * i) / N + Math.random() * 0.4
      const dist = 24 + Math.random() * 28
      const dx = (Math.cos(ang) * dist).toFixed(0)
      const dy = (Math.sin(ang) * dist).toFixed(0)
      s.style.left = cx + 'px'
      s.style.top = cy + 'px'
      s.style.setProperty('--sx', dx + 'px')
      s.style.setProperty('--sy', dy + 'px')
      s.style.background = i % 2 === 0 ? '#F2A30E' : '#8FBF3F'
      document.body.appendChild(s)
      setTimeout(() => s.remove(), 750)
    }
  }
})()
