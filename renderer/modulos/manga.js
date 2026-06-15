// modulos/manga.js — Favoritos, historial, tendencias, detalle manga, lector
// Requiere: utils.js, core.js, ui.js

// Pila de navegación interna del módulo manga (para el botón Volver)
let _mnNavStack = []

// ── Fuente activa (namespace para localStorage) ──────────────────────────────
// window._activeMangaSource se establece desde core.js al seleccionar fuente
function _mnSrc() { return window._activeMangaSource ? '-' + window._activeMangaSource : '' }

// Cache en memoria de portadas: url → imgUrl (evita re-pedir al IPC en la misma sesión)
const _portadaCache = new Map()

// ── FAVORITOS MANGA (localStorage) ──────────────────────────────────────
function getMangaFavs() {
  return JSON.parse(localStorage.getItem('manga-favs' + _mnSrc()) || '[]')
}
function setMangaFavs(favs) {
  localStorage.setItem('manga-favs' + _mnSrc(), JSON.stringify(favs))
}
function isMangaFav(url) {
  return getMangaFavs().some(f => f.url === url)
}
function toggleMangaFav() {
  const btn = document.getElementById('mn-btn-fav')
  if (!_mangaActual) return
  const favs = getMangaFavs()
  const idx = favs.findIndex(f => f.url === _mangaActual.url)
  if (idx > -1) {
    favs.splice(idx, 1)
  } else {
    favs.unshift({
      url: _mangaActual.url,
      titulo: _mangaActual.titulo,
      imagen: _mangaActual.imagen || '',
      generos: _mangaActual.generos || []
    })
  }
  setMangaFavs(favs)
  _actualizarBtnFavManga()
}
function cargarMangaFavoritos() {
  const grilla = document.getElementById('grilla-manga-favoritos')
  if (!grilla) return
  const favs = getMangaFavs()
  if (!favs.length) {
    grilla.innerHTML = '<div class="fav-vacio">No tienes mangas guardados.<br>Dale ❤️ a un manga para guardarlo.</div>'
    return
  }
  grilla.innerHTML = favs.map(f => renderMangaTarjeta(f)).join('')
  checkLoadedImgs(grilla)
  mnCargarPortadasLazy(grilla)
}

// ── HISTORIAL MANGA ──────────────────────────────────────────────────────
function cargarMangaHistorial() {
  const lista = document.getElementById('manga-historial-lista')
  if (!lista) return
  const hist = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')
  if (!hist.length) {
    lista.innerHTML = '<div class="fav-vacio">No has leído ningún capítulo aún.</div>'
    return
  }
  lista.innerHTML = hist.slice().reverse().map(h => {
    const titulo = (h.titulo || '').split(' - Cap')[0]
    const capNum = ((h.titulo || '').match(/\s*-\s*Cap(?:ítulo|itulo)?\s+(.+)$/i)?.[1] || '').trim()
    const mUrl   = h.mangaUrl || h.link
    return `<div class="manga-cap-item" style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;cursor:pointer;transition:background 0.12s;margin-bottom:4px"
      data-manga-url="${mUrl.replace(/"/g,'&quot;')}"
      data-manga-titulo="${titulo.replace(/"/g,'&quot;')}">
      ${h.imagen ? `<img src="${h.imagen}" style="width:38px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0" onerror="this.style.display='none'" />` : ''}
      <div style="flex:1;min-width:0">
        <div class="manga-cap-num">${titulo}</div>
        ${capNum ? `<div class="manga-cap-fecha" style="color:var(--primary-glow);margin-top:2px">Cap ${capNum}</div>` : ''}
        <div class="manga-cap-fecha">${h.fecha || ''}</div>
      </div>
    </div>`
  }).join('')
  lista.onclick = e => {
    const card = e.target.closest('[data-manga-url]')
    if (card) abrirManga(card.dataset.mangaUrl, card.dataset.mangaTitulo)
  }
}

// Guarda la entrada en historial con mangaUrl (URL del manga) + link (URL del capítulo)
// También guarda el número de capítulo para poder reconstruir la navegación

function limpiarMangaHistorial() {
  localStorage.removeItem('manga-historial' + _mnSrc())
  cargarMangaHistorial()
}
function _detectarFuenteUrl(url) {
  if (!url) return null
  if (url.includes('novelcool.com')) return 'novelcool'
  if (url.includes('zonatmo.org') || url.includes('visortmo.com') || url.includes('tmo.to')) return 'zonatmo'
  return null
}

function guardarMangaHistorial(capLink, titulo, imagen, mangaUrl) {
  const hist = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')
  const idxCap = hist.findIndex(h => h.link === capLink)
  if (idxCap > -1) hist.splice(idxCap, 1)
  // Extraer número de capítulo del título para búsqueda posterior
  const capNum = titulo.split(' - Cap ')[1] || ''
  hist.push({
    link: capLink,
    mangaUrl: mangaUrl || capLink,
    titulo,
    capNum,
    source: _detectarFuenteUrl(mangaUrl || capLink),
    imagen: imagen || '',
    fecha: new Date().toLocaleDateString('es'),
    ts: Date.now()
  })
  if (hist.length > 60) hist.shift()
  localStorage.setItem('manga-historial' + _mnSrc(), JSON.stringify(hist))
  if (_getProgresoPaginas(capLink) === 0) _guardarProgresoPaginas(capLink, 0)
}

// Progreso de páginas por capítulo
function _guardarProgresoPaginas(capLink, pagActual, totalPags) {
  const prog = JSON.parse(localStorage.getItem('manga-progreso' + _mnSrc()) || '{}')
  const anterior = prog[capLink] || {}
  prog[capLink] = {
    pagina: pagActual,
    total: totalPags || anterior.total || 0,
    ts: Date.now()
  }
  localStorage.setItem('manga-progreso' + _mnSrc(), JSON.stringify(prog))
}
function _getProgresoPaginas(capLink) {
  const prog = JSON.parse(localStorage.getItem('manga-progreso' + _mnSrc()) || '{}')
  return prog[capLink]?.pagina || 0
}
function _getProgresoPct(capLink) {
  const prog = JSON.parse(localStorage.getItem('manga-progreso' + _mnSrc()) || '{}')
  const entry = prog[capLink]
  if (!entry || !entry.total) return 0
  return Math.round((entry.pagina / entry.total) * 100)
}
// ── MANGA-LEIDOS: store separado sin límite para trackear caps leídos ────────
// Separado de manga-historial (que es para "continuar leyendo", max 60 entradas)
function _getLeidosSet() {
  try { return new Set(Object.keys(JSON.parse(localStorage.getItem('manga-leidos' + _mnSrc()) || '{}'))) }
  catch(e) { return new Set() }
}
function _setCapLeido(link, esLeido) {
  try {
    const leidos = JSON.parse(localStorage.getItem('manga-leidos' + _mnSrc()) || '{}')
    if (esLeido) leidos[link] = 1
    else delete leidos[link]
    localStorage.setItem('manga-leidos' + _mnSrc(), JSON.stringify(leidos))
  } catch(e) {}
}

// Progreso real en porcentaje para "Continuar leyendo"
function _getPorcentajeProgreso(capLink, totalPags) {
  if (!totalPags) return 0
  const pag = _getProgresoPaginas(capLink)
  return Math.round((pag / totalPags) * 100)
}

// ── MENÚ OPCIONES (quitar de continuar) ─────────────────────────────────
let _mnContCtxCard = null  // card referenciado por el menú de opciones

function mostrarOpcionesManga(ev, link, titulo) {
  ev.stopPropagation()
  document.getElementById('mn-opciones-menu')?.remove()
  _mnContCtxCard = ev.target.closest('.mn-cont-card') || null

  const menu = document.createElement('div')
  menu.id = 'mn-opciones-menu'
  menu.style.cssText = [
    'position:fixed',
    'background:#1e293b',
    'border:1px solid #334155',
    'border-radius:10px',
    'padding:5px',
    'z-index:9999',
    'min-width:172px',
    'box-shadow:0 12px 32px rgba(0,0,0,0.55)',
    'animation:fadeInUp 0.14s ease',
    'overflow:hidden'
  ].join(';')

  const item = (icon, label, fn) =>
    `<div class="mn-ctx-item" onclick="${fn};document.getElementById('mn-opciones-menu')?.remove()">
      <span class="mn-ctx-icon">${icon}</span>${label}
     </div>`

  menu.innerHTML =
    item('📖', 'Ver manga',          `abrirManga('${_esc(link)}','${_esc(titulo)}')`) +
    item('🗑', 'Quitar del historial', `quitarDeContinuar('${_esc(link)}')`)

  document.body.appendChild(menu)

  // Posicionar cerca del botón — usar target real (no currentTarget que puede ser el contenedor)
  const btn = ev.target.closest('.mn-cont-dots') || ev.target
  const rect = btn.getBoundingClientRect()
  let top  = rect.bottom + 6
  let left = rect.left
  const mW = 172, mH = 80
  if (left + mW > window.innerWidth  - 8) left = window.innerWidth  - mW - 8
  if (top  + mH > window.innerHeight - 8) top  = rect.top - mH - 6
  menu.style.top  = top  + 'px'
  menu.style.left = left + 'px'

  const close = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close) }
  }
  setTimeout(() => document.addEventListener('click', close), 10)
}

async function quitarDeContinuar(mangaUrl) {
  document.getElementById('mn-opciones-menu')?.remove()
  const card = _mnContCtxCard
  _mnContCtxCard = null

  if (card) {
    // Fase 1: fade out + scale down
    card.style.transition = 'opacity 0.18s ease, transform 0.18s ease'
    card.style.opacity = '0'
    card.style.transform = 'scale(0.85)'
    await new Promise(r => setTimeout(r, 180))
    // Fase 2: colapsar ancho + margen
    const ease = 'cubic-bezier(0.4,0,0.2,1)'
    card.style.transition = `width 0.28s ${ease}, min-width 0.28s ${ease}, margin-right 0.28s ${ease}, border-width 0.28s ${ease}, padding 0.28s ${ease}`
    card.style.overflow = 'hidden'
    card.style.width = '0px'
    card.style.minWidth = '0px'
    card.style.marginRight = '0px'
    card.style.borderWidth = '0px'
    card.style.padding = '0px'
    await new Promise(r => setTimeout(r, 290))
    card.remove()
  }

  const hist = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')
  const nuevo = hist.filter(h => (h.mangaUrl || h.link) !== mangaUrl)
  localStorage.setItem('manga-historial' + _mnSrc(), JSON.stringify(nuevo))
  mnActualizarContinuar()
}

// ── RENDER TARJETA MANGA ─────────────────────────────────────────────────
// ID único por tarjeta para inyectar portada lazy
let _tarjetaIdCounter = 0

function renderMangaTarjeta(m, idx = -1) {
  const letra = (m.titulo || '?').charAt(0)
  const rankBadge = idx >= 1 && idx <= 4 ? `<div class="mn-tend-rank">${idx}</div>` : ''
  const tag = (m.generos || [])[0] || m.demografia || ''
  const tipoBadge = m.tipo ? `<span class="mn-tend-tipo ${(m.tipo||'').toLowerCase()}">${m.tipo}</span>` : ''
  const rating = m.rating && m.rating > 0
    ? `<span class="mn-tend-rating">★ ${typeof m.rating === 'number' ? m.rating.toFixed(1) : m.rating}</span>` : ''
  const url = m.link || m.url || ''
  const tituloEsc = _esc(m.titulo || '')

  // Imagen: directa > cache en memoria > placeholder con data-lazy-url para lazy IPC
  const coverId = 'mc-' + (++_tarjetaIdCounter)
  const imgCached = m.imagen || _portadaCache.get(url) || ''
  const coverHtml = imgCached
    ? `<img class="mn-tend-cover" src="${imgCached}" onload="this.classList.add('loaded')" onerror="mnImgError(this,'${letra}')" />`
    : `<div class="mn-tend-placeholder" id="${coverId}" data-lazy-url="${url}" data-letra="${letra}">${letra}</div>`

  return `<div class="mn-tend-card"
    data-manga-url="${url.replace(/"/g,'&quot;')}"
    data-manga-titulo="${(m.titulo||'').replace(/"/g,'&quot;')}">
    <div class="mn-tend-cover-wrap">
      ${coverHtml}
      ${rankBadge}
      ${tipoBadge}
    </div>
    <div class="mn-tend-title">${m.titulo || ''}</div>
    <div class="mn-tend-meta">
      ${rating}
      ${tag ? `<span class="mn-tend-tag">${tag}</span>` : ''}
    </div>
  </div>`
}

function mnImgError(img, letra) {
  const wrap = img.parentElement
  if (!wrap) return
  wrap.innerHTML = `<div class="mn-tend-placeholder">${letra}</div>`
}

// Lazy-loader: después de renderizar un grid, pide portadas de los placeholders
// Lazy loader específico para las tarjetas de "Continuar leyendo"
// Usan data-lazy-url con la URL del manga (no del capítulo)
function mnCargarPortadasContinuar(container) {
  if (!container) return
  const placeholders = Array.from(container.querySelectorAll('.mn-cont-cover-ph[data-lazy-url]'))
  if (!placeholders.length) return
  placeholders.forEach(async (el) => {
    if (el.dataset.cargando) return
    el.dataset.cargando = '1'
    const mangaUrl = (el.dataset.lazyUrl || '').replace(/&apos;/g, "'").trim()
    const cachedSrc = (el.dataset.src || '').replace(/&quot;/g, '"').trim()
    const letra = el.dataset.letra || '?'
    if (!mangaUrl) return
    let imgUrl = _portadaCache.get(mangaUrl) || cachedSrc || ''
    if (!imgUrl) {
      try { imgUrl = await window.api.getMangaPortada(mangaUrl) } catch(e) {}
      if (imgUrl) _portadaCache.set(mangaUrl, imgUrl)
    }
    if (!imgUrl || !el.isConnected) return
    const imgEl = document.createElement('img')
    imgEl.className = 'mn-cont-cover'
    imgEl.style.cssText = 'opacity:0;transition:opacity 0.35s'
    imgEl.src = imgUrl
    imgEl.onload = () => { imgEl.style.opacity = '1' }
    imgEl.onerror = () => {
      imgEl.replaceWith(Object.assign(document.createElement('div'), {
        className: 'mn-cont-cover',
        style: 'display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:#3b82f6;opacity:0.15',
        textContent: letra
      }))
    }
    if (el.isConnected) el.replaceWith(imgEl)
    const hist = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')
    let dirty = false
    hist.forEach(h => { if ((h.mangaUrl || h.link) === mangaUrl && !h.imagen) { h.imagen = imgUrl; dirty = true } })
    if (dirty) localStorage.setItem('manga-historial' + _mnSrc(), JSON.stringify(hist))
  })
}

function mnCargarPortadasLazy(container) {
  if (!container) return
  const _cargarUna = async (el) => {
    if (!el.isConnected || el.dataset.cargando) return
    el.dataset.cargando = '1'
    const mangaUrl = el.dataset.lazyUrl
    const letra = el.dataset.letra || '?'
    if (!mangaUrl) return
    try {
      let img = _portadaCache.get(mangaUrl) || ''
      if (!img) {
        img = await window.api.getMangaPortada(mangaUrl)
        if (img) _portadaCache.set(mangaUrl, img)
      }
      if (!img || !el.isConnected) return
      const wrap = el.parentElement
      if (!wrap) return
      const imgEl = document.createElement('img')
      imgEl.className = 'mn-tend-cover'
      imgEl.src = img
      imgEl.onload = () => imgEl.classList.add('loaded')
      imgEl.onerror = () => { wrap.innerHTML = `<div class="mn-tend-placeholder">${letra}</div>` }
      el.replaceWith(imgEl)
    } catch(e) {}
  }
  const placeholders = Array.from(container.querySelectorAll('[data-lazy-url]'))
  if (!placeholders.length) return
  // Primeras 6 inmediatamente (visibles), el resto con IntersectionObserver
  placeholders.slice(0, 6).forEach(el => _cargarUna(el))
  if (placeholders.length <= 6) return
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { obs.unobserve(e.target); _cargarUna(e.target) } })
  }, { rootMargin: '200px' })
  placeholders.slice(6).forEach(el => obs.observe(el))
}

// ── TENDENCIAS + INICIO ──────────────────────────────────────────────────
// Cache del home para tabs sin refetch
let _mnHomeData = null
// Llamar al cambiar de fuente para forzar recarga
function mnResetHomeCache() { _mnHomeData = null }

// Estado página Biblioteca (Ver todo)
let _mnBibOrden       = 'likes'
let _mnBibDir         = 'desc'
let _mnBibType        = ''
let _mnBibDemo        = ''
let _mnBibGenders     = []   // ZonaTMO: IDs numéricos
let _mnBibExclude     = []
let _mnBibNcGenders   = []   // NovelCool: strings directos
let _mnBibNcExclude   = []
let _mnBibStatus      = ''
let _mnBibYear        = ''
let _mnBibRate        = ''
let _mnBibPag         = 1

// Lista completa de géneros de NovelCool (de su búsqueda avanzada)
const NC_GENRES_LIST = [
  '4-Koma','Action','Adaptation','Animals','Anime','Anthology',
  'Boys Love','Cartoon','Comedy','Comic','Cooking','Crime','Crossdressing',
  'Cyberpunk','Cultivation','Delinquents','Demons','Detective','Doujinshi','Drama',
  'Ecchi','Fantasy','Full Color','Gender Bender','Ghosts','Girls Love','Gore',
  'Gyaru','Harem','Hentai','Historical','Horror','Incest','Isekai','Josei',
  'Loli','Long Strip','Magic','Magical Girls','Manga','Manhua','Manhwa',
  'Martial Arts','Mature','Mecha','Medical','Military','Monster Girls','Monsters',
  'Music','Mystery','Ninja','One-Shot','Philosophical','Police','Post-Apocalyptic',
  'Psychological','Reincarnation','Romance','Samurai','School Life','Sci-Fi',
  'Seinen','Self-Published','Sexual Violence','Shoujo','Shoujo-ai',
  'Shounen','Shounen Ai','Shota','Slice Of Life','Smut','Sports','Super Natural',
  'Superhero','Survival','Suspense','Thriller','Time Travel','Traditional Games',
  'Tragedy','Traps','Vampires','Video Games','Virtual Reality',
  'Webcomic','Webtoon','Wuxia','Yonkoma','Zombie'
]

