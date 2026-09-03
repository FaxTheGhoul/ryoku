// ─── extractors/_base.js ─────────────────────────────────────────────────────
// Helpers compartidos por todos los extractores
'use strict'

let BrowserWindow = null
try { ({ BrowserWindow } = require('electron')) } catch(e) {}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const AD_DOMAINS = [
  'stun.cloudflare.com','stun.l.google.com','turn.cloudflare.com',
  'pubmatic','iqzone','id5-sync','connatix','adkernel','blsync',
  'doubleclick','googlesyndication','googletagmanager','adservice','pagead','adnxs',
  'taboola','outbrain','popads','popcash','propellerads','adsterra','hilltopads',
  'trafficjunky','exoclick','juicyads','plugrush','tsyndicate','realsrv','adspyglass',
  'adcash','richpush','push.express','notix','onclickads','clickadu','etargetnet',
  // CDNs de anuncios que se hacen pasar por Mixdrop
  'subduepaler.cyou',
]

// Dominios legítimos de Mixdrop (el resto son falsos/redirigen a anuncios)
const MIXDROP_LEGIT = ['mxcontent.net','mixdrop.ag','mixdrop.co','mixdrop.bz','mixdrop.ch','mixdrop.to','mixdrop.sx','mixdrop.ps','mixdrop.gl']

// Crear BrowserWindow aislado con Referer fijo para el proveedor
function crearWin(referer) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      // SIN prefijo 'persist:' a propósito: esta ventana es de un solo uso
      // (se destruye a los segundos, en extraer()) y no necesita que su cookie
      // jar sobreviva entre llamadas — con 'persist:' cada llamada escribía una
      // carpeta de sesión nueva a disco (Partitions/stream_<timestamp>/) que
      // Electron nunca borra sola, así que en semanas de uso se acumulaban miles
      // de carpetas vacías. Sin el prefijo, la partition vive solo en memoria y
      // Electron la libera sola en cuanto se destruye la ventana.
      partition: `stream_${Date.now()}`,
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // Evita que la página intente armar candidatos ICE de WebRTC (gathering
  // de IP vía STUN) — muchos embeds de video traen scripts de tracking/anti-
  // adblock que lo disparan, y como esta VM no resuelve stun.cloudflare.com
  // ni los STUN de Google, spamea la consola con errores de resolución DNS
  // sin aportar nada a la extracción del video.
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  // Bloquear navegaciones a hosts inválidos — algunos sitios/mirrors (p.ej.
  // dsvplay.com, un mirror de doodstream) arman del lado del cliente un
  // redirect con una variable de plantilla rota que termina en
  // "https://undefined/<token>". Sin este guard, la página entera navega
  // hacia esa URL basura, matando el contexto donde jwplayer/EXTRACT_JS
  // hubiera encontrado la URL real del video, y generando ruido en
  // Chromium (ERR_NAME_NOT_RESOLVED / "bad IPC message" por el tamaño
  // del token). Bloquear la navegación deja la página original intacta
  // para que el resto de la extracción siga intentando.
  const _bloquearNavInvalida = (event, url) => {
    try {
      const h = new URL(url).hostname
      if (h === 'undefined' || h === 'null' || h === '') event.preventDefault()
    } catch(e) { event.preventDefault() }
  }
  win.webContents.on('will-navigate', _bloquearNavInvalida)
  win.webContents.on('will-redirect', _bloquearNavInvalida)
  win.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, cb) => {
    cb({ requestHeaders: {
      ...details.requestHeaders,
      'User-Agent': UA,
      'Referer': referer,
      'Accept-Language': 'es-ES,es;q=0.9',
    }})
  })
  return win
}

