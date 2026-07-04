'use strict'
// ─── extractors/anime/monoschinos.js ─────────────────────────────────────────
// Fuente: monoschinos.st

const axios   = require('axios')
const cheerio = require('cheerio')

const BASE = 'https://monoschinos.st'

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer':         'https://monoschinos.st/',
}

async function _fetch(url, extraHeaders = {}) {
  const { data } = await axios.get(url, {
    headers: { ...HEADERS, ...extraHeaders },
    timeout: 15000,
    maxRedirects: 5,
  })
  return data
}

async function _fetchWithHeaders(url) {
  const res = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
    maxRedirects: 5,
  })
  return { html: res.data, headers: res.headers }
}

const _img = src => {
  if (!src) return ''
  if (src.startsWith('http')) return src
  return BASE + src
}

// Extrae número de episodio desde URL tipo /ver/anime-episodio-12
function _epNum(url) {
  const m = url.match(/-episodio-(\d+)(?:\?.*)?$/)
  return m ? parseInt(m[1], 10) : null
}

// Slug del anime desde URL de episodio (/ver/anime-episodio-12 → anime)
function _slugFromEpUrl(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
    return seg.replace(/-episodio-\d+$/, '')
  } catch { return '' }
}

// ── GET RECIENTES ─────────────────────────────────────────────────────────────
async function getRecientes() {
  const html = await _fetch(BASE)
  const $ = cheerio.load(html)
  const slider = []
  const lista  = []
  const series = []

  // ── SLIDER: recopilar portadas en orden, luego emparejar con botones ────
  // Las imágenes de portada son hermanas del contenedor de info, no hijas
  const portadaImgs = []
  $('img').each((_, img) => {
    // Revisar src Y data-src independientemente (src puede ser placeholder anime.png)
    const s1 = $(img).attr('src') || ''
    const s2 = $(img).attr('data-src') || ''
    const portada = s1.includes('/portada/') ? s1
      : s2.includes('/portada/') ? s2
      : (s1.includes('/serie/') && /\.(jpg|webp|png)/.test(s1)) ? s1
      : (s2.includes('/serie/') && /\.(jpg|webp|png)/.test(s2)) ? s2
      : ''
    if (portada) portadaImgs.push(portada)
  })

  let sliderIdx = 0
  $('a').filter((_, el) => /ver ahora/i.test($(el).text())).each((_, el) => {
    const verLink = $(el).attr('href') || ''
    if (!verLink.includes('/ver/')) return

    // Sube buscando el contenedor con h1
    let container = $(el).parent()
    for (let i = 0; i < 8 && container.length; i++) {
      if (container.find('h1').length) break
      container = container.parent()
    }

    const titulo = container.find('h1').first().text().trim()
    if (!titulo) return

    const infoHref = container.find('a[href*="/anime/"]').attr('href') || ''
    const link = infoHref
      ? (infoHref.startsWith('http') ? infoHref : BASE + infoHref)
      : (verLink.startsWith('http') ? verLink : BASE + verLink)

    const imagen = portadaImgs[sliderIdx] || ''
    const desc = container.find('p').filter((_, p) => $(p).text().length > 30).first().text().trim()

    if (!slider.some(s => s.titulo === titulo)) {
      slider.push({ titulo, link, imagen: _img(imagen), desc })
      sliderIdx++
    }
  })

  // ── LISTA: "últimos capítulos" — excluir los links del slider ────────────
  $('a[href*="/ver/"]').each((_, el) => {
    // Saltar los botones "Ver ahora" del slider
    if (/ver ahora/i.test($(el).text())) return

    const link = $(el).attr('href') || ''
    if (!link.includes('-episodio-')) return
    const fullLink = link.startsWith('http') ? link : BASE + link
    const num = _epNum(fullLink)
    if (!num) return

    // h2 puede ser hijo del <a> o hermano dentro del <li>
    let titulo = $(el).find('h2, h3').first().text().trim()
    if (!titulo) titulo = $(el).parent().find('h2, h3').first().text().trim()
    // Fallback: extraer del texto antes de " capitulo"
    if (!titulo) titulo = $(el).text().split(/\s+capitulo\s+/i)[0].trim()
    if (!titulo) return

    const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') ||
                $(el).parent().find('img').attr('data-src') || $(el).parent().find('img').attr('src') || ''

    if (lista.some(x => x.link === fullLink)) return

    lista.push({ titulo, link: fullLink, imagen: _img(img), ep: `Ep ${num}`, idioma: '', fecha: '' })
  })

  // ── SERIES RECIENTES ──────────────────────────────────────────────────────
  $('a[href*="/anime/"][href*="-sub-espanol"]').each((_, el) => {
    // Saltar botones "Más info" del slider
    if (/m.s info/i.test($(el).text())) return

    const link = $(el).attr('href') || ''
    const fullLink = link.startsWith('http') ? link : BASE + link

    let titulo = $(el).find('h2, h3, .titulo').first().text().trim()
    if (!titulo) {
      const raw = $(el).text().trim()
      // Texto duplica el título: "Neko to Ryū anime Neko to Ryū" → tomar primera parte
      titulo = raw.split(/\s+anime\s+/i)[0].trim()
    }
    // Saltar si el título sigue siendo "Más info" u otros textos de botón
    if (!titulo || /^(m.s info|ver ahora|info)$/i.test(titulo)) return
    if (series.some(s => s.link === fullLink)) return

    const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || ''
    series.push({ titulo, link: fullLink, imagen: _img(img) })
  })

  return { slider: slider.slice(0, 8), lista: lista.slice(0, 24), series: series.slice(0, 12) }
}

