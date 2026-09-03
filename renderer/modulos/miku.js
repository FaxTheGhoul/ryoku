// ── Tema "Hatsune Miku" — efectos especiales ─────────────────────────────
// Solo colores no alcanza: esto agrega partículas flotantes de fondo,
// chispas al marcar episodios como vistos / favoritos, y expone el hook
// que core.js y sync.js llaman cuando cambia el tema activo (data-tema-id).
;(function () {
  const NOTAS = ['♪', '♫', '♬']
  let contenedor = null
  let intervalId = null
  let activo = false

  function crearContenedor() {
    if (contenedor && document.body.contains(contenedor)) return contenedor
    contenedor = document.createElement('div')
    contenedor.id = 'miku-particulas'
    contenedor.setAttribute('aria-hidden', 'true')
    document.body.appendChild(contenedor)
    return contenedor
  }

  function spawnParticula() {
    if (!activo || !contenedor) return
    const el = document.createElement('span')
    const usarNota = Math.random() < 0.55
    const colorA = Math.random() < 0.5
    const color = colorA ? '#39C5BB' : '#FF2E92'
    el.className = usarNota ? 'miku-nota' : 'miku-chispa-flot'
    if (usarNota) el.textContent = NOTAS[Math.floor(Math.random() * NOTAS.length)]
    const izq = Math.random() * 100
    const duracion = 10 + Math.random() * 8
    const deriva = (Math.random() * 70 - 35).toFixed(0)
    el.style.left = izq + '%'
    el.style.setProperty('--miku-dur', duracion.toFixed(1) + 's')
    el.style.setProperty('--miku-drift', deriva + 'px')
    el.style.color = color
    if (usarNota) {
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

  // ── Cursor temático — puntero animado (sprite de 8 cuadros, ver styles.css) ──
  // El cursor nativo se oculta por CSS en todo el tema Miku; este elemento
  // sigue al mouse y muestra el sprite (la animación de cuadros la hace el
  // CSS solo, vía @keyframes + steps(), sin tocarlo desde JS).
  let cursorEl = null
  let cursorListenersListos = false

  function crearCursor() {
    if (cursorEl && document.body.contains(cursorEl)) return cursorEl
    cursorEl = document.createElement('div')
    cursorEl.id = 'miku-cursor-fx'
    cursorEl.setAttribute('aria-hidden', 'true')
    document.body.appendChild(cursorEl)
    return cursorEl
  }

  function _mikuCursorMove(e) {
    if (!activo || !cursorEl) return
    cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
    cursorEl.classList.add('activo')
  }

  function _mikuCursorOcultar() {
    if (cursorEl) cursorEl.classList.remove('activo')
  }

  function iniciarCursor() {
    crearCursor()
    if (!cursorListenersListos) {
      document.addEventListener('mousemove', _mikuCursorMove, { passive: true })
      document.addEventListener('mouseleave', _mikuCursorOcultar)
      cursorListenersListos = true
    }
  }

  function detenerCursor() {
    _mikuCursorOcultar()
  }

  // ── Blip sintetizado (Web Audio API, sin archivos) ────────────────────
  let audioCtx = null
  function _mikuBeep() {
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

  // ── Acorde de entrada — sonidentidad al activar el tema desde Configuración
  // (arpegio de 3 notas, distinto del blip de _mikuBeep para que no se
  // confundan; respeta el mismo switch de sonido) ───────────────────────
  function _mikuChimeEntrada() {
    if (window._ryokuMikuSonido === false) return
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
      const t0 = audioCtx.currentTime
      const notas = [659.25, 783.99, 987.77] // Mi5, Sol5, Si5
      notas.forEach((freq, i) => {
        const t = t0 + i * 0.11
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freq, t)
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.13, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32)
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.start(t)
        osc.stop(t + 0.34)
      })
    } catch (e) {}
  }
  window._mikuTemaChime = _mikuChimeEntrada

  // Llamado por core.js (aplicarPreset / initConfig) y sync.js al bajar config
  window._mikuTemaAplicado = function (id) {
    if (id === 'miku') iniciar()
    else detener()
  }

  // ── Chispas — micro-interacción al marcar visto / favorito ───────────
  window._mikuSparkle = function (origen) {
    if (!activo) return
    if (!origen || typeof origen.getBoundingClientRect !== 'function') return
    _mikuBeep()
    const rect = origen.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const N = 10
    for (let i = 0; i < N; i++) {
      const s = document.createElement('span')
      s.className = 'miku-spark-burst'
      const ang = (Math.PI * 2 * i) / N + Math.random() * 0.4
      const dist = 24 + Math.random() * 28
      const dx = (Math.cos(ang) * dist).toFixed(0)
      const dy = (Math.sin(ang) * dist).toFixed(0)
      s.style.left = cx + 'px'
      s.style.top = cy + 'px'
      s.style.setProperty('--sx', dx + 'px')
      s.style.setProperty('--sy', dy + 'px')
      s.style.background = i % 2 === 0 ? '#39C5BB' : '#FF2E92'
      document.body.appendChild(s)
      setTimeout(() => s.remove(), 750)
    }
  }
})()
