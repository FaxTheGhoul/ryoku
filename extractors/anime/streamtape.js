// ─── extractors/streamtape.js ────────────────────────────────────────────────
'use strict'
const { crearWin, interceptarVideo, UA } = require('./_base')

const REFERER = 'https://streamtape.com/'

// Streamtape genera la URL concatenando dos partes en el HTML
async function getStream(serverUrl) {
  return new Promise((resolve) => {
    let done = false, win = null
    const timer = setTimeout(() => { if (!done) { done=true; cleanup(); resolve(null) } }, 25000)

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
      resolve({ tipo: 'mp4', url })
    }

    try {
      win = crearWin(REFERER)
      interceptarVideo(win, resolver)

      win.webContents.on('did-finish-load', async () => {
        if (done || !win || win.isDestroyed()) return
        await new Promise(r => setTimeout(r, 2500))
        if (done || !win || win.isDestroyed()) return

        try {
          const url = await win.webContents.executeJavaScript(`
            (function() {
              // Streamtape construye la URL en dos spans: robotlink + id
              const el = document.getElementById('robotlink')
              if (el) return 'https:' + el.innerHTML + document.getElementById('idelement')?.innerHTML
              // Fallback video tag
              const v = document.querySelector('video')
              if (v && v.src) return v.src
              return null
            })()
          `)
          if (url && !done) resolver(url)
          else if (!done) { done=true; cleanup(); resolve(null) }
        } catch(e) { if (!done) { done=true; cleanup(); resolve(null) } }
      })

      win.webContents.on('did-fail-load', (_, code) => {
        if (code === -3) return
        if (!done) { done=true; cleanup(); resolve(null) }
      })

      win.loadURL(serverUrl, { userAgent: UA, extraHeaders: `Referer: ${REFERER}\nOrigin: https://streamtape.com\n` })
    } catch(e) { if (!done) { done=true; cleanup(); resolve(null) } }
  })
}

module.exports = { getStream }
