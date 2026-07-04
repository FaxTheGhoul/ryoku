// ─── extractors/savefiles.js ─────────────────────────────────────────────────
'use strict'
const { crearWin, UA, AD_DOMAINS } = require('./_base')

// Savefiles.io / savefiles.net — player basado en video tag o API
const REFERER = 'https://savefiles.io/'

async function getStream(serverUrl) {
  return new Promise((resolve) => {
    let done = false, win = null
    const timer = setTimeout(() => { if (!done) { done=true; cleanup(); resolve(null) } }, 30000)

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
      resolve({ tipo: url.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url })
    }

    try {
      win = crearWin(REFERER)

      win.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
        const u = details.url, ul = u.toLowerCase()
        if (AD_DOMAINS.some(d => ul.includes(d))) { cb({ cancel: true }); return }
        try {
          const p = new URL(u).pathname.toLowerCase()
          if ((p.includes('.mp4') || p.includes('.m3u8')) &&
              !p.endsWith('.html') &&
              !['thumb','poster','sample','advert'].some(x => p.includes(x))) {
            resolver(u); cb({ cancel: false }); return
          }
        } catch(e) {}
        cb({ cancel: false })
      })

      win.webContents.on('did-finish-load', async () => {
        if (done || !win || win.isDestroyed()) return
        win.webContents.executeJavaScript(`
          setTimeout(() => {
            document.querySelectorAll('[class*=play],[id*=play],button').forEach(b => { try{b.click()}catch(e){} })
            document.querySelectorAll('video').forEach(v => { try{v.play()}catch(e){} })
          }, 800)
        `).catch(()=>{})
        await new Promise(r => setTimeout(r, 3000))
        if (done || !win || win.isDestroyed()) return
        try {
          const url = await win.webContents.executeJavaScript(`(function() {
            // 1. video tag
            const v = document.querySelector('video')
            if (v?.currentSrc?.startsWith('http')) return v.currentSrc
            if (v?.src?.startsWith('http')) return v.src
            const src = v?.querySelector?.('source')
            if (src?.src?.startsWith('http')) return src.src
            // 2. jwplayer
            try {
              if (typeof jwplayer === 'function') {
                const jw = jwplayer()
                const pl = jw.getPlaylist?.()
                if (pl?.[0]?.sources?.[0]?.file) return pl[0].sources[0].file
              }
            } catch(e) {}
            // 3. Buscar en scripts
            for (const s of document.querySelectorAll('script:not([src])')) {
              const t = s.textContent || ''
              const f1 = t.match(/(https?:\\/\\/[^'"\\s]+\\.mp4[^'"\\s,)]*)/i); if(f1) return f1[1]
              const f2 = t.match(/(https?:\\/\\/[^'"\\s]+\\.m3u8[^'"\\s,)]*)/i); if(f2) return f2[1]
              const f3 = t.match(/[^\\w]file\\s*:\\s*['"]([^'"]+\\.(?:mp4|m3u8)[^'"]*)['"]/i); if(f3) return f3[1]
            }
            return null
          })()`)
          if (url && !done) resolver(url)
          else if (!done) { done=true; cleanup(); resolve(null) }
        } catch(e) { if (!done) { done=true; cleanup(); resolve(null) } }
      })

      win.webContents.on('did-fail-load', (_, code) => { if (code !== -3 && !done) { done=true; cleanup(); resolve(null) } })
      win.loadURL(serverUrl, { userAgent: UA, extraHeaders: 'Referer: https://latanime.org/\nOrigin: https://latanime.org\n' })
    } catch(e) { if (!done) { done=true; cleanup(); resolve(null) } }
  })
}

module.exports = { getStream }