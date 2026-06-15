'use strict'
const { ipcRenderer } = require('electron')

;(function () {
  // 1. Leer hash ANTES que Firebase lo procese
  try {
    const href = window.location.href
    if (href && href.includes('#')) {
      const p = new URLSearchParams(href.split('#')[1])
      const idToken = p.get('id_token'), accessToken = p.get('access_token')
      if (idToken || accessToken) {
        ipcRenderer.send('auth-tokens', { idToken, accessToken })
      }
    }
  } catch (e) {}

  // 2. window.opener falso para que Firebase haga signInViaPopup correctamente
  //    y capturamos su postMessage con los tokens
  try {
    Object.defineProperty(window, 'opener', {
      configurable: true,
      get () {
        return {
          closed: false,
          location: { href: 'about:blank' },
          postMessage (data) {
            try {
              const str = typeof data === 'string' ? data : JSON.stringify(data)
              ipcRenderer.send('auth-postmessage', str)
            } catch (e) {}
          }
        }
      }
    })
  } catch (e) {}
})()
