// ─── extractors/generico.js ──────────────────────────────────────────────────
'use strict'
const { extraer } = require('./_base')

// Fallback para proveedores desconocidos.
//
// El Referer estaba forzado siempre a "https://latanime.org/", sin importar
// de qué sitio viniera el anime (latanime, monoschinos, animeflv) -- rompía
// en silencio cualquier servidor sin extractor dedicado embebido desde un
// sitio distinto (p.ej. "Lulu" -- luluvdo.com -- vía monoschinos: el
// reproductor recibía un Referer de un sitio que nunca lo embebió y no
// cargaba el video). Mismo problema que ya se había encontrado y arreglado
// en filemoon.js: se usa el propio dominio del servidor como Referer, que
// es lo que la mayoría de estos reproductores esperan cuando no reconocen
// el sitio que los está embebiendo.
async function getStream(serverUrl) {
  let referer = 'https://latanime.org/'
  try { referer = new URL(serverUrl).origin + '/' } catch(e) {}
  const url = await extraer(serverUrl, referer, 25000, 'generico')
  if (!url) return null
  return { tipo: url.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url }
}

module.exports = { getStream }
