// ─── extractors/yourupload.js ────────────────────────────────────────────────
// La página del embed (https://www.yourupload.com/embed/ID) trae el video en
// <meta property="og:video" content="..."> (a veces relativo) y/o en la
// config de jwplayer (file: '...'). Ese link redirige al CDN real, que exige
// Referer = la página del embed → se devuelve `referer` para que el
// reproductor lo pida por el proxy local (que ahora sigue redirecciones).
// Si el HTML no trae nada, se cae al extractor con ventana oculta de siempre.
'use strict'
const axios = require('axios')
const { extraer } = require('./_base')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const BASE = 'https://www.yourupload.com'

function urlEmbed(serverUrl) {
  const m = String(serverUrl).match(/your-?upload\.[a-z]+\/(?:embed|watch)\/([A-Za-z0-9_-]+)/i)
  return m ? `${BASE}/embed/${m[1]}` : serverUrl
}

function absoluta(u, base) {
  try { return new URL(u.replace(/\\\//g, '/'), base).href } catch (e) { return null }
}

async function porHtml(embed) {
  const { data: html } = await axios.get(embed, {
    headers: { 'User-Agent': UA, 'Referer': BASE + '/', 'Accept': 'text/html,*/*' },
    timeout: 15000, responseType: 'text', transformResponse: [d => d],
  })
  if (typeof html !== 'string') return null
  const candidatos = [
    (html.match(/<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["']/i) || [])[1],
    (html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::url)?["']/i) || [])[1],
    (html.match(/\bfile\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/i) || [])[1],
    (html.match(/\bfile\s*:\s*["']([^"']+)["']/i) || [])[1],
  ].filter(Boolean)
  for (const c of candidatos) {
    const u = absoluta(c, embed)
    if (u && /^https?:/.test(u) && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(u)) return u
  }
  return null
}

async function getStream(serverUrl) {
  const embed = urlEmbed(serverUrl)
  let url = null
  try { url = await porHtml(embed) } catch (e) { console.log('[yourupload] html:', e.message) }
  if (!url) url = await extraer(embed, BASE + '/', 25000)
  if (!url) return null
  return { tipo: url.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url, referer: embed }
}

module.exports = { getStream }
