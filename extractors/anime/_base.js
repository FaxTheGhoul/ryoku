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
      partition: `persist:stream_${Date.now()}`,
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
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
function extraer(serverUrl, referer, timeout = 25000) {
  return new Promise((resolve) => {
    let done = false
    let win  = null

    const timer = setTimeout(() => {
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
      interceptarVideo(win, resolver)

      win.webContents.on('did-finish-load', async () => {
        if (done || !win || win.isDestroyed()) return
        // Intentar activar el player con clicks
        win.webContents.executeJavaScript(`
          setTimeout(() => {
            document.querySelectorAll('[class*=play],[id*=play],button').forEach(b => { try{b.click()}catch(e){} })
            document.querySelectorAll('video').forEach(v => { try{v.play()}catch(e){}; if(v.src&&v.src.startsWith('http')) window.__foundUrl=v.src })
            document.querySelectorAll('source').forEach(s => { if(s.src&&(s.src.includes('.mp4')||s.src.includes('.m3u8'))) window.__foundUrl=s.src })
          }, 1000)
        `).catch(() => {})

        await new Promise(r => setTimeout(r, 2500))
        if (done || !win || win.isDestroyed()) return

        try {
          const url = await win.webContents.executeJavaScript(EXTRACT_JS)
          if (url) resolver(url)
          else if (!done) {
            setTimeout(async () => {
              if (done || !win || win.isDestroyed()) return
              try {
                const url2 = await win.webContents.executeJavaScript(EXTRACT_JS)
                if (url2) resolver(url2)
                else { done = true; cleanup(); resolve(null) }
              } catch(e) { done = true; cleanup(); resolve(null) }
            }, 1500)
          }
        } catch(e) { if (!done) { done = true; cleanup(); resolve(null) } }
      })

      win.webContents.on('did-fail-load', (_, code) => {
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