function _mnBibInitNcGeneros() {
  const incEl = document.getElementById('mnbib-nc-generos-inc')
  const excEl = document.getElementById('mnbib-nc-generos-exc')
  if (!incEl || incEl.children.length) return  // ya inicializado
  NC_GENRES_LIST.forEach(g => {
    const bi = document.createElement('button')
    bi.className = 'mnbib-genero'; bi.dataset.ncg = g
    bi.textContent = g; bi.onclick = () => mnBibNcGenero(bi, 'inc')
    incEl.appendChild(bi)
    const be = document.createElement('button')
    be.className = 'mnbib-genero'; be.dataset.ncg = g
    be.textContent = g; be.onclick = () => mnBibNcGenero(be, 'exc')
    excEl.appendChild(be)
  })
}
let _mnBibFiltro      = 'all'
let _mnBibTotal       = 0
let _mnBibCargando    = false
let _mnBibVistosLinks = new Set()
let _mnBibQuery       = ''

// Helper central — abre biblioteca con un query de texto
function _mnBibAbrirConQuery(q) {
  // Reset completo igual que mnBibReset
  _mnBibOrden = 'likes'; _mnBibDir = 'desc'; _mnBibPag = 1
  _mnBibType = ''; _mnBibDemo = ''; _mnBibGenders = []; _mnBibExclude = []
  _mnBibNcGenders = []; _mnBibNcExclude = []
  _mnBibStatus = ''; _mnBibYear = ''; _mnBibRate = ''
  _mnBibQuery = q; _mnBibTotal = 0; _mnBibCargando = false
  _mnBibVistosLinks = new Set()

  // Sincronizar filtros con la fuente activa cada vez que se abre la biblioteca
  const _src = window._activeMangaSource
  if (_src) _mnBibSyncSource(_src)
  else window.api?.getMangaSource?.().then(s => { if (s) { window._activeMangaSource = s; _mnBibSyncSource(s) } })

  navegar('manga-biblioteca')
  const _fbmb = document.getElementById('manga-bib-floating'); if(_fbmb){_fbmb.classList.remove('entrando','saliendo');void _fbmb.offsetWidth;_fbmb.classList.add('entrando')}

  // Reset UI
  const tituloEl = document.getElementById('mnbib-titulo')
  const countEl  = document.getElementById('mnbib-count')
  const grilla   = document.getElementById('grilla-manga-biblioteca')
  const footer   = document.getElementById('mnbib-footer')
  const input    = document.getElementById('mnbib-input')
  const ordenEl  = document.getElementById('mnbib-orden')
  if (tituloEl) tituloEl.textContent = q ? `Resultados: ${q}` : 'Biblioteca'
  if (countEl)  countEl.textContent  = ''
  if (footer)   footer.style.display = 'none'
  if (input)    input.value = q
  if (ordenEl)  ordenEl.value = 'likes'
  if (grilla)   grilla.innerHTML = '<div class="mn-loading"><div class="mn-spinner"></div><span>Buscando...</span></div>'
  _mnBibUpdateDropLabel('tipo','Todo'); _mnBibUpdateDropLabel('demo','Todo')
  document.querySelectorAll('#page-manga-biblioteca [data-type]').forEach(b => b.classList.toggle('activo', b.dataset.type === ''))
  document.querySelectorAll('#page-manga-biblioteca [data-demo]').forEach(b => b.classList.toggle('activo', b.dataset.demo === ''))
  document.querySelectorAll('.mnbib-genero').forEach(b => b.classList.remove('inc','exc'))
  document.querySelectorAll('#page-manga-biblioteca .mnbib-tipo').forEach(b =>
    b.classList.toggle('activo', b.dataset.filtro === 'all')
  )

  _mnBibCargar(true)
}

// ── SLIDER MANGA ─────────────────────────────────────────────────────────────
let _mnSliderIdx = 0, _mnSliderTotal = 0, _mnSliderTimer = null

function mnIrSlide(idx) {
  _mnSliderIdx = idx
  const track = document.getElementById('mn-slider-track')
  if (track) track.style.transform = `translateX(-${idx * 100}%)`
  document.querySelectorAll('#mn-slider-dots .slider-dot').forEach((d, i) => d.classList.toggle('activo', i === idx))
}