// ── BUSCAR ────────────────────────────────────────────────────────────────────
const _norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
function _matchesQuery(text, words) {
  const h = _norm(text)
  return words.every(w => h.includes(w))
}
function _slugToTitulo(href) {
  try {
    return (href.split('/anime/')[1] || '').replace(/-sub-espanol.*$/, '').replace(/-/g, ' ').trim()
  } catch { return '' }
}

// Fetch usando session de Electron (comparte cookies reales del browser, incluyendo Cloudflare)
async function _sessionFetch(url, extraHeaders = {}) {
  const { session } = require('electron')
  const resp = await session.defaultSession.fetch(url, {
    method: 'GET',
    headers: { ...HEADERS, ...extraHeaders },
  })
  const text = await resp.text()
  let data
  try { data = JSON.parse(text) } catch(e) { data = text }
  return { status: resp.status, data }
}

// Parsear data-page de Inertia — busca cualquier array con estructura de anime
function _parseInertiaPage(html) {
  try {
    const $ = cheerio.load(html)
    const raw = $('#app').attr('data-page')
    if (!raw) return null
    const props = JSON.parse(raw)?.props || {}
    for (const key of ['animes', 'series', 'data', 'resultados', ...Object.keys(props)]) {
      let val = props[key]
      if (!val) continue
      // Laravel paginator: { data: [...], current_page, last_page, ... }
      if (val && typeof val === 'object' && !Array.isArray(val) && Array.isArray(val.data)) val = val.data
      if (!Array.isArray(val) || !val.length) continue
      const first = val[0]
      if (!first || typeof first !== 'object') continue
      if (!(first.slug || first.titulo || first.title || first.url || first.nombre)) continue
      const result = val.map(a => {
        const slug = a.slug || a.url_slug || ''
        const link = a.url || a.link || (slug ? `${BASE}/anime/${slug}-sub-espanol` : '')
        const titulo = a.titulo || a.title || a.nombre || a.name || slug.replace(/-/g, ' ')
        return { titulo, link, imagen: _img(a.imagen || a.image || a.portada || a.cover || '') }
      }).filter(a => a.titulo && a.link)
      if (result.length) return result
    }
  } catch(e) {}
  return null
}

function _parseAnimeLinks($, words) {
  const items = []
  const seen = new Set()
  $('a[href*="/anime/"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (href.includes('/ver/') || !href.includes('/anime/')) return
    const fullLink = href.startsWith('http') ? href : BASE + href
    if (seen.has(fullLink)) return
    seen.add(fullLink)
    const slug = _slugToTitulo(href)
    let titulo = $(el).find('h3,h2,.titulo,.title,.nombre').first().text().trim()
              || $(el).attr('title') || slug
    if (!titulo || titulo.length < 2) return
    if (words && !_matchesQuery(titulo, words) && !_matchesQuery(slug, words)) return
    const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || ''
    items.push({ titulo, link: fullLink, imagen: _img(img) })
  })
  return items
}

