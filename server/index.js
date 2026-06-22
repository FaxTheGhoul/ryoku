'use strict'
// ── server/index.js ───────────────────────────────────────────────────────────
// Servidor REST que expone toda la lógica de main.js de Electron
// para que la app Android (Capacitor) pueda consumirla.

const express    = require('express')
const cors       = require('cors')
const helmet     = require('helmet')
const rateLimit  = require('express-rate-limit')

const app  = express()
const PORT = process.env.PORT || 3001

// ── Seguridad básica ──────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : '*',
  methods: ['GET', 'POST'],
}))
app.use(express.json({ limit: '2mb' }))

// Rate limiting: 200 requests por IP por minuto
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}))

// ── Rutas ─────────────────────────────────────────────────────────────────────
app.use('/api/anime', require('./routes/anime'))
app.use('/api/manga', require('./routes/manga'))

// ── Health check + keep-alive (cron-job.org pinga esto cada 14 min) ───────────
let _lastPing = Date.now()
app.get('/health', (_, res) => {
  _lastPing = Date.now()
  res.json({ ok: true, ts: Date.now(), uptime: process.uptime() })
})

// Keep-alive activo: si no hay ping en 13 min, el propio servidor se auto-pinga
setInterval(async () => {
  if (Date.now() - _lastPing > 13 * 60 * 1000) {
    try {
      const axios = require('axios')
      await axios.get(`http://localhost:${PORT}/health`, { timeout: 5000 })
    } catch(e) {}
  }
}, 5 * 60 * 1000)

// ── Version check para auto-update de Android ─────────────────────────────────
app.get('/version', (_, res) => {
  const pkg = require('../package.json')
  res.json({
    version: pkg.version,
    apkUrl: process.env.APK_URL || null,
    notes: process.env.RELEASE_NOTES || '',
  })
})

// ── Proxy de video (para streams que validan Referer) ─────────────────────────
app.get('/proxy', async (req, res) => {
  const { url, referer } = req.query
  if (!url) return res.status(400).end()

  // Solo permitir dominios conocidos de video
  const ALLOWED = [
    'mp4upload', 'mixdrop', 'streamtape', 'uqload', 'dood',
    'voe', 'goodstream', 'gscdn', 'novelcool', 'zonatmo',
    'storage.zonatmo', 'storage2.zonatmo',
  ]
  const isAllowed = ALLOWED.some(d => url.includes(d))
  if (!isAllowed) return res.status(403).end()

  try {
    const axios = require('axios')
    const upstream = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'Referer':    referer || url,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 30000,
    })
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream')
    if (upstream.headers['content-length']) {
      res.setHeader('Content-Length', upstream.headers['content-length'])
    }
    upstream.data.pipe(res)
  } catch(e) {
    res.status(502).end()
  }
})

// ── Arrancar ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[RYOKU SERVER] corriendo en http://localhost:${PORT}`)
})

// Limpieza al salir
process.on('SIGTERM', async () => {
  const { closeBrowser } = require('./browser')
  await closeBrowser()
  process.exit(0)
})