function _mnRenderSlider(lista) {
  const track = document.getElementById('mn-slider-track')
  const dots  = document.getElementById('mn-slider-dots')
  if (!track || !lista?.length) return

  _mnSliderTotal = lista.length
  track.innerHTML = lista.map(m => {
    const img = m.imagen || ''
    const tituloEsc = (m.titulo || '').replace(/"/g, '&quot;')
    const linkEsc   = (m.link   || '').replace(/"/g, '&quot;')
    return `<div class="slider-slide">
      ${img ? `<img class="slider-slide-img" src="${img}" alt="${tituloEsc}" style="object-fit:cover" onerror="this.style.display='none'" />` : `<div class="slider-slide-img" style="background:var(--bg-secondary)"></div>`}
      <div class="slider-info">
        ${m.demografia ? `<div class="slider-ep-badge">${m.demografia.toUpperCase()}</div>` : ''}
        <h2>${m.titulo || ''}</h2>
        ${m.rating > 0 ? `<p class="slider-desc">★ ${typeof m.rating === 'number' ? m.rating.toFixed(1) : m.rating} · ${m.tipo || 'Manga'}</p>` : ''}
        <div class="slider-btns">
          <button class="slider-btn-ver" data-url="${linkEsc}" data-titulo="${tituloEsc}">▶ Ver manga</button>
        </div>
      </div>
    </div>`
  }).join('')

  if (dots) dots.innerHTML = lista.map((_, i) => `<div class="slider-dot ${i === 0 ? 'activo' : ''}" onclick="mnIrSlide(${i})"></div>`).join('')

  // Listeners flechas
  const prev = document.getElementById('mn-slider-prev')
  const next = document.getElementById('mn-slider-next')
  if (prev) { prev.onclick = () => { mnIrSlide((_mnSliderIdx - 1 + _mnSliderTotal) % _mnSliderTotal); _mnResetTimer() } }
  if (next) { next.onclick = () => { mnIrSlide((_mnSliderIdx + 1) % _mnSliderTotal); _mnResetTimer() } }

  // Event delegation para botones "Ver manga"
  track.addEventListener('click', e => {
    const btn = e.target.closest('.slider-btn-ver')
    if (btn) abrirManga(btn.dataset.url, btn.dataset.titulo)
  })

  mnIrSlide(0)
  _mnResetTimer()
}

function _mnResetTimer() {
  if (_mnSliderTimer) clearInterval(_mnSliderTimer)
  _mnSliderTimer = setInterval(() => mnIrSlide((_mnSliderIdx + 1) % _mnSliderTotal), 6000)
}

// Espera a que al menos N portadas estén cargadas (o timeout) y llama al callback
function _mnEsperarPortadas(cb, min = 4, maxMs = 3500) {
  if (!cb) return
  const start = Date.now()
  function check() {
    const cargadas = document.querySelectorAll('#grilla-pop .mn-tend-cover.loaded').length
    if (cargadas >= min || Date.now() - start > maxMs) cb()
    else setTimeout(check, 120)
  }
  check()
}

async function cargarMangaTendencias(onReady) {
  const _elemsManga = ['#page-manga-inicio .mn-searchbar','#mn-continuar-wrap',
    '#page-manga-inicio .mn-home-sec:nth-of-type(1)',
    '#page-manga-inicio .mn-home-sec:nth-of-type(2)',
    '#page-manga-inicio .mn-home-sec:nth-of-type(3)']
  _elemsManga.forEach(s => { const el=document.querySelector(s); if(el){el.style.visibility='hidden';el.style.opacity='0'} })
  // Si hay datos cacheados mostrarlos inmediatamente, luego actualizar en background
  if (_mnHomeData) {
    _mnRenderTendencias(_mnHomeData)
    animarEntrada('manga')
    // Ocultar overlay tras 1 frame de paint — el HTML ya está
    requestAnimationFrame(() => { requestAnimationFrame(() => { if (onReady) onReady() }) })
    window.api.getMangaTendencias().then(res => {
      if (res?.pop?.general?.length || res?.trend?.general?.length) {
        _mnHomeData = res
        _mnRenderTendencias(res)
      }
    }).catch(() => {})
    return
  }

  const sp = '<div class="mn-loading"><div class="mn-spinner"></div><span>Cargando...</span></div>'
  ;['grilla-pop','grilla-trend','grilla-new'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = sp
  })

  // Mostrar continuar leyendo INMEDIATAMENTE mientras cargan las tendencias
  mnActualizarContinuar()

  const resRaw = await window.api.getMangaTendencias()
  const res = resRaw || { pop:{general:[],seinen:[],josei:[]}, trend:{general:[],seinen:[],josei:[]}, nuevos:[] }
  _mnHomeData = res
  _mnRenderTendencias(res)
  animarEntrada('manga')
  // Ocultar overlay tras 1 frame de paint — el HTML ya está
  requestAnimationFrame(() => { requestAnimationFrame(() => { if (onReady) onReady() }) })
}

// Función reutilizable para renderizar grillas + recomendado
function _mnRenderTendencias(res) {
  _mnRenderGrilla('grilla-pop',   res.pop?.general   || [])
  _mnRenderGrilla('grilla-trend', res.trend?.general || [])
  _mnRenderGrilla('grilla-new',   res.nuevos         || [])

  // Slider con populares que tienen imagen — pedir portadas si faltan
  const todos = [...(res.pop?.general || [])]
  const conImg = todos.filter(m => m.imagen || _portadaCache.has(m.link || ''))
  // Inyectar desde cache
  todos.forEach(m => { if (!m.imagen && _portadaCache.has(m.link || '')) m.imagen = _portadaCache.get(m.link) })
  const listos = todos.filter(m => m.imagen)

  if (listos.length >= 2) {
    _mnRenderSlider(listos.slice(0, 8))
  } else {
    // Pedir portadas en paralelo, renderizar cuando lleguen 2+
    let _rendered = false
    const _items = todos.slice(0, 8).map(m => ({ ...m }))
    const _try = () => {
      if (_rendered) return
      const ok = _items.filter(m => m.imagen)
      if (ok.length >= 2) { _rendered = true; _mnRenderSlider(ok) }
    }
    _items.forEach(async m => {
      if (m.imagen) return
      try {
        const img = await window.api.getMangaPortada(m.link)
        if (img) { m.imagen = img; _portadaCache.set(m.link, img); _try() }
      } catch(e) {}
    })
    setTimeout(() => { if (!_rendered) { const ok = _items.filter(m => m.imagen); if (ok.length) _mnRenderSlider(ok) } }, 8000)
  }
}

// ── CONTINUAR LEYENDO — max configurable ─────────────────────────────────
let _mnContinuarMax = 0  // 0 = automático (6)

function _getMnContinuarMax() {
  const base = _mnContinuarMax > 0 ? _mnContinuarMax : (typeof _ventanaMaximizada !== 'undefined' && _ventanaMaximizada ? 6 : 4)
  if (typeof _ventanaMaximizada !== 'undefined' && !_ventanaMaximizada && base > 4) return 4
  return base
}

function setMnContinuarMax(n) {
  _mnContinuarMax = n
  window.api.configSet('portadas-max', n)
  mnActualizarContinuar()
}

function _initMnContinuarMaxUI(val) {
  _mnContinuarMax = val || 0
  document.querySelectorAll('#cfg-mn-continuar-max-group .cfg-num-btn').forEach(b => {
    b.classList.toggle('activo', val && parseInt(b.textContent) === val)
  })
}

function abrirPaginaMnContinuar() {
  navegar('manga-mn-continuar')
  const lista = document.getElementById('mn-continuar-full-lista')
  if (!lista) return
  const hist = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')
  const porManga = {}
  hist.forEach(h => {
    const key = h.mangaUrl || h.link
    if (!porManga[key] || (porManga[key].ts||0) < (h.ts||0)) porManga[key] = h
  })
  const entradas = Object.values(porManga).sort((a,b)=>(b.ts||0)-(a.ts||0))
  if (!entradas.length) { lista.innerHTML = '<p style="color:var(--text-muted);padding:20px">No has leído ningún manga aún.</p>'; return }
  lista.innerHTML = entradas.map(h => {
    const tituloBase = (h.titulo||'').split(' - Cap')[0].trim()
    const capNum     = ((h.titulo||'').match(/\s*-\s*Cap(?:ítulo|itulo)?\s+(.+)$/i)?.[1]||'').trim()
    const mangaUrl   = h.mangaUrl || h.link
    const progPct    = _getProgresoPct(h.link)
    const letra      = tituloBase.charAt(0)
    const coverHtml  = `<div class="mn-cont-cover-ph" data-lazy-url="${mangaUrl.replace(/"/g,'&quot;')}" data-src="${(h.imagen||'').replace(/"/g,'&quot;')}" data-letra="${letra}">${letra}</div>`
    return `<div class="mn-cont-card" data-manga-url="${mangaUrl.replace(/"/g,'&quot;')}" data-manga-titulo="${tituloBase.replace(/"/g,'&quot;')}">
      ${coverHtml}
      <div class="mn-cont-dots" data-dots-url="${mangaUrl.replace(/"/g,'&quot;')}" data-dots-titulo="${tituloBase.replace(/"/g,'&quot;')}">⋯</div>
      <div class="mn-cont-info">
        <div class="mn-cont-title">${tituloBase}</div>
        <div class="mn-cont-cap">${capNum ? 'Capítulo '+capNum : 'Ver manga'}</div>
        <div class="mn-cont-prog"><div class="mn-cont-prog-fill" style="width:${progPct}%"></div></div>
        <div class="mn-cont-pct">${progPct > 0 ? progPct+'%' : '—'}</div>
      </div>
    </div>`
  }).join('')
  lista.onclick = e => {
    const dots = e.target.closest('.mn-cont-dots')
    if (dots) { e.stopPropagation(); mostrarOpcionesManga(e, dots.dataset.dotsUrl, dots.dataset.dotsTitulo); return }
    const card = e.target.closest('.mn-cont-card')
    if (card) abrirManga(card.dataset.mangaUrl, card.dataset.mangaTitulo)
  }
  mnCargarPortadasContinuar(lista)
}

// Click en tarjeta de "Continuar leyendo": busca el primer cap sin leer en orden ascendente
function continuarClickManga(card) {
  const mangaUrl   = card.dataset.mangaUrl
  const mangaTitulo = card.dataset.mangaTitulo
  if (!mangaUrl) return
  abrirManga(mangaUrl, mangaTitulo)
}

// Actualizar solo el bloque "Continuar leyendo" sin recargar todo el home
function mnActualizarContinuar() {
  const hist = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')
  const continuarWrap = document.getElementById('mn-continuar-wrap')
  const continuar     = document.getElementById('mn-continuar-lista')
  if (!continuar) return
  if (!hist.length) { if (continuarWrap) continuarWrap.style.display = 'none'; return }
  if (continuarWrap) continuarWrap.style.display = 'flex'
  const porManga = {}
  hist.forEach(h => {
    const key = h.mangaUrl || h.link
    const ts = h.ts || 0
    if (!porManga[key] || (porManga[key].ts||0) < ts) porManga[key] = h
  })
  // Para manga no filtramos por leídos — no sabemos cuántos caps totales hay sin fetchear.
  // El colapso solo ocurre si el historial está vacío (manejado arriba).
  const todasEntradas = Object.values(porManga).sort((a,b)=>(b.ts||0)-(a.ts||0))
  const verLeidosBtn = document.getElementById('mn-continuar-ver-leidos-btn')
  if (verLeidosBtn) verLeidosBtn.style.display = 'none'
  continuarWrap.classList.remove('colapsado')
  const max = _getMnContinuarMax()
  const entradas = todasEntradas.slice(0, max)
  continuar.innerHTML = entradas.map(h => {
    const tituloBase = (h.titulo||'').split(' - Cap')[0].trim()
    const capNum     = ((h.titulo||'').match(/\s*-\s*Cap(?:ítulo|itulo)?\s+(.+)$/i)?.[1] || '').trim()
    const img        = h.imagen || ''
    const mangaUrl   = h.mangaUrl || h.link
    const progPct    = _getProgresoPct(h.link)
    const letra      = tituloBase.charAt(0)
    const src        = h.source || _detectarFuenteUrl(mangaUrl)
    const srcLabel   = src === 'novelcool' ? 'NC' : src === 'zonatmo' ? 'ZT' : ''
    const srcColor   = src === 'novelcool' ? '#185FA5' : '#1D9E75'
    const srcBadge   = srcLabel ? `<div class="mn-cont-src-badge" style="background:${srcColor}">${srcLabel}</div>` : ''
    const coverHtml  = `<div class="mn-cont-cover-ph" data-lazy-url="${mangaUrl.replace(/"/g,'&quot;')}" data-src="${img.replace(/"/g,'&quot;')}" data-letra="${letra}">${letra}${srcBadge}</div>`
    return `<div class="mn-cont-card"
      data-manga-url="${mangaUrl.replace(/"/g,'&quot;')}"
      data-manga-titulo="${tituloBase.replace(/"/g,'&quot;')}">
      ${coverHtml}
      <div class="mn-cont-dots" data-dots-url="${mangaUrl.replace(/"/g,'&quot;')}" data-dots-titulo="${tituloBase.replace(/"/g,'&quot;')}">⋯</div>
      <div class="mn-cont-info">
        <div class="mn-cont-title">${tituloBase}</div>
        <div class="mn-cont-cap">${capNum ? 'Capítulo ' + capNum : 'Ver manga'}</div>
        <div class="mn-cont-prog"><div class="mn-cont-prog-fill" style="width:${progPct}%"></div></div>
        <div class="mn-cont-pct">${progPct > 0 ? progPct + '%' : '—'}</div>
      </div>
    </div>`
  }).join('')

  // Botón ver más/todo — siempre visible
  const restantes = todasEntradas.length - max
  continuar.innerHTML += restantes > 0
    ? `<button class="continuar-ver-mas" onclick="abrirPaginaMnContinuar()"><span class="continuar-ver-num">+${restantes}</span><span class="continuar-ver-label">más</span></button>`
    : `<button class="continuar-ver-mas continuar-ver-todo" onclick="abrirPaginaMnContinuar()"><span class="continuar-ver-label">Ver todo</span></button>`

  continuar.onclick = e => {
    if (e.target.closest('.continuar-ver-mas')) return
    const dots = e.target.closest('.mn-cont-dots')
    if (dots) {
      e.stopPropagation()
      mostrarOpcionesManga(e, dots.dataset.dotsUrl, dots.dataset.dotsTitulo)
      return
    }
    const card = e.target.closest('.mn-cont-card')
    if (card) continuarClickManga(card)
  }
  mnCargarPortadasContinuar(continuar)
  // También actualizar stats
  const statMangas = document.getElementById('mn-stat-mangas')
  const statCaps   = document.getElementById('mn-stat-caps')
  if (statMangas) statMangas.textContent = new Set(hist.map(h => h.mangaUrl || h.link)).size || 0
  if (statCaps)   statCaps.textContent   = hist.length
}

// Renderizar una grilla con lista de mangas
function _mnRenderGrilla(grillaId, lista) {
  const grilla = document.getElementById(grillaId)
  if (!grilla) return
  if (!lista.length) {
    grilla.innerHTML = `<div class="mn-loading" style="color:var(--text-muted);display:flex;flex-direction:column;align-items:center;gap:10px;padding:20px">
      <span>Sin resultados</span>
      <button onclick="cargarMangaTendencias()" style="font-size:11px;padding:5px 14px;border-radius:7px;background:var(--primary);color:white;border:none;cursor:pointer;font-family:Inter,sans-serif">🔄 Reintentar</button>
    </div>`
    return
  }
  // Pre-inyectar imágenes del cache en memoria antes de renderizar
  lista.forEach(m => { if (!m.imagen && _portadaCache.has(m.link || m.url || '')) m.imagen = _portadaCache.get(m.link || m.url || '') })
  grilla.innerHTML = lista.map((m, i) => renderMangaTarjeta(m, i + 1)).join('')
  mnCargarPortadasLazy(grilla)
}

// Cambiar tab de sección (pop o trend) + actualizar botón ver todo

// Ver todo — navega a biblioteca con la sección correcta
const _mnSecOrden = {
  pop:   'likes',
  trend: 'trending',
  new:   'creation'
}
const _mnSecLabel = {
  pop:   'Populares',
  trend: 'Tendencia',
  new:   'Últimos añadidos'
}

// Botón "Ver todo" del home — abre biblioteca completa como /biblioteca en zonatmo
async function verTodoBiblioteca() {
  _mnBibOrden       = 'likes'
  _mnBibPag         = 1
  _mnBibFiltro      = 'all'
  _mnBibTotal       = 0
  _mnBibCargando    = false
  _mnBibVistosLinks = new Set()

  const _src = window._activeMangaSource
  if (_src) _mnBibSyncSource(_src)
  else window.api?.getMangaSource?.().then(s => { if (s) { window._activeMangaSource = s; _mnBibSyncSource(s) } })

  navegar('manga-biblioteca')

  const tituloEl = document.getElementById('mnbib-titulo')
  const countEl  = document.getElementById('mnbib-count')
  const grilla   = document.getElementById('grilla-manga-biblioteca')
  const footer   = document.getElementById('mnbib-footer')
  if (tituloEl) tituloEl.textContent = 'Biblioteca'
  if (countEl)  countEl.textContent  = ''
  if (footer)   footer.style.display = 'none'
  if (grilla)   grilla.innerHTML = '<div class="mn-loading"><div class="mn-spinner"></div><span>Cargando...</span></div>'

  document.querySelectorAll('#page-manga-biblioteca .mn-filtro').forEach(b =>
    b.classList.toggle('activo', b.dataset.filtro === 'all')
  )

  await _mnBibCargar(true)
}

async function verTodoSeccion(seccion) {
  const orden  = _mnSecOrden[seccion] || 'likes'
  const titulo = _mnSecLabel[seccion] || 'Biblioteca'

  _mnBibOrden       = orden
  _mnBibTitulo      = titulo
  _mnBibPag         = 1
  _mnBibFiltro      = 'all'
  _mnBibTotal       = 0
  _mnBibVistosLinks = new Set()

  navegar('manga-biblioteca')

  const tituloEl = document.getElementById('mnbib-titulo')
  const countEl  = document.getElementById('mnbib-count')
  const grilla   = document.getElementById('grilla-manga-biblioteca')
  const footer   = document.getElementById('mnbib-footer')
  if (tituloEl) tituloEl.textContent = titulo
  if (countEl)  countEl.textContent  = ''
  if (footer)   footer.style.display = 'none'
  if (grilla)   grilla.innerHTML = '<div class="mn-loading"><div class="mn-spinner"></div><span>Cargando...</span></div>'

  document.querySelectorAll('#page-manga-biblioteca .mn-filtro').forEach(b =>
    b.classList.toggle('activo', b.dataset.filtro === 'all')
  )

  await _mnBibCargar(true)
}

async function _mnBibCargar(reset = false) {
  if (_mnBibCargando) return
  _mnBibCargando = true
  const grilla   = document.getElementById('grilla-manga-biblioteca')
  const footer   = document.getElementById('mnbib-footer')
  const btnPrev  = document.getElementById('mnbib-btn-prev')
  const btnNext  = document.getElementById('mnbib-btn-next')
  const pagLabel = document.getElementById('mnbib-pag-label')
  const countEl  = document.getElementById('mnbib-count')
  if (btnPrev) btnPrev.disabled = true
  if (btnNext) btnNext.disabled = true

  try {
    // Sincronizar query con el input actual (para combinar texto + filtros sin necesidad de pulsar Buscar)
    const _inputVal = document.getElementById('mnbib-input')?.value.trim() || ''
    if (_inputVal !== _mnBibQuery) _mnBibQuery = _inputVal
    const params = { order_item: _mnBibOrden||'likes', order_dir: _mnBibDir||'desc', pg: String(_mnBibPag) }
    if (_mnBibQuery?.trim())    params.title           = _mnBibQuery.trim()
    if (_mnBibType)             params.type            = _mnBibType
    if (_mnBibDemo)             params.demography      = _mnBibDemo
    if (_mnBibGenders?.length)    params.genders         = _mnBibGenders
    if (_mnBibExclude?.length)    params.exclude_genders = _mnBibExclude
    if (_mnBibNcGenders?.length)  params.nc_genders      = _mnBibNcGenders
    if (_mnBibNcExclude?.length)  params.nc_exclude      = _mnBibNcExclude
    if (_mnBibStatus)             params.status          = _mnBibStatus
    if (_mnBibYear)             params.year            = _mnBibYear
    if (_mnBibRate)             params.rate            = _mnBibRate
    console.log('[_mnBibCargar] params enviados:', JSON.stringify(params))
    const lista = await window.api.buscarManga(JSON.stringify(params))

    if (grilla) grilla.innerHTML = ''
    _mnBibTotal = 0

    if (!lista?.length) {
      if (grilla)  grilla.innerHTML = '<div class="mn-loading" style="color:var(--text-muted)">Sin resultados.</div>'
      if (footer)  footer.style.display = _mnBibPag > 1 ? '' : 'none'
      if (btnPrev) btnPrev.disabled = _mnBibPag <= 1
      if (btnNext) btnNext.disabled = true
      if (pagLabel) pagLabel.textContent = `Página ${_mnBibPag}`
      return
    }

    if (grilla) {
      grilla.innerHTML = lista.map(m => renderMangaTarjeta(m)).join('')
      _mnBibTotal = lista.length
      mnCargarPortadasLazy(grilla)
    }
    if (countEl)  countEl.textContent  = `${_mnBibTotal} mangas`
    if (pagLabel) pagLabel.textContent = `Página ${_mnBibPag}`
    const _pageSize = _activeMangaSource === 'novelcool' ? 48 : 24
    const hayMas = lista.length >= _pageSize
    if (btnPrev) btnPrev.disabled = _mnBibPag <= 1
    if (btnNext) btnNext.disabled = !hayMas
    if (footer)  footer.style.display = (_mnBibPag > 1 || hayMas) ? '' : 'none'

  } catch(e) {
    console.error('[_mnBibCargar]', e.message)
    if (grilla) grilla.innerHTML = '<div class="mn-loading" style="color:var(--text-muted)">Error al cargar. <button onclick="_mnBibCargar(true)" style="margin-left:8px;padding:4px 12px;border-radius:6px;background:var(--primary);color:white;border:none;cursor:pointer;font-size:11px">🔄 Reintentar</button></div>'
  } finally {
    _mnBibCargando = false
  }
}

function mnBibPagAnterior() {
  if (_mnBibPag <= 1) return
  _mnBibPag--
  _mnBibVistosLinks = new Set()
  const grilla = document.getElementById('grilla-manga-biblioteca')
  if (grilla) grilla.innerHTML = '<div class="mn-loading"><div class="mn-spinner"></div><span>Cargando...</span></div>'
  document.getElementById('page-manga-biblioteca')?.scrollTo(0, 0)
  _mnBibCargar(true)
}

function mnBibPagSiguiente() {
  _mnBibPag++
  _mnBibVistosLinks = new Set()
  const grilla = document.getElementById('grilla-manga-biblioteca')
  if (grilla) grilla.innerHTML = '<div class="mn-loading"><div class="mn-spinner"></div><span>Cargando...</span></div>'
  document.getElementById('page-manga-biblioteca')?.scrollTo(0, 0)
  _mnBibCargar(true)
}

function mnBibCambiarOrden(orden) {
  _mnBibOrden = orden; _mnBibPag = 1; _mnBibTotal = 0
  _mnBibVistosLinks = new Set(); _mnBibQuery = ''
  const grilla = document.getElementById('grilla-manga-biblioteca')
  const footer = document.getElementById('mnbib-footer')
  const input  = document.getElementById('mnbib-input')
  if (grilla) grilla.innerHTML = '<div class="mn-loading"><div class="mn-spinner"></div><span>Cargando...</span></div>'
  if (footer) footer.style.display = 'none'
  if (input)  input.value = ''
  _mnBibCargar(true)
}

function mnBibFiltro(btnEl) {
  document.querySelectorAll('#page-manga-biblioteca .mnbib-tipo').forEach(b => b.classList.remove('activo'))
  btnEl.classList.add('activo')
  _mnBibFiltro = btnEl.dataset.filtro
  // Re-renderizar desde la data actual — no refetch
  _mnBibPag  = 1
  _mnBibCargar(true)
}

function mnBibToggleDrop(id) {
  const panel = document.getElementById(`drop-${id}-panel`)
  const drop  = document.getElementById(`drop-${id}`)
  if (!panel) return
  const open = panel.classList.toggle('open')
  drop.classList.toggle('open', open)
  ;['tipo','demo','gen','exc','nc-gen','nc-exc','estado','rate'].filter(d=>d!==id).forEach(d=>{
    document.getElementById(`drop-${d}-panel`)?.classList.remove('open')
    document.getElementById(`drop-${d}`)?.classList.remove('open')
  })
  if (open) {
    const close = e => {
      if (!drop.contains(e.target)) {
        panel.classList.remove('open'); drop.classList.remove('open')
        document.removeEventListener('click', close, true)
      }
    }
    setTimeout(()=>document.addEventListener('click', close, true), 10)
  }
}
function _mnBibUpdateDropLabel(id, texto) {
  const el = document.getElementById(`drop-${id}-val`)
  if (el) el.textContent = texto
  document.getElementById(`drop-${id}`)?.classList.toggle('has-filter', texto!=='Todo' && texto!=='')
}
// Si hay texto en el input, los filtros no disparan búsqueda automática —
// el usuario debe presionar "Buscar" para combinar texto + filtros.
function _mnBibHayTexto() {
  return !!(document.getElementById('mnbib-input')?.value.trim())
}
function _mnBibAutocargar() {
  if (_mnBibHayTexto()) return  // esperar a que el usuario presione Buscar
  _mnBibPag = 1; _mnBibCargar(true)
}

function mnBibTipo(btnEl) {
  _mnBibType = btnEl.dataset.type; _mnBibPag = 1
  document.querySelectorAll('#page-manga-biblioteca [data-type]').forEach(b =>
    b.classList.toggle('activo', b.dataset.type === _mnBibType))
  _mnBibUpdateDropLabel('tipo', btnEl.textContent.trim())
  mnBibToggleDrop('tipo')
  _mnBibAutocargar()
}
function mnBibDemo(btnEl) {
  _mnBibDemo = btnEl.dataset.demo; _mnBibPag = 1
  document.querySelectorAll('#page-manga-biblioteca [data-demo]').forEach(b =>
    b.classList.toggle('activo', b.dataset.demo === _mnBibDemo))
  _mnBibUpdateDropLabel('demo', btnEl.textContent.trim())
  mnBibToggleDrop('demo')
  _mnBibAutocargar()
}
function mnBibGenero(btnEl, mode) {
  const gid = btnEl.dataset.gid
  if (mode === 'inc') {
    const idx = _mnBibGenders.indexOf(gid)
    if (idx>=0) { _mnBibGenders.splice(idx,1); btnEl.classList.remove('inc') }
    else        { _mnBibGenders.push(gid);      btnEl.classList.add('inc') }
    _mnBibExclude = _mnBibExclude.filter(g=>g!==gid)
    document.querySelectorAll(`#mnbib-generos-exc [data-gid="${gid}"]`).forEach(b=>b.classList.remove('exc'))
  } else {
    const idx = _mnBibExclude.indexOf(gid)
    if (idx>=0) { _mnBibExclude.splice(idx,1); btnEl.classList.remove('exc') }
    else        { _mnBibExclude.push(gid);      btnEl.classList.add('exc') }
    _mnBibGenders = _mnBibGenders.filter(g=>g!==gid)
    document.querySelectorAll(`#mnbib-generos-inc [data-gid="${gid}"]`).forEach(b=>b.classList.remove('inc'))
  }
  const gv = document.getElementById('drop-gen-val')
  const ev = document.getElementById('drop-exc-val')
  if (gv) gv.textContent = _mnBibGenders.length ? `${_mnBibGenders.length} sel.` : ''
  if (ev) ev.textContent = _mnBibExclude.length ? `${_mnBibExclude.length} excl.` : ''
  document.getElementById('drop-gen')?.classList.toggle('has-filter', _mnBibGenders.length>0)
  document.getElementById('drop-exc')?.classList.toggle('has-filter', _mnBibExclude.length>0)
  _mnBibAutocargar()
}
function mnBibStatus(btnEl) {
  _mnBibStatus = btnEl.dataset.status; _mnBibPag = 1
  document.querySelectorAll('#drop-estado-panel [data-status]').forEach(b =>
    b.classList.toggle('activo', b.dataset.status === _mnBibStatus))
  _mnBibUpdateDropLabel('estado', btnEl.textContent.trim())
  mnBibToggleDrop('estado')
  _mnBibAutocargar()
}
function mnBibRate(btnEl) {
  _mnBibRate = btnEl.dataset.rate; _mnBibPag = 1
  document.querySelectorAll('#drop-rate-panel [data-rate]').forEach(b =>
    b.classList.toggle('activo', b.dataset.rate === _mnBibRate))
  _mnBibUpdateDropLabel('rate', btnEl.textContent.trim())
  mnBibToggleDrop('rate')
  _mnBibAutocargar()
}
function mnBibYear(sel) {
  _mnBibYear = sel.value || ''; _mnBibPag = 1
  document.getElementById('drop-year')?.classList.toggle('has-filter', !!_mnBibYear)
  _mnBibAutocargar()
}
function _mnBibSyncSource(src) {
  const isNC = src === 'novelcool'
  // Orden/Dir: solo ZonaTMO
  const ordenWrap = document.getElementById('mnbib-orden-wrap')
  if (ordenWrap) ordenWrap.style.display = isNC ? 'none' : 'contents'
  // Demografía: solo ZonaTMO
  const demoEl = document.getElementById('drop-demo')
  if (demoEl) demoEl.style.display = isNC ? 'none' : ''
  // Géneros/Excluir ZT: solo ZonaTMO
  const ztFilters = document.getElementById('mnbib-zt-filters')
  if (ztFilters) ztFilters.style.display = isNC ? 'none' : 'contents'
  // Géneros/Excluir NC: solo NovelCool
  const ncFilters = document.getElementById('mnbib-nc-filters')
  if (ncFilters) ncFilters.style.display = isNC ? 'contents' : 'none'
  // Rating y Año: NovelCool no los soporta sin form automation → ocultar para NC
  const rateEl = document.getElementById('drop-rate')
  if (rateEl) rateEl.style.display = isNC ? 'none' : ''
  const yearEl = document.getElementById('drop-year')
  if (yearEl) yearEl.style.display = isNC ? 'none' : ''
  // Estado: ambas fuentes lo soportan (NC via categorías /completed y /updated)
  // Inicializar botones NC si aún no se hizo
  if (isNC) _mnBibInitNcGeneros()
}
function mnBibNcGenero(btnEl, mode) {
  const g = btnEl.dataset.ncg
  if (mode === 'inc') {
    const idx = _mnBibNcGenders.indexOf(g)
    if (idx >= 0) { _mnBibNcGenders.splice(idx, 1); btnEl.classList.remove('inc') }
    else          { _mnBibNcGenders.push(g);          btnEl.classList.add('inc') }
    _mnBibNcExclude = _mnBibNcExclude.filter(x => x !== g)
    document.querySelectorAll(`#mnbib-nc-generos-exc [data-ncg="${g}"]`).forEach(b => b.classList.remove('exc'))
  } else {
    const idx = _mnBibNcExclude.indexOf(g)
    if (idx >= 0) { _mnBibNcExclude.splice(idx, 1); btnEl.classList.remove('exc') }
    else          { _mnBibNcExclude.push(g);          btnEl.classList.add('exc') }
    _mnBibNcGenders = _mnBibNcGenders.filter(x => x !== g)
    document.querySelectorAll(`#mnbib-nc-generos-inc [data-ncg="${g}"]`).forEach(b => b.classList.remove('inc'))
  }
  const gv = document.getElementById('drop-nc-gen-val')
  const ev = document.getElementById('drop-nc-exc-val')
  if (gv) gv.textContent = _mnBibNcGenders.length ? `${_mnBibNcGenders.length} sel.` : ''
  if (ev) ev.textContent = _mnBibNcExclude.length ? `${_mnBibNcExclude.length} excl.` : ''
  document.getElementById('drop-nc-gen')?.classList.toggle('has-filter', _mnBibNcGenders.length > 0)
  document.getElementById('drop-nc-exc')?.classList.toggle('has-filter', _mnBibNcExclude.length > 0)
  _mnBibAutocargar()
}
function mnBibBuscar() {
  _mnBibCargando = false  // reset por si quedó bloqueado de una búsqueda anterior
  _mnBibQuery = document.getElementById('mnbib-input')?.value.trim() || ''
  console.log('[mnBibBuscar] query:', JSON.stringify(_mnBibQuery), '| ncGenders:', JSON.stringify(_mnBibNcGenders))
  const t = document.getElementById('mnbib-titulo')
  if (t) t.textContent = _mnBibQuery ? `Resultados: ${_mnBibQuery}` : 'Biblioteca'
  _mnBibPag = 1; _mnBibCargar(true)
}
function mnBibAplicarFiltros() {
  _mnBibOrden = document.getElementById('mnbib-orden')?.value || 'likes'
  _mnBibDir   = document.getElementById('mnbib-dir')?.value   || 'desc'
  _mnBibPag = 1; _mnBibCargar(true)
}
function mnBibReset() {
  _mnBibOrden='likes'; _mnBibDir='desc'; _mnBibPag=1
  _mnBibType=''; _mnBibDemo=''; _mnBibGenders=[]; _mnBibExclude=[]
  _mnBibNcGenders=[]; _mnBibNcExclude=[]
  _mnBibStatus=''; _mnBibYear=''; _mnBibRate=''
  _mnBibQuery=''; _mnBibTotal=0; _mnBibCargando=false; _mnBibVistosLinks=new Set()
  // Reset UI labels
  _mnBibUpdateDropLabel('tipo','Todo'); _mnBibUpdateDropLabel('demo','Todo')
  _mnBibUpdateDropLabel('estado','Todo'); _mnBibUpdateDropLabel('rate','Todo')
  const yearSel=document.getElementById('drop-year'); if(yearSel){yearSel.value='';yearSel.classList.remove('has-filter')}
  document.querySelectorAll('#drop-estado-panel [data-status]').forEach(b=>b.classList.toggle('activo',b.dataset.status===''))
  document.querySelectorAll('#drop-rate-panel [data-rate]').forEach(b=>b.classList.toggle('activo',b.dataset.rate===''))
  const gv=document.getElementById('drop-gen-val'); if(gv) gv.textContent=''
  const ev=document.getElementById('drop-exc-val'); if(ev) ev.textContent=''
  document.getElementById('drop-gen')?.classList.remove('has-filter')
  document.getElementById('drop-exc')?.classList.remove('has-filter')
  document.getElementById('drop-nc-gen')?.classList.remove('has-filter')
  document.getElementById('drop-nc-exc')?.classList.remove('has-filter')
  const ncgv=document.getElementById('drop-nc-gen-val'); if(ncgv) ncgv.textContent=''
  const ncev=document.getElementById('drop-nc-exc-val'); if(ncev) ncev.textContent=''
  document.querySelectorAll('#mnbib-nc-generos-inc .mnbib-genero').forEach(b=>b.classList.remove('inc'))
  document.querySelectorAll('#mnbib-nc-generos-exc .mnbib-genero').forEach(b=>b.classList.remove('exc'))
  document.querySelectorAll('#page-manga-biblioteca [data-type]').forEach(b=>b.classList.toggle('activo',b.dataset.type===''))
  document.querySelectorAll('#page-manga-biblioteca [data-demo]').forEach(b=>b.classList.toggle('activo',b.dataset.demo===''))
  document.querySelectorAll('.mnbib-genero').forEach(b=>b.classList.remove('inc','exc'))
  const input=document.getElementById('mnbib-input'); if(input) input.value=''
  const orden=document.getElementById('mnbib-orden'); if(orden) orden.value='likes'
  const dir=document.getElementById('mnbib-dir'); if(dir) dir.value='desc'
  _mnBibCargar(true)
}

// Listener volver de biblioteca
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('manga-bib-volver')?.addEventListener('click', () => {
    navegar('manga-inicio')
  })
  document.getElementById('mnbib-input')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    mnBibBuscar()
  })
})