async function _buscarConBrowserWindow(q) {
  return new Promise((resolve) => {
    try {
      const { BrowserWindow } = require('electron')
      const win = new BrowserWindow({
        show: false, width: 1280, height: 800,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      })
      win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
      let done = false
      const cleanup = (r) => { if (done) return; done = true; try { win.destroy() } catch(e) {}; resolve(r) }
      let _timer = null
      win.webContents.on('did-finish-load', () => {
        clearTimeout(_timer)
        _timer = setTimeout(() => {
          if (done) return
          win.webContents.executeJavaScript(`(function(){
            try {
              const dp = document.getElementById('app')?.getAttribute('data-page')
              if (dp) {
                const page = JSON.parse(dp)
                const props = page?.props || {}
                const PKEYS = ['animes','series','data','resultados']
                const allKeys = [...PKEYS, ...Object.keys(props).filter(k=>!PKEYS.includes(k))]
                for (const key of allKeys) {
                  let val = props[key]
                  if (!val) continue
                  if (val && typeof val==='object' && !Array.isArray(val) && Array.isArray(val.data)) val = val.data
                  if (!Array.isArray(val) || !val.length) continue
                  const f = val[0]
                  if (f && typeof f==='object' && (f.slug||f.titulo||f.title||f.url||f.nombre)) {
                    return val.map(a=>({
                      titulo:(a.titulo||a.title||a.nombre||a.name||'').trim(),
                      link:a.url||a.link||(a.slug?'https://monoschinos.st/anime/'+a.slug+'-sub-espanol':''),
                      imagen:a.imagen||a.image||a.portada||a.img||''
                    })).filter(a=>a.titulo&&a.link)
                  }
                }
              }
              const links = Array.from(document.querySelectorAll('a[href*="/anime/"]'))
                .filter(el=>el.querySelector('img')&&!el.href.includes('/ver/')&&!el.href.endsWith('/anime/'))
              return links.map(el=>({
                titulo:(el.querySelector('h3,h2,h4,p,.titulo,.title')?.textContent||el.title||'').trim(),
                link:el.href,
                imagen:el.querySelector('img')?.src||el.querySelector('img')?.getAttribute('data-src')||''
              })).filter(a=>a.titulo&&a.link)
            } catch(e) { return null }
          })()`).then(r => {
            if (r && r.length) cleanup(r)
            // Si no hay resultados aun (Cloudflare challenge), esperar siguiente did-finish-load
          }).catch(() => cleanup(null))
        }, 2500)
      })
      win.loadURL('https://monoschinos.st/buscar?q=' + encodeURIComponent(q)).catch(() => cleanup(null))
      setTimeout(() => cleanup(null), 15000)
    } catch(e) { resolve(null) }
  })
}

async function buscar(query, filtros = {}, page = 1) {
  const q = (query || '').trim()
  if (!q) return []
  const words = _norm(q).split(/\s+/).filter(Boolean)

  // ── E0: BrowserWindow persistente (bypass Cloudflare) ───────────────────────
  try {
    const r = await _buscarConBrowserWindow(q)
    if (r && r.length) return r
  } catch(e) {}

    // ── E2: /buscar?q=X con axios normal + parseo data-page ───────────────────
  try {
    const html = await _fetch(`${BASE}/buscar?q=${encodeURIComponent(q)}`)
    const r = _parseInertiaPage(html)
    if (r && r.length) return r
    const found = _parseAnimeLinks(cheerio.load(html), words)
    if (found.length) return found
  } catch(e) {}

  // ── E3: catálogo paginado en paralelo con filtro client-side ──────────────
  const seen = new Set()
  const results = []
  let totalPages = 50

  for (let batch = 0; batch * 5 < totalPages; batch++) {
    const start = batch * 5 + 1
    const pages = Array.from({ length: 5 }, (_, i) => start + i).filter(p => p <= totalPages)
    const htmls = await Promise.allSettled(pages.map(p =>
      _fetch(`${BASE}/animes?orden=titulo&p=${p}`)
    ))

    let gotAny = false
    for (let i = 0; i < htmls.length; i++) {
      if (htmls[i].status !== 'fulfilled') continue
      const $ = cheerio.load(htmls[i].value)
      if (batch === 0 && i === 0) {
        const nums = $('a[href*="p="]').map((_, el) => {
          const m = ($(el).attr('href') || '').match(/[?&]p=(\d+)/)
          return m ? parseInt(m[1]) : 0
        }).get()
        const max = Math.max(...nums, 1)
        if (max > 1) totalPages = max
      }
      const items = _parseAnimeLinks($, words)
      items.forEach(a => { if (!seen.has(a.link)) { seen.add(a.link); results.push(a) } })
      if ($('a[href*="/anime/"]').length > 0) gotAny = true
    }
    if (!gotAny) break
  }

  return results
}