// Interceptar petición de red con .m3u8 o .mp4 en la URL
function interceptarVideo(win, onUrl) {
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const u  = details.url
    const ul = u.toLowerCase()
    if (AD_DOMAINS.some(d => ul.includes(d))) { cb({ cancel: true }); return }
    // Algunos mirrors (dsvplay.com, luluvdo.com) arman del lado del cliente
    // una URL con una variable de plantilla rota que queda como
    // "https://undefined/<token>" -- _bloquearNavInvalida ya corta esto para
    // navegaciones de pagina, pero un fetch/XHR/script roto hacia ese host
    // no pasa por ahi. Sin este chequeo, cada uno de esos requests gasta
    // varios segundos esperando la resolucion DNS (ERR_NAME_NOT_RESOLVED)
    // antes de fallar solo.
    try {
      const h = new URL(u).hostname
      if (h === 'undefined' || h === 'null' || h === '') { cb({ cancel: true }); return }
    } catch(e) {}
    // Verificar por PATH para evitar falso positivo con mp4upload.com en el dominio
    let esVideo = false
    try {
      const path = new URL(u).pathname.toLowerCase()
      esVideo = path.includes('.m3u8') ||
        (path.includes('.mp4') && !path.endsWith('.html') &&
         !['thumb','poster','preview','sample','advert'].some(x => path.includes(x)))
    } catch(e) {
      esVideo = ul.includes('.m3u8') || (ul.includes('.mp4') && !ul.includes('.html'))
    }
    if (esVideo) {
      const fake = ['big-buck','test-video','placeholder','advert']
      if (!fake.some(f => ul.includes(f))) { onUrl(u); cb({ cancel: false }); return }
    }
    cb({ cancel: false })
  })
}

// JS de extracción DOM — se ejecuta en la página del proveedor
const EXTRACT_JS = `(function() {
  // 1. jwplayer (mp4upload, uqload, yourupload)
  try {
    if (typeof jwplayer === 'function') {
      const jw = jwplayer()
      if (jw) {
        try { const pl=jw.getPlaylist(); if(pl&&pl[0]&&pl[0].sources&&pl[0].sources[0]) return pl[0].sources[0].file } catch(e){}
        try { const cfg=jw.getConfig(); if(cfg&&cfg.playlist&&cfg.playlist[0]&&cfg.playlist[0].sources) return cfg.playlist[0].sources[0].file } catch(e){}
      }
    }
  } catch(e) {}
  // 2. window.sources (VOE)
  try { if(window.sources){ if(window.sources.hls) return window.sources.hls; if(window.sources.mp4) return window.sources.mp4 } } catch(e){}
  // 3. eval(atob) — mp4upload ofusca la URL
  const scripts = Array.from(document.querySelectorAll('script:not([src])'))
  for (const s of scripts) {
    const t = s.textContent || ''
    const m = t.match(/eval\\s*\\(\\s*atob\\s*\\(\\s*['"]([A-Za-z0-9+/=]{20,})['"]/)
    if (m) { try { const dec=atob(m[1]);
      const f1=dec.match(/file\\s*:\\s*['"]([^'"]+\\.mp4[^'"]*)['"]/i); if(f1) return f1[1]
      const f2=dec.match(/file\\s*:\\s*['"]([^'"]+\\.m3u8[^'"]*)['"]/i); if(f2) return f2[1]
    } catch(e){} }
    const f3=t.match(/sources\\s*:\\s*\\[\\s*\\{[^}]*?file\\s*:\\s*['"]([^'"]+)['"]/i); if(f3) return f3[1]
    const f4=t.match(/[^\\w]file\\s*:\\s*['"]([^'"]+\\.(?:mp4|m3u8)[^'"]*)['"]/i); if(f4) return f4[1]
  }
  // 4. Video tag
  const vid = document.querySelector('video')
  if (vid) {
    if (vid.currentSrc && vid.currentSrc.startsWith('http')) return vid.currentSrc
    if (vid.src && vid.src.startsWith('http')) return vid.src
    const src = vid.querySelector('source'); if (src && src.src) return src.src
  }
  return window.__foundUrl || null
})()`