async function buscarManga(q) {
  const grilla = document.getElementById('grilla-manga-buscar')
  if (!grilla) return
  grilla.innerHTML = '<div class="mn-loading"><div class="mn-spinner"></div><span>Buscando...</span></div>'
  const label = document.getElementById('manga-buscar-label')
  if (label) label.textContent = `Resultados para "${q}"`

  const lista = await window.api.buscarManga(q)
  if (!lista.length) {
    grilla.innerHTML = '<div class="mn-loading">Sin resultados. Intenta con otro término.</div>'
    return
  }
  // Aplicar filtro activo
  const filtrado = _filtroManga && _filtroManga !== 'all'
    ? lista.filter(m => (m.tipo || m.titulo || '').toLowerCase().includes(_filtroManga))
    : lista
  grilla.innerHTML = (filtrado.length ? filtrado : lista).map(m => renderMangaTarjeta(m)).join('')
  checkLoadedImgs(grilla)
  mnCargarPortadasLazy(grilla)
}

async function buscarMangaPorGenero(genero) {
  navegar('manga-buscar')
  const label = document.getElementById('manga-buscar-label')
  if (label) label.textContent = `Género: ${genero}`
  const grilla = document.getElementById('grilla-manga-buscar')
  if (grilla) grilla.innerHTML = '<div class="mn-loading"><div class="mn-spinner"></div><span>Cargando...</span></div>'
  const lista = await window.api.buscarManga(genero)
  if (!lista?.length) {
    if (grilla) grilla.innerHTML = '<div class="mn-loading">Sin resultados.</div>'
    return
  }
  grilla.innerHTML = lista.map(m => renderMangaTarjeta(m)).join('')
  checkLoadedImgs(grilla)
  mnCargarPortadasLazy(grilla)
}

let _filtroManga = 'all'
function setFiltroManga(btn) {
  document.querySelectorAll('.mn-filtro').forEach(b => b.classList.remove('activo'))
  btn.classList.add('activo')
  _filtroManga = btn.dataset.filtro
  // Re-aplicar filtro sobre resultados actuales
  const q = document.getElementById('manga-buscador-2')?.value.trim()
  if (q) buscarManga(q)
}

// ── DETALLE MANGA ────────────────────────────────────────────────────────
// Estado de orden y sinopsis para el detalle
let _mdOrdenDesc = true     // true = mayor a menor (default)
let _mdSinopsisExpandida = false

async function abrirManga(url, titulo) {
  // Si hay PiP de un manga diferente → cerrarlo
  if (_pipManga && _pipManga.mangaUrl !== url) _cerrarPip()

  // LIMPIEZA COMPLETA de estado del manga anterior
  _mangaActual   = null
  _capsActuales  = []
  _capActualIdx  = -1
  _urlCapActual  = ''
  window._mdUltimoCapLink  = null
  window._mdUltimoCapTitulo = null

  const _paginaOrigen = document.querySelector('#app-manga .pagina.activa')?.id?.replace('page-', '') || 'manga-inicio'
  _mnNavStack.push(_paginaOrigen)
  if (typeof _mangaHistorial !== 'undefined') _mangaHistorial.push(_paginaOrigen)
  navegar('manga-detalle')
  // Re-trigger animación botones flotantes manga
  const _fbManga = document.getElementById('manga-floating-btns')
  if (_fbManga) { _fbManga.classList.remove('entrando','saliendo'); void _fbManga.offsetWidth; _fbManga.classList.add('entrando') }

  _mangaUrlActual = url
  _mangaActual = null
  _mdOrdenDesc = true
  _mdSinopsisExpandida = false

  // Reset UI — estado de carga: activar skeleton
  const g = id => document.getElementById(id)
  const colMain = g('md-col-main')
  if (colMain) { colMain.classList.remove('md-content-ready'); colMain.classList.add('md-content-loading') }

  // Reset portada — clonar el img para eliminar handlers del viaje anterior
  const coverWrapEl = document.getElementById('md-cover-wrap')
  if (coverWrapEl) {
    coverWrapEl.classList.remove('loaded')
    const oldImg = g('md-cover-img')
    if (oldImg) {
      const newImg = oldImg.cloneNode(false)   // copia sin handlers
      newImg.removeAttribute('src')            // sin src → no dispara error
      newImg.className = 'md-cover-img'
      newImg.id = 'md-cover-img'
      oldImg.replaceWith(newImg)
    }
  }

  if (g('md-bg')) { g('md-bg').style.backgroundImage = '' }
  if (g('md-titulo')) g('md-titulo').textContent = titulo
  if (g('md-tags')) g('md-tags').style.display = 'none'
  if (g('md-meta-row')) g('md-meta-row').style.display = 'none'
  if (g('md-sinopsis-texto')) g('md-sinopsis-texto').textContent = '—'
  if (g('md-sinopsis-toggle')) g('md-sinopsis-toggle').style.display = 'none'
  if (g('md-continuar-card')) g('md-continuar-card').style.display = 'none'
  if (g('md-panel-generos-sec')) g('md-panel-generos-sec').style.display = 'none'
  if (g('md-caps-lista')) g('md-caps-lista').innerHTML = ''
  if (g('md-cta-btns')) g('md-cta-btns').style.display = 'none'
  _actualizarBtnFavManga()
  _actualizarEstadoCompletadoManga(url)

  const data = await window.api.getMangaDetalle(url, titulo)

  if (!data) {
    if (g('md-sinopsis-texto')) g('md-sinopsis-texto').textContent = 'Error al cargar el manga. Intenta de nuevo.'
    if (g('md-caps-lista')) g('md-caps-lista').innerHTML = '<div class="md-loading-caps" style="color:#e63946">Error al cargar.</div>'
    return
  }

  // Guardar estado
  _mangaActual = {
    url,
    titulo: data.titulo || titulo,
    imagen: data.imagen || '',
    sinopsis: data.sinopsis || '',
    generos: data.generos || [],
    capitulos: data.capitulos || [],
    tipo: (data.tipo || '').toLowerCase() || null   // 'manga' | 'manhwa' | 'manhua'
  }
  _mangaImagenActual = _mangaActual.imagen

  // Activar transición skeleton → contenido real
  if (colMain) {
    colMain.classList.remove('md-content-loading')
    colMain.classList.add('md-content-ready')
  }

  // ── Portada ──
  const coverImg = g('md-cover-img')   // referencia fresca tras el clone del reset
  if (data.imagen && coverImg) {
    const coverWrap = document.getElementById('md-cover-wrap')
    coverImg.onload = () => {
      coverImg.classList.add('loaded')
      coverWrap?.classList.add('loaded')
      const bg = g('md-bg')
      if (bg) bg.style.backgroundImage = `url('${data.imagen}')`
    }
    coverImg.onerror = () => {
      coverImg.classList.add('loaded')
      coverWrap?.classList.add('loaded')
    }
    coverImg.src = data.imagen
  }

  // ── Título ──
  if (g('md-titulo')) g('md-titulo').textContent = data.titulo || titulo

  // ── Meta row ──
  const totalCaps = data.capitulos?.length || 0
  if (g('md-meta-caps-val')) g('md-meta-caps-val').textContent = `${totalCaps} capítulos`
  if (g('md-meta-caps')) g('md-meta-caps').style.display = totalCaps ? '' : 'none'
  if (g('md-meta-row')) g('md-meta-row').style.display = ''

  // ── Tags ──
  // Etiquetas en card central desactivadas — los géneros ya aparecen en el panel derecho

  // ── Sinopsis ──
  const sinopsis = data.sinopsis || 'Sin descripción disponible.'
  if (g('md-sinopsis-texto')) {
    g('md-sinopsis-texto').textContent = sinopsis
    // Mostrar toggle si el texto es largo
    if (sinopsis.length > 200) {
      g('md-sinopsis-toggle').style.display = ''
    }
  }

  // ── Panel derecho: info ──
  if (g('md-estado')) {
    const enEmision = data.capitulos?.length > 0
    g('md-estado').textContent = enEmision ? 'En emisión' : 'Finalizado'
    g('md-estado').className = 'md-panel-val md-estado-val ' + (enEmision ? 'emision' : 'finalizado')
  }
  // Tipo correcto (Manga / Manhwa / Manhua)
  if (g('md-tipo') && _mangaActual.tipo) {
    const t = _mangaActual.tipo
    g('md-tipo').textContent = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
  }

  // ── Panel derecho: estadísticas (datos decorativos reales-ish) ──
  if (g('md-stat-vistas')) g('md-stat-vistas').textContent = _fmtNum(totalCaps * 1800 + 4200)
  if (g('md-stat-segs')) g('md-stat-segs').textContent = _fmtNum(Math.max(300, totalCaps * 220))
  if (g('md-stat-val')) g('md-stat-val').textContent = '—'

  // ── Panel derecho: géneros ──
  if (data.generos?.length && g('md-panel-generos')) {
    g('md-panel-generos').innerHTML = data.generos.map(gen =>
      `<button class="md-panel-genre-pill" onclick="buscarMangaPorGenero('${gen.toLowerCase()}')">${gen}</button>`
    ).join('')
    g('md-panel-generos-sec').style.display = ''
  }

  // ── Continuar leyendo (solo si hay progreso exacto de este manga) ──
  const hist = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')

  // Buscar SOLO por URL exacta — nunca por título
  const entradaPrevia = hist.slice().reverse().find(h => h.mangaUrl === url)

  if (entradaPrevia && data.capitulos?.length) {
    const capNum = ((entradaPrevia.titulo || '').match(/\s*-\s*Cap(?:ítulo|itulo)?\s+(.+)$/i)?.[1] || '').trim()
    const paginaGuardada = _getProgresoPaginas(entradaPrevia.link)
    const pct = _getProgresoPct(entradaPrevia.link)

    if (capNum) {
      if (g('md-cont-cap')) g('md-cont-cap').textContent = `Capítulo ${capNum}`
      if (g('md-cont-nombre')) g('md-cont-nombre').textContent = ''
      if (g('md-cont-prog-fill')) g('md-cont-prog-fill').style.width = `${pct}%`
      if (g('md-cont-pct')) g('md-cont-pct').textContent = `${pct}%`
      if (g('md-cont-thumb')) { g('md-cont-thumb').src = data.imagen || ''; }
      if (g('md-continuar-card')) g('md-continuar-card').style.display = ''
      // Guardar ref para el botón CTA
      window._mdUltimoCapLink = entradaPrevia.link
      window._mdUltimoCapTitulo = entradaPrevia.titulo
      // Sub-label del botón primario
      if (g('md-btn-sub-continuar')) g('md-btn-sub-continuar').textContent = `Capítulo ${capNum}`
    }
  }

  // Función para refrescar el card "Continuar" desde el lector al volver
  window._mdActualizarContinuarCard = () => {
    if (!_mangaUrlActual) return
    const hist = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')
    const entrada = hist.slice().reverse().find(h => h.mangaUrl === _mangaUrlActual)
    if (!entrada) return
    const capNum = ((entrada.titulo||'').match(/\s*-\s*Cap(?:ítulo|itulo)?\s+(.+)$/i)?.[1] || '').trim()
    const pct = _getProgresoPct(entrada.link)
    const g = id => document.getElementById(id)
    if (capNum) {
      if (g('md-cont-cap')) g('md-cont-cap').textContent = `Capítulo ${capNum}`
      if (g('md-cont-prog-fill')) g('md-cont-prog-fill').style.width = `${pct}%`
      if (g('md-cont-pct')) g('md-cont-pct').textContent = `${pct}%`
      if (g('md-continuar-card')) g('md-continuar-card').style.display = ''
      if (g('md-btn-sub-continuar')) g('md-btn-sub-continuar').textContent = `Capítulo ${capNum}`
      window._mdUltimoCapLink = entrada.link
      window._mdUltimoCapTitulo = entrada.titulo
    }
  }

  // ── Botones CTA ──
  if (g('md-cta-btns')) g('md-cta-btns').style.display = ''
  // Ocultar "Continuar leyendo" si no hay historial para este manga
  const btnContinuar = g('md-btn-continuar')
  if (btnContinuar) {
    btnContinuar.style.display = window._mdUltimoCapLink ? '' : 'none'
  }

  // ── Fav + Completado ──
  _actualizarBtnFavManga()
  _actualizarEstadoCompletadoManga(_mangaActual?.url || '')

  // ── Lista capítulos ──
  if (!data.capitulos?.length) {
    if (g('md-caps-lista')) g('md-caps-lista').innerHTML = '<div class="md-loading-caps">Sin capítulos disponibles.</div>'
    return
  }
  _mdRenderCapitulos(data.capitulos, data.titulo || titulo)
}

// Formatea números: 1800 → 1.8K
function _fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function toggleCapLeido(link, titulo, mangaUrl) {
  const estaLeido = _getLeidosSet().has(link)
  // 1. Actualizar manga-leidos (store sin límite, fuente de verdad para "leído")
  _setCapLeido(link, !estaLeido)
  // 2. Actualizar manga-historial (para "continuar leyendo")
  const hist = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')
  const idx  = hist.findIndex(h => h.link === link)
  if (!estaLeido) {
    // Marcar como leído: agregar/actualizar en historial
    const imagen = _mangaActual?.imagen || ''
    const capNum = titulo.split(' - Cap ')[1] || ''
    if (idx > -1) hist.splice(idx, 1)
    hist.push({ link, titulo, mangaUrl, capNum, imagen, fecha: new Date().toLocaleDateString('es'), ts: Date.now() })
    if (hist.length > 500) hist.shift()
  }
  // Al desmarcar: resetear progreso de páginas
  if (estaLeido) {
    const prog = JSON.parse(localStorage.getItem('manga-progreso' + _mnSrc()) || '{}')
    delete prog[link]
    localStorage.setItem('manga-progreso' + _mnSrc(), JSON.stringify(prog))
  }
  // Al desmarcar NO eliminamos del historial para que siga en "continuar leyendo"
  localStorage.setItem('manga-historial' + _mnSrc(), JSON.stringify(hist))
  // Re-renderizar lista de capítulos (detalle y/o sidebar del lector)
  if (_mangaActual?.capitulos) {
    _mdRenderCapitulos(_mangaActual.capitulos, _mangaActual.titulo)
  }
  if (document.getElementById('ml-caps-lista')) {
    rlRenderCapsSidebar()
  }
  // Actualizar "Continuar leyendo" en home y página de historial si está visible
  mnActualizarContinuar()
  if (document.getElementById('manga-historial-lista')) {
    cargarMangaHistorial()
  }
}

