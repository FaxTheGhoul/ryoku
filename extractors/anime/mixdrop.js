// ─── extractors/mixdrop.js ───────────────────────────────────────────────────
'use strict'
let BrowserWindow = null
try { ({ BrowserWindow } = require('electron')) } catch(e) {}
const { UA, AD_DOMAINS, MIXDROP_LEGIT } = require('./_base')

// Dominios falsos que redirigen a anuncios en vez de al video real
// miixdrop.net is the real current Mixdrop domain; only block ad CDN via AD_DOMAINS
const FAKE_MIXDROP = []  // kept for future use, redirect interception disabled
// Dominio fallback al detectar un fake
const MIXDROP_FALLBACK = 'mixdrop.ag'

function getReferer(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.hostname}/` } catch(e) { return 'https://mixdrop.ag/' }
}

function esMediaValida(url) {
  const ul = url.toLowerCase()
  if (!url.startsWith('http')) return false
  if (AD_DOMAINS.some(d => ul.includes(d))) return false
  if (ul.includes('doubleclick') || ul.includes('googlesyndication') || ul.includes('googletagmanager')) return false
  // Solo aceptar URLs con extensión real de media (mp4, m3u8, webm)
  return /\.(mp4|m3u8|webm)(\?|&|$|#|\/|:)/.test(ul) || /\.(mp4|m3u8|webm)$/.test(ul.split('?')[0])
}

async function getStream(serverUrl) {
  return new Promise((resolve) => {
    let done = false, win = null
    let currentUrl = serverUrl
    let _triedFallback = false
    const timer = setTimeout(() => {
      if (!done) { done = true; cleanup(); resolve(null) }
    }, 35000)

    function cleanup() {
      clearTimeout(timer)
      if (win && !win.isDestroyed()) {
        try {
          const d = win.webContents.debugger
          if (d.isAttached()) d.detach().catch(() => {})
        } catch(e) {}
        try { win.webContents.session.clearStorageData().catch(() => {}) } catch(e) {}
        // Pequeño delay para dejar que el debugger procese antes de destruir
        setImmediate(() => { try { if (win && !win.isDestroyed()) win.destroy() } catch(e) {} })
      }
    }

    async function resolver(url) {
      if (done) return
      if (!esMediaValida(url)) return
      console.log('[MIXDROP] resuelto:', url.substring(0, 120))
      done = true
      const ul = url.toLowerCase()
      // Copiar cookies de la sesión de extracción antes de destruir la ventana
      let sessionCookies = []
      try {
        if (win && !win.isDestroyed()) {
          sessionCookies = await win.webContents.session.cookies.get({})
          console.log('[MIXDROP] cookies capturadas:', sessionCookies.length)
        }
      } catch(e) {}
      cleanup()
      resolve({ tipo: ul.includes('.m3u8') ? 'm3u8' : 'mp4', url, sessionCookies, referer: getReferer(serverUrl) })
    }

    async function intentarExtraerJS() {
      if (done || !win || win.isDestroyed()) return
      try {
        const url = await win.webContents.executeJavaScript(`(function() {
          // 1. Runtime objects: nMDCore.wurl / MDCore.wurl (Mixdrop-specific)
          const core = window.nMDCore || window.MDCore || window.nmdCore
          if (core) {
            console.log('[MX-JS] nMDCore keys:', Object.keys(core).join(','))
            const toAbs = u => (u && u.startsWith('//')) ? 'https:' + u : u
            const w = toAbs(core.wurl) || toAbs(core.stream) || toAbs(core.url) || toAbs(core.furl)
            if (w && w.startsWith('http')) return w
          }

          // 2. Video elements
          const vids = document.querySelectorAll('video')
          for (const v of vids) {
            if (v.currentSrc && v.currentSrc.startsWith('http')) return v.currentSrc
            if (v.src && v.src.startsWith('http')) return v.src
          }

          // 3. Global window strings que parezcan stream URL
          for (const k of Object.keys(window)) {
            try {
              const val = window[k]
              if (typeof val === 'string' && val.length > 20 &&
                  /^https?:\\/\\//.test(val) &&
                  /\\.(mp4|m3u8|webm)(\\?|$)/.test(val)) return val
            } catch(e) {}
          }

          // 4. Texto de scripts inline
          const scripts = Array.from(document.querySelectorAll('script:not([src])'))
          for (const s of scripts) {
            const t = s.textContent || ''
            const patterns = [
              /wurl\\s*[=:]\\s*["']([^"']{20,})["']/i,
              /["'](https?:\\/\\/[^"'\\s]{10,}mxcontent[^"'\\s]*)["']/i,
              /["'](https?:\\/\\/[^"'\\s]{10,}\\.mp4(?:\\?[^"'\\s]*)?)["']/i,
              /["'](https?:\\/\\/[^"'\\s]{10,}\\.m3u8(?:[^"'\\s]*)?)["']/i,
              /file\\s*:\\s*["']([^"']{20,})["']/i,
            ]
            for (const p of patterns) {
              const m = t.match(p)
              if (m && m[1] && m[1].startsWith('http')) return m[1]
            }
          }

          // 5. source[src]
          const src = document.querySelector('source[src]')
          if (src && src.src && src.src.startsWith('http')) return src.src
          return null
        })()`)
        if (url) resolver(url)
        else console.log('[MIXDROP] extractor JS: null')
      } catch(e) { console.log('[MIXDROP] extractor JS error:', e.message) }
    }

    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false, contextIsolation: true,
          webSecurity: false, partition: 'persist:mixdrop_v3'
        }
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

      // ── CDP: interceptar TODAS las requests de red ─────────────────────
      try {
        win.webContents.debugger.attach('1.3')
        win.webContents.debugger.sendCommand('Network.enable')
        win.webContents.debugger.on('message', (_, method, params) => {
          if (method === 'Network.requestWillBeSent') {
            const u = params.request?.url || ''
            if (esMediaValida(u)) {
              console.log('[MIXDROP] CDP capturó:', u.substring(0, 120))
              resolver(u)
            }
          }
          if (method === 'Network.responseReceived') {
            const u = params.response?.url || ''
            const mime = (params.response?.mimeType || '').toLowerCase()
            if (mime.includes('video') || mime.includes('mpegurl') || mime.includes('octet-stream')) {
              if (esMediaValida(u)) {
                console.log('[MIXDROP] CDP mime video:', u.substring(0, 120))
                resolver(u)
              }
            }
          }
        })
      } catch(e) { console.log('[MIXDROP] CDP no disponible:', e.message) }

      // ── session webRequest como respaldo ───────────────────────────────
      win.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, cb) => {
        const ref = getReferer(currentUrl)
        cb({ requestHeaders: { ...details.requestHeaders, 'User-Agent': UA, 'Referer': ref, 'Accept-Language': 'es-ES,es;q=0.9' } })
      })

      win.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
        const u = details.url, ul = u.toLowerCase()
        if (AD_DOMAINS.some(d => ul.includes(d))) { cb({ cancel: true }); return }

        // Interceptar navegación principal a dominios falsos (redirect HTTP server-side)
        if (!_triedFallback && details.resourceType === 'mainFrame' && FAKE_MIXDROP.some(d => ul.includes(d))) {
          _triedFallback = true
          cb({ cancel: true })
          const m = u.match(/\/e\/([a-zA-Z0-9]+)/)
          if (m) {
            const fallback = `https://${MIXDROP_FALLBACK}/e/${m[1]}`
            console.log('[MIXDROP] dominio falso bloqueado, cargando fallback:', fallback)
            setImmediate(() => {
              if (!done && win && !win.isDestroyed()) {
                currentUrl = fallback
                win.loadURL(fallback, { userAgent: UA, extraHeaders: `Referer: https://${MIXDROP_FALLBACK}/\nOrigin: https://${MIXDROP_FALLBACK}\n` })
              }
            })
          } else {
            if (!done) { done = true; cleanup(); resolve(null) }
          }
          return
        }

        if (details.resourceType === 'media' && u.startsWith('http')) { resolver(u) }
        if (esMediaValida(u)) { resolver(u) }
        cb({ cancel: false })
      })

      win.webContents.on('did-finish-load', () => {
        currentUrl = win.webContents.getURL()
        console.log('[MIXDROP] did-finish-load:', currentUrl)
        // Dump diagnóstico a los 4s
        setTimeout(async () => {
          if (done || !win || win.isDestroyed()) return
          try {
            const dump = await win.webContents.executeJavaScript(`(function(){
              const core = window.nMDCore || window.MDCore || null
              const coreInfo = core ? {keys: Object.keys(core), wurl: core.wurl, ref: core.ref} : null
              const vids = Array.from(document.querySelectorAll('video')).map(v=>({src:v.src,cur:v.currentSrc}))
              const iframes = Array.from(document.querySelectorAll('iframe')).map(f=>f.src)
              // buscar cualquier URL de media en scripts
              const mediaUrls = []
              document.querySelectorAll('script:not([src])').forEach(s=>{
                const m = s.textContent.match(/https?:\/\/[^"'\\s]{15,}\\.(mp4|m3u8|webm)[^"'\\s]{0,100}/gi)
                if(m) mediaUrls.push(...m.slice(0,3))
              })
              return JSON.stringify({core: coreInfo, vids, iframes: iframes.slice(0,3), mediaUrls, title: document.title, bodyLen: document.body?.innerHTML?.length})
            })()`)
            console.log('[MIXDROP] DUMP8s:', dump)
          } catch(e) { console.log('[MIXDROP] dump error:', e.message) }
        }, 8000)
        setTimeout(intentarExtraerJS, 2000)
        setTimeout(intentarExtraerJS, 5000)
        setTimeout(intentarExtraerJS, 10000)
        setTimeout(intentarExtraerJS, 15000)
      })

      win.webContents.on('did-navigate', (_, url) => {
        currentUrl = url
        setTimeout(intentarExtraerJS, 2000)
        setTimeout(intentarExtraerJS, 5000)
      })

      win.webContents.on('did-fail-load', (_, code) => { if (code === -3) return })

      const ref = getReferer(serverUrl)
      win.loadURL(serverUrl, {
        userAgent: UA,
        extraHeaders: `Referer: ${ref}\nOrigin: ${ref.slice(0, -1)}\n`
      })
    } catch(e) { if (!done) { done = true; cleanup(); resolve(null) }