// ── GET BIBLIOTECA con BrowserWindow (bypass Cloudflare) ─────────────────────
async function _getBibliotecaConBrowserWindow(urlBib) {
  return new Promise((resolve) => {
    try {
      const { BrowserWindow } = require('electron')
      const win = new BrowserWindow({
        show: false, width: 1280, height: 900,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      })
      win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
      let done = false
      const cleanup = (r) => { if (done) return; done = true; try { win.destroy() } catch(e) {}; resolve(r) }
      win.webContents.on('did-finish-load', () => {
        setTimeout(() => {
          if (done) return
          win.webContents.executeJavaScript(`(function(){
            try {
              const dp = document.getElementById('app')?.getAttribute('data-page')
              if (dp) {
                const page = JSON.parse(dp)
                const props = page?.props || {}
                for (const key of Object.keys(props)) {
                  const val = props[key]
                  if (!Array.isArray(val) || !val.length) continue
                  const f = val[0]
                  if (f && typeof f === 'object' && (f.slug||f.titulo||f.title||f.url||f.nombre)) {
                    return { lista: val.map(a=>({
                      titulo:(a.titulo||a.title||a.nombre||a.name||'').trim(),
                      link:a.url||a.link||(a.slug?'https://monoschinos.st/anime/'+a.slug+'-sub-espanol':''),
                      imagen:a.imagen||a.image||a.portada||a.img||''
                    })).filter(a=>a.titulo&&a.link), hayMas: !!document.querySelector('a[rel=next]') }
                  }
                }
              }
              const links = Array.from(document.querySelectorAll('a[href*="/anime/"]'))
                .filter(el=>el.querySelector('img')&&!el.href.includes('/ver/')&&!el.href.endsWith('/anime/'))
              return { lista: links.map(el=>({
                titulo:(el.querySelector('h3,h2,h4,p,.titulo')?.textContent||el.title||'').trim(),
                link:el.href,
                imagen:el.querySelector('img')?.src||el.querySelector('img')?.getAttribute('data-src')||''
              })).filter(a=>a.titulo&&a.link), hayMas: !!document.querySelector('a[rel=next]') }
            } catch(e) { return null }
          })()`).then(r => {
            if (r && r.lista && r.lista.length) cleanup(r)
          }).catch(() => cleanup(null))
        }, 2500)
      })
      win.loadURL(urlBib).catch(() => cleanup(null))
      setTimeout(() => cleanup(null), 15000)
    } catch(e) { resolve(null) }
  })
}