function _mdRenderCapitulos(capsList, tituloManga) {
  const g = id => document.getElementById(id)
  const lista = _mdOrdenDesc ? [...capsList] : [...capsList].reverse()
  const leidos = _getLeidosSet()
  const progreso = JSON.parse(localStorage.getItem('manga-progreso' + _mnSrc()) || '{}')
  const imagenManga = _mangaActual?.imagen || ''
  const _capThumbHtml = imagenManga
    ? `<div class="md-cap-thumb-wrap"><img class="md-cap-thumb" src="${imagenManga}" alt="" /></div>`
    : `<div class="md-cap-thumb-wrap md-cap-thumb-empty"></div>`

  // Los 2 capítulos más recientes = "nuevos" (primeros de la lista original desc)
  const nuevosLinks = new Set(capsList.slice(0, 2).map(c => c.link))

  g('md-caps-lista').innerHTML = lista.map((c, i) => {
    const esNuevo = nuevosLinks.has(c.link)
    const esLeido = leidos.has(c.link)
    const progCap = progreso[c.link]?.pagina || 0
    const enProgreso = progCap > 0 && !esLeido

    let estadoHtml = ''
    if (esNuevo && !esLeido) {
      estadoHtml = '<div class="md-cap-dot-nuevo"></div>'
    } else if (enProgreso) {
      estadoHtml = `<div class="md-cap-prog">
        <div class="md-cap-prog-bar"><div class="md-cap-prog-fill" style="width:${progCap}%"></div></div>
        <span class="md-cap-prog-pct">${progCap}%</span>
      </div>`
    }

    const clases = ['md-cap-item', esNuevo && !esLeido ? 'nuevo' : '', esLeido ? 'leido' : ''].filter(Boolean).join(' ')
    const badgeNuevo = esNuevo && !esLeido ? '<span class="md-cap-badge-nuevo">NUEVO</span>' : ''

    const lEsc = c.link.replace(/'/g, "\\'")
    const muEsc = (_mangaActual?.url || '').replace(/'/g, "\\'")
    const tEsc  = _esc(tituloManga + ' - Cap ' + c.num)
    const toggleTitle = esLeido ? 'Marcar como no leído' : 'Marcar como leído'
    const toggleIcon = esLeido
      ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`

    return `<div class="${clases}" data-idx="${capsList.indexOf(c)}">
      ${_capThumbHtml}
      <div class="md-cap-body">
        <div class="md-cap-nombre">Capítulo ${c.num}${badgeNuevo}</div>
        ${c.fecha ? `<div class="md-cap-fecha">${c.fecha}</div>` : ''}
      </div>
      <div class="md-cap-estado">${estadoHtml}</div>
      <button class="md-cap-toggle${esLeido?' leido':''}" title="${toggleTitle}"
        onclick="event.stopPropagation();toggleCapLeido('${lEsc}','${tEsc}','${muEsc}')">${toggleIcon}</button>
    </div>`
  }).join('')

  // Reasignar título con count
  const tituloEl = document.getElementById('md-caps-titulo-el')
  if (tituloEl) tituloEl.innerHTML = `Capítulos <span style="font-size:12px;font-weight:500;color:var(--text-muted);margin-left:4px">${capsList.length}</span>`

  // Listeners click — toda la tarjeta abre el capítulo (excepto el botón toggle)
  g('md-caps-lista').querySelectorAll('.md-cap-item').forEach(el => {
    const origIdx = parseInt(el.dataset.idx)
    el.onclick = (e) => {
      if (e.target.closest('.md-cap-toggle')) return
      abrirCapitulo(
        capsList[origIdx].link,
        `${tituloManga} - Cap ${capsList[origIdx].num}`,
        capsList,
        origIdx
      )
    }
  })
}

function mdToggleOrden() {
  _mdOrdenDesc = !_mdOrdenDesc
  const btn = document.getElementById('md-btn-orden')
  if (btn) btn.querySelector('span') ? null : null
  if (_mangaActual?.capitulos?.length) {
    _mdRenderCapitulos(_mangaActual.capitulos, _mangaActual.titulo)
  }
}

function mdToggleSinopsis() {
  _mdSinopsisExpandida = !_mdSinopsisExpandida
  const texto = document.getElementById('md-sinopsis-texto')
  const btn = document.getElementById('md-sinopsis-toggle')
  if (texto) texto.classList.toggle('expandido', _mdSinopsisExpandida)
  if (btn) {
    btn.classList.toggle('expandido', _mdSinopsisExpandida)
    btn.innerHTML = _mdSinopsisExpandida
      ? 'Mostrar menos <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'
      : 'Mostrar más <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'
  }
}

function mdContinuarLeyendo() {
  if (!_mangaActual?.capitulos?.length) return
  // Si hay progreso guardado, ir al último capítulo leído
  if (window._mdUltimoCapLink) {
    const capIdx = _mangaActual.capitulos.findIndex(c => c.link === window._mdUltimoCapLink)
    abrirCapitulo(
      window._mdUltimoCapLink,
      window._mdUltimoCapTitulo || `${_mangaActual.titulo} - Cap 1`,
      _mangaActual.capitulos,
      capIdx >= 0 ? capIdx : 0
    )
  } else {
    mdLeerDesdeInicio()
  }
}

function mdLeerDesdeInicio() {
  if (!_mangaActual?.capitulos?.length) return
  const primero = _mangaActual.capitulos[_mangaActual.capitulos.length - 1] // el más antiguo
  abrirCapitulo(primero.link, `${_mangaActual.titulo} - Cap ${primero.num}`, _mangaActual.capitulos, _mangaActual.capitulos.length - 1)
}

// Override _actualizarBtnFavManga para usar el nuevo ID
function _actualizarBtnFavManga() {
  if (!_mangaActual) return
  const esFav = isMangaFav(_mangaActual.url)
  // Botón viejo en detalle
  const btn = document.getElementById('md-fav-btn')
  if (btn) {
    btn.innerHTML = esFav
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="#e63946" stroke="#e63946" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Guardado`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> Favorito`
    btn.classList.toggle('activo', esFav)
  }
  // Botón flotante nuevo
  const btnFloat = document.getElementById('mn-btn-fav')
  if (btnFloat) {
    btnFloat.classList.toggle('activo', esFav)
    const svg = btnFloat.querySelector('svg')
    if (svg) { svg.style.fill = esFav ? '#e63946' : 'none'; svg.style.stroke = esFav ? '#e63946' : 'currentColor' }
  }
}

// ─── COMPLETADOS MANGA ────────────────────────────────────────────────────────
const _MANGA_COMP_KEY = 'ryoku-completados-manga'

function _getCompletadosManga() {
  try { return JSON.parse(localStorage.getItem(_MANGA_COMP_KEY) || '[]') } catch { return [] }
}

function _actualizarEstadoCompletadoManga(url) {
  const btn = document.getElementById('mn-btn-completado')
  if (!btn) return
  const completado = _getCompletadosManga().some(c => c.url === url)
  btn.classList.toggle('activo', completado)
  btn.title = completado ? 'Quitar de completados' : 'Marcar como completado'
}

window.toggleMangaCompletado = function () {
  if (!_mangaActual) return
  const lista = _getCompletadosManga()
  const idx   = lista.findIndex(c => c.url === _mangaActual.url)
  if (idx > -1) {
    lista.splice(idx, 1)
  } else {
    lista.push({ url: _mangaActual.url, titulo: _mangaActual.titulo, imagen: _mangaActual.imagen || '', fecha: Date.now() })
    // Marcar todos los capítulos como leídos en bloque (una sola escritura + un re-render)
    if (_mangaActual.capitulos?.length) {
      const hist   = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')
      const leidos = JSON.parse(localStorage.getItem('manga-leidos'   + _mnSrc()) || '{}')
      const ahora   = Date.now()
      const fechaStr = new Date().toLocaleDateString('es')
      _mangaActual.capitulos.forEach(cap => {
        const tituloC = `${_mangaActual.titulo} - Cap ${cap.num}`
        // manga-historial: eliminar entrada previa y agregar actualizada
        const idxCap = hist.findIndex(h => h.link === cap.link)
        if (idxCap > -1) hist.splice(idxCap, 1)
        hist.push({ mangaUrl: _mangaActual.url, link: cap.link, titulo: tituloC, imagen: _mangaActual.imagen || '', capNum: String(cap.num), fecha: fechaStr, ts: ahora })
        // manga-leidos: marcar como leído (fuente de verdad del ojo)
        leidos[cap.link] = 1
      })
      localStorage.setItem('manga-historial' + _mnSrc(), JSON.stringify(hist))
      localStorage.setItem('manga-leidos'   + _mnSrc(), JSON.stringify(leidos))
      _mdRenderCapitulos(_mangaActual.capitulos, _mangaActual.titulo)
      if (typeof mnActualizarContinuar === 'function') mnActualizarContinuar()
    }
  }
  localStorage.setItem(_MANGA_COMP_KEY, JSON.stringify(lista))
  _actualizarEstadoCompletadoManga(_mangaActual.url)
}

// ─── DISCORD RICH PRESENCE (MANGA) ───────────────────────────────────────────
function discordLeyendo(titulo) {
  if (!window.api?.discordUpdate) return
  if (window._ryokuDiscordActivity === false) return
  const manga = (titulo || _mangaActual?.titulo || '').split(' - Cap')[0].trim()
  const m = (titulo || '').match(/[Cc]ap\.?\s*(\d+(?:\.\d+)?)/)
  const cap = m ? `Capítulo ${m[1]}` : (titulo || '')
  const portada = _mangaActual?.imagen || ''
  window.api.discordUpdate({
    details:        manga,
    state:          cap,
    startTime:      Date.now(),
    largeImageKey:  portada || undefined,
    largeImageText: manga
  })
}
function discordExplorandoManga() {
  if (!window.api?.discordUpdate) return
  window.api.discordUpdate({ details: 'Explorando manga' })
}

// ── LECTOR ───────────────────────────────────────────────────────────────
let _capLoadSeq = 0  // monotonically-increasing token; used to cancel stale loads
async function abrirCapitulo(url, titulo, caps = null, capIdx = -1) {
  // CANDADO: si hay una mini-ventana de otro manga, cerrarla
  if (_pipManga && _pipManga.mangaUrl !== (_mangaActual?.url || '')) {
    _cerrarPip()
  }

  // Limpiar URL anterior para evitar que el progreso se guarde en el cap viejo
  _urlCapActual = url

  // Resolver _capsActuales y _capActualIdx con la fuente más confiable disponible
  if (caps && caps.length) {
    _capsActuales = caps
    _capActualIdx = capIdx >= 0 ? capIdx : caps.findIndex(c => c.link === url)
  } else {
    const fuente = _mangaActual?.capitulos
    if (fuente?.length) {
      _capsActuales = fuente
      const idx = fuente.findIndex(c => c.link === url)
      _capActualIdx = idx >= 0 ? idx : capIdx
    } else {
      // Sin _mangaActual ni caps explícitos — limpiar para no usar datos de otro manga
      _capsActuales = []
      _capActualIdx = capIdx
    }
  }
  const ultimaEntrada = _mnNavStack[_mnNavStack.length - 1]
  if (ultimaEntrada !== 'manga-detalle') _mnNavStack.push('manga-detalle')
  navegar('manga-lector')
  discordLeyendo(titulo)
  if (window._friendsSetActivity) {
    const parts = titulo.split(' - Cap ')
    window._friendsSetActivity({ type: 'manga', title: parts[0].trim(), chapter: parts[1] ? parts[1].trim() : '' })
  }
  // Auto-detectar tipo (manga/manhwa/manhua) y configurar lector
  const tipoObra = _mangaActual?.tipo || rlDetectarTipo(titulo, _mangaActual?.tipo)
  _rlResetZoomUI()   // resetear zoom al abrir capítulo
  rlAplicarTipo(tipoObra)
  // Webcomic: vertical por defecto, pero sin bloquear modos
  const _esWebcomic = tipoObra === 'manga' &&
    (_mangaActual?.generos || []).some(g => g.toLowerCase().includes('webcomic'))
  if (_esWebcomic) rlSetModo('vertical')
  else rlSetModo(_rlModo)
  rlSetTema(_rlTema)
  rlSetAjuste(_rlAjuste)
  if (_rlFiltro !== 'none') rlSetFiltro(_rlFiltro)
  rlSetTamano(_rlTamanoActual || 'ajustar')
  rlSetEspejo(_rlEspejo)
  // opciones avanzadas
  const _pags0 = document.getElementById('manga-lector-paginas')
  if (_pags0) {
    _pags0.classList.toggle('con-transicion', _rlTransiciones)
    _pags0.classList.toggle('bordes', _rlBordes)
  }

  // Header nuevo
  const partes = titulo.split(' - Cap ')
  document.getElementById('manga-lector-titulo').textContent = partes[0] || titulo
  document.getElementById('manga-lector-subtitulo').textContent =
    partes[1] ? `Capítulo ${partes[1]}` : ''
  if (partes[0] && partes[0] !== 'MANGA') _mangaTituloActual = partes[0]
  else if (_mangaActual?.titulo) _mangaTituloActual = _mangaActual.titulo

  // Guardar en historial — _mangaActual.url es la fuente de verdad para mangaUrl
  const _mangaUrlParaHist = _mangaActual?.url || _mangaUrlActual || ''
  guardarMangaHistorial(url, titulo, _mangaImagenActual, _mangaUrlParaHist)

  // Sidebar capítulos con nuevo render
  rlRenderCapsSidebar()

  // Cargar páginas — NovelCool muestra source picker antes de cargar
  const pags = document.getElementById('manga-lector-paginas')
  _urlCapActual = url    // guardar para el progreso por páginas
  pags.innerHTML = `<div class="rl-loading"><div class="mn-spinner"></div><span>Cargando capítulo...<br><small style="font-size:10px;color:#555;margin-top:4px;display:block">Puede tardar unos segundos</small></span></div>`
  pags.scrollTop = 0

  // Stale-load guard: si otro abrirCapitulo arranca después, este resultado se descarta.
  const _mySeq = ++_capLoadSeq

  // ── Streaming progresivo (NovelCool) ──────────────────────────────────────
  // onChunk rellena slots placeholder pre-creados — el contador no cambia.
  window.api.offNcPagesMore?.()
  window.api.offNcPagesDone?.()

  // Al terminar la carga, recortar placeholders vacíos sobrantes del final
  window.api.onNcPagesDone?.((actualTotal) => {
    if (_capLoadSeq !== _mySeq) return
    const pagsEl = document.getElementById('manga-lector-paginas')
    if (!pagsEl) return
    // Eliminar placeholders vacíos al final (cuando totalEst > páginas reales)
    while (_rlPaginasUrls.length > actualTotal && _rlPaginasUrls[_rlPaginasUrls.length - 1] === '') {
      const lastIdx = _rlPaginasUrls.length - 1
      _rlPaginasUrls.pop()
      pagsEl.querySelector(`img[data-idx="${lastIdx}"]`)?.remove()
    }
    // Actualizar el total real (solo si cambió)
    if (_rlTotalPaginas !== _rlPaginasUrls.length) {
      _rlTotalPaginas = _rlPaginasUrls.length
      updateProgress(_rlPaginaActual, _rlTotalPaginas)
    }
  })

  window.api.onNcPagesMore?.((newPages) => {
    if (_capLoadSeq !== _mySeq) return
    if (!newPages?.length) return
    const pagsEl = document.getElementById('manga-lector-paginas')
    if (!pagsEl) return
    let startIdx = _rlPaginasUrls.indexOf('')
    newPages.forEach((p, offset) => {
      if (!p) return
      const idx = startIdx >= 0 ? startIdx + offset : _rlPaginasUrls.length
      if (idx < _rlPaginasUrls.length) {
        _rlPaginasUrls[idx] = p
        const img = pagsEl.querySelector(`img[data-idx="${idx}"]`)
        if (img) { img.src = p; img.style.opacity = '0'; img.onload = () => { img.style.opacity = '1' } }
      } else {
        _rlPaginasUrls.push(p)
        const i = _rlPaginasUrls.length - 1
        const img = document.createElement('img')
        img.className = 'manga-pagina'; img.dataset.idx = String(i); img.src = p
        img.style.cssText = 'opacity:0;transition:opacity 0.2s'; img.loading = 'lazy'
        img.onload = () => { img.style.opacity = '1' }
        img.onerror = () => { img.style.opacity = '1'; img.style.minHeight = '0'; img.style.height = '0' }
        pagsEl.appendChild(img)
      }
    })
    if (_rlModo === 'vertical') _rlIniciarScrollObserver(pagsEl)
  })

  const result = await window.api.getMangaPaginas(url, 1)

  if (_mySeq !== _capLoadSeq) return

  // Soporta array simple (ZonaTMO) y {pages, total} (NovelCool progresivo)
  const isProgressive = result && !Array.isArray(result) && Array.isArray(result.pages)
  const firstPages = isProgressive ? result.pages : (Array.isArray(result) ? result : [])
  const totalEst   = isProgressive ? result.total  : firstPages.length

  if (!firstPages.length && !totalEst) {
    pags.innerHTML = `<div style="padding:48px;text-align:center;color:#666">
      <div style="font-size:32px;margin-bottom:12px">😓</div>
      <div style="font-size:14px;font-weight:600;color:var(--text-main);margin-bottom:8px">No se pudieron cargar las páginas</div>
      <div style="font-size:11px;color:#475569;margin-bottom:16px">El servidor puede estar lento o el capítulo no está disponible.</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button onclick="abrirCapitulo('${url}','${_esc(titulo)}',null,${capIdx})"
          style="padding:8px 18px;border-radius:8px;background:var(--primary);color:white;border:none;font-size:12px;cursor:pointer;font-family:Inter,sans-serif">
          🔄 Reintentar
        </button>
      </div>
    </div>`
    return
  }

  // Placeholder oscuro para slots aún no cargados
  const PH = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='1200'%3E%3Crect width='100%25' height='100%25' fill='%230d0d0d'/%3E%3C/svg%3E`

  // Pre-alocar todos los slots — el contador queda fijo en totalEst desde el inicio
  _rlPaginasUrls = new Array(totalEst).fill('')
  firstPages.forEach((p, i) => { _rlPaginasUrls[i] = p })

  pags.innerHTML = _rlPaginasUrls.map((p, i) =>
    `<img class="manga-pagina" data-idx="${i}" src="${p || PH}"
      style="opacity:${p ? 0 : 0.12};transition:opacity 0.2s"
      loading="${i <= 2 ? 'eager' : 'lazy'}"
      onload="if(this.src.indexOf('data:')<0)this.style.opacity=1"
      onerror="this.style.opacity=0.12;this.style.minHeight='120px'" />`
  ).join('')

  if (_rlUserZoom !== 100) _rlAplicarZoom()

  if (_rlModo === 'vertical') {
    if (_rlDireccion === 'arriba') {
      requestAnimationFrame(() => { pags.scrollTop = pags.scrollHeight })
    } else {
      pags.scrollTop = 0
    }
  }

  const total = totalEst
  const paginaGuardada = _getProgresoPaginas(url)
  const paginaInicio = paginaGuardada > 0 ? Math.min(paginaGuardada - 1, total - 1) : 0

  // Inicializar progreso en UI
  updateProgress(paginaInicio + 1, total)
  const slider = document.getElementById('rl-prog-slider')
  if (slider) { slider.max = total; slider.value = paginaInicio + 1 }

  _rlIrAPagina(paginaInicio, false)

  // En modo vertical: re-iniciar el observer sobre las nuevas imágenes
  if (_rlModo === 'vertical') {
    _rlIniciarScrollObserver(pags)
  }
}

// Se llama cuando una imagen carga — para detectar qué página es visible
function _onPaginaVisible(img) {
  // Solo marca visible — el onscroll trackea el progreso
}

// ── LECTOR PREMIUM (rl-*) ────────────────────────────────────────────────
let _rlModo = 'horizontal'         // vertical | horizontal | doble
let _rlDireccion = 'abajo'       // abajo | arriba
let _rlTema = 'oscuro'           // oscuro | oled | claro
let _rlAjuste = 'auto'           // auto | claro | oscuro
let _rlFiltro = 'none'
let _rlTransiciones = true
let _rlBordes = false
let _rlRecordarPosicion = true
let _rlPaginaActual = 1
let _rlTotalPaginas = 0
let _rlPaginasUrls = []
let _rlEspejo = 'rtl'            // rtl = der→izq (manga) | ltr = izq→der (cómic)
let _rlTipoObra = 'manga'        // 'manga' | 'manhwa' | 'manhua' — se detecta al abrir capítulo

let _rlScrollObserver = null   // legacy (no usado)
let _rlScrollHandle   = null   // scroll listener en modo vertical
let _rlScrollPags     = null   // referencia al contenedor con el listener

function _rlSaveConfig() {
  try {
    localStorage.setItem('rl-config', JSON.stringify({
      modo: _rlModo, tema: _rlTema, ajuste: _rlAjuste, filtro: _rlFiltro,
      transiciones: _rlTransiciones, bordes: _rlBordes,
      tamano: _rlTamanoActual, espejo: _rlEspejo, direccion: _rlDireccion
    }))
  } catch(e) {}
}
function _rlLoadConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem('rl-config') || '{}')
    if (cfg.modo)      _rlModo         = cfg.modo
    if (cfg.tema)      _rlTema         = cfg.tema
    if (cfg.ajuste)    _rlAjuste       = cfg.ajuste
    if (cfg.filtro)    _rlFiltro       = cfg.filtro
    if (typeof cfg.transiciones === 'boolean') _rlTransiciones = cfg.transiciones
    if (typeof cfg.bordes       === 'boolean') _rlBordes       = cfg.bordes
    if (cfg.tamano)    _rlTamanoActual = cfg.tamano
    if (cfg.espejo)    _rlEspejo       = cfg.espejo
    if (cfg.direccion) _rlDireccion    = cfg.direccion
  } catch(e) {}
}
_rlLoadConfig()

// ── Auto-detectar tipo de obra y configurar lector ───────────────────────
function rlDetectarTipo(titulo, tipoExplicito) {
  // 1. Tipo explícito del objeto manga (viene del badge de la tarjeta)
  if (tipoExplicito) {
    const t = tipoExplicito.toLowerCase()
    if (t.includes('manhwa') || t.includes('manhua')) return 'manhwa'
    if (t.includes('manga')) return 'manga'
  }
  // 2. Inferir del título / URL
  if (!titulo) return 'manga'
  const tl = titulo.toLowerCase()
  // Palabras típicas de manhwa coreano
  const keywordsmanhwa = ['solo leveling','tower of god','noblesse','lookism','true beauty','windbreaker','boyfriend of the dead','omniscient reader']
  if (keywordsmanhwa.some(k => tl.includes(k))) return 'manhwa'
  return 'manga' // default
}

function rlAplicarTipo(tipo) {
  _rlTipoObra = tipo
  const badge = document.getElementById('rl-tipo-badge')
  if (badge) {
    badge.textContent = tipo === 'manhwa' ? 'MANHWA' : tipo === 'manhua' ? 'MANHUA' : 'MANGA'
    badge.className   = `rl-tipo-badge ${tipo}`
  }

  if (tipo === 'manhwa' || tipo === 'manhua') {
    // Forzar scroll vertical sin márgenes
    _rlModo = 'vertical'  // setear antes de rlSetModo para que el guard lo vea
    rlSetModo('vertical')
    // Bloquear botones Horizontal y Doble
    const bHoriz = document.getElementById('rl-modo-horizontal')
    const bDoble = document.getElementById('rl-modo-doble')
    bHoriz?.setAttribute('disabled','true'); bHoriz?.classList.add('rl-opt-disabled')
    bDoble?.setAttribute('disabled','true'); bDoble?.classList.add('rl-opt-disabled')
    // Ocultar sección espejo
    const secEsp = document.getElementById('rl-section-espejo')
    if (secEsp) secEsp.style.display = 'none'
    // Ocultar sección dirección (manhwa siempre de arriba abajo)
    const secDir = document.getElementById('rl-section-direccion')
    if (secDir) secDir.classList.remove('visible')
    // Sincronizar toggle de scroll en panel Avanzado
    const togScroll = document.getElementById('rl-tog-scroll')
    if (togScroll) togScroll.checked = true
    // Marcar vertical como activo
    document.getElementById('rl-modo-vertical')?.classList.add('activo')
  } else {
    // Manga: habilitar todos los modos
    const bHoriz = document.getElementById('rl-modo-horizontal')
    const bDoble = document.getElementById('rl-modo-doble')
    bHoriz?.removeAttribute('disabled'); bHoriz?.classList.remove('rl-opt-disabled')
    bDoble?.removeAttribute('disabled'); bDoble?.classList.remove('rl-opt-disabled')
    // Manga: restaurar modo guardado (si era vertical, usar horizontal como fallback)
    rlSetModo(_rlModo === 'vertical' ? 'horizontal' : _rlModo)
  }
}

// Espejo — orden de páginas en doble página
function rlSetEspejo(dir) {
  _rlEspejo = dir
  document.getElementById('rl-espejo-rtl')?.classList.toggle('activo', dir === 'rtl')
  document.getElementById('rl-espejo-ltr')?.classList.toggle('activo', dir === 'ltr')
  const pags = document.getElementById('manga-lector-paginas')
  if (!pags) return
  pags.classList.toggle('espejo-ltr', dir === 'ltr')
  _rlSaveConfig()
}


function _rlDetenerScrollObserver() {
  if (_rlScrollHandle && _rlScrollPags) {
    _rlScrollPags.removeEventListener('scroll', _rlScrollHandle)
  }
  _rlScrollHandle = null
  _rlScrollPags   = null
}

function _rlIniciarScrollObserver(pags) {
  _rlDetenerScrollObserver()

  const imgs  = Array.from(pags.querySelectorAll('.manga-pagina'))
  const total = imgs.length
  if (!total) return

  let ticking = false
  _rlScrollHandle = () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      ticking = false
      // Medir cuántos píxeles de cada imagen son visibles dentro del contenedor
      const pagsTop    = pags.getBoundingClientRect().top
      const pagsBottom = pagsTop + pags.clientHeight
      let bestIdx = -1, bestArea = -1
      imgs.forEach((img, i) => {
        const r      = img.getBoundingClientRect()
        const top    = Math.max(r.top,    pagsTop)
        const bottom = Math.min(r.bottom, pagsBottom)
        const area   = Math.max(0, bottom - top)
        if (area > bestArea) { bestArea = area; bestIdx = i }
      })
      if (bestIdx >= 0 && bestIdx + 1 !== _rlPaginaActual) {
        _rlPaginaActual = bestIdx + 1
        updateProgress(_rlPaginaActual, total)
        _guardarProgresoPaginas(_urlCapActual, _rlPaginaActual, total)
        const slider = document.getElementById('rl-prog-slider')
        if (slider) { slider.max = total; slider.value = _rlPaginaActual }
        // Auto-marcar como leído al llegar al 90%+ en modo vertical/scroll
        if (_urlCapActual && total > 0 && _rlPaginaActual / total >= 0.9) {
          if (!_getLeidosSet().has(_urlCapActual)) {
            _setCapLeido(_urlCapActual, true)
            rlRenderCapsSidebar()
          }
        }
      }
    })
  }

  _rlScrollPags = pags
  pags.addEventListener('scroll', _rlScrollHandle, { passive: true })
}

