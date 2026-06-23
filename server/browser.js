'use strict'
// ── server/browser.js ─────────────────────────────────────────────────────────
// Reemplaza BrowserWindow de Electron con Playwright para el servidor.
// Expone una interfaz compatible para que los extractores funcionen sin cambios.

const { EventEmitter } = require('events')

let _browser = null

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const AD_DOMAINS = [
  'pubmatic','iqzone','id5-sync','connatix','adkernel','blsync',
  'doubleclick','googlesyndication','googletagmanager','adservice','pagead','adnxs',
  'taboola','outbrain','popads','popcash','propellerads','adsterra',
]

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser
  const { chromium } = require('playwright-core')
  _browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--single-process',
    ]
  })
  return _browser
}

// ── Función principal: navega a una URL, espera, devuelve HTML ────────────────
async function browserGetHTML(url, { waitMs = 3000, referer = null, ua = UA } = {}) {
  const browser = await getBrowser()
  const ctx = await browser.newContext({
    userAgent: ua,
    extraHTTPHeaders: referer ? { Referer: referer } : {},
    ignoreHTTPSErrors: true,
  })
  // Bloquear ads
  await ctx.route('**/*', (route) => {
    const u = route.request().url()
    if (AD_DOMAINS.some(d => u.includes(d))) return route.abort()
    route.continue()
  })
  const page = await ctx.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(waitMs)
    const html = await page.content()
    return html
  } finally {
    await ctx.close()
  }
}

// ── Ejecutar JS en una página y capturar redes ─────────────────────────────────
async function browserCapture(url, { waitMs = 4000, referer = null, ua = UA, captureUrls = [] } = {}) {
  const browser = await getBrowser()
  const ctx = await browser.newContext({
    userAgent: ua,
    extraHTTPHeaders: referer ? { Referer: referer } : {},
    ignoreHTTPSErrors: true,
  })
  const captured = []
  await ctx.route('**/*', (route) => {
    const u = route.request().url()
    if (AD_DOMAINS.some(d => u.includes(d))) return route.abort()
    if (captureUrls.some(pattern => u.includes(pattern))) captured.push(u)
    route.continue()
  })
  const page = await ctx.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(waitMs)
    const html = await page.content()
    return { html, captured }
  } finally {
    await ctx.close()
  }
}

// ── Ejecutar JS arbitrario en una página ──────────────────────────────────────
async function browserEvalJS(url, jsCode, { waitMs = 3000, referer = null, ua = UA } = {}) {
  const browser = await getBrowser()
  const ctx = await browser.newContext({
    userAgent: ua,
    extraHTTPHeaders: referer ? { Referer: referer } : {},
    ignoreHTTPSErrors: true,
  })
  const page = await ctx.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(waitMs)
    const result = await page.evaluate(jsCode)
    return result
  } finally {
    await ctx.close()
  }
}

async function closeBrowser() {
  if (_browser) { await _browser.close(); _browser = null }
}

// ── Extractor de stream para el servidor (reemplaza BrowserWindow de Electron) ─
// Intercepta requests de red con Playwright para capturar URLs de video (.m3u8/.mp4)
const EXTRACT_JS = `(function() {
  try { if(typeof jwplayer==='function'){const jw=jwplayer();const pl=jw.getPlaylist?.();if(pl?.[0]?.sources?.[0]?.file)return pl[0].sources[0].file;const cfg=jw.getConfig?.();if(cfg?.playlist?.[0]?.sources?.[0]?.file)return cfg.playlist[0].sources[0].file} } catch(e){}
  try { const c=window.nMDCore||window.MDCore;if(c){const toA=u=>(u&&u.startsWith('//'))?'https:'+u:u;const w=toA(c.wurl)||toA(c.stream)||toA(c.url);if(w&&w.startsWith('http'))return w} } catch(e){}
  try { const cands=[window.wurl,window.hls,window.video_url,window.stream_url,window.sources?.hls,window.sources?.mp4,window.sources?.video];for(const c of cands){if(typeof c==='string'&&c.startsWith('http'))return c} } catch(e){}
  for(const s of document.querySelectorAll('script:not([src])')){const t=s.textContent||'';let m;m=t.match(/(?:wurl|hls|video_url|stream_url)\s*[=:]\s*["'](https?:\/\/[^"']+)/i);if(m)return m[1];m=t.match(/atob\(["']([A-Za-z0-9+\/=]{20,})["']\)/);if(m){try{const d=atob(m[1]);if(d.startsWith('http'))return d;const f=d.match(/file\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)/i);if(f)return f[1]}catch(e){}}m=t.match(/(https?:\/\/[^"'\s,;)]{15,}\.m3u8[^"'\s,;)]*)/i);if(m)return m[1];m=t.match(/[^\w]file\s*:\s*["']([^"']{15,}\.(?:mp4|m3u8)[^"']*)/i);if(m)return m[1]}
  const v=document.querySelector('video');if(v){if(v.currentSrc?.startsWith('http'))return v.currentSrc;if(v.src?.startsWith('http'))return v.src}
  return null
})()`

async function extraerStream(pageUrl, { referer = null, timeout = 30000 } = {}) {
  const browser = await getBrowser()
  const ctx = await browser.newContext({
    userAgent: UA,
    extraHTTPHeaders: referer ? { Referer: referer, Origin: new URL(referer).origin } : {},
    ignoreHTTPSErrors: true,
  })

  let capturedUrl = null

  // Interceptar requests de red — captura .m3u8 y .mp4 directos
  await ctx.route('**/*', (route) => {
    const u = route.request().url()
    const ul = u.toLowerCase()
    if (AD_DOMAINS.some(d => ul.includes(d))) return route.abort()
    if (!capturedUrl) {
      try {
        const path = new URL(u).pathname.toLowerCase()
        const fake = ['thumb','poster','preview','advert','placeholder']
        const isVideo = path.includes('.m3u8') ||
          (path.includes('.mp4') && !path.endsWith('.html') && !fake.some(f => path.includes(f)))
        if (isVideo) capturedUrl = u
      } catch(e) {}
    }
    route.continue()
  })

  const page = await ctx.newPage()
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout })

    // Intentar activar el player
    await page.evaluate(() => {
      try { jwplayer().play() } catch(e) {}
      document.querySelectorAll('[class*=play],[id*=play],button').forEach(b => { try{b.click()}catch(e){} })
      document.querySelectorAll('video').forEach(v => { try{v.play()}catch(e){} })
    }).catch(() => {})

    // Esperar hasta 12s comprobando cada 800ms
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(800)
      if (capturedUrl) break
      try {
        const url = await page.evaluate(EXTRACT_JS)
        if (url && url.startsWith('http')) { capturedUrl = url; break }
      } catch(e) {}
    }

    if (!capturedUrl) {
      // Último intento DOM
      try { capturedUrl = await page.evaluate(EXTRACT_JS) } catch(e) {}
    }

    return capturedUrl || null
  } finally {
    await ctx.close()
  }
}

module.exports = { getBrowser, browserGetHTML, browserCapture, browserEvalJS, extraerStream, closeBrowser, UA, AD_DOMAINS }
