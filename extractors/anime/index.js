// ─── extractors/index.js ─────────────────────────────────────────────────────
'use strict'

const mp4upload  = require('./mp4upload')
const voe        = require('./voe')
const doodstream = require('./doodstream')
const uqload     = require('./uqload')
const yourupload = require('./yourupload')
const mixdrop    = require('./mixdrop')
const streamtape = require('./streamtape')
const fembed     = require('./fembed')
const savefiles  = require('./savefiles')
const generico    = require('./generico')
const goodstream  = require('./goodstream')

// Inline extractor for cuevana8 player (needs cuevana referer)
const cuevanaPlayer = {
  async getStream(serverUrl) {
    const { extraer } = require('./_base')
    const url = await extraer(serverUrl, 'https://player.cuevana8.plus/', 30000)
    if (!url) return null
    return { tipo: url.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url }
  }
}

// Cache con TTL de 8 minutos
const cache = new Map()
const CACHE_TTL = 8 * 60 * 1000

function cacheGet(url) {
  const e = cache.get(url)
  if (!e) return null
  if (Date.now() - e.ts > CACHE_TTL) { cache.delete(url); return null }
  return e.data
}
function cacheSet(url, data) { cache.set(url, { data, ts: Date.now() }) }
setInterval(() => {
  const n = Date.now()
  for (const [k, v] of cache) if (n - v.ts > CACHE_TTL) cache.delete(k)
}, 15 * 60 * 1000)

function detectar(url) {
  const u = url.toLowerCase()
  if (u.includes('mp4upload'))                               return 'mp4upload'
  if (u.includes('voe') || u.includes('jessicayeah') ||
      u.includes('laymanlousest') || u.includes('housecardsunited') ||
      u.includes('donaldlineage') || u.includes('pickledandshuffled'))
                                                             return 'voe'
  if (u.includes('dood') || u.includes('ds2play'))          return 'doodstream'
  if (u.includes('uqload') || u.includes('uptostream') ||
      u.includes('uqload.co') || u.includes('uqload.io'))   return 'uqload'
  if (u.includes('yourupload') || u.includes('your-upload')) return 'yourupload'
  if (u.includes('mixdrop') || u.includes('miixdrop'))      return 'mixdrop'
  if (u.includes('streamtape') || u.includes('streamta.pe')) return 'streamtape'
  if (u.includes('fembed'))                                  return 'fembed'
  if (u.includes('savefiles') || u.includes('save-files') ||
      u.includes('svfiles'))                                 return 'savefiles'
  if (u.includes('dsvplay') || u.includes('dsv-play'))       return 'dsvplay'
  if (u.includes('hexload'))                                 return 'hexload'
  if (u.includes('streamwish') || u.includes('wishembed'))  return 'streamwish'
  if (u.includes('filelions') || u.includes('lion'))        return 'filelions'
  if (u.includes('goodstream') || u.includes('gscdn.cam'))  return 'goodstream'
  if (u.includes('player.cuevana8.plus') || u.includes('cuevana8.plus/player')) return 'cuevana'
  return 'generico'
}

const EXTRACTORES = {
  mp4upload, voe, doodstream, uqload, yourupload,
  mixdrop, streamtape, fembed, savefiles, generico, goodstream,
  dsvplay: generico, hexload: generico,
  streamwish: generico, filelions: generico,
  cuevana: cuevanaPlayer,
}

async function getStream(serverUrl) {
  const cached = cacheGet(serverUrl)
  if (cached) return cached

  const proveedor = detectar(serverUrl)
  const extractor = EXTRACTORES[proveedor]

  console.log(`[STREAM] ${proveedor} → ${serverUrl.substring(0, 80)}`)

  try {
    const resultado = await extractor.getStream(serverUrl)
    if (resultado) {
      cacheSet(serverUrl, resultado)
      console.log(`[STREAM] ✓ ${proveedor}: ${resultado.url.substring(0, 80)}`)
    } else {
      console.log(`[STREAM] ✗ ${proveedor}: sin resultado`)
    }
    return resultado
  } catch(e) {
    console.error(`[STREAM] error en ${proveedor}:`, e.message)
    return null
  }
}

function clearCache(url) {
  if (url) cache.delete(url)
  else cache.clear()
}

module.exports = { getStream, clearCache }