// ── BIBLIOTECA ────────────────────────────────────────────────────────────────
async function getBiblioteca({ query = '', genero = '', tipo = '', estado = '', page = 1 } = {}) {
  // MonosChinos filtra por query solo en /buscar?q=X, no en /animes?buscar=X
  // Cuando hay query, delegar al buscador que usa el endpoint correcto
  if (query) {
    const lista = await buscar(query)
    return { lista: Array.isArray(lista) ? lista : [], hayMas: false }
  }

  const params = new URLSearchParams({
    genero:    genero  || 'all',
    categoria: tipo    || 'all',
    estado:    estado  || 'all',
    orden:     'default',
    p:         String(page),
  })

  const url = `${BASE}/animes?${params}`

  // ── E0: Inertia XHR (server-side filtering, retorna JSON con resultados correctos) ─
  try {
    let version = ''
    try {
      const home = await _sessionFetch(BASE)
      if (typeof home.data === 'string') {
        const $ = cheerio.load(home.data)
        const raw = $('#app').attr('data-page')
        if (raw) version = JSON.parse(raw)?.version || ''
      }
    } catch(e) {}
    console.log('[MC-BIB] E0 Inertia XHR url:', url)
    const resp = await _sessionFetch(url, {
      'X-Inertia': 'true',
      'X-Inertia-Version': version,
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'text/html, application/xhtml+xml',
    })
    console.log('[MC-BIB] E0 status:', resp.status, 'data type:', typeof resp.data, 'isObj:', typeof resp.data === 'object')
    if (typeof resp.data === 'object' && resp.data) {
      const props = resp.data?.props || {}
      console.log('[MC-BIB] E0 props keys:', Object.keys(props).map(k => k + '=' + (Array.isArray(props[k]) ? 'arr('+props[k].length+')' : typeof props[k] === 'object' ? 'obj('+JSON.stringify(Object.keys(props[k] || {})).slice(0,60)+')' : typeof props[k])))
    }
    if (resp.status === 200 && resp.data && typeof resp.data === 'object') {
      const props = resp.data?.props || {}
      for (const key of ['animes', 'series', 'data', 'resultados', ...Object.keys(props)]) {
        const val = props[key]
        if (!Array.isArray(val) || !val.length) continue
        const f = val[0]
        if (!f || typeof f !== 'object') continue
        if (!(f.slug || f.titulo || f.title || f.url || f.nombre)) continue
        const lista = val.map(a => {
          const slug = a.slug || ''
          const link = a.url || a.link || (slug ? `${BASE}/anime/${slug}-sub-espanol` : '')
          const titulo = a.titulo || a.title || a.nombre || a.name || slug.replace(/-/g, ' ')
          return { titulo, link, imagen: _img(a.imagen || a.image || a.portada || a.cover || '') }
        }).filter(a => a.titulo && a.link)
        console.log('[MC-BIB] E0 lista encontrada, count:', lista.length, 'primero:', lista[0]?.titulo)
        if (lista.length) return { lista, hayMas: !!(props.links?.next || resp.data?.props?.links?.next) }
      }
    }
    // SSR HTML con data-page
    if (typeof resp.data === 'string') {
      const r = _parseInertiaPage(resp.data)
      console.log('[MC-BIB] E0 SSR parse result:', r?.length)
      if (r && r.length) return { lista: r, hayMas: false }
    }
    console.log('[MC-BIB] E0 sin resultados utiles')
  } catch(e) { console.log('[MC-BIB] E0 error:', e.message) }

  // ── E1: BrowserWindow (bypass Cloudflare, espera rendering Vue) ────────────
  try {
    console.log('[MC-BIB] E1 BrowserWindow...')
    const r = await _getBibliotecaConBrowserWindow(url)
    console.log('[MC-BIB] E1 result:', r?.lista?.length, 'primero:', r?.lista?.[0]?.titulo)
    if (r && r.lista && r.lista.length) return r
  } catch(e) { console.log('[MC-BIB] E1 error:', e.message) }

  // ── E2: axios ───────────────────────────────────────────────────────────────
  const html = await _fetch(url)
  const $ = cheerio.load(html)
  const lista = []

  $('a[href*="/anime/"]').each((_, el) => {
    const link = $(el).attr('href') || ''
    if (!link.includes('-sub-espanol') && !link.includes('/anime/')) return
    const fullLink = link.startsWith('http') ? link : BASE + link

    const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || ''
    let titulo = $(el).find('h3, h2, .titulo, .title').first().text().trim()
    if (!titulo) titulo = $(el).attr('title') || $(el).text().trim()
    if (!titulo) return
    if (lista.find(x => x.link === fullLink)) return

    lista.push({ titulo, link: fullLink, imagen: _img(img) })
  })

  const hayMas = !!$(`a[href*="p=${page + 1}"]`).length
  return { lista, hayMas }
}

