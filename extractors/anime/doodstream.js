// ─── extractors/doodstream.js ────────────────────────────────────────────────
'use strict'
let BrowserWindow = null, net = null, electronSession = null
try { ({ BrowserWindow, net, session: electronSession } = require('electron')) } catch(e) {}
const { UA, AD_DOMAINS } = require('./_base')

// Fetch pass_md5 con net.request usando las cookies de la sesión persistente
// (incluye cf_clearance — no usa executeJavaScript, evita bad IPC message)
function fetchPassMd5(url) {
  const ses = electronSession.fromPartition('persist:dood_v4')
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET', session: ses, useSessionCookies: true })
    req.setHeader('Referer', 'https://playmogo.com/')
    req.setHeader('X-Requested-With', 'XMLHttpRequest')
    req.setHeader('User-Agent', UA)
    let body = ''
    req.on('response', (res) => {
      res.on('data', c => { body += c.toString() })
      res.on('end', () => resolve(body.trim()))
    })
    req.on('error', reject)
    req.end()
  })
}

async function getStream(serverUrl) {
  return new Promise((resolve) => {
    let done = false, win = null, _fetching = false, _playerReferer = 'https://doodstream.com/'
    const timer = setTimeout(() => {
      if (!done) { done = true; cleanup(); resolve(null) }
    }, 35000)

    function cleanup() {
      clearTimeout(timer)
      if (win && !win.isDestroyed()) {
        // Detach CDP antes de destruir para evitar bad IPC message
        try { const d = win.webContents.debugger; if (d.isAttached()) d.detach() } catch(e) {}
        // Limpiar serviceworkers — CF los usa para cachear; sin esto pass_md5 no se re-emite
        try {
          win.webContents.session.clearStorageData({
            storages: ['appcache','indexdb','localstorage','serviceworkers']
          }).catch(() => {})
        } catch(e) {}
        try { win.destroy() } catch(e) {}
      }
    }

    function resolver(url) {
      if (done) return
      console.log('[DOOD] resuelto:', url.substring(0, 100))
      done = true; cleanup()
      resolve({ tipo: 'mp4', url, referer: _playerReferer })
    }

    try {
      win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false, contextIsolation: true,
          webSecurity: false, partition: 'persist:dood_v4',
        }
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

      // Bloquear anuncios y hostnames inválidos
      win.webContents.session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
        const u = details.url, ul = u.toLowerCase()
        if (AD_DOMAINS.some(d => ul.includes(d))) { cb({ cancel: true }); return }
        try {
          const h = new URL(u).hostname
          if (h === 'undefined' || h === 'null' || h === '') { cb({ cancel: true }); return }
        } catch(e) { cb({ cancel: true }); return }
        cb({ cancel: false })
      })

      win.webContents.session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, cb) => {
        cb({ requestHeaders: { ...details.requestHeaders, 'User-Agent': UA } })
      })

      // CDP: captura pass_md5 incluyendo requests manejados por service workers
      try {
        win.webContents.debugger.attach('1.3')
        win.webContents.debugger.sendCommand('Network.enable')

        win.webContents.debugger.on('message', (_, method, params) => {
          if (done) return

          // Captura directa de media request (fallback cuando pass_md5 devuelve URL cifrada)
          if (method === 'Network.responseReceived' && !_fetching) {
            const u = params.response?.url || ''
            const mime = (params.response?.mimeType || '').toLowerCase()
            const ul = u.toLowerCase()
            if ((mime.includes('video') || ul.includes('.mp4')) &&
                u.startsWith('http') && !ul.includes('undefined') &&
                !AD_DOMAINS.some(d => ul.includes(d))) {
              console.log('[DOOD] CDP media capturado directamente:', u.substring(0, 100))
              resolver(u)
              return
            }
          }

          if (_fetching) return
          if (method !== 'Network.requestWillBeSent') return

          const u = params.request?.url || ''
          if (!u.includes('/pass_md5/')) return

          _fetching = true
          console.log('[DOOD] pass_md5 capturado (CDP):', u)

          // net.request con cookies CF — sin executeJavaScript, sin riesgo de IPC crash
          fetchPassMd5(u)
            .then(base => {
              if (base && base.startsWith('http')) {
                // Validar hostname — DoodStream CDN a veces devuelve https://undefined/...
                let baseHost = ''
                try { baseHost = new URL(base).hostname } catch(e) {}
                if (baseHost === 'undefined' || baseHost === 'null' || !baseHost) {
                  console.log('[DOOD] base URL inválida (host=' + baseHost + '), esperando media...')
                  _fetching = false
                  return
                }
                const token = u.split('/').pop() || ''
                const rand = Math.random().toString(36).substring(2, 14)
                resolver(`${base}${rand}?token=${token}&expiry=${Date.now()}`)
              } else {
                console.log('[DOOD] base URL inesperada:', base?.substring(0, 80))
                _fetching = false
              }
            })
            .catch(e => {
              console.log('[DOOD] fetch error:', e.message)
              _fetching = false
            })
        })
      } catch(e) { console.log('[DOOD] CDP no disponible:', e.message) }

      win.webContents.on('did-finish-load', () => {
        if (done || !win || win.isDestroyed()) return
        try { const u = new URL(win.webContents.getURL()); _playerReferer = `${u.protocol}//${u.hostname}/` } catch(e) {}
        console.log('[DOOD] página cargada:', win.webContents.getURL())
      })

      win.webContents.on('did-fail-load', (_, code) => {
        if (code === -3 || code === -106 || code === -20) return
        if (!done) { done = true; cleanup(); resolve(null) }
      })

      // Limpiar caché HTTP antes de cargar — fuerza re-fetch de pass_md5
      // No afecta cookies (cf_clearance se mantiene)
      win.webContents.session.clearCache()
        .catch(() => {})
        .finally(() => {
          if (done || !win || win.isDestroyed()) return
          win.loadURL(serverUrl, {
            userAgent: UA,
            extraHeaders: 'Referer: https://doodstream.com/\nOrigin: https://doodstream.com\n'
          })
        })

    } catch(e) { if (!done) { done = true; cleanup(); resolve(null) } }
  })
}

module.exports = { getStream }
