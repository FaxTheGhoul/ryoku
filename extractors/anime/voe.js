// ─── extractors/voe.js ───────────────────────────────────────────────────────
'use strict'
let BrowserWindow = null
try { ({ BrowserWindow } = require('electron')) } catch(e) {}
const { UA, AD_DOMAINS } = require('./_base')

async function getStream(serverUrl) {
  return new Promise((resolve) => {
    let done = false, win = null
    const timer = setTimeout(() => { if (!done) { done=true; cleanup(); resolve(null) } }, 35000)

    function cleanup() {
      clearTimeout(timer)
      if (win && !win.isDestroyed()) {
        try { win.webContents.session.clearStorageData().catch(()=>{}) } catch(e) {}
        win.destroy()
      }
    }
    function resolver(url) {
      if (done) return
      done = true; cleanup()
      console.log('[VOE] resuelto:', url.substring(0, 120))
      resolve({ tipo: url.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url })
    }

    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: false,
          partition: `persist:voe_${Date.now()}`,
        }
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

      win.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, cb) => {
        cb({ requestHeaders: { ...details.requestHeaders, 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' } })
      })

      // Interceptar peticiones de red — captura .m3u8 directo
      win.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
        const ul = details.url.toLowerCase()
        if (AD_DOMAINS.some(d => ul.includes(d))) { cb({ cancel: true }); return }
        try {
          const pathname = new URL(details.url).pathname.toLowerCase()
          if (pathname.includes('.m3u8')) { resolver(details.url); cb({ cancel: false }); return }
        } catch(e) {}
        cb({ cancel: false })
      })

      win.webContents.on('did-finish-load', async () => {
        if (done || !win || win.isDestroyed()) return
        console.log('[VOE] cargado:', win.webContents.getURL())

        // Intentar extraer inmediatamente desde el DOM/variables de página
        for (let i = 0; i < 8; i++) {
          await new Promise(r => setTimeout(r, 500))
          if (done || !win || win.isDestroyed()) return
          try {
            const url = await win.webContents.executeJavaScript(`(function() {
              // 1. Variables globales más comunes de VOE
              const candidates = [
                window.wurl, window.hls, window.video_url, window.stream_url,
                window.sources?.hls, window.sources?.video,
                window.player_sources?.[0]?.file,
              ]
              for (const c of candidates) {
                if (typeof c === 'string' && c.startsWith('http')) return c
              }

              // 2. Buscar en todos los scripts inline: wurl=, hls=, atob(
              for (const s of document.querySelectorAll('script:not([src])')) {
                const t = s.textContent || ''

                // Patrón: var wurl = "https://..."
                let m = t.match(/(?:wurl|hls|video_url|stream_url)\s*[=:]\s*["'](https?:\/\/[^"']+)/i)
                if (m) return m[1]

                // Patrón: atob("BASE64")
                m = t.match(/atob\(["']([A-Za-z0-9+/=]{20,})["']\)/)
                if (m) {
                  try {
                    const dec = atob(m[1])
                    if (dec.startsWith('http')) return dec
                  } catch(e) {}
                }

                // Patrón URL m3u8 directa en el script
                m = t.match(/(https?:\/\/[^"'\s,;)]+\.m3u8[^"'\s,;)]*)/i)
                if (m) return m[1]
              }

              // 3. jwplayer legacy
              try {
                if (typeof jwplayer === 'function') {
                  const jw = jwplayer()
                  const pl = jw.getPlaylist?.()
                  if (pl?.[0]?.sources) {
                    const hls = pl[0].sources.find(s => s.file?.includes('.m3u8'))
                    if (hls?.file) return hls.file
                    if (pl[0].sources[0]?.file) return pl[0].sources[0].file
                  }
                }
              } catch(e) {}

              // 4. Video tag activo
              const v = document.querySelector('video[src], video source[src]')
              if (v?.src?.startsWith('http')) return v.src
              const vs = document.querySelector('video source[src]')
              if (vs?.src?.startsWith('http')) return vs.src

              return null
            })()`)
            if (url && typeof url === 'string' && url.startsWith('http')) {
              resolver(url); return
            }
          } catch(e) {}

          // Intentar activar el player si no respondió aún
          if (i === 1) {
            try {
              await win.webContents.executeJavaScript(`
                try { jwplayer().play() } catch(e) {}
                try { document.querySelector('video')?.play() } catch(e) {}
                try { document.querySelector('.play-btn, .btn-play, [class*="play"]')?.click() } catch(e) {}
              `)
            } catch(e) {}
          }
        }
        if (!done) { done=true; cleanup(); resolve(null) }
      })

      win.webContents.on('did-fail-load', (_, code) => {
        if (code === -3) return
        if (!done) { done=true; cleanup(); resolve(null) }
      })

      win.loadURL(serverUrl, {
        userAgent: UA,
        extraHeaders: 'Referer: https://latanime.org/\nOrigin: https://latanime.org\n'
      })
    } catch(e) { if (!done) { done=true; cleanup(); resolve(null) } 