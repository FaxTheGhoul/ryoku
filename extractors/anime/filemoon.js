// ─── extractors/anime/filemoon.js ────────────────────────────────────────────
// Filemoon (filemoon.sx / filemoon.to / filemoon.in, etc.)
//
// El embed de Filemoon trae un JS "packed" (formato Dean Edwards, eval(function
// (p,a,c,k,e,d){...}(...))) que al desempaquetarse arma un player.setup({sources
// :[...]}) tipo JWPlayer. Como corremos en un Electron/Chromium real (no un
// scraper estático como youtube-dl), ese eval se ejecuta solo con la página, así
// que el mismo EXTRACT_JS de _base.js (que ya intenta jwplayer().getPlaylist()/
// getConfig() como primer paso) alcanza para sacar la URL — no hace falta
// desempaquetar el packer a mano.
//
// Este módulo es casi idéntico a generico.js pero con dos diferencias, hechas
// a propósito porque Filemoon puede tardar más que un embed simple en armar el
// player (handshake con su CDN) y porque el Referer forzado a latanime.org que
// usa generico.js no tiene sentido acá (Filemoon se embebe desde sitios muy
// distintos — monoschinos, latanime, etc. — así que usamos el propio dominio
// de filemoon como Referer, que es lo que la mayoría de los reproductores de
// este estilo esperan cuando no conocen el sitio que los está embebiendo):
'use strict'
const { extraer } = require('./_base')

async function getStream(serverUrl) {
  let referer = 'https://filemoon.sx/'
  try { referer = new URL(serverUrl).origin + '/' } catch(e) {}
  const url = await extraer(serverUrl, referer, 30000, 'filemoon')
  if (!url) return null
  return { tipo: url.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url }
}

module.exports = { getStream }