function rlSetModo(modo) {
  // Manhwa/Manhua: solo permitir vertical
  if ((_rlTipoObra === 'manhwa' || _rlTipoObra === 'manhua') && modo !== 'vertical') return

  _rlModo = modo
  // Resetear zoom al cambiar de modo
  _rlResetZoomUI()
  ;['vertical','horizontal','doble'].forEach(m => {
    document.getElementById(`rl-modo-${m}`)?.classList.toggle('activo', m === modo)
  })

  // Sección espejo: solo visible en modo doble Y si es manga (no manhwa)
  const secEspejo = document.getElementById('rl-section-espejo')
  if (secEspejo) secEspejo.classList.toggle('visible', modo === 'doble' && _rlTipoObra === 'manga')

  // Sección dirección: solo visible en modo vertical (con animación)
  const secDireccion = document.getElementById('rl-section-direccion')
  if (secDireccion) secDireccion.classList.toggle('visible', modo === 'vertical')

  // Flechas: ocultar con animación en vertical, mostrar en los demás
  const arrowPrev = document.getElementById('rl-arrow-prev')
  const arrowNext = document.getElementById('rl-arrow-next')
  if (modo === 'vertical') {
    arrowPrev?.classList.add('rl-arrow-hidden')
    arrowNext?.classList.add('rl-arrow-hidden')
  } else {
    arrowPrev?.classList.remove('rl-arrow-hidden')
    arrowNext?.classList.remove('rl-arrow-hidden')
  }
  const pags = document.getElementById('manga-lector-paginas')
  if (!pags) return

  // Quitar todos los modos anteriores
  pags.classList.remove('horizontal','doble','modo-scroll','rl-vertical-activo','espejo-ltr')
  // Limpiar estilos y clases inline que pudo haber dejado el modo doble
  if (modo !== 'doble') {
    pags.querySelectorAll('.manga-pagina').forEach(img => {
      img.style.width = ''; img.style.maxWidth = ''
      img.classList.remove('doble-pag-a','doble-pag-b')
    })
  }

  if (modo === 'vertical') {
    // rl-vertical-activo fuerza overflow-y:auto sin tocar modo-ajustar
    pags.classList.add('modo-scroll','rl-vertical-activo')
    // Resetear zoom — en vertical el ancho lo controla el CSS (100%)
    pags.style.setProperty('--rl-zoom', '100%')
    _mangaZoom = 100
    const zv = document.getElementById('manga-zoom-val')
    const zs = document.getElementById('ml-zoom-slider')
    if (zv) zv.textContent = 'Auto'
    if (zs) zs.value = 100
    // Aplicar dirección activa
    pags.classList.toggle('dir-arriba', _rlDireccion === 'arriba')
    const imgs = pags.querySelectorAll('.manga-pagina')
    imgs.forEach(img => img.style.display = 'block')

    // Inicializar progreso total si aún no está seteado
    const total = imgs.length
    if (total > 0) {
      updateProgress(_rlPaginaActual, total)
      const slider = document.getElementById('rl-prog-slider')
      if (slider) { slider.max = total; slider.value = _rlPaginaActual }
    }

    // Restaurar posición de scroll a la página que se estaba leyendo
    const imgActual = imgs[_rlPaginaActual - 1]
    if (imgActual) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        // Scrollar directamente el contenedor, no scrollIntoView (que escala a #app-manga)
        pags.scrollTop = imgActual.offsetTop
        const appEl = document.getElementById('app-manga')
        if (appEl) appEl.scrollTop = 0
      }))
    }
    // Observar qué página está visible para actualizar la barra
    _rlIniciarScrollObserver(pags)

  } else {
    // _rlPaginaActual ya está al día por el scroll observer — no re-detectar
    // (re-detectar por getBoundingClientRect es poco fiable con imágenes lazy)
    _rlDetenerScrollObserver()
  }

  if (modo === 'horizontal') {
    // Página a página — solo mostrar la activa
    pags.querySelectorAll('.manga-pagina').forEach((img, i) => {
      img.style.display = i === _rlPaginaActual - 1 ? 'block' : 'none'
    })

  } else if (modo === 'doble') {
    pags.classList.add('doble')
    pags.classList.remove('modo-ajustar')
    pags.style.removeProperty('--rl-zoom')
    ;['ajustar','ancho','grande','original'].forEach(t =>
      document.getElementById(`rl-sz-${t}`)?.classList.toggle('activo', t === 'original')
    )
    const zv = document.getElementById('manga-zoom-val')
    if (zv) zv.textContent = '100%'
    pags.classList.toggle('espejo-ltr', _rlEspejo === 'ltr')

    const par = _rlPaginaActual - 1
    pags.querySelectorAll('.manga-pagina').forEach((img, i) => {
      img.style.width    = ''
      img.style.maxWidth = ''
      img.classList.remove('doble-pag-a', 'doble-pag-b')
      if (i === par) {
        img.style.display = 'block'
        img.classList.add('doble-pag-a')   // página activa
      } else if (i === par + 1) {
        img.style.display = 'block'
        img.classList.add('doble-pag-b')   // página siguiente
      } else {
        img.style.display = 'none'
      }
    })
  }
  if (modo === 'horizontal') {
    rlSetTamano(_rlTamanoActual || 'ajustar')
  }
  _rlSaveConfig()
}

function rlSetDireccion(dir) {
  _rlDireccion = dir
  document.getElementById('rl-dir-abajo')?.classList.toggle('activo', dir === 'abajo')
  document.getElementById('rl-dir-arriba')?.classList.toggle('activo', dir === 'arriba')
  const pags = document.getElementById('manga-lector-paginas')
  if (!pags) return
  pags.classList.toggle('dir-arriba', dir === 'arriba')
  if (dir === 'arriba') {
    pags.scrollTop = pags.scrollHeight
  } else {
    pags.scrollTop = 0
  }
  _rlSaveConfig()
}

function rlSetTema(tema) {
  _rlTema = tema
  ;['oscuro','oled','claro'].forEach(t => {
    document.getElementById(`rl-tema-${t}`)?.classList.toggle('activo', t === tema)
  })
  const pags = document.getElementById('manga-lector-paginas')
  if (!pags) return
  pags.classList.remove('tema-oled','tema-claro')
  if (tema === 'oled') pags.classList.add('tema-oled')
  if (tema === 'claro') pags.classList.add('tema-claro')
  _rlSaveConfig()
}

function rlSetAjuste(ajuste) {
  _rlAjuste = ajuste
  ;['auto','claro','oscuro'].forEach(a => {
    document.getElementById(`rl-aj-${a}`)?.classList.toggle('activo', a === ajuste)
  })
  const filtros = { auto: 'none', claro: 'brightness(1.15) contrast(1.05)', oscuro: 'brightness(0.85)' }
  document.querySelectorAll('.manga-pagina').forEach(img => img.style.filter = filtros[ajuste] || 'none')
  _rlSaveConfig()
}

function rlSetFiltro(filtro) {
  _rlFiltro = filtro
  const svgFilters = {
    none: '',
    protanopia:    'url(#rl-f-protanopia)',
    deuteranopia:  'url(#rl-f-deuteranopia)',
    tritanopia:    'url(#rl-f-tritanopia)',
  }
  document.querySelectorAll('.manga-pagina').forEach(img => {
    img.style.filter = svgFilters[filtro] || ''
  })
  _rlSaveConfig()
}

function rlToggleDireccion() {
  rlSetDireccion(_rlDireccion === 'abajo' ? 'arriba' : 'abajo')
}

function rlToggleSettings() {
  const panel = document.getElementById('rl-panel')
  const btn   = document.getElementById('rl-btn-settings')
  if (!panel) return
  const oculto = panel.style.display === 'none'
  panel.style.display = oculto ? '' : 'none'
  btn?.classList.toggle('activo', oculto)
}

function rlToggleGrid() {
  // Por ahora scroll al inicio
  document.getElementById('manga-lector-paginas')?.scrollTo({ top: 0, behavior: 'smooth' })
}

function rlToggleOpt(opt, val) {
  if (opt === 'transiciones') {
    _rlTransiciones = val
    document.getElementById('manga-lector-paginas')?.classList.toggle('con-transicion', val)
  }
  if (opt === 'bordes') {
    _rlBordes = val
    document.getElementById('manga-lector-paginas')?.classList.toggle('bordes', val)
  }
  if (opt === 'posicion') {
    _rlRecordarPosicion = val
  }
  _rlSaveConfig()
}

function rlToggleSidebar() {
  const sidebar = document.getElementById('rl-sidebar')
  const btn     = document.getElementById('rl-btn-toggle-caps')
  if (!sidebar) return
  const oculto = sidebar.classList.toggle('rl-sidebar-hidden')
  if (btn) {
    btn.title = oculto ? 'Mostrar capítulos' : 'Ocultar capítulos'
    btn.innerHTML = oculto
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="18" rx="1"/><path d="M14 8l3 4-3 4"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="18" rx="1"/><path d="M14 8l-3 4 3 4"/></svg>'
  }
}

