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
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
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

module.exports = { getBrowser, browserGetHTML, browserCapture, browserEvalJS, closeBrowser, UA, AD_DOMAINS }