// Lógica común de extracción: interceptar + DOM fallback
function extraer(serverUrl, referer, timeout = 25000, debugTag = null) {
  return new Promise((resolve) => {
    let done = false
    let win  = null
    // Log opcional de diagnostico — solo cuando el llamador pasa un debugTag
    // (los demas extractores no lo pasan, asi que su consola queda igual)
    const dbg = debugTag ? (...a) => console.log(`[EXTRAER:${debugTag}]`, ...a) : () => {}

    const timer = setTimeout(() => {
      dbg('timeout alcanzado sin resultado')
      if (!done) { done = true; cleanup(); resolve(null) }
    }, timeout)

    function cleanup() {
      clearTimeout(timer)
      if (win && !win.isDestroyed()) {
        try { win.webContents.session.clearStorageData().catch(() => {}) } catch(e) {}
        win.destroy()
      }
    }

    function resolver(url) {
      if (done) return
      done = true
      cleanup()
      resolve(url)
    }

    try {
      win = crearWin(referer)
      dbg('cargando:', serverUrl, '| referer:', referer)
      interceptarVideo(win, (u) => { dbg('interceptado video:', u.substring(0, 150)); resolver(u) })

      const ACTIVAR_JS = `
        document.querySelectorAll('[class*=play],[id*=play],button').forEach(b => { try{b.click()}catch(e){} })
        document.querySelectorAll('video').forEach(v => { try{v.play()}catch(e){}; if(v.src&&v.src.startsWith('http')) window.__foundUrl=v.src })
        document.querySelectorAll('source').forEach(s => { if(s.src&&(s.src.includes('.mp4')||s.src.includes('.m3u8'))) window.__foundUrl=s.src })
      `

      // Recorre el frame principal Y todos sus subframes (recalculado en cada
      // vuelta, por si un subframe se agrega mas tarde — comun en embeds que
      // arman el iframe del player real via JS despues de cargar). Algunos
      // proveedores (Byse/Filemoon) montan el player adentro de un <iframe>
      // en vez del documento principal, así que EXTRACT_JS en el top frame
      // solo no alcanza — WebFrameMain.executeJavaScript() sí puede evaluar
      // JS en esos subframes sin importar el dominio.
      async function intentarTodosLosFrames(intentoNum) {
        if (done || !win || win.isDestroyed()) return null
        let frames
        try { frames = win.webContents.mainFrame.framesInSubtree } catch(e) { return null }
        if (intentoNum === 1) dbg('frames en la pagina:', frames.length, frames.map(f => f.url || '(sin url)').join(' | '))
        for (const f of frames) { try { await f.executeJavaScript(ACTIVAR_JS) } catch(e) {} }
        for (const f of frames) {
          if (done || !win || win.isDestroyed()) return null
          try {
            const u = await f.executeJavaScript(EXTRACT_JS)
            if (u) {
              dbg(`EXTRACT_JS (${f === win.webContents.mainFrame ? 'main' : (f.url || 'frame')}) intento ${intentoNum}:`, u)
              return u
            }
          } catch(e) {}
        }
        return null
      }

      win.webContents.on('did-finish-load', async () => {
        if (done || !win || win.isDestroyed()) return
        dbg('did-finish-load, url final:', win.webContents.getURL())

        const MAX_INTENTOS = 8 // ~2s inicial + 8x1.5s ≈ 14s, bien por debajo del timeout minimo (25s) que usan los llamadores
        await new Promise(r => setTimeout(r, 2000))
        for (let i = 1; i <= MAX_INTENTOS; i++) {
          if (done || !win || win.isDestroyed()) return
          let u = null
          try { u = await intentarTodosLosFrames(i) } catch(e) { dbg('error en intento', i, ':', e.message) }
          if (u) { resolver(u); return }
          if (i === MAX_INTENTOS) {
            dbg(`sin resultado tras ${MAX_INTENTOS} intentos en todos los frames`)
            if (!done) { done = true; cleanup(); resolve(null) }
            return
          }
          await new Promise(r => setTimeout(r, 1500))
        }
      })

      win.webContents.on('did-fail-load', (_, code, desc, validatedURL) => {
        dbg('did-fail-load code=', code, 'desc=', desc, 'url=', validatedURL)
        if (code === -3) return // redirect normal
        if (!done) { done = true; cleanup(); resolve(null) }
      })

      win.loadURL(serverUrl, {
        userAgent: UA,
        extraHeaders: `Referer: ${referer}\nOrigin: ${new URL(referer).origin}\n`
      })
    } catch(e) { if (!done) { done = true; cleanup(); resolve(null) } }
  })
}

module.exports = { UA, AD_DOMAINS, MIXDROP_LEGIT, crearWin, interceptarVideo, EXTRACT_JS, extraer }
