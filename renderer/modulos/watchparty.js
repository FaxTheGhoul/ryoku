// modulos/watchparty.js — "Ver juntos" (watch party), etapa 1: PC con PC.
//
// Cada uno reproduce el video desde su app; lo que se sincroniza por Firebase
// Realtime Database es el episodio, el servidor y el estado (play/pausa/segundo).
//
//   wp/salas/{sala}: { host, creada, ep:{url,titulo}, srv:{nombre,idioma},
//                      estado:{playing, t, at(serverTime), rate},
//                      miembros:{uid:{nombre, foto, en}} }
//   wp/invitaciones/{uid}/{sala}: { de, deNombre, deFoto, titulo, at }
//
// Solo el anfitrión controla (play/pausa/adelantar/cambiar de episodio). Los
// demás se corrigen solos si se desfasan más de ~1,5 s. Si el anfitrión sale,
// la sala termina; si un invitado cierra el reproductor, sale de la sala.
;(function () {
  'use strict'
  const DESFASE_MAX = 1.5       // s antes de corregir a un invitado
  const LATIDO_MS   = 8000      // el anfitrión reenvía su estado cada 8 s

  let _rtdb = null, _uid = null, _yo = { nombre: 'Usuario', foto: '' }
  let _offset = 0                           // reloj del servidor - reloj local
  let _sala = null, _soyHost = false
  let _refSala = null, _offSala = null, _latido = null
  let _datos = null                         // último snapshot de la sala
  let _miembrosPrev = {}
  let _cargandoEp = null                    // url del episodio que se está abriendo (invitado)
  let _invRef = null, _invitaciones = {}

  const $ = id => document.getElementById(id)
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const imgOk = s => /^(https?:|data:image\/)/i.test(String(s || '').trim()) ? esc(s) : ''
  const ahora = () => Date.now() + _offset
  const video = () => $('player-video')
  const TS = () => firebase.database.ServerValue.TIMESTAMP

  // ── Arranque ────────────────────────────────────────────────────────────
  function init() {
    const listo = () => {
      const auth = window._ryokuAuth
      if (!auth || !window.firebase?.database) { setTimeout(listo, 600); return }
      _rtdb = firebase.database()
      _rtdb.ref('.info/serverTimeOffset').on('value', s => { _offset = s.val() || 0 })
      auth.onAuthStateChanged(async u => {
        if (_invRef) { _invRef.off(); _invRef = null }
        _invitaciones = {}; _pintarInvitaciones()
        if (_sala) await salir(true)
        _uid = u ? u.uid : null
        if (!u) return
        _yo = { nombre: u.displayName || 'Usuario', foto: u.photoURL || '' }
        try {
          const d = (await window._ryokuDb.collection('users').doc(u.uid).get()).data() || {}
          _yo = { nombre: d.customName || d.displayName || _yo.nombre, foto: d.avatarURL || d.photoURL || _yo.foto }
        } catch (e) {}
        _escucharInvitaciones()
      })
    }
    listo()
    _engancharVideo()
    _envolverCerrar()
  }

  // ── Datos del episodio actual (anime.js) ────────────────────────────────
  function _epActual() {
    try { return { url: _urlEpisodioActual || '', titulo: _tituloActual || '' } } catch (e) { return { url: '', titulo: '' } }
  }
  function _srvActual() {
    try { const s = _servidores[_idxActivo]; return s ? { nombre: s.nombre || '', idioma: s.idioma || '' } : null } catch (e) { return null }
  }
  const _playerAbierto = () => $('overlay-player')?.classList.contains('activo')

  // ── Crear / unirse / salir ──────────────────────────────────────────────
  async function crear() {
    if (!_rtdb || !_uid) { _toast('Inicia sesión para ver con amigos.'); return }
    const ep = _epActual(), srv = _srvActual(), v = video()
    if (!ep.url || !_playerAbierto()) { _toast('Abre un episodio primero.'); return }
    const ref = _rtdb.ref('wp/salas').push()
    await ref.set({
      host: _uid, creada: TS(), ep, srv: srv || { nombre: '', idioma: '' },
      estado: { playing: !!(v && !v.paused), t: v ? v.currentTime || 0 : 0, at: TS(), rate: v?.playbackRate || 1 },
      miembros: { [_uid]: { nombre: _yo.nombre, foto: _yo.foto, en: TS() } },
    })
    ref.onDisconnect().remove()          // si el anfitrión se desconecta, la sala termina
    _entrar(ref.key, true)
    _abrirPanel()
  }

  async function unirse(salaId) {
    if (!_rtdb || !_uid) return
    const inv = _invitaciones[salaId]
    _rtdb.ref(`wp/invitaciones/${_uid}/${salaId}`).remove().catch(() => {})
    let snap
    try { snap = await _rtdb.ref('wp/salas/' + salaId).once('value') } catch (e) { snap = null }
    if (!snap || !snap.exists()) { _toast('Esa sala ya terminó.'); return }
    if (_sala) await salir(true)
    const mRef = _rtdb.ref(`wp/salas/${salaId}/miembros/${_uid}`)
    await mRef.set({ nombre: _yo.nombre, foto: _yo.foto, en: TS() })
    mRef.onDisconnect().remove()
    _entrar(salaId, false)
    _toast(`Te uniste a la sala de ${inv?.deNombre || 'tu amigo'}`)
  }

  function _entrar(salaId, host) {
    _sala = salaId; _soyHost = host; _datos = null; _miembrosPrev = {}; _cargandoEp = null
    _refSala = _rtdb.ref('wp/salas/' + salaId)
    const cb = _refSala.on('value', s => _alCambiarSala(s.val()))
    _offSala = () => _refSala.off('value', cb)
    clearInterval(_latido)
    if (host) _latido = setInterval(() => _publicarEstado(), LATIDO_MS)
    _pintarIndicador()
  }

  async function salir(silencioso) {
    if (!_sala) return
    const sala = _sala, host = _soyHost
    clearInterval(_latido); _latido = null
    if (_offSala) _offSala()
    _offSala = null
    try {
      if (host) { await _rtdb.ref('wp/salas/' + sala).onDisconnect().cancel(); await _rtdb.ref('wp/salas/' + sala).remove() }
      else { const m = _rtdb.ref(`wp/salas/${sala}/miembros/${_uid}`); await m.onDisconnect().cancel(); await m.remove() }
    } catch (e) {}
    _sala = null; _soyHost = false; _datos = null; _refSala = null
    _cerrarPanel(); _pintarIndicador()
    if (!silencioso) _toast(host ? 'Terminaste la sala.' : 'Saliste de la sala.')
  }

  // ── Cambios en la sala ──────────────────────────────────────────────────
  function _alCambiarSala(d) {
    if (!_sala) return
    if (!d) {                                  // la sala se borró
      const eraHost = _soyHost
      clearInterval(_latido); if (_offSala) _offSala()
      _sala = null; _soyHost = false; _datos = null; _offSala = null
      _cerrarPanel(); _pintarIndicador()
      if (!eraHost) _toast('El anfitrión terminó la sala.')
      return
    }
    // Avisos de quién entra/sale
    const m = d.miembros || {}
    if (_datos) {
      for (const u in m) if (!_miembrosPrev[u] && u !== _uid) _toast(`${m[u].nombre || 'Alguien'} se unió`)
      for (const u in _miembrosPrev) if (!m[u] && u !== _uid) _toast(`${_miembrosPrev[u].nombre || 'Alguien'} salió`)
    }
    _miembrosPrev = m
    _datos = d
    _pintarIndicador()
    if ($('wp-panel')?.classList.contains('abierto')) _pintarPanel()
    if (!_soyHost) _seguirAlHost()
  }

  // Invitado: abrir el mismo episodio/servidor y alinearse al estado del host
  async function _seguirAlHost() {
    const d = _datos; if (!d?.ep?.url) return
    const ep = _epActual()
    if (ep.url !== d.ep.url || !_playerAbierto()) {
      if (_cargandoEp === d.ep.url) return
      _cargandoEp = d.ep.url
      try {
        if (_playerAbierto() && typeof pedirServidorEp === 'function') await pedirServidorEp(d.ep.url, d.ep.titulo)
        else await abrirSelector(d.ep.url, d.ep.titulo)
        const lista = (typeof _servidores !== 'undefined' && _servidores) || []
        let idx = lista.findIndex(s => s.nombre === d.srv?.nombre && (s.idioma || '') === (d.srv?.idioma || ''))
        if (idx < 0) idx = lista.findIndex(s => s.nombre === d.srv?.nombre)
        if (idx < 0 && typeof _esFuncional === 'function') idx = lista.findIndex(s => _esFuncional(s.nombre))
        if (idx < 0 && lista.length) idx = 0
        if (idx >= 0) await elegirServidor(idx)
      } catch (e) { console.warn('[watchparty] abrir episodio:', e) }
      // Se libera al cargar el video (loadedmetadata) o, como tope, a los 45 s
      const url = d.ep.url
      setTimeout(() => { if (_cargandoEp === url) _cargandoEp = null }, 45000)
      return
    }
    _aplicarEstado()
  }

  function _objetivo(e) {
    if (!e) return null
    const at = typeof e.at === 'number' ? e.at : ahora()
    const t = (e.t || 0) + (e.playing ? Math.max(0, (ahora() - at) / 1000) * (e.rate || 1) : 0)
    return { t, playing: !!e.playing, rate: e.rate || 1 }
  }

  function _aplicarEstado() {
    if (_soyHost || !_datos) return
    const v = video(); if (!v || !_playerAbierto() || v.readyState < 1) return
    if (_epActual().url !== _datos.ep?.url) return
    const o = _objetivo(_datos.estado); if (!o) return
    if (v.playbackRate !== o.rate) v.playbackRate = o.rate
    const dif = Math.abs((v.currentTime || 0) - o.t)
    if (dif > (o.playing ? DESFASE_MAX : 0.4) && (!v.duration || o.t < v.duration)) {
      try { v.currentTime = o.t } catch (e) {}
    }
    if (o.playing && v.paused) v.play().catch(() => {})
    else if (!o.playing && !v.paused) v.pause()
  }

  // ── Anfitrión: publicar lo que hace ─────────────────────────────────────
  function _publicarEstado() {
    if (!_sala || !_soyHost || !_refSala) return
    const v = video(); if (!v || !_playerAbierto()) return
    _refSala.child('estado').set({ playing: !v.paused, t: v.currentTime || 0, at: TS(), rate: v.playbackRate || 1 }).catch(() => {})
  }
  function _publicarEpisodio() {
    if (!_sala || !_soyHost || !_refSala) return
    const ep = _epActual(); if (!ep.url) return
    if (_datos?.ep?.url === ep.url) { _publicarEstado(); return }
    const v = video()
    _refSala.update({
      ep, srv: _srvActual() || { nombre: '', idioma: '' },
      estado: { playing: !!(v && !v.paused), t: v?.currentTime || 0, at: TS(), rate: v?.playbackRate || 1 },
    }).catch(() => {})
  }

  function _engancharVideo() {
    const enganchar = () => {
      const v = video(); if (!v) { setTimeout(enganchar, 800); return }
      ;['play', 'pause', 'seeked', 'ratechange'].forEach(ev => v.addEventListener(ev, () => { if (_soyHost) _publicarEstado() }))
      v.addEventListener('loadedmetadata', () => {
        if (_soyHost) _publicarEpisodio()
        else if (_sala) { if (_cargandoEp === _epActual().url) _cargandoEp = null; setTimeout(_aplicarEstado, 50) }
      })
      v.addEventListener('playing', () => { if (_sala && !_soyHost) _aplicarEstado() })
    }
    enganchar()
  }

  // Cerrar el reproductor = salir de la sala (o terminarla si eres el anfitrión)
  function _envolverCerrar() {
    const orig = window.cerrarReproductor
    if (typeof orig !== 'function') { setTimeout(_envolverCerrar, 500); return }
    window.cerrarReproductor = async function () {
      if (_sala) salir(false)
      return orig.apply(this, arguments)
    }
  }

  // ── Invitaciones ────────────────────────────────────────────────────────
  async function invitar(amigo) {
    if (!_sala || !_soyHost || !amigo?.uid) return
    try {
      await _rtdb.ref(`wp/invitaciones/${amigo.uid}/${_sala}`).set({
        de: _uid, deNombre: _yo.nombre, deFoto: _yo.foto, titulo: _datos?.ep?.titulo || _epActual().titulo, at: TS(),
      })
      _toast(`Invitación enviada a ${amigo.displayName || 'tu amigo'}`)
    } catch (e) { _toast('No se pudo enviar la invitación.') }
  }

  function _escucharInvitaciones() {
    _invRef = _rtdb.ref('wp/invitaciones/' + _uid)
    _invRef.on('value', s => {
      const v = s.val() || {}
      // Las de más de 2 horas se descartan solas
      for (const k in v) if (typeof v[k]?.at === 'number' && ahora() - v[k].at > 2 * 3600e3) { _invRef.child(k).remove().catch(() => {}); delete v[k] }
      _invitaciones = v
      _pintarInvitaciones()
    })
  }

  function rechazar(salaId) {
    _rtdb?.ref(`wp/invitaciones/${_uid}/${salaId}`).remove().catch(() => {})
  }

  // ── Interfaz ────────────────────────────────────────────────────────────
  function _toast(msg) {
    let c = $('wp-toasts')
    if (!c) { c = document.createElement('div'); c.id = 'wp-toasts'; document.body.appendChild(c) }
    const shell = document.fullscreenElement
    if (shell && c.parentElement !== shell) shell.appendChild(c)
    else if (!shell && c.parentElement !== document.body) document.body.appendChild(c)
    const t = document.createElement('div'); t.className = 'wp-toast'; t.textContent = msg
    c.appendChild(t)
    setTimeout(() => { t.classList.add('fuera'); setTimeout(() => t.remove(), 300) }, 3200)
  }

  function _pintarInvitaciones() {
    let c = $('wp-invs')
    if (!c) { c = document.createElement('div'); c.id = 'wp-invs'; document.body.appendChild(c) }
    c.innerHTML = Object.entries(_invitaciones).filter(([k]) => k !== _sala).map(([k, i]) => `
      <div class="wp-inv">
        ${imgOk(i.deFoto) ? `<img src="${imgOk(i.deFoto)}" alt="">` : `<div class="wp-av-ph">${esc((i.deNombre || '?')[0])}</div>`}
        <div class="wp-inv-txt"><b>${esc(i.deNombre || 'Un amigo')}</b> te invita a ver<span>${esc(i.titulo || '')}</span></div>
        <button class="wp-inv-si" data-wp-unir="${esc(k)}">Unirme</button>
        <button class="wp-inv-no" data-wp-rechazar="${esc(k)}" title="Rechazar">✕</button>
      </div>`).join('')
  }

  function _pintarIndicador() {
    const btn = $('rp-wp-btn')
    if (btn) btn.classList.toggle('activo', !!_sala)
    let ind = $('wp-indicador')
    const wrap = $('rp-video-wrap')
    if (!ind && wrap) { ind = document.createElement('button'); ind.id = 'wp-indicador'; ind.type = 'button'; ind.onclick = e => { e.stopPropagation(); _togglePanel() }; wrap.appendChild(ind) }
    if (!ind) return
    if (!_sala || !_datos) { ind.style.display = 'none'; return }
    // Burbujitas con las fotos de quienes están en la sala (anfitrión primero)
    const host = _datos.host
    const lista = Object.entries(_datos.miembros || {}).sort((a, b) => (a[0] === host ? -1 : b[0] === host ? 1 : 0))
    const MAX = 5
    const avs = lista.slice(0, MAX).map(([u, x]) => {
      const nombre = (x.nombre || 'Usuario') + (u === _uid ? ' (tú)' : '') + (u === host ? ' · anfitrión' : '')
      const cara = imgOk(x.foto) ? `<img src="${imgOk(x.foto)}" alt="">` : `<span>${esc((x.nombre || '?')[0])}</span>`
      return `<div class="wp-burb ${u === host ? 'host' : ''}" title="${esc(nombre)}">${cara}</div>`
    }).join('')
    const extra = lista.length > MAX ? `<div class="wp-burb mas">+${lista.length - MAX}</div>` : ''
    ind.style.display = 'flex'
    ind.title = `Viendo juntos · ${lista.length}`
    ind.innerHTML = avs + extra
  }

  function _panel() {
    let p = $('wp-panel')
    const wrap = $('rp-video-wrap')
    if (!p && wrap) {
      p = document.createElement('div'); p.id = 'wp-panel'
      p.addEventListener('click', e => e.stopPropagation())
      p.addEventListener('dblclick', e => e.stopPropagation())
      wrap.appendChild(p)
    }
    return p
  }
  function _abrirPanel() { const p = _panel(); if (!p) return; p.classList.add('abierto'); _pintarPanel() }
  function _cerrarPanel() { $('wp-panel')?.classList.remove('abierto') }
  function _togglePanel() { const p = _panel(); if (p?.classList.contains('abierto')) _cerrarPanel(); else _abrirPanel() }

  function _pintarPanel() {
    const p = _panel(); if (!p) return
    if (!_sala) {
      p.innerHTML = `
        <div class="wp-cab"><div><p class="wp-lbl">Ver juntos</p><h4>Mira este episodio con amigos</h4></div><button class="wp-x" data-wp="cerrar">✕</button></div>
        <p class="wp-desc">Crea una sala e invita a tus amigos. Todos ven el mismo episodio al mismo tiempo; tú controlas la reproducción.</p>
        <button class="wp-prim" data-wp="crear"><i class="ti ti-users-plus"></i> Crear sala</button>`
      return
    }
    const d = _datos || {}, m = d.miembros || {}
    const miembros = Object.entries(m).sort((a, b) => (a[0] === d.host ? -1 : b[0] === d.host ? 1 : 0)).map(([u, x]) => `
      <div class="wp-mi">
        ${imgOk(x.foto) ? `<img src="${imgOk(x.foto)}" alt="">` : `<div class="wp-av-ph">${esc((x.nombre || '?')[0])}</div>`}
        <span>${esc(x.nombre || 'Usuario')}${u === _uid ? ' (tú)' : ''}</span>
        ${u === d.host ? '<em>Anfitrión</em>' : ''}
      </div>`).join('')
    let amigos = ''
    if (_soyHost) {
      const lista = (typeof window._friendsLista === 'function' ? window._friendsLista() : [])
        .filter(f => !m[f.uid]).sort((a, b) => (b.online - a.online) || String(a.displayName).localeCompare(b.displayName))
      amigos = `<p class="wp-sec">Invitar amigos</p>` + (lista.length ? lista.map(f => `
        <div class="wp-am ${f.online ? '' : 'off'}">
          ${imgOk(f.photoURL) ? `<img src="${imgOk(f.photoURL)}" alt="">` : `<div class="wp-av-ph">${esc((f.displayName || '?')[0])}</div>`}
          <span>${esc(f.displayName || 'Usuario')}<small>${f.online ? 'En línea' : 'Desconectado'}</small></span>
          <button data-wp-invitar="${esc(f.uid)}">Invitar</button>
        </div>`).join('') : '<p class="wp-vacio">No hay amigos para invitar.</p>')
    }
    p.innerHTML = `
      <div class="wp-cab"><div><p class="wp-lbl">Ver juntos</p><h4>${esc(d.ep?.titulo || '')}</h4></div><button class="wp-x" data-wp="cerrar">✕</button></div>
      <p class="wp-sec">En la sala · ${Object.keys(m).length}</p>
      <div class="wp-lista">${miembros}</div>
      ${amigos ? `<div class="wp-lista wp-amigos">${amigos}</div>` : ''}
      <button class="wp-sal" data-wp="salir">${_soyHost ? 'Terminar sala' : 'Salir de la sala'}</button>`
  }

  // Clicks (delegados)
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-wp],[data-wp-invitar],[data-wp-unir],[data-wp-rechazar]')
    if (!el) return
    e.stopPropagation()
    if (el.dataset.wpUnir) { unirse(el.dataset.wpUnir); return }
    if (el.dataset.wpRechazar) { rechazar(el.dataset.wpRechazar); return }
    if (el.dataset.wpInvitar) {
      const f = (window._friendsLista?.() || []).find(x => x.uid === el.dataset.wpInvitar)
      if (f) { invitar(f); el.disabled = true; el.textContent = 'Enviada' }
      return
    }
    const a = el.dataset.wp
    if (a === 'cerrar') _cerrarPanel()
    else if (a === 'crear') crear()
    else if (a === 'salir') salir(false)
  }, true)

  window.wpToggle = function () { _togglePanel() }
  window._wpEnSala = () => !!_sala

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