// ── GET ANIME ─────────────────────────────────────────────────────────────────
async function getAnime(url) {
  const { html, headers } = await _fetchWithHeaders(url)
  const $ = cheerio.load(html)

  const titulo    = $('h1').first().text().trim() || $('h2').first().text().trim()
  const imagen    = _img($('img.lazy').attr('data-src') || $('img').first().attr('src') || '')
  const sinopsis  = $('p').filter((_, el) => $(el).text().length > 80).first().text().trim() || ''
  const generos   = []
  $('a[href*="/genero/"]').each((_, el) => {
    const g = $(el).text().trim()
    if (g && !generos.includes(g)) generos.push(g)
  })

  // Estado
  let estado = ''
  $('p, span, div').each((_, el) => {
    const t = $(el).text().toLowerCase()
    if (t.includes('finalizado')) { estado = 'Finalizado'; return false }
    if (t.includes('en emisión') || t.includes('en emision')) { estado = 'En emisión'; return false }
  })

  const episodios = []

  // Intento 1: AJAX pagination (el método que usa el site para cargar episodios)
  const csrfMatch = html.match(/name="csrf-token"\s+content="([^"]+)"/i)
  const axMatch   = html.match(/(https?:\/\/[^\s"'<>]+\/ajax_pagination\/\d+)/i)

  if (csrfMatch && axMatch) {
    try {
      const csrfToken = csrfMatch[1]
      const axUrl     = axMatch[1]
      const cookie    = (headers['set-cookie'] || []).join('; ')
      const ajaxHeaders = {
        ...HEADERS,
        'X-CSRF-TOKEN': csrfToken,
        'Cookie':       cookie,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      }

      const axRes  = await axios.post(axUrl, null, { headers: ajaxHeaders, timeout: 15000 })
      const pData  = axRes.data

      if (pData && pData.paginate_url && Array.isArray(pData.eps)) {
        const perPage   = pData.perpage || 50
        const totalPages = Math.ceil(pData.eps.length / perPage)

        for (let p = 1; p <= totalPages; p++) {
          const epUrl  = `${pData.paginate_url}?p=${p}`
          const epRes  = await axios.post(epUrl, null, { headers: ajaxHeaders, timeout: 15000 })
          const epData = epRes.data
          if (epData && Array.isArray(epData.caps)) {
            for (const cap of epData.caps) {
              const num = parseInt(cap.episodio, 10)
              if (!cap.url || !num) continue
              const epLink = cap.url.startsWith('http') ? cap.url : BASE + cap.url
              const epImg  = cap.imagen ? _img(cap.imagen) : ''
              episodios.push({ num, link: epLink, titulo: `Episodio ${num}`, imagen: epImg })
            }
          }
        }
      }
    } catch(e) { /* silenciar, usar fallback */ }
  }

  // Fallback: parsear links /ver/ presentes en el HTML
  if (!episodios.length) {
    $('a[href*="/ver/"]').each((_, el) => {
      const href = $(el).attr('href') || ''
      if (!href.includes('-episodio-')) return
      const fullLink = href.startsWith('http') ? href : BASE + href
      const num = _epNum(fullLink)
      if (!num) return
      if (episodios.find(e => e.num === num)) return
      const epImg = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || ''
      episodios.push({ num, link: fullLink, titulo: `Episodio ${num}`, imagen: _img(epImg) })
    })
  }

  episodios.sort((a, b) => a.num - b.num)

  return {
    titulo,
    imagen,
    sinopsis,
    generos,
    estado,
    episodios,
  }
}

// ── GET SERVIDORES ────────────────────────────────────────────────────────────
async function getServidores(url) {
  const html = await _fetch(url)
  const $ = cheerio.load(html)
  const servidores = []

  // Método principal: .play-video con data-player en base64
  $('.play-video').each((_, el) => {
    const nombre     = $(el).text().trim().toLowerCase() || 'server'
    const dataPlayer = $(el).attr('data-player')
    if (!dataPlayer) return
    try {
      const decoded = Buffer.from(dataPlayer, 'base64').toString('utf-8')
      if (decoded.startsWith('http')) {
        servidores.push({ nombre, url: decoded })
      }
    } catch(e) {}
  })

  // Fallback: links de descarga → convertir a embed cuando es posible
  if (!servidores.length) {
    $('a[href]').each((_, el) => {
      const href  = $(el).attr('href') || ''
      const texto = $(el).text().trim().toLowerCase()
      if (!href.startsWith('http')) return

      let embedUrl = null
      if (href.includes('filemoon.sx'))  embedUrl = href.replace('/d/', '/e/')
      else if (href.includes('voe.sx'))  embedUrl = href
      else if (href.includes('mp4upload.com')) {
        const m = href.match(/mp4upload\.com\/([^.]+)\.html/)
        if (m) embedUrl = `https://www.mp4upload.com/embed-${m[1]}.html`
      }
      else if (href.includes('doodstream.com') || href.includes('dood.')) {
        embedUrl = href.replace('/d/', '/e/')
      }

      if (embedUrl && !servidores.find(s => s.url === embedUrl)) {
        servidores.push({ nombre: texto || 'server', url: embedUrl })
      }
    })
  }

  return servidores
}

module.exports = { BASE, getRecientes, buscar, getBiblioteca, getAnime, getServidores }
