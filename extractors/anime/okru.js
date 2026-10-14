// ─── extractors/okru.js ──────────────────────────────────────────────────────
// Ok.ru (Odnoklassniki). La página https://ok.ru/videoembed/ID trae un
// <div data-module="OKVideo" data-options="{...}"> con JSON escapado en HTML.
// options.flashvars.metadata es OTRO JSON (string) con:
//   videos: [{ name: 'mobile'|'lowest'|'low'|'sd'|'hd'|'full'|..., url }]
//   hlsManifestUrl: '...m3u8'
// Se prefiere mp4 720p (hd) → 1080p → sd → ...; si no hay mp4, HLS.
// Si el HTML no sirve, se cae al extractor con ventana oculta.
'use strict'
const axios = require('axios')
const { extraer } = require('./_base')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const ORDEN = ['hd', 'full', 'sd', 'low', 'lowest', 'mobile']

function urlEmbed(serverUrl) {
  const m = String(serverUrl).match(/(?:ok\.ru|odnoklassniki\.ru)\/(?:videoembed|video|live)\/(\d+)/i)
  return m ? `https://ok.ru/videoembed/${m[1]}` : serverUrl
}

function desescapar(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

async function porHtml(embed) {
  const { data: html } = await axios.get(embed, {
    headers: { 'User-Agent': UA, 'Referer': 'https://ok.ru/', 'Accept': 'text/html,*/*', 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' },
    timeout: 15000, responseType: 'text', transformResponse: [d => d],
  })
  if (typeof html !== 'string') { console.log('[okru] respuesta sin HTML'); return null }
  // Puede haber varios data-options en la página: se usa el del player
  const attrs = [...html.matchAll(/data-options=(["'])(.*?)\1/gs)].map(m => m[2])
  const attr = attrs.find(a => /flashvars|metadata/.test(a)) || attrs[0]
  if (!attr) {
    const motivo = /vp_video_stub|video-status|deleted|blocked|заблокирован|недоступн/i.test(html) ? 'video no disponible o bloqueado' : 'sin data-options'
    console.log(`[okru] ${motivo} (html ${html.length} bytes)`)
    return null
  }
  let opts = null
  try { opts = JSON.parse(desescapar(attr)) } catch (e) { console.log('[okru] data-options no es JSON:', e.message); return null }
  const fv = opts?.flashvars || {}
  let meta = fv.metadata
  if (typeof meta === 'string') { try { meta = JSON.parse(meta) } catch (e) { meta = null } }
  // Algunas páginas no traen metadata embebida sino una URL para pedirla
  if (!meta && fv.metadataUrl) {
    try {
      const mu = new URL(decodeURIComponent(fv.metadataUrl), 'https://ok.ru/').href
      const { data } = await axios.post(mu, 'st.location=AutoplayVideoAnnouncement', {
        headers: { 'User-Agent': UA, 'Referer': embed, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      })
      meta = typeof data === 'string' ? JSON.parse(data) : data
    } catch (e) { console.log('[okru] metadataUrl:', e.message) }
  }
  if (!meta) { console.log('[okru] sin metadata. flashvars:', Object.keys(fv).join(',')); return null }
  console.log('[okru] calidades:', (meta.videos || []).map(v => v.name).join(',') || '(ninguna)', meta.hlsManifestUrl ? '+hls' : '')
  const videos = (meta.videos || []).filter(v => v && v.url && !v.disallowed)
  for (const nombre of ORDEN) {
    const v = videos.find(x => String(x.name).toLowerCase() === nombre)
    if (v) return { tipo: 'mp4', url: v.url.replace(/^\/\//, 'https://') }
  }
  if (videos[0]) return { tipo: 'mp4', url: videos[0].url.replace(/^\/\//, 'https://') }
  const hls = meta.hlsManifestUrl || meta.ondemandHls || meta.hlsMasterPlaylistUrl
  if (hls) return { tipo: 'm3u8', url: hls.replace(/^\/\//, 'https://') }
  return null
}

async function getStream(serverUrl) {
  const embed = urlEmbed(serverUrl)
  let r = null
  try { r = await porHtml(embed) } catch (e) { console.log('[okru] html:', e.code || '', e.response?.status || '', e.message) }
  if (!r) {
    const url = await extraer(embed, 'https://ok.ru/', 25000)
    if (url) r = { tipo: url.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url }
  }
  if (!r) return null
  // Los mp4 de okcdn se piden por el proxy con Referer de ok.ru; el HLS va directo
  return r.tipo === 'mp4' ? { ...r, referer: 'https://ok.ru/' } : r
}

module.exports = { getStream }
