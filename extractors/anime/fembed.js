// ─── extractors/fembed.js ────────────────────────────────────────────────────
'use strict'
const { extraer } = require('./_base')

const REFERER = 'https://fembed.com/'

// Fembed/Fembed2 usa jwplayer o API POST /api/source/ID
async function getStream(serverUrl) {
  const url = await extraer(serverUrl, REFERER, 25000)
  if (!url) return null
  return { tipo: url.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url }
}

module.exports = { getStream }
