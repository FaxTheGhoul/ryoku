// ─── extractors/uqload.js ────────────────────────────────────────────────────
'use strict'
const { crearWin, UA, AD_DOMAINS } = require('./_base')

const REFERER = 'https://uqload.co/'

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
            try { jwplayer().play() } catch(e) {}
            document.querySelectorAll('[class*=play],[id*=play],button').forEach(b => { try{b.click()}catch(e){} })
            document.querySelectorAll('video').forEach(v => { try{v.play()}catch(e){} })
          }, 800)
        `).catch(()=>{})
        await new Promise(r => setTimeout(r, 3000))
        if (done || !win || win.isDestroyed()) return
        try {
          const url = await win.webContents.executeJavaScript(`(function() {
            try {
              if (typeof jwplayer === 'function') {
                const jw = jwplayer()
                const pl = jw.getPlaylist?.()
                if (pl?.[0]?.sources?.[0]?.file) return pl[0].sources[0].file
                const cfg = jw.getConfig?.()
                if (cfg?.playlist?.[0]?.sources?.[0]?.file) return cfg.playlist[0].sources[0].file
              }
            } catch(e) {}
            for (const s of document.querySelectorAll('script:not([src])')) {
              const t = s.textContent || ''
              const f1 = t.match(/sources\\s*:\\s*\\[\\s*\\{[^}]*file\\s*:\\s*['"]([^'"]+)['"]/i); if(f1) return f1[1]
              const f2 = t.match(/[^\\w]file\\s*:\\s*['"]([^'"]+\\.(?:mp4|m3u8)[^'"]*)['"]/i); if(f2) return f2[1]
            }
            const v = document.querySelector('video')
            if (v?.currentSrc?.startsWith('http')) return v.currentSrc
            if (v?.src?.startsWith('http')) return v.src
            return null
          })()`)
          if (url && !done) resolver(url)
          else if (!done) { done=true; cleanup(); resolve(null) }
        } catch(e) { if (!done) { done=true; cleanup(); resolve(null) } }
      })

      win.webContents.on('did-fail-load', (_, code) => { if (code !== -3 && !done) { done=true; cleanup(); resolve(null) } })
      win.loadURL(serverUrl, { userAgent: UA, extraHeaders: `Referer: ${REFERER}\nOrigin: https://uqload.co\n` })
    } catch(e) { if (!done) { done=true; cleanup(); resolve(null) } }
  })
}

module.exports = { getStream }