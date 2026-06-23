// ─── extractors/mp4upload.js ──────────────────────────────────────────────────
'use strict'
let BrowserWindow = null
try { ({ BrowserWindow } = require('electron')) } catch(e) {}
const { UA, AD_DOMAINS } = require('./_base')
const axios = require('axios')

const REFERER = 'https://www.mp4upload.com/'

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

    async function resolver(rawUrl) {
      if (done) return
      done = true
      cleanup()
      // La URL que expone jwplayer puede dar 403 si el player la pide con Referer incorrecto
      // La verificamos haciendo HEAD request desde main process con Referer correcto
      try {
        await axios.head(rawUrl, {
          headers: { 'Referer': REFERER, 'User-Agent': UA },
          timeout: 5000,
          maxRedirects: 5
        })
        // Responde OK — devolver la URL directamente
        resolve({ tipo: rawUrl.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url: rawUrl })
      } catch(e) {
        // 403 u otro error — devolver igual, el player intentará con sus propios headers
        resolve({ tipo: rawUrl.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url: rawUrl })
      }
    }

    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: false,
          partition: 'persist:mp4upload',
        }
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

      // Cancelar anuncios
      win.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
        const ul = details.url.toLowerCase()
        if (AD_DOMAINS.some(d => ul.includes(d))) { cb({ cancel: true }); return }
        cb({ cancel: false })
      })

      // Forzar Referer mp4upload en TODAS las requests — incluyendo CDN
      win.webContents.session.webRequest.onBeforeSendHeaders(
        { urls: ['*://*/*'] },
        (details, cb) => {
          const h = { ...details.requestHeaders }
          h['User-Agent']      = UA
          h['Referer']         = REFERER
          h['Origin']          = 'https://www.mp4upload.com'
          h['Accept-Language'] = 'es-ES,es;q=0.9'
          cb({ requestHeaders: h })
        }
      )

      win.webContents.on('did-finish-load', async () => {
        if (done || !win || win.isDestroyed()) return

        // Click play para que jwplayer resuelva la URL
        win.webContents.executeJavaScript(`
          setTimeout(() => {
            try { jwplayer().play() } catch(e) {}
            document.querySelectorAll('[class*=play],[id*=play]').forEach(b => { try{b.click()}catch(e){} })
          }, 500)
        `).catch(()=>{})

        await new Promise(r => setTimeout(r, 3500))
        if (done || !win || win.isDestroyed()) return

        try {
          const url = await win.webContents.executeJavaScript(`(function() {
            // 1. jwplayer API
            try {
              if (typeof jwplayer === 'function') {
                const jw = jwplayer()
                const pl = jw.getPlaylist?.()
                if (pl?.[0]?.sources?.[0]?.file) return pl[0].sources[0].file
                const cfg = jw.getConfig?.()
                if (cfg?.playlist?.[0]?.sources?.[0]?.file) return cfg.playlist[0].sources[0].file
              }
            } catch(e) {}
            // 2. eval(atob) ofuscado
            for (const s of document.querySelectorAll('script:not([src])')) {
              const t = s.textContent || ''
              const m = t.match(/eval\\s*\\(\\s*atob\\s*\\(\\s*['"]([A-Za-z0-9+/=]{20,})['"]/);
              if (m) {
                try {
                  const dec = atob(m[1])
                  const f1 = dec.match(/file\\s*:\\s*['"]([^'"]+\\.mp4[^'"]*)['"]/i); if(f1) return f1[1]
                  const f2 = dec.match(/file\\s*:\\s*['"]([^'"]+\\.m3u8[^'"]*)['"]/i); if(f2) return f2[1]
                  const f3 = dec.match(/(https?:\\/\\/[^'"\\s]+\\.mp4[^'"\\s,)]*)/i); if(f3) return f3[1]
                } catch(e) {}
              }
              const f4 = t.match(/sources\\s*:\\s*\\[\\s*\\{[^}]*file\\s*:\\s*['"]([^'"]+)['"]/i); if(f4) return f4[1]
              const f5 = t.match(/[^\\w]file\\s*:\\s*['"]([^'"]+\\.(?:mp4|m3u8)[^'"]*)['"]/i); if(f5) return f5[1]
            }
            // 3. video tag
            const v = document.querySelector('video')
            if (v?.currentSrc?.startsWith('http')) return v.currentSrc
            if (v?.src?.startsWith('http')) return v.src
            return null
          })()`)

          if (url && !done) resolver(url)
          else if (!done) {
            await new Promise(r => setTimeout(r, 2000))
            if (done || !win || win.isDestroyed()) return
            const url2 = await win.webContents.executeJavaScript(`(function(){
              try { const jw=jwplayer(); const pl=jw.getPlaylist?.(); if(pl?.[0]?.sources?.[0]?.file) return pl[0].sources[0].file } catch(e){}
              const v=document.querySelector('video'); if(v?.currentSrc?.startsWith('http')) return v.currentSrc; return null
            })()`)
            if (url2 && !done) resolver(url2)
            else if (!done) { done=true; cleanup(); resolve(null) }
          }
        } catch(e) { if (!done) { done=true; cleanup(); resolve(null) } }
      })

      win.webContents.on('did-fail-load', (_, code) => {
        if (code === -3) return
        if (!done) { done=true; cleanup(); resolve(null) }
      })

      win.loadURL(serverUrl, { userAgent: UA })

    } catch(e) { if (!done) { done=true; cleanup(); resolve(null) }