// ─── extractors/generico.js ──────────────────────────────────────────────────
'use strict'
const { extraer } = require('./_base')

// Fallback para proveedores desconocidos
async function getStream(serverUrl) {
  const url = await extraer(serverUrl, 'https://latanime.org/', 25000)
  if (!url) return null
  return { tipo: url.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url }
}

module.exports = { getStream }
