// ─── extractors/anime/goodstream.js ──────────────────────────────────────────
// Goodstream / gscdn.cam — usa gscdn.cam como Referer correcto
'use strict'
const { extraer } = require('./_base')

const REFERER = 'https://gscdn.cam/'

async function getStream(serverUrl) {
  // Goodstream valida cookies de sesión — no se puede reproducir el m3u8 directamente.
  // Devolvemos el embed URL para que el player lo muestre como iframe.
  return { tipo: 'iframe', url: serverUrl }
}

module.exports = { getStream }