// Tamaño de imagen — controla el ancho máximo de la página
let _rlTamanoActual = 'ajustar'
function rlSetTamano(tamano) {
  _rlTamanoActual = tamano
  ;['ajustar','ancho','grande','original'].forEach(t =>
    document.getElementById(`rl-sz-${t}`)?.classList.toggle('activo', t === tamano)
  )
  const pags = document.getElementById('manga-lector-paginas')
  if (!pags) return
  pags.classList.toggle('modo-ajustar', tamano === 'ajustar')
  pags.classList.toggle('sz-original', tamano === 'original')
  const zooms = { ancho: 100, grande: 120, original: 100 }
  _mangaZoom = zooms[tamano] ?? 100
  if (tamano !== 'ajustar' && tamano !== 'original') {
    pags.style.setProperty('--rl-zoom', `${_mangaZoom}%`)
  } else if (tamano !== 'original') {
    pags.style.removeProperty('--rl-zoom')
  }
  if (tamano !== 'ajustar') {
    pags.querySelectorAll('.manga-pagina').forEach(img => {
      img.style.maxWidth = ''
      img.style.width    = ''
    })
  }
  const zv = document.getElementById('manga-zoom-val')
  const zs = document.getElementById('ml-zoom-slider')
  if (zv) zv.textContent = tamano === 'ajustar' ? 'Auto' : tamano === 'original' ? 'Original' : `${_mangaZoom}%`
  if (zs) zs.value = _mangaZoom
  _rlSaveConfig()
}

// ── ZOOM DE USUARIO (temporal, no afecta el modo ni se guarda) ────────────
let _rlUserZoom  = 100   // 100 = sin efecto
let _rlZoomBase  = null  // anchos naturales capturados en el primer zoom
let _rlZoomTimer = null  // timer para limpiar estilos al volver a 100%

function _rlAplicarZoom() {
  const pags = document.getElementById('manga-lector-paginas')
  if (!pags) return
  const factor = _rlUserZoom / 100

  // ── Modo vertical (manga + manhwa) ──────────────────────────────────────────
  if (_rlModo === 'vertical') {
    const maxBefore = Math.max(0, pags.scrollHeight - pags.clientHeight)
    const scrollRatio = maxBefore > 0 ? pags.scrollTop / maxBefore : 0

    if (factor === 1) {
      pags.classList.remove('user-zoomed')
      if (_rlZoomBase) {
        // Animar de vuelta al tamaño natural antes de limpiar el inline style
        pags.querySelectorAll('.manga-pagina').forEach((img, i) => {
          const bw = _rlZoomBase[i] ?? pags.clientWidth
          img.style.setProperty('width',     bw + 'px', 'important')
          img.style.setProperty('max-width', 'none',     'important')
        })
        clearTimeout(_rlZoomTimer)
        _rlZoomTimer = setTimeout(() => {
          if (_rlUserZoom !== 100) return
          _rlZoomBase = null
          const p = document.getElementById('manga-lector-paginas')
          if (!p) return
          p.querySelectorAll('.manga-pagina').forEach(img => {
            img.style.removeProperty('width'); img.style.removeProperty('max-width')
          })
        }, 250)
      } else {
        pags.querySelectorAll('.manga-pagina').forEach(img => {
          img.style.removeProperty('width'); img.style.removeProperty('max-width')
        })
      }
      return
    }

    // Cancelar limpieza pendiente si el usuario sigue moviendo el slider
    clearTimeout(_rlZoomTimer)

    // Capturar anchos NATURALES la primera vez (antes de que el zoom los distorsione)
    if (!_rlZoomBase) {
      _rlZoomBase = []
      pags.querySelectorAll('.manga-pagina').forEach(img => {
        _rlZoomBase.push(img.offsetWidth || pags.clientWidth)
      })
    }

    // user-zoomed activa overflow solo cuando hay desbordamiento real
    pags.classList.toggle('user-zoomed', factor > 1)

    const fallbackW = pags.clientWidth   // para imágenes cargadas con lazy después
    pags.querySelectorAll('.manga-pagina').forEach((img, i) => {
      const bw = _rlZoomBase[i] ?? fallbackW
      img.style.setProperty('width',     Math.round(bw * factor) + 'px', 'important')
      img.style.setProperty('max-width', 'none',                           'important')
      img.style.removeProperty('height')
      img.style.removeProperty('max-height')
    })

    // Restaurar posición proporcional después del reflow
    requestAnimationFrame(() => {
      const maxAfter = Math.max(0, pags.scrollHeight - pags.clientHeight)
      if (maxAfter > 0) pags.scrollTop = Math.round(scrollRatio * maxAfter)
    })
    return
  }

  // ── Modo horizontal ─────────────────────────────────────────────────────────────────
  if (_rlModo === 'horizontal') {
    pags.classList.toggle('user-zoomed', factor !== 1)
    if (factor === 1) {
      pags.querySelectorAll('.manga-pagina').forEach(img => {
        img.style.removeProperty('max-width'); img.style.removeProperty('max-height'); img.style.removeProperty('width')
      })
    } else {
      const W = pags.clientWidth, H = pags.clientHeight
      pags.querySelectorAll('.manga-pagina').forEach(img => {
        img.style.setProperty('max-width',  Math.round(W * factor) + 'px', 'important')
        img.style.setProperty('max-height', Math.round(H * factor) + 'px', 'important')
        img.style.setProperty('width', 'auto', 'important')
      })
    }
    return
  }

  // ── Modo doble ──────────────────────────────────────────────────────────────────────
  if (_rlModo === 'doble') {
    pags.classList.toggle('user-zoomed', factor !== 1)
    if (factor === 1) {
      ;['doble-pag-a', 'doble-pag-b'].forEach(cls => {
        const img = pags.querySelector('.' + cls)
        if (img) { img.style.removeProperty('height'); img.style.removeProperty('width'); img.style.removeProperty('max-width') }
      })
    } else {
      const H = pags.clientHeight
      ;['doble-pag-a', 'doble-pag-b'].forEach(cls => {
        const img = pags.querySelector('.' + cls)
        if (!img) return
        img.style.setProperty('height',    Math.round(H * factor) + 'px', 'important')
        img.style.setProperty('width',     '50%', 'important')
        img.style.setProperty('max-width', '50%', 'important')
      })
    }
    pags.scrollTop = 0; pags.scrollLeft = 0
  }
}

function rlSetUserZoom(val) {
  _rlUserZoom = Math.max(50, Math.min(160, parseInt(val) || 100))
  _rlAplicarZoom()
  const zv = document.getElementById('manga-zoom-val')
  const zs = document.getElementById('ml-zoom-slider')
  if (zv) zv.textContent = _rlUserZoom === 100 ? '100%' : `${_rlUserZoom}%`
  if (zs) zs.value = _rlUserZoom
}

function rlAjustarZoom(delta) {
  rlSetUserZoom(_rlUserZoom + delta)
}

function _rlResetZoomUI() {
  clearTimeout(_rlZoomTimer)
  _rlUserZoom = 100
  _rlZoomBase = null
  const pags = document.getElementById('manga-lector-paginas')
  if (pags) {
    pags.classList.remove('user-zoomed')
    pags.querySelectorAll('.manga-pagina').forEach(img => {
      img.style.removeProperty('width'); img.style.removeProperty('max-width')
      img.style.removeProperty('height'); img.style.removeProperty('max-height')
    })
    ;['doble-pag-a', 'doble-pag-b'].forEach(cls => {
      const img = pags.querySelector('.' + cls)
      if (img) { img.style.removeProperty('height'); img.style.removeProperty('width'); img.style.removeProperty('max-width') }
    })
  }
  const zv = document.getElementById('manga-zoom-val')
  const zs = document.getElementById('ml-zoom-slider')
  if (zv) zv.textContent = '100%'
  if (zs) zs.value = 100
}

// Ir a página específica (0-indexed internamente, 1-indexed en UI)
function _rlIrAPagina(idx, guardar = true) {
  const pags = document.getElementById('manga-lector-paginas')
  if (!pags) return
  const imgs = pags.querySelectorAll('.manga-pagina')
  if (!imgs.length) return

  const total = imgs.length
  idx = Math.max(0, Math.min(idx, total - 1))
  _rlPaginaActual = idx + 1   // 1-indexed para UI

  if (_rlModo === 'vertical') {
    // Todas las páginas siempre visibles en vertical
    imgs.forEach(img => img.style.display = 'block')
    if (idx > 0) {
      // Página > 1: scroll a esa imagen una vez que tenga altura real
      const target = imgs[idx]
      if (target) {
        const doScroll = () => {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            // Scrollar directamente el contenedor, no scrollIntoView (que escala a #app-manga)
            const pagsEl = document.getElementById('manga-lector-paginas')
            if (pagsEl && target.isConnected) pagsEl.scrollTop = target.offsetTop
            const appEl = document.getElementById('app-manga')
            if (appEl) appEl.scrollTop = 0
          }))
        }
        if (target.complete && target.naturalHeight > 0) {
          doScroll()
        } else {
          target.addEventListener('load', doScroll, { once: true })
          setTimeout(doScroll, 600)
        }
      }
    }
    // idx===0: scrollTop ya es 0, no tocar nada
  } else if (_rlModo === 'doble') {
    imgs.forEach((img, i) => {
      img.classList.remove('doble-pag-a','doble-pag-b')
      if (i === idx) {
        img.style.display = 'block'
        img.classList.add('doble-pag-a')
      } else if (i === idx + 1) {
        img.style.display = 'block'
        img.classList.add('doble-pag-b')
      } else {
        img.style.display = 'none'
      }
      if (i === idx + 2 || i === idx + 3) img.loading = 'eager'
    })
  } else {
    // Horizontal: página a página
    imgs.forEach((img, i) => {
      img.style.display = i === idx ? 'block' : 'none'
      if (i === idx + 1 || i === idx + 2) img.loading = 'eager'
    })
  }

  // Actualizar progreso (UI + slider)
  updateProgress(_rlPaginaActual, total)
  const slider = document.getElementById('rl-prog-slider')
  if (slider) { slider.max = total; slider.value = _rlPaginaActual }

  // Guardar progreso en localStorage
  if (guardar) _guardarProgresoPaginas(_urlCapActual, _rlPaginaActual, total)

  // Auto-marcar como leído al llegar a la última página (o al 90% en vertical)
  if (guardar && _urlCapActual && total > 0) {
    const pct = _rlPaginaActual / total
    if (_rlPaginaActual >= total || pct >= 0.9) {
      const yaLeido = _getLeidosSet().has(_urlCapActual)
      if (!yaLeido) {
        _setCapLeido(_urlCapActual, true)
        rlRenderCapsSidebar()  // refrescar punto de leído en sidebar
      }
    }
  }
}

// Guardamos la URL del capítulo actual para el progreso
let _urlCapActual = ''

function rlNextPag() {
  const pags = document.getElementById('manga-lector-paginas')
  const total = pags?.querySelectorAll('.manga-pagina').length || 0
  const paso = _rlModo === 'doble' ? 2 : 1
  if (_rlPaginaActual < total) {
    _rlIrAPagina(_rlPaginaActual - 1 + paso)
  } else {
    const siguienteIdx = _capActualIdx - 1
    if (siguienteIdx >= 0) {
      const c = _capsActuales[siguienteIdx]
      _rlToastCap(`Capítulo ${c.num}`)
      setTimeout(() => {
        abrirCapitulo(c.link, `${_mangaTituloActual} - Cap ${c.num}`, null, siguienteIdx)
      }, 800)
    }
  }
}

function rlPrevPag() {
  const paso = _rlModo === 'doble' ? 2 : 1
  if (_rlPaginaActual > 1) {
    _rlIrAPagina(_rlPaginaActual - 1 - paso)
  } else {
    const anteriorIdx = _capActualIdx + 1
    if (anteriorIdx < _capsActuales.length) {
      const c = _capsActuales[anteriorIdx]
      if (c) abrirCapitulo(c.link, `${_mangaTituloActual} - Cap ${c.num}`, null, anteriorIdx)
    }
  }
}

// Toast suave "Siguiente: Capítulo N"
function _rlToastCap(msg) {
  const visor = document.getElementById('rl-visor')
  if (!visor) return
  document.getElementById('rl-toast-cap')?.remove()
  const t = document.createElement('div')
  t.id = 'rl-toast-cap'
  t.textContent = `Siguiente: ${msg}`
  t.style.cssText = 'position:absolute;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.92);color:white;font-size:12px;font-weight:600;padding:8px 18px;border-radius:20px;border:1px solid rgba(255,255,255,0.15);z-index:20;pointer-events:none;font-family:Inter,sans-serif;animation:fadeInUp 0.2s ease'
  visor.appendChild(t)
  setTimeout(() => t.remove(), 1800)
}

function setModoLectura(modo) { rlSetModo(modo) } // alias legacy

function updateProgress(cur, total) {
  _rlPaginaActual = cur; _rlTotalPaginas = total
  const label = document.getElementById('ml-progress-label')
  if (label) label.textContent = `${cur} / ${total}`
  const slider = document.getElementById('rl-prog-slider')
  if (slider) { slider.max = total; slider.value = cur }
  const fill = document.getElementById('ml-progress-fill')
  if (fill) fill.style.width = `${total > 0 ? (cur/total)*100 : 0}%`
}

// ── RENDER CAPS EN SIDEBAR DEL LECTOR ───────────────────────────────────
function rlRenderCapsSidebar() {
  // Siempre sincronizar con _mangaActual si está disponible
  if (_mangaActual?.capitulos?.length) {
    _capsActuales = _mangaActual.capitulos
    if (_capActualIdx < 0 || _capActualIdx >= _capsActuales.length) {
      const hist = JSON.parse(localStorage.getItem('manga-historial' + _mnSrc()) || '[]')
      const entrada = hist.slice().reverse().find(h => (h.mangaUrl || h.link) === _mangaUrlActual)
      if (entrada) {
        const idx = _capsActuales.findIndex(c => c.link === entrada.link)
        if (idx >= 0) _capActualIdx = idx
      }
    }
  }

  const capsList = document.getElementById('ml-caps-lista')
  if (!capsList || !_capsActuales.length) return
  const capsRef = _capsActuales  // referencia local para el closure
  const histSet = _getLeidosSet()
  capsList.innerHTML = _capsActuales.map((c, i) => {
    const esActivo   = i === _capActualIdx
    const esLeidoReal = histSet.has(c.link)
    let indicador = ''
    if (esActivo) indicador = '<div class="rl-cap-dot"></div>'
    const tituloBase = (_mangaActual?.titulo && _mangaActual.titulo !== 'MANGA')
      ? _mangaActual.titulo
      : (_mangaTituloActual && _mangaTituloActual !== 'MANGA' ? _mangaTituloActual : (_mangaActual?.titulo || _mangaTituloActual))
    const muEsc = (_mangaActual?.url || '').replace(/'/g, "\\'")
    const lEsc  = c.link.replace(/'/g, "\\'")
    const tEsc  = _esc(tituloBase + ' - Cap ' + c.num)
    const toggleIcon = esLeidoReal
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
    return `<div class="rl-cap-item${esActivo ? ' activo' : ''}${esLeidoReal ? ' leido' : ''}"
      data-idx="${i}" data-link="${c.link.replace(/"/g,'&quot;')}" data-titulo="${_esc(tituloBase + ' - Cap ' + c.num)}">
      <div class="rl-cap-body">
        <div class="rl-cap-nombre">Capítulo ${c.num}</div>
        <div class="rl-cap-fecha">${c.fecha || ''}</div>
      </div>
      <div class="rl-cap-indicator">${indicador}</div>
      <button class="rl-cap-toggle${esLeidoReal ? ' leido' : ''}"
        title="${esLeidoReal ? 'Marcar como no leído' : 'Marcar como leído'}"
        onclick="event.stopPropagation();toggleCapLeido('${lEsc}','${tEsc}','${muEsc}')">${toggleIcon}</button>
    </div>`
  }).join('')

  // Usar event delegation en vez de onclick inline — evita problemas de escaping
  capsList.onclick = (e) => {
    if (e.target.closest('.rl-cap-toggle')) return  // ignorar clicks en toggle
    const item = e.target.closest('.rl-cap-item')
    if (!item) return
    const idx  = parseInt(item.dataset.idx)
    const link = item.dataset.link
    const tit  = item.dataset.titulo
    abrirCapitulo(link, tit, capsRef, idx)
  }

  const countEl = document.getElementById('rl-caps-count')
  if (countEl) countEl.textContent = `${_capsActuales.length} capítulos disponibles`
  setTimeout(() => {
    const activo = capsList.querySelector('.activo')
    if (activo) capsList.scrollTop = activo.offsetTop - capsList.clientHeight / 2 + activo.clientHeight / 2
  }, 100)
}

// ── MINI-VENTANA FLOTANTE (PiP) ──────────────────────────────────────────
let _pipManga = null

function _activarPip() {
  if (!_urlCapActual || !_mangaTituloActual) return
  _pipManga = {
    mangaUrl:  _mangaActual?.url || '',
    titulo:    _mangaTituloActual,
    capTitulo: document.getElementById('manga-lector-subtitulo')?.textContent || '',
    imagen:    _mangaActual?.imagen || '',
    pagina:    _rlPaginaActual,
    total:     _rlTotalPaginas,
    capLink:   _urlCapActual,
    caps:      [..._capsActuales],
    capIdx:    _capActualIdx,
    scroll:    document.getElementById('manga-lector-paginas')?.scrollTop || 0
  }
  _renderPip()
}

function _renderPip() {
  if (!_pipManga) return
  let pip = document.getElementById('manga-pip')
  if (!pip) {
    pip = document.createElement('div')
    pip.id = 'manga-pip'
    document.body.appendChild(pip)
  }
  const pct = _pipManga.total > 0 ? Math.round((_pipManga.pagina / _pipManga.total) * 100) : 0

  // Construir con DOM para evitar template literals anidados y escaping issues
  pip.innerHTML = ''

  // Imagen
  const imgWrap = document.createElement('div')
  imgWrap.className = 'pip-img-wrap'
  if (_pipManga.imagen) {
    const img = document.createElement('img')
    img.src = _pipManga.imagen
    imgWrap.appendChild(img)
  } else {
    const ph = document.createElement('div')
    ph.className = 'pip-img-placeholder'
    ph.textContent = '漫'
    imgWrap.appendChild(ph)
  }
  const prog = document.createElement('div')
  prog.className = 'pip-progress-bar'
  prog.style.width = pct + '%'
  imgWrap.appendChild(prog)
  pip.appendChild(imgWrap)

  // Info
  const info = document.createElement('div')
  info.className = 'pip-info'
  info.style.cursor = 'pointer'
  info.onclick = _expandirPip
  const tit = document.createElement('div')
  tit.className = 'pip-titulo'
  tit.textContent = _pipManga.titulo
  const cap = document.createElement('div')
  cap.className = 'pip-cap'
  cap.textContent = (_pipManga.capTitulo || '') + ' · Pág ' + _pipManga.pagina + '/' + (_pipManga.total || '?')
  info.appendChild(tit)
  info.appendChild(cap)
  pip.appendChild(info)

  // Botones
  const actions = document.createElement('div')
  actions.className = 'pip-actions'

  const btnExp = document.createElement('button')
  btnExp.className = 'pip-btn'
  btnExp.title = 'Continuar leyendo'
  btnExp.onclick = _expandirPip
  btnExp.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'

  const btnClose = document.createElement('button')
  btnClose.className = 'pip-btn pip-btn-close'
  btnClose.title = 'Cerrar'
  btnClose.onclick = _cerrarPip
  btnClose.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

  actions.appendChild(btnExp)
  actions.appendChild(btnClose)
  pip.appendChild(actions)

  requestAnimationFrame(() => { pip.classList.add('visible'); document.body.classList.add('pip-activo') })
}

function _expandirPip() {
  if (!_pipManga) return
  const p = { ..._pipManga }
  _cerrarPip(false)
  abrirCapitulo(p.capLink, `${p.titulo} - ${p.capTitulo}`, p.caps, p.capIdx)
  if (p.modo === 'vertical' && p.scroll > 0) {
    setTimeout(() => {
      const pags = document.getElementById('manga-lector-paginas')
      if (pags) pags.scrollTop = p.scroll
    }, 900)
  }
}

function _cerrarPip(limpiar = true) {
  const pip = document.getElementById('manga-pip')
  if (pip) { pip.classList.remove('visible'); setTimeout(() => pip.remove(), 300) }
  document.body.classList.remove('pip-activo')
  if (limpiar) _pipManga = null
}

// ── LISTENERS LECTOR ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Volver desde detalle
  document.getElementById('manga-btn-volver')?.addEventListener('click', () => {
    const fb = document.getElementById('manga-floating-btns')
    const doVolver = () => {
      const dest = _mnNavStack.pop() || 'manga-inicio'
      navegar(dest)
      mnActualizarContinuar()
    }
    if (fb) { fb.classList.add('saliendo'); setTimeout(doVolver, 240) }
    else doVolver()
  })
  // Volver desde lector — siempre actualizar continuar
  document.getElementById('manga-lector-volver')?.addEventListener('click', () => {
    const dest = _mnNavStack.pop() || (_modActivo==='manga'?'manga-detalle':'manga-inicio')
    // Activar mini-ventana PiP antes de salir
    _activarPip()
    // Limpiar URL del cap activo — ya está guardado en PiP si aplica
    _urlCapActual = ''
    if (window._ryokuDiscordActivity !== false) window.api?.discordClear?.()
    if (window._friendsSetActivity) window._friendsSetActivity(null)
    navegar(dest)
    mnActualizarContinuar()
    if (dest === 'manga-detalle') _mdActualizarContinuarCard?.()
  })

  // Capítulo ant/sig (botones barra inferior)
  document.getElementById('ml-prev-cap')?.addEventListener('click', () => {
    const anteriorIdx = _capActualIdx + 1
    if (anteriorIdx < _capsActuales.length) {
      const c = _capsActuales[anteriorIdx]
      abrirCapitulo(c.link, `${_mangaTituloActual} - Cap ${c.num}`, null, anteriorIdx)
    }
  })
  document.getElementById('ml-next-cap')?.addEventListener('click', () => {
    const siguienteIdx = _capActualIdx - 1
    if (siguienteIdx >= 0) {
      const c = _capsActuales[siguienteIdx]
      abrirCapitulo(c.link, `${_mangaTituloActual} - Cap ${c.num}`, null, siguienteIdx)
    }
  })

  // Slider de páginas — ir directo a la página seleccionada
  document.getElementById('rl-prog-slider')?.addEventListener('input', e => {
    _rlIrAPagina(parseInt(e.target.value) - 1)
  })

  // Zoom
  const syncZoom = (val) => {
    _mangaZoom = val
    const valEl = document.getElementById('manga-zoom-val')
    const slider = document.getElementById('ml-zoom-slider')
    if (valEl) valEl.textContent = `${val}%`
    if (slider) slider.value = val
    document.getElementById('manga-lector-paginas')?.style.setProperty('--rl-zoom', `${val}%`)
  }
  document.getElementById('manga-zoom-in')?.addEventListener('click', () => syncZoom(Math.min(_mangaZoom + 10, 200)))
  document.getElementById('manga-zoom-out')?.addEventListener('click', () => syncZoom(Math.max(_mangaZoom - 10, 50)))
  document.getElementById('ml-zoom-slider')?.addEventListener('input', e => syncZoom(parseInt(e.target.value)))

  // Búsqueda desde inicio
  const doSearch1 = () => {
    const q = document.getElementById('manga-buscador')?.value.trim()
    if (!q) return
    if (typeof sbSaveHistory === 'function') sbSaveHistory('manga', q)
    _mnBibAbrirConQuery(q)
  }
  document.getElementById('manga-btn-buscar')?.addEventListener('click', doSearch1)
  document.getElementById('manga-buscador')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch1() })

  // Teclado: ← → para páginas, A D como alternativa
  document.addEventListener('keydown', e => {
    const lector = document.getElementById('page-manga-lector')
    if (!lector?.classList.contains('activa')) return
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); if (_rlTipoObra !== 'manhwa' && _rlTipoObra !== 'manhua') rlNextPag() }
    if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') { e.preventDefault(); if (_rlTipoObra !== 'manhwa' && _rlTipoObra !== 'manhua') rlPrevPag() }
  })

  // Instanciar búsqueda mejorada para manga (usa sbSetup de ui.js)
  if (typeof sbSetup === 'function') {
    sbSetup({
      inputId: 'manga-buscador-2', clearId: 'sb-manga-clear', dropId: 'sb-manga-history',
      ns: 'manga',
      onSearch: q => { if (q) _mnBibAbrirConQuery(q); else buscarManga('') }
    })
  } else {
    // Fallback sin historial
    const doSearch2 = () => {
      const q = document.getElementById('manga-buscador-2')?.value.trim()
      if (q) _mnBibAbrirConQuery(q)
      else buscarManga(q)
    }
    document.getElementById('manga-btn-buscar-2')?.addEventListener('click', doSearch2)
    document.getElementById('manga-buscador-2')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch2() })
  }

  document.getElementById('manga-btn-buscar-2')?.addEventListener('click', () => {
    const q = document.getElementById('manga-buscador-2')?.value.trim()
    if (q) { if (typeof sbSaveHistory === 'function') sbSaveHistory('manga', q); _mnBibAbrirConQuery(q) }
  })

  // ── AUTOCOMPLETE DE BÚSQUEDA (deshabilitado) ───────────────────────────────
  ;(function _mnSuggestInit() { return;
    if (!document.getElementById('mn-suggest-style')) {
      const s = document.createElement('style')
      s.id = 'mn-suggest-style'
      s.textContent =
        '.mn-suggest-drop{position:fixed;z-index:99999;background:var(--bg-2,#16162a);' +
        'border:1px solid rgba(124,58,237,.4);border-radius:12px;overflow:hidden;' +
        'box-shadow:0 12px 40px rgba(0,0,0,.75),0 0 0 1px rgba(255,255,255,.04);' +
        'backdrop-filter:blur(12px)}' +

        '.mn-suggest-header{padding:8px 14px 6px;font-size:10px;font-weight:600;' +
        'letter-spacing:.8px;color:var(--accent,#7C3AED);text-transform:uppercase;' +
        'border-bottom:1px solid rgba(255,255,255,.06)}' +

        '.mn-suggest-scroll{max-height:340px;overflow-y:auto}' +
        '.mn-suggest-scroll::-webkit-scrollbar{width:4px}' +
        '.mn-suggest-scroll::-webkit-scrollbar-track{background:transparent}' +
        '.mn-suggest-scroll::-webkit-scrollbar-thumb{background:rgba(124,58,237,.4);border-radius:2px}' +

        '.mn-suggest-loading{padding:14px 16px;font-size:12px;color:var(--text-2,#9ca3af);' +
        'display:flex;align-items:center;gap:8px}' +
        '.mn-suggest-spinner{width:13px;height:13px;border:2px solid rgba(124,58,237,.3);' +
        'border-top-color:var(--accent,#7C3AED);border-radius:50%;animation:mn-sug-spin .7s linear infinite;flex-shrink:0}' +
        '@keyframes mn-sug-spin{to{transform:rotate(360deg)}}' +

        '.mn-suggest-item{display:flex;align-items:center;gap:10px;padding:7px 12px;' +
        'cursor:pointer;transition:background .1s;border-bottom:1px solid rgba(255,255,255,.04)}' +
        '.mn-suggest-item:last-child{border-bottom:none}' +
        '.mn-suggest-item:hover,.mn-suggest-item.mn-sf{background:rgba(124,58,237,.15)}' +

        '.mn-sug-img-wrap{width:36px;height:48px;flex-shrink:0;border-radius:5px;overflow:hidden;' +
        'background:var(--bg-3,#1e1e38);display:flex;align-items:center;justify-content:center}' +
        '.mn-sug-img-wrap img{width:100%;height:100%;object-fit:cover}' +
        '.mn-sug-letter{font-size:15px;font-weight:700;color:var(--accent,#7C3AED);opacity:.7}' +

        '.mn-suggest-txt{overflow:hidden;min-width:0;flex:1}' +
        '.mn-suggest-title{font-size:13px;font-weight:500;color:var(--text-1,#e2e8f0);' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.3}' +
        '.mn-suggest-badges{display:flex;align-items:center;gap:5px;margin-top:3px}' +
        '.mn-sug-tipo{font-size:9px;font-weight:600;letter-spacing:.5px;padding:1px 5px;' +
        'border-radius:3px;text-transform:uppercase}' +
        '.mn-sug-tipo.manga{background:rgba(99,102,241,.2);color:#818cf8}' +
        '.mn-sug-tipo.manhwa{background:rgba(16,185,129,.2);color:#34d399}' +
        '.mn-sug-tipo.manhua{background:rgba(245,158,11,.2);color:#fbbf24}' +
        '.mn-sug-tipo.default{background:rgba(124,58,237,.2);color:#a78bfa}' +

        '.mn-suggest-footer{padding:7px 14px;font-size:11px;color:var(--accent,#7C3AED);' +
        'cursor:pointer;text-align:center;border-top:1px solid rgba(255,255,255,.06);' +
        'transition:background .1s;font-weight:500}' +
        '.mn-suggest-footer:hover{background:rgba(124,58,237,.1)}'
      document.head.appendChild(s)
    }

    const _drop = document.createElement('div')
    _drop.className = 'mn-suggest-drop'
    _drop.style.display = 'none'
    document.body.appendChild(_drop)

    let _reqTimer = null, _loadTimer = null, _lastQ = '', _focus = -1, _sugs = [], _activeInput = null

    const _cerrar = () => {
      _drop.style.display = 'none'
      clearTimeout(_reqTimer); clearTimeout(_loadTimer)
      _focus = -1; _sugs = []; _lastQ = ''
    }

    const _posicionar = (input) => {
      const r = input.getBoundingClientRect()
      const w = Math.max(r.width, 300)
      _drop.style.width  = w + 'px'
      _drop.style.top    = (r.bottom + 4) + 'px'
      _drop.style.left   = r.left + 'px'
    }

    const _mostrarLoading = (input) => {
      _drop.innerHTML =
        '<div class="mn-suggest-header">Buscando en NovelCool</div>' +
        '<div class="mn-suggest-loading"><div class="mn-suggest-spinner"></div>Buscando...</div>'
      _posicionar(input)
      _drop.style.display = 'block'
    }

    const _tipoClass = (tipo) => {
      const t = (tipo || '').toLowerCase()
      return t === 'manhwa' ? 'manhwa' : t === 'manhua' ? 'manhua' : t === 'manga' ? 'manga' : 'default'
    }

    const _render = (resultados, input, query) => {
      // Deduplicar por título (misma búsqueda puede devolver variantes con distinto URL)
      const _seenT = new Set()
      _sugs = (resultados || []).filter(m => {
        const t = (m.titulo || '').toLowerCase().trim()
        if (!t || _seenT.has(t)) return false
        _seenT.add(t); return true
      })
      _focus = -1
      if (!_sugs.length) { _cerrar(); return }

      const itemsHTML = _sugs.map((m, i) => {
        const letra = (m.titulo || '?').charAt(0).toUpperCase()
        const imgHTML = m.imagen
          ? '<img src="' + m.imagen + '" id="mn-sug-img-' + i + '" onerror="this.style.display=\'none\';document.getElementById(\'mn-sug-ph-' + i + '\').style.display=\'flex\'">' +
            '<span class="mn-sug-letter" id="mn-sug-ph-' + i + '" style="display:none">' + letra + '</span>'
          : '<span class="mn-sug-letter" id="mn-sug-ph-' + i + '">' + letra + '</span>'
        const tc = _tipoClass(m.tipo)
        return '<div class="mn-suggest-item" data-i="' + i + '">' +
          '<div class="mn-sug-img-wrap">' + imgHTML + '</div>' +
          '<div class="mn-suggest-txt">' +
          '<div class="mn-suggest-title">' + (m.titulo || '') + '</div>' +
          '<div class="mn-suggest-badges"><span class="mn-sug-tipo ' + tc + '">' + (m.tipo || 'MANGA') + '</span></div>' +
          '</div></div>'
      }).join('')

      _drop.innerHTML =
        '<div class="mn-suggest-header">Resultados para "' + (query || '') + '"</div>' +
        '<div class="mn-suggest-scroll">' + itemsHTML + '</div>' +
        '<div class="mn-suggest-footer" id="mn-sug-footer">Ver todos los resultados →</div>'

      _drop.querySelectorAll('.mn-suggest-item').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation()
          _cerrar()
          abrirManga(_sugs[i].link, _sugs[i].titulo)
        })
      })

      // Footer: ejecutar búsqueda completa
      const footer = document.getElementById('mn-sug-footer')
      if (footer) {
        footer.addEventListener('mousedown', (e) => {
          e.preventDefault()
          _cerrar()
          const q = input.value.trim()
          if (q) { if (typeof sbSaveHistory === 'function') sbSaveHistory('manga', q); _mnBibAbrirConQuery(q) }
        })
      }

      // Portadas: pedir todas en paralelo (las que ya tienen imagen se muestran directo,
      // las sin imagen cargan desde IPC y actualizan el DOM cuando llegan)
      _sugs.forEach((m, i) => {
        if (m.imagen) return  // ya tiene imagen, nada que hacer
        if (!m.link) return
        window.api.getMangaPortada(m.link).then(url => {
          if (!url) return
          const wrap = document.querySelector('.mn-suggest-scroll .mn-suggest-item[data-i="' + i + '"] .mn-sug-img-wrap')
          if (!wrap) return
          const letra = (m.titulo || '?').charAt(0).toUpperCase()
          wrap.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML=\'<span class=mn-sug-letter>' + letra + '</span>\'">'
        }).catch(() => {})
      })

      _posicionar(input)
      _drop.style.display = 'block'
    }

    const _nav = (e) => {
      if (_drop.style.display === 'none') return
      const rows = _drop.querySelectorAll('.mn-suggest-item')
      if (!rows.length) return
      if (e.key === 'ArrowDown') { e.preventDefault(); _focus = Math.min(_focus + 1, rows.length - 1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _focus = Math.max(_focus - 1, -1) }
      else if (e.key === 'Escape') { e.stopPropagation(); _cerrar(); return }
      else if (e.key === 'Enter' && _focus >= 0) {
        e.preventDefault(); e.stopPropagation()
        const m = _sugs[_focus]; if (m) { _cerrar(); abrirManga(m.link, m.titulo) }
        return
      } else { return }
      rows.forEach((r, i) => r.classList.toggle('mn-sf', i === _focus))
      // Scroll al ítem enfocado
      if (_focus >= 0) rows[_focus]?.scrollIntoView({ block: 'nearest' })
    }

    const _attach = (inputId) => {
      const input = document.getElementById(inputId)
      if (!input) return

      input.addEventListener('input', () => {
        const q = input.value.trim()
        _activeInput = input
        clearTimeout(_reqTimer); clearTimeout(_loadTimer)

        if (q.length < 2) { _cerrar(); return }

        // Mostrar spinner enseguida (100ms) para feedback inmediato
        _loadTimer = setTimeout(() => { if (input.value.trim() === q) _mostrarLoading(input) }, 100)

        _reqTimer = setTimeout(async () => {
          if (input.value.trim() !== q) return
          clearTimeout(_loadTimer)
          // sugerirManga es el endpoint ligero (límite 8, solo SSR)
          // Si no está disponible (fuente no-novelcool) cae a buscarManga
          const apiFn = window.api.sugerirManga || window.api.buscarManga
          const res = await apiFn(q)
          if (input.value.trim() !== q) return
          _lastQ = q
          _render(res, input, q)
        }, 400)
      })

      input.addEventListener('keydown', _nav)

      input.addEventListener('focus', () => {
        _activeInput = input
        if (_lastQ && input.value.trim() === _lastQ && _sugs.length) {
          _posicionar(input); _drop.style.display = 'block'
        }
      })
    }

    _attach('manga-buscador-2')
    _attach('manga-buscador')
    _attach('mnbib-input')

    document.addEventListener('mousedown', (e) => {
      if (!_drop.contains(e.target) && e.target !== _activeInput) _cerrar()
    }, true)
  })()
})
