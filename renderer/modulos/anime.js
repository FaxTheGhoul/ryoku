// ── Carga nativa de imágenes (fallback cuando WebView bloquea hotlink) ──────────
if (!window._ryokuImgCallbacks) window._ryokuImgCallbacks = {}
window._ryokuImgCb = function(id, dataUrl) {
  const cb = window._ryokuImgCallbacks[id]
  if (cb) { cb(dataUrl); delete window._ryokuImgCallbacks[id] }
}
window._ryokuLoadImgNative = function(img, url, onFail) {
  // onFail (opcional) se llama solo cuando TODOS los fallbacks fallaron de
  // verdad — antes algunos call-sites asumían que esta función indicaba
  // éxito/fracaso via su valor de retorno (siempre undefined), así que
  // ocultaban la imagen apenas se llamaba, sin esperar a que el proxy/nativo
  // termine, y nunca la volvían a mostrar aunque el fallback sí funcionara.
  if (img._nativeTried || !url || url.startsWith('blob:') || url.startsWith('data:')) {
    if (typeof onFail === 'function') onFail()
    return
  }
  img._nativeTried = true
  function _tryNative() {
    // 2. Fallback: Java native fetchImage (solo existe en Android)
    if (window._nativeExtractor && window._nativeExtractor.fetchImage) {
      const id = 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
      window._ryokuImgCallbacks[id] = function(d) {
        if (d) img.src = d
        else if (typeof onFail === 'function') onFail()
      }
      window._nativeExtractor.fetchImage(url, id)
    } else if (typeof onFail === 'function') {
      onFail()
    }
  }
  // 1. Intentar proxy del servidor (fetch → blob, bypassa hotlink + CORS)
  const su = window.api && window.api.serverUrl
  if (su) {
    fetch(su + '/img-proxy?url=' + encodeURIComponent(url))
      .then(function(r) { return r.ok ? r.blob() : Promise.reject(r.status) })
      .then(function(blob) { img.src = URL.createObjectURL(blob) })
      .catch(_tryNative)
    return
  }
  // Sin servidor: Java native directo
  _tryNative()
}
// Helper para onerror inline: solo oculta la imagen si el fallback nativo/proxy
// también termina fallando (en vez de ocultarla apenas se dispara el error).
window._ryokuImgHideOnFail = function(img) {
  _ryokuLoadImgNative(img, img.src, function() { img.style.display = 'none' })
}

// modulos/anime.js — Recientes, slider, continuar, calendario, búsqueda, player
// Requiere: utils.js, core.js, ui.js

// Convierte link de episodio (/ver/...) en URL de página del anime, según la fuente
function _epLinkToAnimeUrl(link) {
  if (!link) return ''
  if (link.includes('animeflv.net/ver/')) {
    const slug = link.split('/ver/')[1]?.replace(/-\d+$/, '') || ''
    return slug ? `https://www4.animeflv.net/anime/${slug}` : ''
  }
  if (link.includes('animeav1.com/media/')) {
    // animeav1 no usa /ver/ -- el link de episodio ya es /media/slug/N, así
    // que la ficha del anime es directamente ese mismo link sin el número.
    const slug = link.split('/media/')[1]?.split('/')[0] || ''
    return slug ? `https://animeav1.com/media/${slug}` : ''
  }
  const slug = link.split('/ver/')[1]?.replace(/-episodio-\d+$/, '') || ''
  return slug ? `https://latanime.org/anime/${slug}` : ''
}

// ¿Es un link de EPISODIO de anime (sin importar la fuente)? latanime,
// monoschinos y animeflv usan .../ver/..., pero animeav1 usa .../media/slug/N
// (con el número de episodio al final, sin "/ver/" en ningún lado). Varios
// puntos de este archivo usaban `link.includes('/ver/')` como atajo genérico
// para "esto es un episodio, convertilo a URL de la ficha del anime" --
// como animeav1 nunca matcheaba, quedaba excluido en silencio de "Continuar
// viendo" (detección de nuevo episodio, miniaturas, salto directo al
// selector de servidores, etc.). Esta función sí reconoce ambos formatos.
function _esLinkEpisodioAnime(link) {
  if (!link) return false
  if (link.includes('/ver/')) return true
  if (/animeav1\.com\/media\/[^/]+\/\d+(?:[/?]|$)/.test(link)) return true
  return false
}

// Fuente de anime activa, cacheada para que _imgProxySrc pueda resolver
// rutas relativas de forma síncrona (ver más abajo). Se refresca cada vez
// que se recargan los recientes (cargarRecientes), que es cuando cambia el
// contenido mostrado tras un cambio de fuente.
let _srcActivaImgAnime = 'latanime'

async function cargarRecientes(onDone) {
  const grilla   = document.getElementById('grilla-recientes')
  const gSeries  = document.getElementById('grilla-series')
  grilla.innerHTML  = '<div class="loading">Cargando...</div>'
  if (gSeries) gSeries.innerHTML = '<div class="loading">Cargando...</div>'
  // Ocultar para la animación de entrada
  const _elemsAnime = ['.home-hero-continuar','.home-hero-banner','#page-inicio .home-top-panel',
    '#home-sec-recientes .seccion-titulo','#grilla-recientes',
    '#home-sec-series .seccion-titulo','#grilla-series','#home-ver-todo-wrap']
  // En mobile no ocultar — el splash cubre la carga y animarEntrada no usa stagger
  if (!document.body.classList.contains('mobile-mode')) {
    _elemsAnime.forEach(s => { const el=document.querySelector(s); if(el){el.style.visibility='hidden';el.style.opacity='0'} })
  }

  let _recData
  try {
    _recData = await window.api.getRecientes()
    // Refrescar la fuente activa para que _imgProxySrc resuelva imágenes
    // relativas contra el dominio correcto (antes _imgProxySrc asumía
    // siempre latanime.org sin importar la fuente activa)
    _srcActivaImgAnime = (await window.api?.getAnimeSource?.()) || 'latanime'
  } catch(e) {
    console.error('[cargarRecientes] error al obtener datos:', e)
    _elemsAnime.forEach(s => { const el=document.querySelector(s); if(el){el.style.visibility='';el.style.opacity='1'} })
    grilla.innerHTML = `<div class="loading" style="display:flex;flex-direction:column;align-items:center;gap:10px">
      <span>No se pudo cargar el contenido.</span>
      <button onclick="cargarRecientes()" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:7px 18px;font-size:13px;cursor:pointer;font-family:inherit">Reintentar</button>
    </div>`
    if (gSeries) gSeries.innerHTML = ''
    if (typeof onDone === 'function') onDone()
    return
  }
  const { slider, lista, series } = _recData

  // ── SLIDER ──────────────────────────────────────────────────────────────
  if (slider && slider.length) {
    const _isMobileSlider = document.body.classList.contains('mobile-mode')
    // En mobile limitar a 6 slides para no colapsar los dots
    const sliderFiltrado = _isMobileSlider
      ? _filtrarLista(slider).slice(0, 6)
      : _filtrarLista(slider)
    _sliderTotal = sliderFiltrado.length
    const track = document.getElementById('slider-track')
    const dots  = document.getElementById('slider-dots')
    track.innerHTML = sliderFiltrado.map(s => {
      const esA = s.adulto || _esAdulto(s)
      return `<div class="slider-slide" onclick="abrirAnime('${s.link}','${_esc(s.titulo)}')">
        <img class="slider-slide-img"
          src="${_imgProxySrc(s.imagen)}"
          data-orig="${s.imagen}"
          alt="${s.titulo}"
          style="${esA ? 'filter:blur(14px);transform:scale(1.05)' : ''}"
          onerror="_ryokuLoadImgNative(this, this.getAttribute('data-orig'))" />
        ${esA ? '<span class="badge-18 badge-18-slider">+18</span>' : ''}
        ${_isMobileSlider && !esA ? '<div class="slider-nuevo-badge">★ NUEVO EPISODIO ★</div>' : ''}
        <div class="slider-info">
          ${s.idioma && !_isMobileSlider ? `<div class="slider-ep-badge">${s.idioma}</div>` : ''}
          <h2>${s.titulo}</h2>
          ${s.desc && !esA ? `<p class="slider-desc">${s.desc}</p>` : ''}
          <div class="slider-btns">
            <button class="slider-btn-ver" onclick="event.stopPropagation();abrirAnime('${s.link}','${_esc(s.titulo)}')">▶ Ver ahora</button>
            ${_isMobileSlider ? `<button class="slider-btn-add" onclick="event.stopPropagation()" title="Añadir">+</button>` : ''}
          </div>
        </div>
      </div>`
    }).join('')
    if (_isMobileSlider) {
      // Cargar imágenes del slider proactivamente (no esperar onerror)
      // 1. Intentar fetch via proxy del servidor (maneja hotlink/Cloudflare)
      // 2. Si falla, intentar native Java fetchImage
      // 3. Si falla, dejar la URL directa (onerror la manejará)
      ;(function _preloadSliderImages() {
        const imgs = Array.from(track.querySelectorAll('.slider-slide-img'))
        const su = window.api && window.api.serverUrl
        imgs.forEach(function(img, i) {
          const origUrl = img.getAttribute('data-orig')
          if (!origUrl) return
          // Solo actuar si la imagen no cargó en 1.5s
          setTimeout(function() {
            if (img.complete && img.naturalWidth > 0) return // ya cargó directamente
            img._nativeTried = false // reset para permitir intento
            _ryokuLoadImgNative(img, origUrl)
          }, 1500)
        })
      })()
      // layout controlado por CSS mobile (inline styles removed)
    }
    dots.innerHTML = sliderFiltrado.map((_,i) => `<div class="slider-dot ${i===0?'activo':''}" onclick="irSlide(${i})"></div>`).join('')
    irSlide(0)
    if (_sliderTimer) clearInterval(_sliderTimer)
    _sliderTimer = setInterval(() => irSlide((_sliderIdx+1) % _sliderTotal), 5000)
  }

  const _sprev = document.getElementById('slider-prev'); if(_sprev) _sprev.onclick = () => { irSlide((_sliderIdx-1+_sliderTotal)%_sliderTotal); resetTimer() }
  const _snext = document.getElementById('slider-next'); if(_snext) _snext.onclick = () => { irSlide((_sliderIdx+1)%_sliderTotal); resetTimer() }

  // ── AÑADIDOS RECIENTEMENTE ──────────────────────────────────────────────
  if (!lista.length) { grilla.innerHTML = '<div class="loading">Sin episodios.</div>' }
  else {
    const _isMobileCards = document.body.classList.contains('mobile-mode')
    grilla.innerHTML = _marcarAdultos(_filtrarLista(lista)).map(ep => {
      const animeUrl = _epLinkToAnimeUrl(ep.link)
      const letra = ep.titulo.charAt(0)
      const tieneImg = ep.imagen && !ep.imagen.includes('capblank')
      const imgHtml = tieneImg
        ? `<img src="${ep.imagen}" onload="imgLoaded(this)" onerror="imgError(this)" />`
        : `<div class="tarjeta-thumb"><div class="tarjeta-letra">${letra}</div></div>`
      return `
      <div class="tarjeta" onclick="abrirAnime('${_esc(animeUrl)}','${_esc(ep.titulo)}')">
        <div class="play-overlay">▶</div>
        <div class="tarjeta-img-wrap tarjeta-ep${tieneImg ? '' : ' loaded'}" data-letra="${letra}">${imgHtml}
          ${_isMobileCards ? '<div class="tarjeta-badge-nuevo">★ NUEVO</div>' : ''}
        </div>
        <div class="tarjeta-info">
          <div class="tarjeta-titulo">${ep.titulo}</div>
          <div class="tarjeta-sub">${ep.ep}${ep.ep && ep.idioma ? ' · ' : ''}${ep.idioma}${ep.fecha ? ' · ' + ep.fecha : ''}</div>
        </div>
      </div>`
    }).join('')
    checkLoadedImgs(grilla)
    _enriquecerEnBackground(_filtrarLista(lista), 'grilla-recientes')
  }

  // ── SERIES RECIENTES ────────────────────────────────────────────────────
  // Antes, si "series" venía vacío (p.ej. un timeout al traer los datos),
  // esta función cortaba acá con return — nunca llegaba a "Top de la semana",
  // cargarContinuarViendo() ni animarEntrada(), así que TODO lo que
  // _elemsAnime dejó oculto al principio se quedaba invisible para siempre,
  // sin ningún mensaje de error ni forma de reintentar. Ahora solo se salta
  // el armado de la grilla de series (mostrando "Sin series.") pero la
  // función sigue su curso normal.
  if (gSeries) {
    if (!series || !series.length) {
      gSeries.innerHTML = '<div class="loading">Sin series.</div>'
    } else {
      const _isMobileSeries = document.body.classList.contains('mobile-mode')
      const _rankColors = ['#2563eb','#f97316','#7c3aed','#16a34a','#dc2626']
      gSeries.innerHTML = _marcarAdultos(_filtrarLista(series)).map((s, idx) => {
        const letra = s.titulo.charAt(0)
        const tieneImg = s.imagen && !s.imagen.includes('logito') && !s.imagen.includes('web.jpg')
        const rankColor = _rankColors[idx] || '#6b7280'
        return `
        <div class="tarjeta tarjeta-serie" onclick="abrirAnime('${s.link}','${_esc(s.titulo)}')">
          <div class="tarjeta-img-wrap tarjeta-serie-cover${tieneImg ? '' : ' loaded'}" data-letra="${letra}">
            ${tieneImg
              ? `<img src="${s.imagen}" onload="imgLoaded(this)" onerror="imgError(this)" />`
              : `<div class="tarjeta-letra-grande">${letra}</div>`}
            ${_isMobileSeries ? `<div class="tarjeta-rank-badge" style="background:${rankColor}">${idx+1}</div>` : ''}
            ${_isMobileSeries && s.rating ? `<div class="tarjeta-rating-badge">★ ${s.rating}</div>` : ''}
          </div>
          <div class="tarjeta-info">
            <div class="tarjeta-titulo">${s.titulo}</div>
            ${s.idioma ? `<div class="tarjeta-sub">${s.idioma}</div>` : ''}
          </div>
        </div>`
      }).join('')
      checkLoadedImgs(gSeries)
      _enriquecerEnBackground(_filtrarLista(series), 'grilla-series')
    }
  }
  // ── Panel "Top de la semana" (junto al banner) ──────────────────────────
  // Ya no se pinta primero con el orden local: eso hacía que por varios
  // segundos se viera contenido que no correspondía al ranking real (título/
  // imagen de "recién agregados", no del top). Ahora arranca en "Cargando" y
  // _cargarTopSemanaReal() (fire-and-forget, no bloquea la animación de
  // entrada del resto de la página) pinta directamente el resultado real de
  // AniList/Jikan con un fundido — si esa fuente falla, ahí sí cae al orden
  // local como respaldo, para no dejar el panel pegado en "Cargando".
  const _seriesParaTop = _marcarAdultos(_filtrarLista(series))
  if (_seriesParaTop.length) {
    const topList = document.getElementById('home-top-list')
    if (topList) topList.innerHTML = '<div class="loading">Cargando...</div>'
    _cargarTopSemanaReal(_seriesParaTop)
  } else {
    const topList = document.getElementById('home-top-list')
    if (topList) topList.innerHTML = '<div class="loading">Sin datos.</div>'
  }
  await cargarContinuarViendo()
  if (typeof onDone === 'function') onDone()
  animarEntrada('anime')
}

// ── CONTINUAR VIENDO ─────────────────────────────────────────────────────
// 8 en ventana normal, 12 maximizada (fila a todo el ancho en el nuevo layout apilado)
function _getContinuarMax() {
  return _ventanaMaximizada ? 12 : 8
}

// Pre-render síncrono desde localStorage — se llama en DOMContentLoaded
// para mostrar la sección ANTES de que lleguen los datos del servidor
function _preRenderContinuarViendo() {
  try {
    const panel = document.getElementById('home-hero-continuar')
    const lista  = document.getElementById('continuar-lista')
    if (!panel || !lista) return
    const historial  = JSON.parse(localStorage.getItem('ryoku-hist') || '[]')
    const progresos  = JSON.parse(localStorage.getItem('ryoku-prog') || '{}')
    if (!historial.length) return
    const porAnime = {}
    for (const h of historial) {
      const nombre = (h.anime || h.titulo?.split(' - Ep')[0].trim() || h.titulo || '').replace(/\\/g, '')
      if (!porAnime[nombre]) porAnime[nombre] = h
    }
    const todos = Object.values(porAnime).filter(h => {
      const prog = progresos[h.link]
      return !prog || !prog.duration || (prog.currentTime / prog.duration) * 100 < 94
    })
    if (!todos.length) return
    // Renderizar con los datos que ya están en memoria
    panel.style.display = 'flex'
    const max = _getContinuarMax()
    lista.innerHTML = todos.slice(0, max).map(h => _continuarCard(h, progresos)).join('')
    if (todos.length > max) {
      const restantes = todos.length - max
      lista.innerHTML += `<button class="continuar-ver-mas" onclick="abrirPaginaContinuar()"><span class="continuar-ver-num">+${restantes}</span><span class="continuar-ver-label">más</span></button>`
    }
    const btnVistos = document.getElementById('continuar-ver-vistos-btn')
    if (btnVistos) btnVistos.style.display = ''
  } catch(e) {}
}
// Actualiza #continuar-lista con un fundido cuando ya tenía contenido (esta
// función se vuelve a llamar seguido — al terminar un episodio, al sincronizar
// con la nube, etc. — y reemplazar el innerHTML de golpe se veía como que la
// fila "se quitaba y volvía a aparecer" bruscamente). En la carga inicial de
// la página la lista todavía está vacía, así que ahí no se aplica ningún
// fundido — no interfiere con la animación de entrada del resto del home.
async function _actualizarContinuarConFade(lista, render) {
  const teniaContenido = lista.innerHTML.trim().length > 0
  if (!teniaContenido) { render(); return }
  lista.style.opacity = '0'
  await new Promise(r => setTimeout(r, 160))
  render()
  lista.style.opacity = '1'
  // Entrada en cascada por tarjeta (fundido + deslizamiento leve) en vez de
  // que toda la fila aparezca de golpe de una — mismo espíritu que el
  // ryoku-animar del resto de la app, pero más chico/rápido porque esto
  // pasa mientras el usuario ya está navegando, no en la carga de la página.
  const tarjetas = lista.querySelectorAll('.ac-cont-card, .continuar-ver-mas')
  tarjetas.forEach((card, i) => {
    card.style.setProperty('--ac-cont-delay', `${Math.min(i, 8) * 45}ms`)
    card.classList.remove('ac-cont-card-in')
    void card.offsetWidth
    card.classList.add('ac-cont-card-in')
    card.addEventListener('animationend', () => card.classList.remove('ac-cont-card-in'), { once: true })
  })
}

async function cargarContinuarViendo() {
  const panel = document.getElementById('home-hero-continuar')
  const lista  = document.getElementById('continuar-lista')
  if (!panel || !lista) return
  const historial = await window.api.getHistorial()
  const progresos = await window.api.getTodosProgresos()
  const porAnime = {}
  for (const h of historial) {
    const nombre = (h.anime || h.titulo?.split(' - Ep')[0].trim() || h.titulo || '').replace(/\\/g, '')
    if (!porAnime[nombre]) porAnime[nombre] = h
  }
  const todos = Object.values(porAnime).filter(h => {
    const prog = progresos[h.link]
    return !prog || !prog.duration || (prog.currentTime/prog.duration)*100 < 94
  })
  const hayHistorial = Object.keys(porAnime).length > 0
  const btnVistos = document.getElementById('continuar-ver-vistos-btn')
  if (btnVistos) btnVistos.style.display = hayHistorial ? '' : 'none'

  if (!todos.length) {
    await _actualizarContinuarConFade(lista, () => {
      panel.style.display = 'none'
      lista.innerHTML = ''
    })
    if (hayHistorial) {
      const vistos = Object.values(porAnime).filter(h => _esLinkEpisodioAnime(h.link))
      if (vistos.length > 0) {
        await Promise.race([
          _chequearNuevosEpisodios(vistos, progresos),
          new Promise(r => setTimeout(r, 3500))
        ])
      }
    }
    window._continuarViendobListo = true
    return
  }
  await _actualizarContinuarConFade(lista, () => {
    panel.style.display = 'flex'
    lista.innerHTML = todos.slice(0,_getContinuarMax()).map(h => _continuarCard(h,progresos)).join('')
    if (todos.length > _getContinuarMax()) {
      const restantes = todos.length - _getContinuarMax()
      lista.innerHTML += `<button class="continuar-ver-mas" onclick="abrirPaginaContinuar()"><span class="continuar-ver-num">+${restantes}</span><span class="continuar-ver-label">más</span></button>`
    }
  })
  _continuarCargarPortadas(todos.slice(0, _getContinuarMax()), progresos)
  const vistos = Object.values(porAnime).filter(h => {
    const prog = progresos[h.link]
    const pct = prog?.duration ? (prog.currentTime / prog.duration) * 100 : 0
    return pct >= 94 && _esLinkEpisodioAnime(h.link)
  })
  if (vistos.length > 0) {
    await Promise.race([
      _chequearNuevosEpisodios(vistos, progresos),
      new Promise(r => setTimeout(r, 3500))
    ])
  }
  window._continuarViendobListo = true
}

async function _chequearNuevosEpisodios(vistos, progresos) {
  // Paralelo: chequear los primeros 3 animes a la vez (no saturar conexiones)
  await Promise.all(vistos.slice(0, 3).map(async h => {
    const nombre = h.anime || h.titulo?.split(' - Ep')[0].trim() || ''
    const animeUrl = _epLinkToAnimeUrl(h.link)
    if (!animeUrl) return
    try {
      const info = await window.api.getAnime(animeUrl)
      if (!info?.episodios?.length) return
      const sigEp = info.episodios.find(ep => {
        const p = progresos[ep.link]
        return !p || (p.porcentaje || 0) < 94
      })
      if (!sigEp) return
      const lista = document.getElementById('continuar-lista')
      if (!lista) return
      if (lista.querySelector(`[data-anime-link="${CSS.escape(sigEp.link)}"]`)) return
      const hNuevo = { link: sigEp.link, titulo: `${nombre} - Ep ${sigEp.num}`, anime: nombre, imagen: sigEp.imagen || info.imagen }
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = _continuarCard(hNuevo, progresos)
      const cardEl = tempDiv.firstChild
      const capEl = cardEl?.querySelector('.ac-cont-cap')
      if (capEl) capEl.innerHTML = `<span style="color:#60a5fa;font-weight:700;font-size:10px">● NUEVO · Ep ${sigEp.num}</span>`
      const verMas = lista.querySelector('.continuar-ver-mas')
      if (verMas) lista.insertBefore(cardEl, verMas)
      else lista.prepend(cardEl)
      const panel = document.getElementById('home-hero-continuar')
      if (panel) panel.style.display = 'flex'
    } catch(e) {}
  }))
}

// Quita del historial todos los links dados, sin tocar el resto (orden
// intacto). Usa el handler batch si existe; si no, uno por uno.
async function _quitarLinksDelHistorial(links) {
  if (!links || !links.length) return
  if (window.api.removeHistorialBatch) return window.api.removeHistorialBatch(links)
  for (const l of links) await window.api.removeHistorial(l)
}

async function _continuarCargarPortadas(items, progresos) {
  // Imágenes a actualizar en el historial guardado -- se aplican al final
  // en su lugar (set-imagenes-historial), sin vaciar y rearmar el historial.
  const cambios = []

  for (let i = 0; i < items.length; i++) {
    const h = items[i]
    if (!_esLinkEpisodioAnime(h.link)) continue
    const animeUrl = _epLinkToAnimeUrl(h.link)
    if (!animeUrl) continue
    try {
      const info = await window.api.getAnime(animeUrl)
      if (!info) continue
      // Preferir la miniatura del episodio puntual; si no hay, usar la portada de la serie.
      const epImg = info.episodios?.find(ep => ep.link === h.link)?.imagen
      const mejorImg = epImg || info.imagen
      if (!mejorImg || mejorImg === h.imagen) continue
      h.imagen = mejorImg
      // Actualizar card en DOM (reemplaza el placeholder o la imagen ya puesta)
      const card = document.querySelector(`.ac-cont-card[data-anime-link="${CSS.escape(h.link)}"]`)
      if (card) {
        const ph = card.querySelector('.ac-cont-cover-ph')
        if (ph) {
          const img = document.createElement('img')
          img.className = 'ac-cont-cover'
          img.src = mejorImg
          img.onerror = () => img.remove()
          ph.replaceWith(img)
        } else {
          const imgEl = card.querySelector('.ac-cont-cover')
          if (imgEl) imgEl.src = mejorImg
        }
      }
      // Persistir sólo en la entrada de ESTE episodio (cada uno tiene su propia miniatura,
      // a diferencia de la portada de serie que antes se repetía en todo el historial del anime)
      cambios.push({ link: h.link, imagen: mejorImg })
    } catch(e) {}
  }

  if (cambios.length && window.api.setImagenesHistorial) {
    try { await window.api.setImagenesHistorial(cambios) } catch (e) {}
  }
}
function _continuarCard(h, progresos) {
  const _isMobile=document.body.classList.contains('mobile-mode')
  const prog=progresos[h.link]
  const pct=prog?.duration?Math.round((prog.currentTime/prog.duration)*100):0
  const tiempoTexto=prog?.currentTime>0?formatTime(prog.currentTime):''
  const visto=(prog?.porcentaje||0)>=95  // mismo umbral que la lista de episodios
  const epNum=h.titulo?.includes(' - Ep')?h.titulo.split(' - Ep')[1]?.trim():''
  const nombre=h.anime||h.titulo?.split(' - Ep')[0].trim()||h.titulo
  const animeUrl=_esLinkEpisodioAnime(h.link)?_epLinkToAnimeUrl(h.link):(h.link||'')
  const imgHtml=h.imagen?`<img class="ac-cont-cover" src="${h.imagen}" onerror="_ryokuImgHideOnFail(this)" />`:`<div class="ac-cont-cover-ph">${nombre.charAt(0)}</div>`
  const capTexto = visto ? 'Visto ✓' : (epNum ? `Ep ${epNum}${tiempoTexto?' · '+tiempoTexto:''}` : 'Ver anime')
  const cardStyle=''  // layout controlado por CSS mobile
  return `<div class="ac-cont-card" ${cardStyle} data-anime-url="${_escHtml(animeUrl)}" data-anime-nombre="${_escHtml(nombre)}" data-anime-titulo="${_escHtml(h.titulo||nombre)}" data-anime-link="${_escHtml(h.link)}" data-anime-visto="${visto}" onclick="continuarClickCard(event,this)">${imgHtml}<div class="ac-cont-dots" onclick="continuarDotsClick(event,this)" data-anime-url="${_escHtml(animeUrl)}" data-anime-nombre="${_escHtml(nombre)}" data-anime-link="${_escHtml(h.link)}">⋯</div><div class="ac-cont-info"><div class="ac-cont-title">${nombre}</div><div class="ac-cont-cap">${capTexto}</div><div class="ac-cont-prog"><div class="ac-cont-prog-fill" style="width:${pct}%"></div></div><div class="ac-cont-pct">${pct>0?pct+'%':''}</div></div></div>`
}
let _animeContinuarCtx=null
document.addEventListener('DOMContentLoaded',()=>{

  const menu=document.getElementById('continuar-ctx-menu'); if(!menu)return
  document.getElementById('ctx-ver-eps')?.addEventListener('click',()=>{ menu.classList.remove('visible'); if(_animeContinuarCtx)abrirAnime(_animeContinuarCtx.anime,_animeContinuarCtx.nombre) })
  document.getElementById('ctx-quitar')?.addEventListener('click',async()=>{
    menu.classList.remove('visible'); if(!_animeContinuarCtx)return
    const nombre=_animeContinuarCtx.nombre
    const hist=await window.api.getHistorial()
    const aQuitar=hist.filter(h=>(h.anime||h.titulo?.split(' - Ep')[0].trim()||h.titulo)===nombre).map(h=>h.link)
    await _quitarLinksDelHistorial(aQuitar)
    // Subir historial actualizado a Firestore para que el merge no restaure el anime borrado
    if (typeof window._syncGuardar === 'function') window._syncGuardar()
    const card=_animeContinuarCtx.el
    const lista=document.getElementById('continuar-lista')
    const panel=document.getElementById('home-hero-continuar')
    // ¿Hay botón "+X más" con items ocultos que necesitan mostrarse?
    const hayMasOcultos=!!lista?.querySelector('.continuar-ver-mas')
    if(card){
      // Fase 1: fade out + scale down
      card.style.transition='opacity 0.18s ease, transform 0.18s ease'
      card.style.opacity='0'
      card.style.transform='scale(0.85)'
      await new Promise(r=>setTimeout(r,180))
      // Fase 2: colapsar ancho — las demás cards se deslizan a la izquierda
      card.style.transition='width 0.25s cubic-bezier(0.4,0,0.2,1), min-width 0.25s cubic-bezier(0.4,0,0.2,1), margin-right 0.25s cubic-bezier(0.4,0,0.2,1)'
      card.style.overflow='hidden'
      card.style.width='0px'
      card.style.minWidth='0px'
      card.style.marginRight='0px'
      await new Promise(r=>setTimeout(r,260))
      card.remove()  // quitar del DOM sin reconstruir la lista
    }
    const cardsRestantes=lista?.querySelectorAll('.ac-cont-card').length??0
    if(cardsRestantes===0){
      if(panel)panel.style.display='none'
    } else if(hayMasOcultos){
      // Solo reconstruir si había items ocultos que ahora deben mostrarse
      cargarContinuarViendo()
    }
    // Si no había "+X más", las demás cards ya están en el DOM sin tocar → sin parpadeo
  })
  document.addEventListener('click',e=>{ if(!e.target.closest('.ac-cont-dots')&&!e.target.closest('#continuar-ctx-menu'))menu.classList.remove('visible') })
  document.addEventListener('touchstart',e=>{ if(!e.target.closest('.ac-cont-dots')&&!e.target.closest('#continuar-ctx-menu'))menu.classList.remove('visible') }, {passive:true})

  // Long press en mobile para mostrar menu contextual
  let _lpTimer = null, _lpCard = null
  document.getElementById('continuar-lista')?.addEventListener('touchstart', e => {
    const card = e.target.closest('.ac-cont-card')
    if (!card) return
    _lpCard = card
    const t = e.touches[0]
    const startX = t.clientX, startY = t.clientY
    _lpTimer = setTimeout(() => {
      _lpTimer = null
      const menu = document.getElementById('continuar-ctx-menu')
      if (!menu) return
      _animeContinuarCtx = {
        nombre: card.dataset.animeNombre,
        anime:  card.dataset.animeUrl,
        link:   card.dataset.animeLink,
        el:     card
      }
      // Posicionar el menu cerca del toque pero dentro de la pantalla
      let top = startY + 10, left = startX - 20
      if (left + 172 > window.innerWidth - 8) left = window.innerWidth - 172 - 8
      if (left < 8) left = 8
      if (top + 100 > window.innerHeight - 8) top = startY - 110
      menu.style.top  = top  + 'px'
      menu.style.left = left + 'px'
      menu.classList.add('visible')
      // Vibrar si disponible
      if (navigator.vibrate) navigator.vibrate(40)
    }, 500)
  }, {passive: true})
  document.getElementById('continuar-lista')?.addEventListener('touchmove', e => {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null }
  }, {passive: true})
  document.getElementById('continuar-lista')?.addEventListener('touchend', e => {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null }
  }, {passive: true})
})
function continuarDotsClick(e,el){
  e.stopPropagation(); const menu=document.getElementById('continuar-ctx-menu'); if(!menu)return
  _animeContinuarCtx={nombre:el.dataset.animeNombre,anime:el.dataset.animeUrl,link:el.dataset.animeLink,el:el.closest('.ac-cont-card')}
  const rect=el.getBoundingClientRect(); let top=rect.bottom+6,left=rect.left
  if(left+172>window.innerWidth-8)left=window.innerWidth-172-8
  if(top+90>window.innerHeight-8)top=rect.top-90-6
  menu.style.top=top+'px'; menu.style.left=left+'px'; menu.classList.toggle('visible')
}
function continuarClickCard(e,card){ if(e.target.closest('.ac-cont-dots'))return; continuarClickAnime(card) }
async function continuarClickAnime(el){
  const link=el.dataset.animeLink,animeUrl=el.dataset.animeUrl,nombre=el.dataset.animeNombre,titulo=el.dataset.animeTitulo||nombre,visto=el.dataset.animeVisto==='true'
  // Si tiene episodio en progreso, abrir selector directo (sin fetch)
  if(_esLinkEpisodioAnime(link)&&!visto){ abrirSelector(link,titulo) }
  // Si está visto o no tiene link de episodio, ir a la página del anime
  else { abrirAnime(animeUrl,nombre) }
}
async function abrirPaginaContinuar(){
  navegar('continuar')
  const h2 = document.querySelector('#page-continuar .seccion-titulo')
  if (h2) h2.textContent = 'Historial'
  const lista = document.getElementById('continuar-full-lista')
  if (!lista) return
  lista.innerHTML = '<div class="loading">Cargando...</div>'
  const hist = await window.api.getHistorial()
  const progresos = await window.api.getTodosProgresos()
  const porAnime = {}
  for (const h of hist) {
    const n = h.anime || h.titulo?.split(' - Ep')[0].trim() || h.titulo
    if (!porAnime[n]) porAnime[n] = h
  }
  const todos = Object.values(porAnime)
  if (!todos.length) {
    lista.innerHTML = '<div class="loading">Sin historial aún.</div>'
    return
  }
  lista.innerHTML = todos.map(h => _historialPortadaCard(h, progresos)).join('')
  _initHistorialLongPress(lista, todos)
}

let _histCtx = null
function _initHistorialLongPress(lista, todos) {
  const menu = document.getElementById('hist-ctx-menu')
  if (!menu) return

  // Cerrar menu al tocar fuera
  const _cerrarMenu = (e) => {
    if (!e.target.closest('#hist-ctx-menu') && !e.target.closest('.tarjeta')) menu.classList.remove('visible')
  }
  document.addEventListener('click', _cerrarMenu)
  document.addEventListener('touchstart', _cerrarMenu, { passive: true })

  // Ver episodios
  const btnVer = document.getElementById('hist-ctx-ver-eps')
  if (btnVer) {
    const newBtn = btnVer.cloneNode(true)
    btnVer.parentNode.replaceChild(newBtn, btnVer)
    newBtn.addEventListener('click', () => {
      menu.classList.remove('visible')
      if (_histCtx) abrirAnime(_histCtx.animeUrl, _histCtx.nombre)
    })
  }

  // Quitar del historial
  const btnQuitar = document.getElementById('hist-ctx-quitar')
  if (btnQuitar) {
    const newBtn = btnQuitar.cloneNode(true)
    btnQuitar.parentNode.replaceChild(newBtn, btnQuitar)
    newBtn.addEventListener('click', async () => {
      menu.classList.remove('visible')
      if (!_histCtx) return
      const { nombre, card } = _histCtx
      // Animación de salida
      if (card) {
        card.style.transition = 'opacity 0.18s, transform 0.18s'
        card.style.opacity = '0'
        card.style.transform = 'scale(0.85)'
        await new Promise(r => setTimeout(r, 200))
        card.remove()
      }
      // Borrar del historial
      const hist = await window.api.getHistorial()
      const aQuitar = hist.filter(h => (h.anime || h.titulo?.split(' - Ep')[0].trim() || h.titulo) === nombre).map(h => h.link)
      await _quitarLinksDelHistorial(aQuitar)
      // Sincronizar con Firestore
      if (typeof window._syncGuardar === 'function') window._syncGuardar()
      // Si no quedan cards, mostrar vacío
      if (!lista.querySelector('.tarjeta')) {
        lista.innerHTML = '<div class="loading">Sin historial aún.</div>'
      }
    })
  }

  // Long press en cada tarjeta
  let _lpTimer = null, _lpStartX = 0, _lpStartY = 0
  lista.addEventListener('touchstart', e => {
    const card = e.target.closest('.tarjeta')
    if (!card) return
    const t = e.touches[0]
    const sx = t.clientX, sy = t.clientY
    _lpStartX = sx; _lpStartY = sy
    _lpTimer = setTimeout(() => {
      _lpTimer = null
      _histCtx = {
        nombre:   card.dataset.animeNombre,
        animeUrl: card.dataset.animeUrl,
        card
      }
      // Posicionar menú
      const x = Math.min(sx, window.innerWidth - 170)
      const y = Math.min(sy, window.innerHeight - 110)
      menu.style.left = x + 'px'
      menu.style.top  = y + 'px'
      menu.classList.add('visible')
      if (navigator.vibrate) navigator.vibrate(30)
    }, 450)
  }, { passive: true })
  lista.addEventListener('touchmove', e => {
    if (!_lpTimer) return
    const t = e.touches[0]
    if (Math.abs(t.clientX - _lpStartX) > 8 || Math.abs(t.clientY - _lpStartY) > 8) {
      clearTimeout(_lpTimer); _lpTimer = null
    }
  }, { passive: true })
  lista.addEventListener('touchend', () => { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null } }, { passive: true })
}

function _historialPortadaCard(h, progresos) {
  const nombre = h.anime || h.titulo?.split(' - Ep')[0].trim() || h.titulo || ''
  const animeUrl = _esLinkEpisodioAnime(h.link) ? _epLinkToAnimeUrl(h.link) : (h.link || '')
  const prog = progresos[h.link]
  const pct = prog?.duration ? Math.round((prog.currentTime / prog.duration) * 100) : 0
  const visto = (prog?.porcentaje || 0) >= 95  // mismo umbral que la lista de episodios
  const letra = nombre.charAt(0)
  // Portada del ANIME, no la miniatura del episodio -- h.imagen guarda el
  // still del episodio (correcto para "Continuar viendo", donde interesa
  // ver en qué episodio vas), pero esta lista es un ítem por anime, así que
  // debe mostrar la carátula. h.animeImagen es el campo nuevo con la
  // portada real; _coverCache cubre animes vistos en esta misma sesión;
  // h.imagen queda como último fallback para historial viejo sin ese campo.
  const cacheKey = animeUrl ? animeUrl.replace(/-(latino|castellano)$/, '') : ''
  const imgSrc = h.animeImagen || (cacheKey && _coverCache[cacheKey]) || h.imagen
  const imgHtml = imgSrc
    ? `<img src="${imgSrc}" onload="imgLoaded(this)" onerror="imgError(this)" />`
    : `<div class="tarjeta-thumb"><div class="tarjeta-letra">${letra}</div></div>`
  const progBar = pct > 0 ? `<div class="tarjeta-prog-bar"><div style="width:${pct}%"></div></div>` : ''
  return `<div class="tarjeta"
    data-anime-url="${_escHtml(animeUrl)}" data-anime-nombre="${_escHtml(nombre)}"
    data-anime-titulo="${_escHtml(h.titulo||nombre)}" data-anime-link="${_escHtml(h.link)}"
    data-anime-visto="${visto}" onclick="continuarClickAnime(this)">
    <div class="play-overlay">▶</div>
    <div class="tarjeta-img-wrap${h.imagen ? '' : ' loaded'}" data-letra="${letra}">${imgHtml}${progBar}</div>
    <div class="tarjeta-info"><div class="tarjeta-titulo">${nombre}</div></div>
  </div>`
}

// Resuelve URLs relativas de imagen contra el dominio de la fuente de anime
// activa (antes asumía siempre latanime.org, lo cual habría sido incorrecto
// si monoschinos/animeav1 llegaran a mandar una ruta relativa)
const _DOMINIOS_ANIME = { latanime: 'https://latanime.org', animeav1: 'https://animeav1.com' }
function _imgProxySrc(url) {
  if (!url) return ''
  if (url.startsWith('/')) return (_DOMINIOS_ANIME[_srcActivaImgAnime] || _DOMINIOS_ANIME.latanime) + url
  return url
}

function irSlide(idx) {
  _sliderIdx = idx
  document.getElementById('slider-track').style.transform = `translateX(-${idx*100}%)`
  document.querySelectorAll('.slider-dot').forEach((d,i) => d.classList.toggle('activo', i===idx))
}
function resetTimer() {
  if (_sliderTimer) clearInterval(_sliderTimer)
  _sliderTimer = setInterval(() => irSlide((_sliderIdx+1)%_sliderTotal), 5000)
}

// ── Swipe táctil en el slider ────────────────────────────────────────────────
;(function _initSliderSwipe() {
  const wrap = document.getElementById('slider-wrap')
  if (!wrap) return
  let _tx = 0, _dragging = false
  wrap.addEventListener('touchstart', e => { _tx = e.touches[0].clientX; _dragging = true }, { passive: true })
  wrap.addEventListener('touchend', e => {
    if (!_dragging) return
    _dragging = false
    const dx = e.changedTouches[0].clientX - _tx
    if (Math.abs(dx) < 40) return
    if (dx < 0) irSlide((_sliderIdx + 1) % _sliderTotal)
    else         irSlide((_sliderIdx - 1 + _sliderTotal) % _sliderTotal)
    resetTimer()
  }, { passive: true })
})()

// ─── CALENDARIO ──────────────────────────────────────────────────────────
const DIAS_ES = { lunes:'Lunes', martes:'Martes', miercoles:'Miércoles', jueves:'Jueves', viernes:'Viernes', sabado:'Sábado', domingo:'Domingo', otros:'Otros' }
const DIAS_HOY = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado']
let _calData = {}
let _calDiaActivo = ''

async function cargarCalendario() {
  const tabs  = document.getElementById('cal-tabs')
  const lista = document.getElementById('cal-lista')
  if (!tabs || !lista) return
  tabs.innerHTML  = ''
  lista.innerHTML = '<div class="loading" style="padding:40px;text-align:center">Cargando calendario...<br><small style="color:#475569;font-size:11px;display:block;margin-top:8px">Esto puede tardar unos segundos</small></div>'

  _calData = await window.api.getCalendario()

  if (!_calData || !Object.keys(_calData).length) {
    lista.innerHTML = '<div class="loading" style="color:#e63946">No se pudo cargar el calendario.</div>'
    return
  }

  const hoyIdx = new Date().getDay()
  const hoyKey = DIAS_HOY[hoyIdx]

  // Orden fijo Lunes→Domingo (algunas fuentes, como AnimeAV1, devuelven los días desordenados)
  const _ORDEN_DIAS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo','otros']
  const _posDia = d => { const i = _ORDEN_DIAS.indexOf(d); return i === -1 ? 99 : i }
  const diasOrdenados = Object.keys(_calData).sort((a, b) => _posDia(a) - _posDia(b))

  tabs.innerHTML = diasOrdenados.map(dia => {
    const esHoy = dia === hoyKey
    return `<button class="cal-tab${esHoy ? ' hoy' : ''}" data-dia="${dia}" onclick="selCalDia('${dia}')">${DIAS_ES[dia] || dia}</button>`
  }).join('')

  const diasDisp = diasOrdenados
  _calDiaActivo = diasDisp.includes(hoyKey) ? hoyKey : diasDisp[0] || ''
  if (_calDiaActivo) selCalDia(_calDiaActivo)
}

function selCalDia(dia) {
  _calDiaActivo = dia
  document.querySelectorAll('.cal-tab').forEach(t => {
    t.classList.toggle('activo', t.dataset.dia === dia)
  })
  const animes = _calData[dia] || []
  const lista = document.getElementById('cal-lista')
  if (!animes.length) { lista.innerHTML = '<div class="loading">Sin animes este día.</div>'; return }

  const hoyIdx = new Date().getDay()
  const hoyKey = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][hoyIdx]
  const esHoy = dia === hoyKey

  lista.innerHTML = `<div class="cal-grid">${animes.map(a => {
    const letra = a.titulo.charAt(0)
    const imgHtml = a.imagen
      ? `<img class="cal-card-img" src="${a.imagen}" onload="imgLoaded(this)" onerror="imgErrorCal(this)" />`
      : `<div class="cal-card-img-placeholder">${letra}</div>`
    return `<div class="cal-card" onclick="abrirAnime('${a.link}','${_esc(a.titulo)}')">
      ${esHoy ? '<div class="cal-card-live">● EN VIVO</div>' : ''}
      <div class="cal-card-img-wrap${a.imagen ? '' : ' loaded'}" data-letra="${letra}">${imgHtml}</div>
      <div class="cal-card-info">
        <div class="cal-card-titulo">${a.titulo}</div>
        <div class="cal-card-meta">
          ${a.ep ? `<span class="cal-card-ep">${a.ep}</span>` : ''}
          ${a.badge ? `<span class="cal-card-badge ${a.badge}">${a.badge === 'latino' ? 'LAT' : 'CAST'}</span>` : ''}
        </div>
      </div>
    </div>`
  }).join('')}</div>`

  // Forzar loaded en imágenes que ya cargaron antes de que el evento onload se registrara
  setTimeout(() => {
    lista.querySelectorAll('.cal-card-img').forEach(img => {
      if (img.complete && img.naturalWidth > 0) imgLoaded(img)
    })
    lista.querySelectorAll('.tarjeta-img-wrap img, .tarjeta-img-wrap.tarjeta-ep img').forEach(img => {
      if (img.complete && img.naturalWidth > 0) imgLoaded(img)
    })
  }, 100)
}
let _emisionActiva = false
let _filtros = { categoria: '' }

function toggleDD(id) {
  document.querySelectorAll('.filtro-dd.open').forEach(d => { if (d.id !== id) d.classList.remove('open') })
  document.getElementById(id)?.classList.toggle('open')
}

function setFiltro(tipo, valor, el) {
  _filtros[tipo] = valor
  const label = document.getElementById(`dd-${tipo}-label`)
  const dd = el.closest('.filtro-dd')
  if (label) label.textContent = valor || (tipo === 'genero' ? 'Género' : 'Categoría')
  dd?.classList.toggle('activo', !!valor)
  dd?.classList.remove('open')
  // Marcar item seleccionado
  dd?.querySelectorAll('.filtro-dd-item').forEach(i => i.classList.toggle('selected', i.dataset.value === valor))
  actualizarFiltros()
}

// Cerrar dropdowns al hacer click fuera
document.addEventListener('click', (e) => {
  if (!e.target.closest('.filtro-dd')) {
    document.querySelectorAll('.filtro-dd.open').forEach(d => d.classList.remove('open'))
  }
})

async function buscar(q) {
  const grilla = document.getElementById('grilla-buscar')
  grilla.innerHTML = '<div class="loading">Buscando...</div>'
  const lista = await window.api.buscar(q, { ..._filtros, emision: _emisionActiva })
  if (!lista.length) { grilla.innerHTML = '<div class="loading">Sin resultados.</div>'; return }
  grilla.innerHTML = _filtrarLista(lista).map(r => renderTarjeta({...r, adulto: r.adulto || _esAdulto(r)})).join('')
  checkLoadedImgs(grilla)
  _enriquecerEnBackground(_filtrarLista(lista), 'grilla-buscar')
}

async function buscarPorGenero(genero) {
  navegar('buscar')
  // Marcar pill activa
  document.querySelectorAll('.genre-pill').forEach(p => p.classList.remove('activo'))
  document.querySelector(`.genre-pill[onclick*="${genero}"]`)?.classList.add('activo')
  const grilla = document.getElementById('grilla-buscar')
  grilla.innerHTML = '<div class="loading">Cargando...</div>'
  const lista = await window.api.buscar('', { genero })
  if (!lista.length) { grilla.innerHTML = '<div class="loading">Sin resultados.</div>'; return }
  grilla.innerHTML = _filtrarLista(lista).map(r => renderTarjeta({...r, adulto: r.adulto || _esAdulto(r)})).join('')
  checkLoadedImgs(grilla)
}

function actualizarFiltros() {
  const hayFiltro = _emisionActiva || _filtros.genero || _filtros.categoria
  document.getElementById('btn-limpiar-filtros')?.classList.toggle('visible', !!hayFiltro)
  const q = document.getElementById('buscador-2')?.value.trim() || ''
  buscar(q)
}

document.addEventListener('DOMContentLoaded', () => {
  // ── Buscador: escuchar input con debounce ──────────────────────────────────
  let _buscarTimer = null
  const _buscadorEl = document.getElementById('buscador-2')
  if (_buscadorEl) {
    _buscadorEl.addEventListener('input', () => {
      clearTimeout(_buscarTimer)
      _buscarTimer = setTimeout(() => {
        const q = _buscadorEl.value.trim()
        buscar(q)
      }, 400)
    })
    _buscadorEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        clearTimeout(_buscarTimer)
        buscar(_buscadorEl.value.trim())
      }
    })
  }

  document.getElementById('filtro-emision')?.addEventListener('click', () => {
    _emisionActiva = !_emisionActiva
    document.getElementById('filtro-emision').classList.toggle('activo', _emisionActiva)
    actualizarFiltros()
  })
  document.getElementById('btn-limpiar-filtros')?.addEventListener('click', () => {
    _emisionActiva = false
    _filtros = { categoria: '' }
    document.getElementById('filtro-emision')?.classList.remove('activo')
    document.getElementById('dd-categoria-label').textContent = 'Categoría'
    document.querySelectorAll('.filtro-dd').forEach(d => { d.classList.remove('activo','open') })
    document.querySelectorAll('.filtro-dd-item').forEach(i => i.classList.remove('selected'))
    document.getElementById('btn-limpiar-filtros')?.classList.remove('visible')
    const q = document.getElementById('buscador-2')?.value.trim() || ''
    buscar(q)
  })
})

// ─── PÁGINA DETALLE ANIME ─────────────────────────────────────────────────
let _paginaAnterior = 'inicio'
const _coverCache = {}
let _animeActual = null
// Token de cancelación — si el usuario navega a otro anime antes de que
// termine una carga anterior, la respuesta vieja se descarta en vez de
// pisar el estado/DOM del anime que se está mostrando ahora.
let _abrirAnimeToken = 0

async function abrirAnime(url, titulo) {
  ++_epSeleccionToken
  const miToken = ++_abrirAnimeToken
  const activa = document.querySelector('#app-anime .pagina.activa')
  const _origen = activa ? activa.id.replace('page-','') : 'inicio'
  // Si ya estamos en el detalle (doble disparo del click, o abrir otro anime
  // desde aquí) no pisar el origen: si no, "Volver" navega a la misma página.
  if (_origen !== 'anime') _paginaAnterior = _origen
  else if (!_paginaAnterior || _paginaAnterior === 'anime') _paginaAnterior = 'inicio'
  // Ocultar todas las páginas del app anime y mostrar page-anime
  document.querySelectorAll('#app-anime .pagina').forEach(p => p.classList.remove('activa'))
  document.querySelector('#sidebar-anime .nav-btn.activo')?.classList.remove('activo')
  document.getElementById('page-anime').classList.add('activa')
  // Re-trigger animación botones flotantes
  const _fbAnime = document.getElementById('anime-floating-btns')
  if (_fbAnime) { _fbAnime.classList.remove('entrando','saliendo'); void _fbAnime.offsetWidth; _fbAnime.classList.add('entrando') }

  const portada = document.getElementById('anime-portada')
  const portadaWrap = document.getElementById('anime-portada-wrap')
  portada.removeAttribute('src')
  portada.classList.remove('loaded')
  portadaWrap.classList.remove('loaded')
  document.getElementById('anime-titulo').textContent = titulo
  document.getElementById('anime-sinopsis').textContent = 'Cargando...'
  document.getElementById('anime-hero-bg').style.backgroundImage = ''
  document.getElementById('eps-lista').innerHTML = '<div class="loading">Cargando episodios...</div>'

  const info = await window.api.getAnime(url)
  if (miToken !== _abrirAnimeToken) return  // el usuario ya abrió otro anime
  portada.classList.remove('loaded')

  if (!info) {
    document.getElementById('eps-lista').innerHTML = '<div class="loading" style="color:#e63946">Error al cargar.</div>'
    return
  }

  document.getElementById('anime-titulo').textContent = info.titulo || titulo
  const sinopsisEl = document.getElementById('anime-sinopsis')
  const sinopsisToggle = document.getElementById('anime-sinopsis-toggle')
  if (sinopsisEl) {
    sinopsisEl.textContent = info.sinopsis || ''
    sinopsisEl.classList.remove('expandido')
    if (sinopsisToggle) sinopsisToggle.classList.remove('expandido')
    // Mostrar "Ver más" solo si el texto está siendo recortado
    // Doble RAF para que -webkit-line-clamp esté calculado antes de medir
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (sinopsisToggle) {
        const recortado = sinopsisEl.scrollHeight > sinopsisEl.clientHeight + 2
        sinopsisToggle.style.display = recortado ? '' : 'none'
        sinopsisToggle.childNodes[0].textContent = 'Ver más '
      }
    }))
  }

  _animeActual = { url, titulo: info.titulo || titulo, imagen: info.imagen || '', sinopsis: info.sinopsis || '', episodios: info.episodios }
  const esFav = await window.api.isFav(url)
  if (miToken !== _abrirAnimeToken) return
  _actualizarEstadoFav(esFav)
  _actualizarEstadoCompletado(url)

  const cacheKey = url.replace(/-(latino|castellano)$/,'')
  if (info.imagen) _coverCache[cacheKey] = info.imagen
  const imagenFinal = info.imagen || _coverCache[cacheKey] || ''

  if (imagenFinal) {
    portada.onload = () => { portada.classList.add('loaded'); portadaWrap.classList.add('loaded') }
    portada.onerror = () => { portadaWrap.classList.add('loaded') }
    portada.src = imagenFinal
    document.getElementById('anime-hero-bg').style.backgroundImage = `url('${imagenFinal}')`
  } else {
    portadaWrap.classList.add('loaded')
  }

  if (!info.episodios.length) {
    document.getElementById('eps-lista').innerHTML = '<div class="loading">Sin episodios encontrados.</div>'
    return
  }

  const historial = await window.api.getHistorial()
  const progresos = await window.api.getTodosProgresos()
  if (miToken !== _abrirAnimeToken) return
  const linksVistos = new Set(historial.map(h => h.link))

  document.getElementById('eps-lista').innerHTML = info.episodios.map(ep => {
    const prog     = progresos[ep.link]
    const visto    = linksVistos.has(ep.link) && prog?.porcentaje >= 95
    const enProg   = prog && prog.porcentaje > 5 && prog.porcentaje < 95
    const pct      = prog ? Math.round(prog.porcentaje) : 0
    const thumbSrc = ep.imagen || info.imagen || ''
    const lEsc     = _esc(ep.link)
    const tEsc     = _esc((info.titulo||titulo) + ' - Ep ' + ep.num)

    // Estado (columna 3): igual que manga — progreso | check | vacío
    let estadoHtml = ''
    if (visto) {
      estadoHtml = ''
    } else if (enProg) {
      estadoHtml = `<div class="ep-prog">
        <div class="ep-prog-bar"><div class="ep-prog-fill" style="width:${pct}%"></div></div>
        <span class="ep-prog-pct">${formatTime(prog.currentTime)}</span>
      </div>`
    }

    // Toggle icon: ojo abierto = no visto, ojo tachado = ya visto (igual que manga)
    const toggleTitle = visto ? 'Marcar como no visto' : 'Marcar como visto'
    const toggleIcon  = visto
      ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`

    const liked    = localStorage.getItem(`ryoku_like_${ep.link}`) === '1'
    const disliked = localStorage.getItem(`ryoku_dislike_${ep.link}`) === '1'
    const likeBadgeHtml = liked
      ? `<span class="ep-like-badge liked"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg></span>`
      : disliked
      ? `<span class="ep-like-badge disliked"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/></svg></span>`
      : ''

    const clases = ['ep-item', visto ? 'visto' : ''].filter(Boolean).join(' ')
    return `<div class="${clases}" data-ep-num="${ep.num}" data-ep-link="${lEsc}" data-ep-titulo="${tEsc}"
      onclick="if(!event.target.closest('.ep-toggle'))abrirSelector('${lEsc}','${tEsc}')" style="cursor:pointer">
      <div class="ep-thumb-wrap${!thumbSrc?' ep-thumb-empty':''}">
        ${thumbSrc ? `<img class="ep-thumb" src="${thumbSrc}" onerror="this.closest('.ep-thumb-wrap').classList.add('ep-thumb-empty');this.remove()" loading="lazy">` : ''}
      </div>
      <div class="ep-body">
        <div class="ep-titulo">Episodio ${ep.num}</div>
      </div>
      <div class="ep-estado">${likeBadgeHtml}${estadoHtml}</div>
      <button class="ep-toggle${visto?' visto':''}" title="${toggleTitle}"
        onclick="event.stopPropagation();toggleEpVisto(this)">${toggleIcon}</button>
    </div>`
  }).join('')

  _recalcAlDiaAnime(_animeActual)
}

// ─── "AL DÍA" (auto) — animes donde el usuario ya vio TODOS los episodios
// que existen ahora mismo. A diferencia de "completado" (marcado a mano),
// esto se recalcula solo cada vez que hay datos frescos de episodios/
// progreso (al abrir el anime, al marcar/desmarcar un episodio, al terminar
// de ver uno), así que si el anime saca un episodio nuevo que todavía no se
// vio, deja de contar como "al día" hasta que también se vea ese episodio.
// No hace llamadas de red propias -- reusa historial/progreso ya locales.
const _ALDIA_ANIME_KEY = 'ryoku-al-dia-anime'

function _getAlDiaAnime() {
  try { return JSON.parse(localStorage.getItem(_ALDIA_ANIME_KEY) || '{}') } catch (e) { return {} }
}

function _setAlDiaAnimeEntry(url, entry) {
  const mapa  = _getAlDiaAnime()
  const antes = JSON.stringify(mapa[url] || null)
  if (entry) mapa[url] = entry
  else delete mapa[url]
  if (JSON.stringify(mapa[url] || null) === antes) return // sin cambios reales
  localStorage.setItem(_ALDIA_ANIME_KEY, JSON.stringify(mapa))
  if (typeof window._ryokuMarcarSyncPendiente === 'function') window._ryokuMarcarSyncPendiente()
}

async function _recalcAlDiaAnime(anime) {
  if (!anime || !anime.url || !anime.episodios || !anime.episodios.length) return
  try {
    const [historial, progresos] = await Promise.all([window.api.getHistorial(), window.api.getTodosProgresos()])
    const linksVistos = new Set(historial.map(h => h.link))
    const todosVistos = anime.episodios.every(ep => {
      const prog = progresos[ep.link]
      return linksVistos.has(ep.link) && prog?.porcentaje >= 95
    })
    _setAlDiaAnimeEntry(anime.url, todosVistos
      ? { titulo: anime.titulo, imagen: anime.imagen || '', totalEps: anime.episodios.length, fecha: Date.now() }
      : null)
  } catch (e) {}
}

async function toggleEpVisto(btn) {
  const item    = btn.closest('.ep-item')
  const link    = item.dataset.epLink
  const tituloE = item.dataset.epTitulo
  const epNum   = item.dataset.epNum
  const yaVisto = item.classList.contains('visto')
  const iconOjo      = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
  const iconOjoSlash = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
  const estado = item.querySelector('.ep-estado')

  if (yaVisto) {
    await window.api.removeProgreso(link)
    await window.api.removeHistorial(link)
    item.classList.remove('visto')
    btn.classList.remove('visto')
    btn.title = 'Marcar como visto'
    btn.innerHTML = iconOjo
    if (estado) estado.innerHTML = ''
  } else {
    await window.api.setProgreso(link, 1000, 1000)
    const _epImgVisto = _animeActual?.episodios?.find(e => e.link === link)?.imagen
    await window.api.addHistorial({
      anime:  (_animeActual?.titulo || tituloE.split(' - Ep')[0]).trim(),
      titulo: tituloE,
      link,
      imagen: _epImgVisto || _animeActual?.imagen || '',
      animeImagen: _animeActual?.imagen || '',
      fecha:  new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })
    })
    item.classList.add('visto')
    btn.classList.add('visto')
    btn.title = 'Marcar como no visto'
    btn.innerHTML = iconOjoSlash
    if (estado) estado.innerHTML = ''
    if (typeof window._mikuSparkle === 'function') window._mikuSparkle(btn)
    if (typeof window._neruSparkle === 'function') window._neruSparkle(btn)
    if (typeof window._berserkerSparkle === 'function') window._berserkerSparkle(btn)
    if (typeof window._metaphorSparkle === 'function') window._metaphorSparkle(btn)
    if (typeof window._kanekiSparkle === 'function') window._kanekiSparkle(btn)
  }
  // Refrescar "Continuar viendo"
  if (typeof cargarContinuarViendo === 'function') cargarContinuarViendo()
  _recalcAlDiaAnime(_animeActual)
}

document.getElementById('btn-volver').addEventListener('click', () => {
  const fb = document.getElementById('anime-floating-btns')
  const dest = (_paginaAnterior && _paginaAnterior !== 'anime') ? _paginaAnterior : 'inicio'
  if (fb) { fb.classList.add('saliendo'); setTimeout(() => { navegar(dest); fb.classList.remove('saliendo') }, 240) }
  else navegar(dest)
})


function toggleSinopsis() {
  const texto  = document.getElementById('anime-sinopsis')
  const toggle = document.getElementById('anime-sinopsis-toggle')
  if (!texto || !toggle) return
  const expandido = texto.classList.toggle('expandido')
  toggle.classList.toggle('expandido', expandido)
  toggle.childNodes[0].textContent = expandido ? 'Ver menos ' : 'Ver más '
}

async function toggleFav() {
  if (!_animeActual) return
  const favs = await window.api.toggleFav(_animeActual)
  const esFav = favs.some(f => f.url === _animeActual.url)
  _actualizarEstadoFav(esFav)
  cargarFavoritos()
  if (esFav) {
    const btnFav = document.getElementById('btn-fav')
    if (btnFav && typeof window._mikuSparkle === 'function') window._mikuSparkle(btnFav)
    if (btnFav && typeof window._neruSparkle === 'function') window._neruSparkle(btnFav)
    if (btnFav && typeof window._berserkerSparkle === 'function') window._berserkerSparkle(btnFav)
    if (btnFav && typeof window._metaphorSparkle === 'function') window._metaphorSparkle(btnFav)
    if (btnFav && typeof window._kanekiSparkle === 'function') window._kanekiSparkle(btnFav)
  }
}

// Para valores dentro de atributos HTML que se leen después vía dataset
// (data-*): ahí NO va _esc (utils.js), que es para strings JS dentro de
// onclick y deja la barra literal -- "JoJo's" volvía como "JoJo\'s" y, por
// ejemplo, "Quitar" de Continuar viendo no encontraba el anime.
function _escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ─── Favoritos: carpetas + reordenamiento por arrastre ────────────────────
let _favCarpetaActiva = ''
let _favsCache        = []
let _favCarpetasCache = []

// Descarta entradas repetidas (misma url) preservando la primera aparición --
// protección defensiva del lado del cliente ante datos ya duplicados de una
// sincronización vieja (el backend también deduplica en _setF, pero esto
// limpia la vista al toque sin esperar a que el usuario arrastre algo).
function _dedupeFavsCliente(arr) {
  const vistos = new Set()
  const out = []
  for (const f of (arr || [])) {
    if (!f || !f.url || vistos.has(f.url)) continue
    vistos.add(f.url)
    out.push(f)
  }
  return out
}

async function cargarFavoritos() {
  const grilla = document.getElementById('grilla-favoritos')
  if (!grilla) return
  const [favs, carpetas] = await Promise.all([
    window.api.getFavs(),
    Promise.resolve(window.api.getCarpetasFavs?.()).catch(() => [])
  ])
  const favsCrudos = favs || []
  _favsCache        = _dedupeFavsCliente(favsCrudos)
  _favCarpetasCache = carpetas || []
  if (_favCarpetaActiva && !_favCarpetasCache.includes(_favCarpetaActiva)) _favCarpetaActiva = ''
  if (_favsCache.length !== favsCrudos.length) {
    // Había duplicados guardados de antes -- persistir la limpieza ahora mismo.
    window.api.reordenarFavs?.(_favsCache.map(f => f.url)).catch(() => {})
  }
  _renderFavCarpetas()
  _renderFavGrilla()
}

function _renderFavCarpetas() {
  const row = document.getElementById('fav-carpetas-row')
  if (!row) return
  if (!_favsCache.length && !_favCarpetasCache.length) { row.innerHTML = ''; return }
  const chips = [`<div class="fav-carpeta-chip${_favCarpetaActiva === '' ? ' activo' : ''}" data-carpeta="">Todos</div>`]
  for (const c of _favCarpetasCache) {
    chips.push(`<div class="fav-carpeta-chip${_favCarpetaActiva === c ? ' activo' : ''}" data-carpeta="${_escHtml(c)}" title="Clic derecho para renombrar o eliminar">${_escHtml(c)}</div>`)
  }
  chips.push(`<div class="fav-carpeta-add" id="fav-carpeta-add" title="Crear carpeta">+ Carpeta</div>`)
  row.innerHTML = chips.join('')
  row.querySelectorAll('.fav-carpeta-chip').forEach(chip => {
    chip.addEventListener('click', () => _favSetCarpetaActiva(chip.dataset.carpeta))
    chip.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; chip.classList.add('drag-over') })
    chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'))
    chip.addEventListener('drop', e => {
      e.preventDefault()
      chip.classList.remove('drag-over')
      const url = e.dataTransfer.getData('text/plain')
      if (!url) return
      window.api.moverFavCarpeta(url, chip.dataset.carpeta).then(() => cargarFavoritos()).catch(e => console.warn('[fav] error moviendo a carpeta', e))
    })
    if (chip.dataset.carpeta) {
      chip.addEventListener('contextmenu', e => { e.preventDefault(); _favCarpetaMenu(chip.dataset.carpeta, e) })
    }
  })
  document.getElementById('fav-carpeta-add')?.addEventListener('click', _favCrearCarpeta)
}

function _favSetCarpetaActiva(c) {
  _favCarpetaActiva = c || ''
  _renderFavCarpetas()
  _renderFavGrilla()
}

// "Todos" = favoritos SIN carpeta asignada (no es "absolutamente todo") --
// cada anime vive en un solo lugar: en "Todos" si no tiene carpeta, o en su
// carpeta si se le asignó una. Evita que un mismo anime aparezca a la vez
// en "Todos" y en su carpeta (lo que el usuario ve como "duplicado").
function _favVisibles() {
  return _favCarpetaActiva
    ? _favsCache.filter(f => (f.carpeta || '') === _favCarpetaActiva)
    : _favsCache.filter(f => !f.carpeta)
}

function _renderFavGrilla() {
  const grilla = document.getElementById('grilla-favoritos')
  if (!grilla) return
  if (!_favsCache.length) { grilla.innerHTML = '<div class="fav-vacio">No tienes animes guardados aún.<br>Dale ❤️ a un anime para guardarlo.</div>'; return }
  const visibles = _favVisibles()
  if (!visibles.length) {
    grilla.innerHTML = _favCarpetaActiva
      ? '<div class="fav-vacio">No hay animes en esta carpeta todavía.<br>Arrastrá una portada hasta la pestaña de la carpeta para moverla acá.</div>'
      : '<div class="fav-vacio">No tenés animes sin carpeta — están todos organizados.<br>Arrastrá una portada hasta "Todos" para sacarla de su carpeta.</div>'
    return
  }
  grilla.innerHTML = visibles.map(f => renderTarjeta({ titulo: f.titulo, link: f.url, imagen: f.imagen })).join('')
  checkLoadedImgs(grilla)
  grilla.querySelectorAll('.tarjeta[data-link]').forEach(t => t.setAttribute('draggable', 'true'))
  _wireFavDragAndDrop(grilla)
}

// ── Drag & drop de favoritos con hueco animado (placeholder) ───────────────
// En vez de solo resaltar la tarjeta destino, mientras se arrastra se inserta
// un "hueco" (placeholder punteado, con pulso) en el lugar exacto donde
// quedaría la portada al soltarla. Las tarjetas vecinas se reacomodan al
// toque (se probó animar ese reacomodo con la técnica FLIP, pero la medición
// de posiciones se contaminaba en arrastres largos y generaba glitches, así
// que se dejó sin animar esa parte -- el hueco con su pulso es la animación
// que realmente importa).
let _favPlaceholderEl = null
let _favArrastreActivo = false
function _favGetPlaceholder() {
  if (!_favPlaceholderEl) {
    _favPlaceholderEl = document.createElement('div')
    _favPlaceholderEl.className = 'fav-drag-placeholder'
  }
  return _favPlaceholderEl
}

function _favDragCleanup(grilla) {
  _favArrastreActivo = false
  grilla?.querySelectorAll('.tarjeta.dragging').forEach(c => c.classList.remove('dragging'))
  if (_favPlaceholderEl?.parentElement) _favPlaceholderEl.remove()
}

// Encuentra dónde insertar el hueco: primero decide la FILA (según en qué
// franja vertical cae el cursor) y recién ahí, dentro de esa fila, decide
// antes/después de qué tarjeta según la posición horizontal.
// OJO: la versión anterior comparaba distancia euclídea al centro de TODAS
// las tarjetas de la grilla a la vez -- justo en el borde entre dos filas,
// una tarjeta de la fila de arriba y una de la fila de abajo pueden quedar
// casi igual de "cerca", así que al mover el mouse verticalmente el
// resultado saltaba de una a otra en cada frame, moviendo el hueco (y
// recalculando el acomodo de toda la grilla) sin parar -- eso era el
// "se enloquece" al mover algo de arriba hacia abajo o viceversa.
function _favDragClosest(grilla, x, y) {
  const els = [...grilla.querySelectorAll('.tarjeta:not(.dragging)')]
  if (!els.length) return { closest: null, insertAfter: false }

  const filas = []
  for (const el of els) {
    const box = el.getBoundingClientRect()
    let fila = filas.find(f => Math.abs(f.top - box.top) < 4)
    if (!fila) { fila = { top: box.top, bottom: box.bottom, items: [] }; filas.push(fila) }
    fila.bottom = Math.max(fila.bottom, box.bottom)
    fila.items.push({ el, box })
  }

  let fila = filas.find(f => y >= f.top && y <= f.bottom)
  if (!fila) {
    fila = filas.reduce((mejor, f) => {
      const centroF = (f.top + f.bottom) / 2
      const centroM = (mejor.top + mejor.bottom) / 2
      return Math.abs(y - centroF) < Math.abs(y - centroM) ? f : mejor
    }, filas[0])
  }

  let closest = fila.items[0].el, insertAfter = false, mejorDist = Infinity
  for (const { el, box } of fila.items) {
    const cx = box.left + box.width / 2
    const dist = Math.abs(x - cx)
    if (dist < mejorDist) { mejorDist = dist; closest = el; insertAfter = x > cx }
  }
  return { closest, insertAfter }
}

// Mueve el placeholder a la posición indicada. Las tarjetas vecinas se
// reacomodan al toque (sin animación de deslizamiento) -- ver comentario
// arriba de por qué se sacó esa parte.
function _favMoverPlaceholder(grilla, closest, insertAfter) {
  const placeholder = _favGetPlaceholder()
  const yaAhi = closest
    ? (insertAfter ? closest.nextSibling === placeholder : closest.previousSibling === placeholder)
    : grilla.lastElementChild === placeholder
  if (yaAhi) return

  if (!closest) grilla.appendChild(placeholder)
  else if (insertAfter) closest.after(placeholder)
  else closest.before(placeholder)
}

// Red de seguridad global: en ventanas de Electron sin marco nativo (como
// esta, con su propio titlebar) a veces el navegador NO llega a disparar
// 'dragend' en la tarjeta de origen si el arrastre termina de forma rara
// (se suelta fuera de la ventana, se pierde el foco, el SO intercepta el
// gesto, etc.) -- sin esto, el hueco punteado se queda pegado en la grilla
// para siempre hasta que algo la vuelva a renderizar. Se registra UNA sola
// vez a nivel de documento y limpia sin importar qué elemento originó el
// drag.
let _favDragSafetyNetInstalada = false
function _favInstalarRedSeguridadDrag() {
  if (_favDragSafetyNetInstalada) return
  _favDragSafetyNetInstalada = true
  const limpiar = () => _favDragCleanup(document.getElementById('grilla-favoritos'))
  // OJO: 'drop' NO va acá -- 'dragend' siempre llega DESPUÉS de que el
  // 'drop' real (en la grilla o en un chip de carpeta) ya leyó la posición
  // del placeholder para calcular el nuevo orden. Si se limpiara también en
  // captura de 'drop', esta red de seguridad borraría el placeholder ANTES
  // de que el handler de la grilla llegue a usarlo, rompiendo el reordenado
  // en cada suelte normal.
  document.addEventListener('dragend', limpiar, true)
  window.addEventListener('blur', limpiar)
}

function _wireFavDragAndDrop(grilla) {
  _favInstalarRedSeguridadDrag()
  grilla.querySelectorAll('.tarjeta[data-link]').forEach(card => {
    card.addEventListener('dragstart', e => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', card.dataset.link)
      // Se demora un tick para que el navegador ya haya capturado la imagen
      // "fantasma" del drag antes de sacar la tarjeta original de la grilla.
      _favArrastreActivo = true
      setTimeout(() => card.classList.add('dragging'), 0)
      // El drag nativo deja de emitir mousemove, así que el cursor temático
      // (Miku/Neru/Berserker/Metaphor) se quedaría congelado en su última
      // posición. En vez de intentar seguirle el paso al drag (queda detrás
      // de la imagen fantasma nativa del SO, algo que no se puede evitar),
      // simplemente lo ocultamos durante el arrastre; el próximo mousemove
      // real al soltar ya lo vuelve a mostrar solo.
      window._cursorTematicoOcultar?.()
    })
    card.addEventListener('dragend', () => _favDragCleanup(grilla))
  })

  // Los listeners del contenedor (que manejan el hueco/placeholder) solo se
  // registran una vez -- #grilla-favoritos nunca se recrea, solo su innerHTML.
  if (grilla._favDragWired) return
  grilla._favDragWired = true

  // 'dragover' dispara MUCHAS veces por segundo (atado al movimiento del
  // mouse), y cada recálculo del hueco hace varios getBoundingClientRect()
  // sobre toda la grilla (fuerza reflow). Sin límite, en una grilla con
  // varias decenas de favoritos esto satura el hilo principal y se siente
  // como que la app "se traba" un instante mientras se arrastra. Se
  // throttlea a lo sumo un recálculo por frame (rAF), siempre con la
  // posición del cursor más reciente.
  let dragX = 0, dragY = 0, dragFrameProgramado = false
  grilla.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('text/plain')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dragX = e.clientX; dragY = e.clientY
    if (dragFrameProgramado) return
    dragFrameProgramado = true
    requestAnimationFrame(() => {
      dragFrameProgramado = false
      if (!_favArrastreActivo) return // el drag ya terminó mientras este frame esperaba turno
      const { closest, insertAfter } = _favDragClosest(grilla, dragX, dragY)
      _favMoverPlaceholder(grilla, closest, insertAfter)
    })
  })

  // Al soltar, en vez de reconstruir toda la grilla (lo que recrea todas las
  // <img> y hace parpadear todas las portadas como si la página se hubiera
  // recargado), se reemplaza el hueco directamente por la tarjeta real que
  // ya estaba oculta -- ningún <img> se vuelve a crear, cero parpadeo.
  grilla.addEventListener('drop', e => {
    e.preventDefault()
    _favArrastreActivo = false
    const urlOrigen   = e.dataTransfer.getData('text/plain')
    const placeholder = _favGetPlaceholder()
    const draggedCard = grilla.querySelector('.tarjeta.dragging')
    if (!urlOrigen || !placeholder.parentElement || !draggedCard) { _favDragCleanup(grilla); return }
    placeholder.replaceWith(draggedCard)
    draggedCard.classList.remove('dragging')
    const nuevoVisibleOrder = [...grilla.querySelectorAll('.tarjeta[data-link]')].map(el => el.dataset.link)
    _aplicarNuevoOrdenVisible(nuevoVisibleOrder, false)
  })
}

// Recibe el nuevo orden visible (según la carpeta activa) ya calculado a
// partir del DOM tras soltar, y lo traduce al orden GLOBAL de la fuente
// (_favsCache completo), preservando intacta la posición relativa de los
// favoritos que no pertenecen a la carpeta activa. Actualiza la UI al toque
// (optimista) y persiste con reordenar-favs.
function _aplicarNuevoOrdenVisible(nuevoVisibleOrder, rerender = true) {
  const fullOrder  = _favsCache.map(f => f.url)
  const visibles   = _favVisibles().map(f => f.url)
  if (nuevoVisibleOrder.length !== visibles.length) return // algo no cuadra, no arriesgar el orden
  const visibleSet = new Set(visibles)
  const cola       = [...nuevoVisibleOrder]
  const nuevoOrden = fullOrder.map(u => visibleSet.has(u) ? cola.shift() : u)
  const byUrl = new Map(_favsCache.map(f => [f.url, f]))
  _favsCache = nuevoOrden.map(u => byUrl.get(u)).filter(Boolean)
  if (rerender) _renderFavGrilla()
  try { localStorage.setItem('ryoku-favs-orden-ts', String(Date.now())) } catch (e) {}  // ver _mergeFavs en sync.js
  window.api.reordenarFavs(nuevoOrden).catch(() => {})
}

function _favCrearCarpeta() {
  _favModalInput('Nueva carpeta', '', nombre => {
    window.api.crearCarpetaFav(nombre)
      .then(async () => { window._ryokuCarpetaMarca?.('creada', await window.api.getAnimeSource?.(), nombre); _favCarpetaActiva = nombre; cargarFavoritos() })
      .catch(e => console.warn('[fav] error creando carpeta', e))
  })
}

function _favCarpetaMenu(nombre, evt) {
  document.getElementById('fav-carpeta-menu')?.remove()
  const menu = document.createElement('div')
  menu.id = 'fav-carpeta-menu'
  menu.className = 'fav-carpeta-menu'
  menu.style.left = evt.clientX + 'px'
  menu.style.top  = evt.clientY + 'px'
  menu.innerHTML = `<div class="fav-carpeta-menu-item" data-accion="renombrar">✏️ Renombrar</div><div class="fav-carpeta-menu-item fav-carpeta-menu-danger" data-accion="borrar">🗑️ Eliminar</div>`
  document.body.appendChild(menu)
  menu.querySelector('[data-accion="renombrar"]').addEventListener('click', () => {
    menu.remove()
    _favModalInput('Renombrar carpeta', nombre, nuevo => {
      if (nuevo === nombre) return
      window.api.renombrarCarpetaFav(nombre, nuevo).then(async (r) => {
        const _src = await window.api.getAnimeSource?.(); window._ryokuCarpetaMarca?.('borrada', _src, nombre); window._ryokuCarpetaMarca?.('creada', _src, nuevo)
        if (_favCarpetaActiva === nombre) _favCarpetaActiva = nuevo
        cargarFavoritos()
      }).catch(e => console.warn('[fav] error renombrando carpeta', e))
    })
  })
  menu.querySelector('[data-accion="borrar"]').addEventListener('click', () => {
    menu.remove()
    _favModalConfirm(`¿Eliminar la carpeta "${nombre}"? Los animes dentro volverán a "Todos".`, () => {
      window.api.borrarCarpetaFav(nombre).then(async () => {
        window._ryokuCarpetaMarca?.('borrada', await window.api.getAnimeSource?.(), nombre)
        if (_favCarpetaActiva === nombre) _favCarpetaActiva = ''
        cargarFavoritos()
      }).catch(e => console.warn('[fav] error borrando carpeta', e))
    })
  })
  setTimeout(() => {
    document.addEventListener('click', function _cerrar(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', _cerrar) }
    })
  }, 10)
}

// Modal genérico con campo de texto (crear/renombrar carpeta) — sin prompt()
// nativo, siguiendo el mismo patrón de modal manual usado en el resto de la app.
function _favModalInput(titulo, valorInicial, onOk) {
  document.getElementById('fav-modal-input')?.remove()
  const modal = document.createElement('div')
  modal.id = 'fav-modal-input'
  modal.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center'
  modal.innerHTML = `<div style="background:var(--bg-1);border:1px solid var(--border);border-radius:14px;padding:20px 22px;width:300px;max-width:calc(100vw - 40px);display:flex;flex-direction:column;gap:14px">
    <div style="font-size:14px;color:var(--text-1);font-weight:600">${_escHtml(titulo)}</div>
    <input id="fav-modal-input-campo" type="text" maxlength="40" value="${_escHtml(valorInicial || '')}" placeholder="Nombre de la carpeta" style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-3);color:var(--text-1);font-size:13px;outline:none" />
    <div style="display:flex;gap:8px">
      <button id="fav-modal-input-cancel" style="flex:1;padding:8px;border-radius:8px;background:var(--bg-3);border:none;color:var(--text-1);font-size:13px;cursor:pointer">Cancelar</button>
      <button id="fav-modal-input-ok" style="flex:1;padding:8px;border-radius:8px;background:var(--primary);border:none;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Guardar</button>
    </div>
  </div>`
  document.body.appendChild(modal)
  const campo = document.getElementById('fav-modal-input-campo')
  campo.focus(); campo.select()
  const cerrar = () => modal.remove()
  const confirmar = () => { const v = campo.value.trim(); cerrar(); if (v) onOk(v) }
  document.getElementById('fav-modal-input-cancel').addEventListener('click', cerrar)
  document.getElementById('fav-modal-input-ok').addEventListener('click', confirmar)
  campo.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmar()
    if (e.key === 'Escape') cerrar()
  })
  modal.addEventListener('mousedown', e => { if (e.target === modal) cerrar() })
}

// Modal genérico de confirmación (borrar carpeta) — mismo patrón que _chatConfirm en chat.js.
function _favModalConfirm(message, onYes) {
  document.getElementById('fav-modal-confirm')?.remove()
  const modal = document.createElement('div')
  modal.id = 'fav-modal-confirm'
  modal.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center'
  modal.innerHTML = `<div style="background:var(--bg-1);border:1px solid var(--border);border-radius:14px;padding:20px 22px;width:280px;max-width:calc(100vw - 40px);display:flex;flex-direction:column;gap:14px">
    <div style="font-size:14px;color:var(--text-1);line-height:1.4">${_escHtml(message)}</div>
    <div style="display:flex;gap:8px">
      <button id="fav-modal-confirm-no" style="flex:1;padding:8px;border-radius:8px;background:var(--bg-3);border:none;color:var(--text-1);font-size:13px;cursor:pointer">Cancelar</button>
      <button id="fav-modal-confirm-yes" style="flex:1;padding:8px;border-radius:8px;background:#ef4444;border:none;color:#fff;font-size:13px;font-weight:600;cursor:pointer">Eliminar</button>
    </div>
  </div>`
  document.body.appendChild(modal)
  const cerrar = () => modal.remove()
  document.getElementById('fav-modal-confirm-no').addEventListener('click', cerrar)
  document.getElementById('fav-modal-confirm-yes').addEventListener('click', () => { cerrar(); onYes() })
  modal.addEventListener('mousedown', e => { if (e.target === modal) cerrar() })
}

// ─── PASO 1: SELECTOR DE SERVIDOR ─────────────────────────────────────────
let _servidores = [], _tituloActual = '', _urlEpisodioActual = ''
let _pendingEp = null
// Token de cancelación para elegirServidor(): sin esto, elegir un servidor
// lento (p.ej. Hexload) y ABANDONAR esa pantalla antes de que responda --
// abriendo otro anime, cerrando el selector, o eligiendo otro episodio --
// no cancelaba nada. Cuando por fin respondía, elegirServidor() igual
// pisaba _urlEpisodioActual/_tituloActual y abría el player con el
// episodio VIEJO encima de lo que el usuario esté mirando ahora ("abro un
// anime con hexload y luego abro otro y se abre el anterior"). Se
// incrementa cada vez que el usuario claramente pasó a otra cosa (nuevo
// anime, nuevo selector, selector cerrado, otro servidor elegido).
let _epSeleccionToken = 0

// Cache de streams pre-fetcheados: { [urlServidor]: Promise<resultado> }
const _streamCache = {}
// 'mxdrop' (sin la 'i') aparte de 'mixdrop': el botón en Monoschinos dice
// literalmente "Mxdrop", así que 'mixdrop' solo no lo matcheaba — mismo
// problema que ya vimos con Filemoon/Byse, el nombre visible no siempre
// coincide con el nombre "oficial" del proveedor.
const _SRV_OK = ['mp4upload','uqload','voe','savefiles','mixdrop','mxdrop','doodstream','dsvplay','ds2play','streamwish','sw','filemoon','byse','hexload','lulu','yourupload','okru','ok.ru']
// "Ok" (ok.ru) va por nombre exacto: "ok" suelto coincidiría con cualquier cosa
const _esFuncional = n => { const s = (n || '').toLowerCase().trim(); return s === 'ok' || /^ok\b/.test(s) || _SRV_OK.some(k => s.includes(k)) }

// ── Selector de servidores (ventana centrada) ───────────────────────────
// Por servidor: color del avatar con la inicial y prioridad de orden (menor = mejor)
const _SRV_INFO = [
  { k: 'hexload',    color: '#16a34a', prio: 1 },
  { k: 'mp4upload',  color: '#2563eb', prio: 2 },
  { k: 'voe',        color: '#7c3aed', prio: 3 },
  { k: 'lulu',       color: '#db2777', prio: 4 },
  { k: 'streamwish', color: '#0891b2', prio: 5 },
  { k: 'sw',         color: '#0891b2', prio: 5 },
  { k: 'filemoon',   color: '#ea580c', prio: 6 },
  { k: 'byse',       color: '#ea580c', prio: 6 },
  { k: 'uqload',     color: '#4f46e5', prio: 7 },
  { k: 'dood',       color: '#dc2626', prio: 8 },
  { k: 'dsvplay',    color: '#dc2626', prio: 8 },
  { k: 'ds2play',    color: '#dc2626', prio: 8 },
  { k: 'mixdrop',    color: '#d97706', prio: 9 },
  { k: 'mxdrop',     color: '#d97706', prio: 9 },
  { k: 'savefiles',  color: '#0d9488', prio: 10 },
  { k: 'yourupload', color: '#65a30d', prio: 11 },
  { k: 'ok',         color: '#f97316', prio: 12, exacto: true },
]
function _srvInfo(nombre) {
  const n = (nombre || '').toLowerCase().trim()
  return _SRV_INFO.find(x => x.exacto ? (n === x.k || /^ok\b/.test(n)) : n.includes(x.k)) || { color: '#475569', prio: 99 }
}
const _escSrv = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const _SRV_CHEVRON = '<svg class="srv-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>'

function _pintarCabeceraSrv(titulo) {
  const t = String(titulo || '')
  const m = t.match(/^(.*?)\s*-\s*Ep(?:isodio)?\.?\s*([\d.]+)\s*$/i)
  document.getElementById('srv-titulo').textContent = m ? m[1] : t
  const ep = document.getElementById('srv-ep')
  if (ep) { ep.textContent = m ? 'Episodio ' + m[2] : ''; ep.style.display = m ? '' : 'none' }
  const cuenta = document.getElementById('srv-cuenta'); if (cuenta) cuenta.textContent = ''
  _pintarPortadaSrv()
}
function _pintarPortadaSrv() {
  const img = document.getElementById('srv-portada'); if (!img) return
  const src = _animeActual?.imagen || document.getElementById('anime-portada')?.getAttribute('src') || ''
  if (src) { if (img.getAttribute('src') !== src) img.src = src; img.style.display = '' }
  else img.style.display = 'none'
}

function _preFetchServidores(lista) {
  // Solo pre-fetchear 1 servidor (el primero funcional) para no saturar la RAM de Render
  for (const s of lista) {
    if (!s?.url || _streamCache[s.url]) continue
    _streamCache[s.url] = window.api.getStream(s.url).catch(() => null)
    break  // solo 1 a la vez
  }
}

async function abrirSelector(url, titulo) {
  ++_epSeleccionToken
  _tituloActual = titulo
  _urlEpisodioActual = url
  _pendingEp = null  // limpiar cualquier pendiente residual
  const overlay = document.getElementById('overlay-servidor')
  const lista   = document.getElementById('srv-lista')
  _pintarCabeceraSrv(titulo)
  lista.innerHTML = '<div class="loading">Cargando servidores...</div>'
  overlay.classList.add('activo')

  // Cargar datos del anime en paralelo para tenerlos listos al abrir el player
  const animeName = titulo.split(' - Ep')[0].trim()
  if (!_animeActual || _animeActual.titulo !== animeName) {
    _animeActual = null // resetear para no mostrar datos del anime anterior
    // Buscar URL del anime desde la URL del episodio
    const animeUrl = _esLinkEpisodioAnime(url)
      ? _epLinkToAnimeUrl(url)
      : ''
    if (animeUrl) {
      window.api.getAnime(animeUrl).then(info => {
        if (info) { _animeActual = { url: animeUrl, titulo: info.titulo || animeName, imagen: info.imagen || '', sinopsis: info.sinopsis || '', episodios: info.episodios }; _pintarPortadaSrv() }
      }).catch(() => {})
    }
  }

  _servidores = await window.api.getServidores(url)

  if (!_servidores.length) {
    lista.innerHTML = '<div class="loading" style="color:#e63946">Sin servidores disponibles.</div>'
    return
  }

  // Renderizar: funcionales en verde, resto en neutro
  const _indexados = _renderListaServidores()

  // Pre-fetch en background: los primeros funcionales primero, luego el resto
  _preFetchServidores(_indexados)
}

async function pedirServidorEp(url, titulo) {
  ++_epSeleccionToken
  _pendingEp = { url, titulo }
  const overlay = document.getElementById('overlay-servidor')
  const lista   = document.getElementById('srv-lista')
  _pintarCabeceraSrv(titulo)
  lista.innerHTML = '<div class="loading">Cargando servidores...</div>'
  overlay.classList.add('activo')

  _servidores = await window.api.getServidores(url)

  if (!_servidores.length) {
    lista.innerHTML = '<div class="loading" style="color:#e63946">Sin servidores disponibles.</div>'
    return
  }

  const _indexados2 = _renderListaServidores()

  // Pre-fetch en background
  _preFetchServidores(_indexados2)
}

// Renderiza #srv-lista a partir de _servidores (funcionales primero) y
// devuelve el array indexado -- compartido por abrirSelector, pedirServidorEp
// y por la vuelta al selector cuando un servidor falla a mitad de carga
// (ver _volverASelectorTrasFallo), para que ese caso también tenga la lista
// correcta y actualizada en vez de depender de un render viejo/ausente.
function _renderListaServidores() {
  const lista = document.getElementById('srv-lista')
  const _indexados = _servidores.map((s, i) => ({ ...s, _idx: i }))
  // Fuentes que distinguen idioma (p.ej. AnimeAV1: sub / latino): agrupar,
  // subtitulados arriba y latino abajo, cada grupo con su título.
  const _porIdioma = _indexados.some(s => s.idioma)
  const _grupo = s => (s.idioma === 'latino' ? 1 : 0)
  _indexados.sort((a, b) => {
    if (_porIdioma && _grupo(a) !== _grupo(b)) return _grupo(a) - _grupo(b)
    const f = _esFuncional(b.nombre) - _esFuncional(a.nombre)
    return f || (_srvInfo(a.nombre).prio - _srvInfo(b.nombre).prio)
  })
  const cuenta = document.getElementById('srv-cuenta')
  if (cuenta) cuenta.textContent = _indexados.length + (_indexados.length === 1 ? ' servidor' : ' servidores')
  if (lista) {
    let _grupoActual = null
    lista.innerHTML = _indexados.map(s => {
      const ok = _esFuncional(s.nombre)
      let titulo = ''
      if (_porIdioma && s.idioma !== _grupoActual) {
        _grupoActual = s.idioma
        titulo = `<div class="srv-grupo">${s.idioma === 'latino' ? 'Latino' : 'Subtitulado'}</div>`
      }
      // Bajo su título de grupo, el sufijo de idioma del nombre sobra
      const nombre = _porIdioma ? s.nombre.replace(/\s+(sub|latino)$/i, '') : s.nombre
      const letra = (nombre.trim()[0] || '?').toUpperCase()
      return `${titulo}<button class="srv-btn ${ok ? 'srv-funcional' : ''}" id="srv-btn-${s._idx}" onclick="elegirServidor(${s._idx})">
        <div class="srv-ava" style="--srv-c:${_srvInfo(s.nombre).color}">${_escSrv(letra)}</div>
        <div class="srv-txt"><span class="srv-nombre">${_escSrv(nombre)}</span></div>
        <div class="srv-dot ${ok ? 'srv-dot-ok' : ''}"></div>
        ${_SRV_CHEVRON}
      </button>`
    }).join('')
  }
  return _indexados
}

// Marca un botón del selector como fallido: punto rojo + nombre tachado +
// etiqueta "sin resultado". Compartido entre el fallo de getStream() (antes
// de intentar abrir el player) y el fallo de reproducción real (HLS/video
// error) que antes abría el player igual y mostraba el error ahí adentro.
function _marcarServidorFallido(idx) {
  const btn = document.getElementById(`srv-btn-${idx}`)
  if (!btn) return
  const dot = btn.querySelector('.srv-dot')
  btn.disabled = false
  btn.classList.remove('srv-checking', 'srv-funcional')
  btn.classList.add('srv-no-funcional')
  if (dot) dot.className = 'srv-dot srv-dot-fail'
  const nombreEl = btn.querySelector('.srv-nombre')
  if (nombreEl) nombreEl.style.textDecoration = 'line-through'
  if (!btn.querySelector('.srv-sin-resultado')) {
    const lbl = document.createElement('span')
    lbl.className = 'srv-sin-resultado'
    lbl.textContent = 'sin resultado'
    btn.appendChild(lbl)
  }
}

// Un servidor que devolvió stream OK pero falla al reproducir de verdad
// (HLS fatal / video error) ya no debe dejar al usuario mirando el player
// roto con un cartel de error -- se cierra el player, se vuelve al selector
// (re-renderizado por las dudas, por si _servidores cambió por un cambio de
// episodio) y se marca ese servidor en rojo/tachado, igual que un servidor
// que ya fallaba desde antes de abrir el player.
async function _volverASelectorTrasFallo(idx) {
  document.getElementById('player-error-msg')?.remove()
  spinnerShow(false)
  if (hls) { hls.destroy(); hls = null }
  const video = document.getElementById('player-video')
  if (video) { video.oncanplay = null; video.onerror = null; video.pause(); video.src = '' }
  document.getElementById('overlay-player').classList.remove('activo')
  if (window._chatUpdateFAB) window._chatUpdateFAB()
  _renderListaServidores()
  document.getElementById('overlay-servidor').classList.add('activo')
  _marcarServidorFallido(idx)
}

document.getElementById('srv-cerrar').addEventListener('click', () => {
  ++_epSeleccionToken
  _pendingEp = null
  // Limpiar cache al cerrar sin elegir servidor
  for (const k in _streamCache) delete _streamCache[k]
  document.getElementById('overlay-servidor').classList.remove('activo')
  // Si se estaba preparando un video en segundo plano (el reproductor todavía
  // no se había mostrado), cancelarlo: antes seguía cargando y, al estar
  // listo, abría el reproductor solo aunque hubieras cerrado el selector.
  if (!document.getElementById('overlay-player')?.classList.contains('activo')) {
    _reproducirToken++
    if (hls) { hls.destroy(); hls = null }
    const v = document.getElementById('player-video')
    if (v) { v.oncanplay = null; v.onerror = null; v.pause(); v.src = '' }
  }
})

// ─── PASO 2: REPRODUCTOR ──────────────────────────────────────────────────
let hls = null, _idxActivo = 0
let _reproducirToken = 0  // token de cancelación — se incrementa al cerrar/cambiar
let _toastContinuarDone = false
const _toastDismissedEps = new Set()  // true una vez que el toast fue atendido/descartado en el episodio actual
const _nombresDisplay = ['Ultra HD','Rápido','Respaldo','Alternativo','HD','Backup']
const _proveedores = ['byse','voe','mp4upload','dsvplay','mixdrop','hexload']

function spinnerShow(v) {
  document.getElementById('player-spinner').classList.toggle('oculto', !v)
  if (v) drawPlayPauseCanvas(false, true)
}

function _mostrarErrorPlayer(msg) {
  spinnerShow(false)
  const wrap = document.getElementById('rp-video-wrap')
  document.getElementById('player-error-msg')?.remove()
  if (!wrap) return
  const el = document.createElement('div')
  el.id = 'player-error-msg'
  el.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:30;
    background:var(--bg-2,rgba(15,23,42,0.95));border:1px solid var(--border,rgba(255,255,255,0.15));
    border-radius:8px;padding:16px 20px;font-family:Inter,sans-serif;font-size:13px;
    color:var(--text-1,white);text-align:center;max-width:280px;pointer-events:none`
  el.textContent = msg
  wrap.appendChild(el)
}

async function elegirServidor(idx) {
  const s = _servidores[idx]
  if (!s) return
  const miEpToken = ++_epSeleccionToken

  // Marcar botón como "cargando" sin cerrar el overlay aún
  const btn = document.getElementById(`srv-btn-${idx}`)
  const dot = btn?.querySelector('.srv-dot')
  if (btn) {
    btn.disabled = true
    btn.classList.remove('srv-funcional','srv-no-funcional')
    btn.classList.add('srv-checking')
    if (dot) dot.className = 'srv-dot srv-dot-checking'
  }

  // Usar stream pre-fetcheado si ya está en cache
  const _cached = _streamCache[s.url]
  delete _streamCache[s.url]  // consumir del cache
  let resultado = _cached ? (await _cached.catch(() => null)) : null

  // Si el pre-fetch falló o no había cache, intentar hasta 2 veces
  if (!resultado?.url) {
    for (let _intento = 0; _intento < 2; _intento++) {
      resultado = await window.api.getStream(s.url).catch(() => null)
      if (resultado?.url) break
    }
  }

  // El usuario ya se fue a otra cosa (otro anime, otro episodio, cerró el
  // selector, o eligió otro servidor) mientras se esperaba esta respuesta --
  // no tocar nada de lo que esté en pantalla ahora.
  if (miEpToken !== _epSeleccionToken) return

  if (!resultado?.url) {
    // Falló — tachado + pill rojo
    _marcarServidorFallido(idx)
    return
  }

  // Éxito — el link del servidor sirvió, pero eso no garantiza que el video
  // arranque de verdad (streams "muertos", geo-bloqueados, etc.). En vez de
  // abrir el player ya mismo, se prepara todo en segundo plano (el overlay
  // del player sigue oculto por CSS) y el selector se queda a la vista con
  // el botón en "checking" -- recién se abre el player cuando reproducir()
  // confirma que el video realmente puede reproducirse (ver onListo más
  // abajo). Si falla, _volverASelectorTrasFallo() nunca tuvo que cerrar nada
  // visible: el usuario no llega a ver el player roto ni por un instante.
  // Si hay episodio pendiente (cambio desde el player), confirmar ahora
  if (_pendingEp) {
    await _guardarProgresoEpisodioSaliente()
    _urlEpisodioActual = _pendingEp.url
    _tituloActual = _pendingEp.titulo
    _pendingEp = null
    if (hls) { hls.destroy(); hls = null }
    const _vid = document.getElementById('player-video')
    // Soltar los handlers del episodio viejo ANTES de vaciar el src: vaciarlo
    // siempre dispara 'error', y el onerror viejo lo tomaba como una falla
    // real -- cerraba el reproductor, abría el selector y tachaba un servidor
    // que funcionaba, justo al pasar al siguiente episodio.
    if (_vid) { _vid.oncanplay = null; _vid.onerror = null; _vid.src = '' }
  }
  _idxActivo = idx
  if (window._chatUpdateFAB) window._chatUpdateFAB()
  spinnerShow(true)
  initCanvasControls()
  // Discord: mostrar episodio activo
  _discordSetEp(_tituloActual)

  // Llenar header
  const animeName = _tituloActual.split(' - Ep')[0].trim()
  const g = id => document.getElementById(id)
  if (g('rp-anime-nombre')) g('rp-anime-nombre').textContent = animeName
  if (g('rp-ep-nombre'))    g('rp-ep-nombre').textContent = _tituloActual
  if (g('rp-info-titulo'))  g('rp-info-titulo').textContent = animeName
  if (g('rp-fs-anime')) g('rp-fs-anime').textContent = animeName
  if (g('rp-fs-ep'))    g('rp-fs-ep').textContent = _tituloActual

  // Portada en shimmer hasta que llegue _animeActual
  const portadaEl = g('rp-info-portada')
  if (portadaEl) { portadaEl.removeAttribute('src'); portadaEl.classList.add('loading') }
  const _setInfoPanel = () => {
    if (_animeActual) {
      if (portadaEl && _animeActual.imagen) {
        const tmpImg = new Image()
        tmpImg.onload = () => { portadaEl.src = _animeActual.imagen; portadaEl.classList.remove('loading') }
        tmpImg.onerror = () => { portadaEl.classList.remove('loading') }
        tmpImg.src = _animeActual.imagen
      } else if (portadaEl) {
        portadaEl.classList.remove('loading')
      }
      if (g('rp-info-sinopsis')) g('rp-info-sinopsis').textContent = _animeActual.sinopsis || ''
      return true
    }
    return false
  }
  if (!_setInfoPanel()) {
    let _tries = 0
    const _poll = setInterval(() => {
      _tries++
      if (_setInfoPanel() || _tries > 16) clearInterval(_poll)
    }, 500)
  }

  // Media Session (controles PiP / notificaciones del SO)
  _actualizarMediaSession()

  // Episodios en col izquierda
  await poblarEpsPlayer()
  _actualizarProximoEp()

  const video = document.getElementById('player-video')
  if (hls) { hls.destroy(); hls = null }
  video.oncanplay = null; video.onerror = null  // ver comentario arriba
  video.src = ''
  // Pasar el stream ya obtenido para no pedirlo dos veces
  await reproducir(idx, false, resultado)
}



function _actualizarProximoEp() {
  if (!_animeActual?.episodios) return
  const eps = _animeActual.episodios
  const idxCur = eps.findIndex(e => e.link === _urlEpisodioActual)
  const next = eps[idxCur + 1]
  const prev = eps[idxCur - 1]
  const g = id => document.getElementById(id)

  // Meta info del episodio actual
  if (g('rp-info-season-ep')) g('rp-info-season-ep').textContent = `Episodio ${idxCur + 1} de ${eps.length}`
  if (g('rp-info-ep-name')) g('rp-info-ep-name').textContent = _tituloActual

  // Siguiente episodio
  const nextSection = g('rp-next-ep-section')
  if (nextSection) {
    if (next) {
      nextSection.style.display = ''
      if (g('rp-next-title')) g('rp-next-title').textContent = `Episodio ${next.num}`
      if (g('rp-next-sub')) g('rp-next-sub').textContent = _animeActual.titulo || ''
      const nextThumb = g('rp-next-thumb')
      const nextImg = next.imagen || _animeActual.imagen
      if (nextThumb && nextImg) {
        nextThumb.src = nextImg
        // Si la miniatura propia del episodio falla, caer a la portada del
        // anime en vez de ocultar la imagen directamente.
        nextThumb.onerror = () => {
          if (next.imagen && nextThumb.src !== _animeActual.imagen && _animeActual.imagen) {
            nextThumb.onerror = () => { nextThumb.style.display = 'none' }
            nextThumb.src = _animeActual.imagen
          } else {
            nextThumb.style.display = 'none'
          }
        }
      }
    } else {
      nextSection.style.display = 'none'
    }
  }

  // Episodio anterior
  const prevSection = g('rp-prev-ep-section')
  if (prevSection) {
    if (prev) {
      prevSection.style.display = ''
      if (g('rp-prev-title')) g('rp-prev-title').textContent = `Episodio ${prev.num}`
      if (g('rp-prev-sub')) g('rp-prev-sub').textContent = _animeActual.titulo || ''
      const prevThumb = g('rp-prev-thumb')
      const prevImg = prev.imagen || _animeActual.imagen
      if (prevThumb && prevImg) {
        prevThumb.src = prevImg
        prevThumb.onerror = () => {
          if (prev.imagen && prevThumb.src !== _animeActual.imagen && _animeActual.imagen) {
            prevThumb.onerror = () => { prevThumb.style.display = 'none' }
            prevThumb.src = _animeActual.imagen
          } else {
            prevThumb.style.display = 'none'
          }
        }
      }
    } else {
      prevSection.style.display = 'none'
    }
  }

  // Estado like/dislike
  _actualizarBotonesLike()
}

function irSiguienteEpisodio() {
  if (!_animeActual?.episodios) return
  const eps = _animeActual.episodios
  const idxCur = eps.findIndex(e => e.link === _urlEpisodioActual)
  const next = eps[idxCur + 1]
  if (next) pedirServidorEp(next.link, `${_animeActual.titulo} - Ep ${next.num}`)
}

function irEpisodioAnterior() {
  if (!_animeActual?.episodios) return
  const eps = _animeActual.episodios
  const idxCur = eps.findIndex(e => e.link === _urlEpisodioActual)
  const prev = eps[idxCur - 1]
  if (prev) pedirServidorEp(prev.link, `${_animeActual.titulo} - Ep ${prev.num}`)
}


function toggleRpLike() {
  if (!_urlEpisodioActual) return
  const key        = `ryoku_like_${_urlEpisodioActual}`
  const dislikeKey = `ryoku_dislike_${_urlEpisodioActual}`
  const current = localStorage.getItem(key) === '1'
  localStorage.setItem(key, current ? '0' : '1')
  if (!current) localStorage.setItem(dislikeKey, '0')
  _actualizarBotonesLike()
  _actualizarLikeEpDetalle(_urlEpisodioActual)
}

function toggleRpDislike() {
  if (!_urlEpisodioActual) return
  const key     = `ryoku_dislike_${_urlEpisodioActual}`
  const likeKey = `ryoku_like_${_urlEpisodioActual}`
  const current = localStorage.getItem(key) === '1'
  localStorage.setItem(key, current ? '0' : '1')
  if (!current) localStorage.setItem(likeKey, '0')
  _actualizarBotonesLike()
  _actualizarLikeEpDetalle(_urlEpisodioActual)
}

function _actualizarBotonesLike() {
  if (!_urlEpisodioActual) return
  const liked    = localStorage.getItem(`ryoku_like_${_urlEpisodioActual}`) === '1'
  const disliked = localStorage.getItem(`ryoku_dislike_${_urlEpisodioActual}`) === '1'
  document.getElementById('rp-btn-like')?.classList.toggle('activo', liked)
  document.getElementById('rp-btn-dislike')?.classList.toggle('activo-dislike', disliked)
}

// Actualiza el badge de like/dislike de un episodio en la lista de detalles
function _actualizarLikeEpDetalle(epLink) {
  const item = document.querySelector(`[data-ep-link="${_esc(epLink)}"]`)
  if (!item) return
  const liked    = localStorage.getItem(`ryoku_like_${epLink}`) === '1'
  const disliked = localStorage.getItem(`ryoku_dislike_${epLink}`) === '1'
  const estado = item.querySelector('.ep-estado')
  if (!estado) return
  // Remover badge previo si existe
  estado.querySelector('.ep-like-badge')?.remove()
  if (liked || disliked) {
    const badge = document.createElement('span')
    badge.className = 'ep-like-badge ' + (liked ? 'liked' : 'disliked')
    const path = liked
      ? 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z'
      : 'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z'
    badge.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="${path}"/></svg>`
    estado.prepend(badge)
  }
}

async function poblarEpsPlayer() {
  // Panel eliminado — función conservada por compatibilidad
  const container = document.getElementById('rp-eps-list')
  if (!container) return
  if (!_animeActual?.episodios) {
    let tries = 0
    await new Promise(resolve => {
      const poll = setInterval(() => {
        tries++
        if (_animeActual?.episodios || tries > 12) { clearInterval(poll); resolve() }
      }, 500)
    })
  }
  if (!_animeActual?.episodios) return
  const progresos = await window.api.getTodosProgresos()
  const historial = await window.api.getHistorial()
  const vistos = new Set(historial.map(h => h.link))

  container.innerHTML = _animeActual.episodios.map(ep => {
    const prog = progresos[ep.link]
    const visto = vistos.has(ep.link) && (prog?.porcentaje >= 95)
    const enProg = prog && prog.porcentaje > 5 && prog.porcentaje < 95
    const esActivo = ep.link === _urlEpisodioActual
    const cls = ['rp-ep-item', esActivo?'activo':'', visto?'visto':''].filter(Boolean).join(' ')
    const pct = prog ? Math.round(prog.porcentaje) : 0
    const subtituloText = enProg ? formatTime(prog.currentTime) : (visto ? 'Visto' : '')

    return `<div class="${cls}" onclick="pedirServidorEp('${ep.link}','${_esc(_animeActual.titulo||'')} - Ep ${ep.num}')">
      <div class="rp-ep-num-box">${visto ? '✓' : ep.num}</div>
      <div class="rp-ep-body">
        <div class="rp-ep-name">Episodio ${ep.num}</div>
        ${subtituloText ? `<div class="rp-ep-subtitle">${subtituloText}</div>` : ''}
        ${(enProg||visto) ? `<div class="rp-ep-bar"><div class="rp-ep-bar-fill" style="width:${visto?100:pct}%"></div></div>` : ''}
      </div>
      ${esActivo ? `<div class="rp-ep-playing"><span></span><span></span><span></span></div>` : ''}
    </div>`
  }).join('')

  setTimeout(() => {
    container.querySelector('.rp-ep-item.activo')?.scrollIntoView({ block:'center', behavior:'smooth' })
  }, 100)
}

// Guarda el avance del episodio que se está dejando ANTES de cambiar a otro
// desde el reproductor. Antes no se guardaba: se perdían hasta 15s (lo que
// tarda el guardado periódico) y, si se pasaba al siguiente durante los
// créditos, el anterior nunca quedaba como visto. Si se deja con 90% o más
// visto, se marca como completo (los créditos/preview suelen ser el ~5-10%).
async function _guardarProgresoEpisodioSaliente() {
  const v = document.getElementById('player-video')
  const link = _urlEpisodioActual
  if (!v || !link || !(v.duration > 0)) return
  const ct = (v.currentTime / v.duration) >= 0.90 ? v.duration : v.currentTime
  try { await window.api.setProgreso(link, ct, v.duration) } catch (e) {}
}

async function cambiarEpisodioPlayer(url, titulo) {
  _reproducirToken++  // cancela carga anterior
  await _guardarProgresoEpisodioSaliente()
  _urlEpisodioActual = url
  _tituloActual = titulo
  const g = id => document.getElementById(id)
  if (g('rp-ep-nombre')) g('rp-ep-nombre').textContent = titulo
  if (g('rp-info-ep-name')) g('rp-info-ep-name').textContent = titulo
  if (g('rp-vtitle-sub')) g('rp-vtitle-sub').textContent = titulo
  if (hls) { hls.destroy(); hls = null }
  const video = document.getElementById('player-video')
  video.src = ''
  spinnerShow(true)
  _servidores = await window.api.getServidores(url)
  _idxActivo = 0
  await poblarEpsPlayer()
  _actualizarProximoEp()
  await reproducir(0)
}



// _reanudarEn: segundo donde seguir (se usa al renovar el link de un video
// que se cortó a mitad del episodio, para no volver al principio).
async function reproducir(idx, renovar = false, _streamPreload = null, _yaRenovado = false, _reanudarEn = 0) {
  const s = _servidores[idx]
  if (!s) { spinnerShow(false); return }
  const miToken = ++_reproducirToken
  const cancelado = () => miToken !== _reproducirToken
  const video = document.getElementById('player-video')

  document.getElementById('rp-skip-intro')?.classList.remove('visible')
  const skipBtnReset = document.getElementById('rp-skip-intro')
  if (skipBtnReset) skipBtnReset._usado = false
  document.getElementById('toast-progreso')?.remove()
  document.getElementById('player-error-msg')?.remove()
  _toastContinuarDone = false
  const fill  = document.getElementById('player-progress-fill')
  const thumb = document.getElementById('player-progress-thumb')
  if (fill)  fill.style.width = '0%'
  if (thumb) thumb.style.left = '0%'
  document.getElementById('player-time-current').textContent = '0:00'
  drawPlayPauseCanvas(false, true)
  video.oncanplay = null
  video.onerror   = null

  if (renovar && window.api.clearStreamCache) await window.api.clearStreamCache(s.url)

  // Ocultar video hasta primer frame en mobile
  if (document.body.classList.contains('mobile-mode')) video.style.opacity = '0'

  const resultado = _streamPreload || await window.api.getStream(s.url)

  if (cancelado()) { spinnerShow(false); return }

  if (!resultado || !resultado.url) {
    if (window.api.clearStreamCache) await window.api.clearStreamCache(s.url)
    _volverASelectorTrasFallo(idx)
    return
  }

  // Para servidores que validan Referer (mp4upload, mixdrop), usar proxy local
  let url = resultado.url
  const _sNombre = (s.nombre || '').toLowerCase()
  if (_sNombre.includes('mp4upload') && window.api?.getProxyUrl) {
    try {
      url = await window.api.getProxyUrl(url, 'https://www.mp4upload.com/')
    } catch(e) {}
  } else if ((_sNombre.includes('mixdrop') || resultado.referer?.includes('mixdrop') ||
              (resultado.url || '').includes('mxcontent.net') || (resultado.url || '').includes('mxcdn.net')) && window.api?.getProxyUrl) {
    try {
      const ref = resultado.referer || 'https://mixdrop.ag/'
      url = await window.api.getProxyUrl(url, ref)
    } catch(e) {}
  } else if ((_sNombre.includes('dood') || (resultado.url || '').includes('cloudatacdn.com') ||
              (resultado.url || '').includes('dood.video') || (resultado.url || '').includes('doods.pro')) && window.api?.getProxyUrl) {
    try {
      const ref = resultado.referer || 'https://doodstream.com/'
      url = await window.api.getProxyUrl(url, ref)
    } catch(e) {}
  } else if (resultado.referer && window.api?.getProxyUrl) {
    // Cualquier otro extractor que haya devuelto su propio Referer (hexload,
    // dsvplay/ds2play con el dominio real de turno, futuros servidores) --
    // sin necesitar un branch a mano por cada nombre/dominio nuevo.
    try {
      url = await window.api.getProxyUrl(url, resultado.referer)
    } catch(e) {}
  }

  const _isMobilePlayer = document.body.classList.contains('mobile-mode')
  let _watchdogTimer = setTimeout(() => {
    _watchdogTimer = null
    if (cancelado()) return
    if (window.api.clearStreamCache) window.api.clearStreamCache(s.url)
    _volverASelectorTrasFallo(idx)
  }, 20000)
  const _limpiarWatchdog = () => { if (_watchdogTimer) { clearTimeout(_watchdogTimer); _watchdogTimer = null } }
  // 'canplay' se vuelve a disparar después de cada salto (seek) o corte de
  // buffer, no solo al arrancar. Antes onListo corría cada vez: si pausabas y
  // adelantabas, el video se reanudaba solo (video.play()), y además volvía a
  // escribir el historial y reiniciaba el guardado de progreso. Una sola vez.
  let _listoHecho = false
  const onListo = async () => {
    if (_listoHecho || cancelado()) return
    _listoHecho = true
    _limpiarWatchdog()
    // Recién acá se confirmó que el video arranca de verdad -- mostrar el
    // player (si todavía no estaba, p.ej. viniendo de elegirServidor) y
    // asegurar que el selector quede cerrado.
    document.getElementById('overlay-servidor')?.classList.remove('activo')
    document.getElementById('overlay-player')?.classList.add('activo')
    if (!_isMobilePlayer) spinnerShow(false) // desktop: ocultar en canplay
    // mobile: ocultar spinner y mostrar video cuando hay frame real (timeupdate)
    if (_isMobilePlayer) {
      var _onFirstFrame = function() {
        if (video.currentTime <= 0) return
        video.removeEventListener('timeupdate', _onFirstFrame)
        spinnerShow(false)
        video.style.opacity = '1'
      }
      video.addEventListener('timeupdate', _onFirstFrame)
    }
    if (window._friendsSetActivity) {
      const epPart = _tituloActual.split(' - Ep')[1]
      window._friendsSetActivity({ type: 'anime', title: _tituloActual.split(' - Ep')[0].trim(), episode: epPart ? epPart.trim() : '' })
    }
    const ahora = new Date()
    const _epImgActual = _animeActual?.episodios?.find(e => e.link === _urlEpisodioActual)?.imagen
    await window.api.addHistorial({
      anime: _tituloActual.split(' - Ep')[0].trim(),
      titulo: _tituloActual,
      link: _urlEpisodioActual || '',
      imagen: _epImgActual || _animeActual?.imagen || '',
      animeImagen: _animeActual?.imagen || '',
      fecha: ahora.toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })
    })
    if (video._progresoInterval) clearInterval(video._progresoInterval)
    video._progresoInterval = setInterval(() => {
      if (video.duration > 0 && _urlEpisodioActual && !video.paused)
        window.api.setProgreso(_urlEpisodioActual, video.currentTime, video.duration)
    }, 15000)
    if (_reanudarEn > 0) {
      // Link renovado tras un corte: seguir donde estaba, sin preguntar.
      try { if (Math.abs(video.currentTime - _reanudarEn) > 2) video.currentTime = _reanudarEn } catch (e) {}
      video.play().catch(() => {})
      return
    }
    const prog = await window.api.getProgreso(_urlEpisodioActual)
    if (prog && prog.currentTime > 10 && prog.porcentaje < 95) {
      const _tokenSnapshot = _reproducirToken
      const mostrarCuandoArranque = () => {
        video.removeEventListener('playing', mostrarCuandoArranque)
        if (_reproducirToken !== _tokenSnapshot) return  // episodio cambió, ignorar
        mostrarToastProgreso(prog.currentTime)
      }
      video.addEventListener('playing', mostrarCuandoArranque)
    }
    video.play().catch(() => {})
  }

  const _isMobile = document.body.classList.contains('mobile-mode')

  if (url.includes('.m3u8') && !_isMobile) {
    // PC: HLS.js (necesita MSE, respeta CORS)
    if (!Hls.isSupported()) { spinnerShow(false); return }
    if (hls) { hls.destroy(); hls = null }
    hls = new Hls(_reanudarEn > 0 ? { startPosition: _reanudarEn } : undefined)
    hls.loadSource(url)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, onListo)
    let _hlsRecoverAttempts = 0
    // Los 3 reintentos son por racha de errores, no por todo el episodio:
    // antes el contador nunca volvía a 0, así que con una conexión inestable
    // el 4to corte en un episodio largo (aunque los anteriores se hubieran
    // recuperado bien) te sacaba del reproductor.
    hls.on(Hls.Events.FRAG_BUFFERED, () => { _hlsRecoverAttempts = 0 })
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return
      if (cancelado()) return
      // Reintentar antes de rendirse — evita que un error de red/media a
      // mitad de reproducción deje el player congelado sin ningún aviso.
      if (_hlsRecoverAttempts < 3 && d.type === Hls.ErrorTypes.NETWORK_ERROR) {
        _hlsRecoverAttempts++
        hls.startLoad()
        return
      }
      if (_hlsRecoverAttempts < 3 && d.type === Hls.ErrorTypes.MEDIA_ERROR) {
        _hlsRecoverAttempts++
        hls.recoverMediaError()
        return
      }
      // Se agotaron los reintentos sobre la MISMA url. Con CDNs que firman la
      // url para un solo uso (visto con Lulu/luluvdo.com -- a veces funciona,
      // a veces tira 403 en pleno playback) reintentar la url vieja nunca
      // sirve: hay que reextraer para conseguir una firma nueva. Se hace UNA
      // sola vez (_yaRenovado) para no quedar en bucle si el server está
      // realmente caído.
      if (!_yaRenovado && resultado.referer) {
        _limpiarWatchdog()
        const _t = video.currentTime > 2 ? video.currentTime : 0
        if (_t && video.duration > 0 && _urlEpisodioActual) window.api.setProgreso(_urlEpisodioActual, _t, video.duration)
        hls.destroy(); hls = null
        reproducir(idx, true, null, true, _t)
        return
      }
      _limpiarWatchdog()
      if (window.api.clearStreamCache) window.api.clearStreamCache(s.url)
      _volverASelectorTrasFallo(idx)
    })
  } else {
    // Mobile: reproducción nativa del elemento <video> (Android soporta HLS
    // nativamente sin CORS, funciona para .m3u8 y .mp4)
    if (hls) { hls.destroy(); hls = null }
    video.src = url
    video.oncanplay = onListo
    video.onerror = () => {
      // cerrarReproductor() hace video.src = '' para liberar el elemento --
      // eso SIEMPRE dispara "error" (y resetea currentTime a 0 antes de que
      // se dispare, así que el chequeo de abajo no alcanza a filtrarlo). Sin
      // este chequeo, cerrar el player después de ver un episodio entero
      // (con Hexload por ejemplo) se interpretaba como una falla real del
      // servidor: reabría el selector y lo marcaba tachado, y como el
      // overlay del player ya se había cerrado, se veía como que "la lista
      // de servidores no cierra".
      if (cancelado()) return
      const _t = video.currentTime > 2 ? video.currentTime : 0
      if (_t && video.duration > 0 && _urlEpisodioActual) window.api.setProgreso(_urlEpisodioActual, _t, video.duration)
      if (!_yaRenovado && resultado.referer) {
        _limpiarWatchdog()
        reproducir(idx, true, null, true, _t)
        return
      }
      if (_t) {
        // Se cortó a mitad del episodio y no hay cómo renovar el link. Antes
        // esto se ignoraba y el video quedaba congelado sin ningún aviso.
        _mostrarErrorPlayer('Se cortó la conexión con este servidor. Cierra y elige otro: tu avance quedó guardado.')
        return
      }
      _limpiarWatchdog()
      if (window.api.clearStreamCache) window.api.clearStreamCache(s.url)
      _volverASelectorTrasFallo(idx)
    }
    video.load()
  }
}

// ─── CERRAR REPRODUCTOR ──────────────────────────────────────────────────
// ─── CERRAR REPRODUCTOR ──────────────────────────────────────────────────
async function _discordSetEp(titulo) {
  if (!window.api?.discordUpdate) return
  if (window._ryokuDiscordActivity === false) return
  // titulo = "Nombre Anime - Ep N"
  const parts = titulo ? titulo.split(' - Ep ') : []
  const animeName = parts[0]?.trim() || titulo || 'Anime'
  let epPart = parts[1] ? `Ep ${parts[1].trim()}` : ''
  // Fallback: extraer número de episodio del URL si el titulo no lo incluye
  if (!epPart && _urlEpisodioActual) {
    const m = _urlEpisodioActual.match(/[_-]ep(?:isodio)?[_-]?(\d+)/i) ||
              _urlEpisodioActual.match(/\/(\d+)\/?$/)
    if (m) epPart = `Ep ${m[1]}`
  }''
  // Fuente activa para mostrar en state
  const srcId  = await window.api?.getAnimeSource?.() || 'latanime'
  const srcMap = { latanime: 'Latanime', animeflv: 'AnimeFLV', animeav1: 'AnimeAV1' }
  const srcName = srcMap[srcId] || srcId
  const portada = _animeActual?.imagen || ''
  window.api.discordUpdate({
    details:        animeName,
    state:          epPart ? `${epPart} · ${srcName}` : srcName,
    startTime:      Date.now(),
    largeImageKey:  portada || undefined,
    largeImageText: animeName
  })
}

// Expone info del episodio/anime actual para compartir por chat
window._rpGetCurrentInfo = function () {
  if (!_tituloActual) return null
  var epMatch = _tituloActual.match(/[Ee]p(?:isodio)?\s*(\d+)/)
  return {
    animeTitle: _animeActual ? _animeActual.titulo : _tituloActual.split(' - Ep')[0].trim(),
    ep:         epMatch ? epMatch[1] : '',
    img:        _animeActual ? (_animeActual.imagen || '') : '',
    url:        _animeActual ? (_animeActual.url    || '') : ''
  }
}

// Guarda YA el avance del episodio que se está reproduciendo en este
// instante, sin cerrar el reproductor. Se usa antes de cerrar la app entera
// (ver sync.js / save-before-quit): el intervalo normal guarda cada 15s, así
// que cerrar la ventana en el peor momento podía perder hasta ~15s de avance
// que nunca llegaban a guardarse. Esto lo cubre.
window._rpFlushProgresoActual = async function () {
  const overlay = document.getElementById('overlay-player')
  if (!overlay || !overlay.classList.contains('activo')) return
  const video = document.getElementById('player-video')
  if (!video || !video.duration || !_urlEpisodioActual) return
  try {
    // No pisar un episodio que el usuario ya marcó como visto (100%) con el
    // tiempo real de reproducción, más bajo -- pasa si se marca "visto" a
    // mano mientras sigue reproduciéndose y se cierra la app sin cerrar
    // antes el reproductor: este flush corría igual y lo dejaba como no
    // visto de nuevo al volver a abrir la app.
    const previo = await window.api.getProgreso(_urlEpisodioActual)
    if (previo && previo.porcentaje >= 95) return
    await window.api.setProgreso(_urlEpisodioActual, video.currentTime, video.duration)
  } catch (e) {}
}

async function cerrarReproductor() {
  _reproducirToken++  // invalida cualquier reproducir() pendiente

  // Si estamos en fullscreen mobile, salir primero (restaura orientación y barras)
  if (document.body.classList.contains('mobile-mode')) {
    const fsShell = document.querySelector('.rp-shell')
    if (fsShell?.classList.contains('rp-mobile-fullscreen')) {
      if (typeof toggleFullscreenPlayer === 'function') toggleFullscreenPlayer()
    }
  }

  document.getElementById('overlay-player').classList.remove('activo')
  if (window._chatUpdateFAB) window._chatUpdateFAB()
  if (window._ryokuDiscordActivity !== false) window.api?.discordClear?.()
  if (window._friendsSetActivity) window._friendsSetActivity(null)
  const video = document.getElementById('player-video')
  const epUrl = _urlEpisodioActual
  const ct = video.currentTime, dur = video.duration
  // Lo que se muestra en la lista: set-progreso NO pisa un episodio ya
  // completado (>=95%) con un tiempo menor, así que si estaba visto hay que
  // mostrarlo visto -- antes se pintaba con el tiempo real de reproducción y
  // aparecía como "no visto" hasta volver a abrir el anime.
  let uiCt = ct, uiDur = dur
  if (dur > 0 && epUrl) {
    await window.api.setProgreso(epUrl, ct, dur)  // esperar antes de refrescar
    const guardado = await window.api.getProgreso(epUrl).catch(() => null)
    if (guardado && guardado.porcentaje >= 95) { uiCt = 1; uiDur = 1 }
  }
  if (video._progresoInterval) { clearInterval(video._progresoInterval); video._progresoInterval = null }
  video.oncanplay = null; video.onerror = null
  video.pause(); video.src = ''
  document.getElementById('player-error-msg')?.remove()
  if (hls) { hls.destroy(); hls = null }
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen()
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen()
  }
  // Actualizar barra de progreso del episodio en la lista de detalle (sin recrear el DOM)
  if (epUrl && dur > 0) _actualizarEpProgresoEnLista(epUrl, uiCt, uiDur)
  // Refrescar sección continuar viendo con el progreso actualizado
  cargarContinuarViendo()
  _recalcAlDiaAnime(_animeActual)
}

function _actualizarEpProgresoEnLista(link, currentTime, duration) {
  const item = document.querySelector(`.ep-item[data-ep-link="${CSS.escape(link)}"]`)
  if (!item) return
  const pct = Math.round((currentTime / duration) * 100)
  // Umbral sobre el porcentaje real (no el redondeado): 94.6% se redondea a
  // 95 pero lo guardado es 94.6 y al recargar la lista salía "no visto".
  const visto = (currentTime / duration) * 100 >= 95
  const enProg = pct > 5 && pct < 95
  const estado = item.querySelector('.ep-estado')
  if (!estado) return
  // Quitar barra anterior (mantener like/dislike badge)
  const badge = estado.querySelector('.ep-like-badge')
  const badgeHtml = badge ? badge.outerHTML : ''
  if (visto) {
    item.classList.add('visto')
    const btn = item.querySelector('.ep-toggle')
    if (btn) {
      btn.classList.add('visto')
      btn.title = 'Marcar como no visto'
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    }
    estado.innerHTML = badgeHtml
  } else if (enProg) {
    item.classList.remove('visto')
    estado.innerHTML = badgeHtml + `<div class="ep-prog">
      <div class="ep-prog-bar"><div class="ep-prog-fill" style="width:${pct}%"></div></div>
      <span class="ep-prog-pct">${formatTime(currentTime)}</span>
    </div>`
  }
}

document.getElementById('player-cerrar')?.addEventListener('click', cerrarReproductor)

// ─── CANVAS CONTROLES CENTRALES ──────────────────────────────────────────
function drawSkipCanvas(canvasId, isForward) {
  const c = document.getElementById(canvasId)
  if (!c) return
  const ctx = c.getContext('2d')
  const cx = 40, cy = 40, r = 26
  ctx.clearRect(0, 0, 80, 80)

  const _style   = getComputedStyle(document.documentElement)
  const _bg1     = _style.getPropertyValue('--bg-1').trim()         || '#0f172a'
  const _accent  = _style.getPropertyValue('--primary-glow').trim() || '#60a5fa'
  const _accentD = _style.getPropertyValue('--primary').trim()      || '#2563eb'

  ctx.beginPath()
  ctx.arc(cx, cy, 36, 0, Math.PI * 2)
  ctx.fillStyle = _bg1; ctx.globalAlpha = 0.82; ctx.fill(); ctx.globalAlpha = 1
  ctx.strokeStyle = _accent + '44'
  ctx.lineWidth = 1.5
  ctx.stroke()

  const gapHalf = (40 * Math.PI) / 180
  const top = -Math.PI / 2
  const arcStart = top + gapHalf
  const arcEnd   = top - gapHalf

  ctx.beginPath()
  ctx.strokeStyle = _accent
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  if (!isForward) {
    ctx.arc(cx, cy, r, arcStart, arcEnd, false)
  } else {
    ctx.arc(cx, cy, r, arcEnd, arcStart, true)
  }
  ctx.stroke()

  let tipAngle, tx, ty
  if (!isForward) {
    tipAngle = arcStart
    tx =  Math.sin(tipAngle)
    ty = -Math.cos(tipAngle)
  } else {
    tipAngle = arcEnd
    tx = -Math.sin(tipAngle)
    ty =  Math.cos(tipAngle)
  }

  const ax = cx + r * Math.cos(tipAngle)
  const ay = cy + r * Math.sin(tipAngle)
  const aLen = 7, aWid = 4.5
  const px = -ty, py = tx

  ctx.beginPath()
  ctx.fillStyle = _accent
  ctx.moveTo(ax + tx * aLen * 0.6,             ay + ty * aLen * 0.6)
  ctx.lineTo(ax - tx * aLen * 0.4 + px * aWid, ay - ty * aLen * 0.4 + py * aWid)
  ctx.lineTo(ax - tx * aLen * 0.4 - px * aWid, ay - ty * aLen * 0.4 - py * aWid)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = _accent
  ctx.font = 'bold 15px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('10', cx, cy + 3)
}

function drawPlayPauseCanvas(playing, loading = false) {
  const c = document.getElementById('c-play-pause')
  if (!c) return
  const ctx = c.getContext('2d')

  if (loading) {
    c._loading = true
    const t0 = c._t0 || (c._t0 = Date.now())
    const animate = () => {
      if (!c._loading) return
      const t = (Date.now() - t0) / 1000
      const style = getComputedStyle(document.documentElement)
      const accent  = style.getPropertyValue('--primary-glow').trim() || '#60a5fa'
      const accentD = style.getPropertyValue('--primary').trim()      || '#2563eb'
      const bg      = style.getPropertyValue('--bg-1').trim()         || '#0f172a'
      ctx.clearRect(0,0,80,80)
      ctx.beginPath(); ctx.arc(40,40,36,0,Math.PI*2)
      ctx.fillStyle=bg; ctx.globalAlpha=0.9; ctx.fill(); ctx.globalAlpha=1
      ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1.5; ctx.stroke()
      const a1 = t * Math.PI * 2 * 0.6
      ctx.beginPath(); ctx.arc(40,40,22,a1,a1+Math.PI*1.4)
      ctx.strokeStyle=accent; ctx.lineWidth=3; ctx.lineCap='round'; ctx.stroke()
      const a2 = -t * Math.PI * 2 * 0.4
      ctx.beginPath(); ctx.arc(40,40,14,a2,a2+Math.PI*1.0)
      ctx.strokeStyle=accentD; ctx.lineWidth=2; ctx.lineCap='round'; ctx.stroke()
      ctx.beginPath(); ctx.arc(40,40,4,0,Math.PI*2)
      ctx.fillStyle=accent; ctx.globalAlpha=0.5; ctx.fill(); ctx.globalAlpha=1
      requestAnimationFrame(animate)
    }
    animate()
    return
  }

  c._loading = false
  c._t0 = null
  ctx.clearRect(0,0,80,80)
  const _bg1 = getComputedStyle(document.documentElement).getPropertyValue('--bg-1').trim() || '#0f172a'
  ctx.beginPath(); ctx.arc(40,40,36,0,Math.PI*2)
  ctx.fillStyle=_bg1; ctx.globalAlpha=0.82; ctx.fill(); ctx.globalAlpha=1
  ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=2; ctx.stroke()
  const _ppAccent = getComputedStyle(document.documentElement).getPropertyValue('--primary-glow').trim() || '#60a5fa'
  ctx.fillStyle = _ppAccent
  ctx.shadowColor = _ppAccent; ctx.shadowBlur = 8
  if (playing) {
    ctx.beginPath(); ctx.roundRect(26,22,8,36,2); ctx.fill()
    ctx.beginPath(); ctx.roundRect(46,22,8,36,2); ctx.fill()
  } else {
    ctx.beginPath(); ctx.moveTo(30,22); ctx.lineTo(57,40); ctx.lineTo(30,58)
    ctx.closePath(); ctx.fill()
  }
  ctx.shadowBlur = 0
}

let _canvasControlsInited = false
function initCanvasControls() {
  drawSkipCanvas('c-skip-back', false)
  drawSkipCanvas('c-skip-fwd',  true)
  drawPlayPauseCanvas(false, true) // spinner desde el inicio
  // Ocultar barra superior en mobile (refuerzo JS al CSS)
  if (document.body.classList.contains('mobile-mode')) {
    var _titleFloat = document.querySelector('.rp-video-title-float')
    if (_titleFloat) _titleFloat.style.setProperty('display', 'none', 'important')
  }
  if (_canvasControlsInited) return
  _canvasControlsInited = true
  document.getElementById('c-play-pause').addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (video.paused) video.play(); else video.pause()
  })
  document.getElementById('c-play-pause').addEventListener('mousedown', (e) => {
    e.stopPropagation()
  })
}

// ─── CONTROLES VIDEO ──────────────────────────────────────────────────────
const video = document.getElementById('player-video')

function syncPlayBtns(playing) {
  drawPlayPauseCanvas(playing, false)
  const small = document.getElementById('rp-play-small')
  if (small) {
    small.querySelector('.icon-play-s').style.display  = playing ? 'none' : ''
    small.querySelector('.icon-pause-s').style.display = playing ? '' : 'none'
  }
}

video.addEventListener('click', (e) => {
  if (document.body.classList.contains('mobile-mode')) return
  if (e.target === video) { if (video.paused) video.play(); else video.pause() }
})

// Botón play/pause pequeño de la barra inferior
document.getElementById('rp-play-small')?.addEventListener('click', (e) => {
  e.stopPropagation()
  if (video.paused) video.play(); else video.pause()
})
video.addEventListener('play',    () => {
  syncPlayBtns(true)
  const wrap = document.getElementById('rp-video-wrap')
  wrap?.classList.remove('paused')
  // Al reanudar, si los controles ya estaban ocultos (se pausó y despausó
  // sin mover el mouse) el cursor debe volver a ocultarse -- si no, si el
  // usuario está sobre los controles, se deja como está.
  if (wrap && !wrap.classList.contains('show-controls') && typeof _cursorVisible === 'function') _cursorVisible(false)
})
video.addEventListener('pause',   () => {
  syncPlayBtns(false)
  document.getElementById('rp-video-wrap')?.classList.add('paused')
  // En pausa el cursor siempre debe verse (igual que el CSS ":not(.paused)")
  if (typeof _cursorVisible === 'function') _cursorVisible(true)
})
video.addEventListener('waiting', () => drawPlayPauseCanvas(false, true))
video.addEventListener('playing', () => drawPlayPauseCanvas(true,  false))
video.addEventListener('canplay', () => drawPlayPauseCanvas(!video.paused, false))

// Al terminar el episodio, marcarlo como visto de una -- antes dependía
// pura y exclusivamente de que el guardado periódico de progreso (cada 15s,
// ver _progresoInterval en reproducir()) hubiera alcanzado a caer lo
// bastante cerca del final como para pasar el umbral de 95% que usa
// "¿está visto?" en toda la app. Casi siempre alcanzaba, pero no siempre
// (si el intervalo cayó justo antes de un salto/skip, o el episodio duraba
// poco), y aunque alcanzara, el ✓ en la lista de episodios no aparecía
// hasta recargar esa lista. Con esto queda garantizado apenas termina.
video.addEventListener('ended', async () => {
  if (!_urlEpisodioActual || !video.duration) return
  const link = _urlEpisodioActual
  try { await window.api.setProgreso(link, video.duration, video.duration) } catch (e) {}
  const item = document.querySelector(`#eps-lista .ep-item[data-ep-link="${CSS.escape(link)}"]`)
  if (item && !item.classList.contains('visto')) {
    item.classList.add('visto')
    const btn = item.querySelector('.ep-toggle')
    if (btn) {
      btn.classList.add('visto')
      btn.title = 'Marcar como no visto'
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    }
    const estado = item.querySelector('.ep-estado')
    if (estado) estado.innerHTML = ''
  }
  if (typeof cargarContinuarViendo === 'function') cargarContinuarViendo()
  _recalcAlDiaAnime(_animeActual)
})

// Progreso — apuntar a los nuevos IDs del overlay flotante
video.addEventListener('timeupdate', () => {
  if (!video.duration) return
  const pct = (video.currentTime / video.duration) * 100
  // Barra del overlay flotante (modo normal)
  const fill  = document.getElementById('player-progress-fill')
  const thumb = document.getElementById('player-progress-thumb')
  if (fill)  fill.style.width = pct + '%'
  if (thumb) thumb.style.left = pct + '%'
  const tc = formatTime(video.currentTime)
  const tt = formatTime(video.duration)
  const cur = document.getElementById('player-time-current')
  const tot = document.getElementById('player-time-total')
  if (cur) cur.textContent = tc
  if (tot) tot.textContent = tt
  const skipBtn = document.getElementById('rp-skip-intro')
  if (skipBtn && !skipBtn._usado) {
    skipBtn.classList.add('visible')
    skipBtn.style.opacity = (videoWrap.classList.contains('show-controls') || video.paused) ? '1' : '0'
    skipBtn.style.pointerEvents = (videoWrap.classList.contains('show-controls') || video.paused) ? 'all' : 'none'
  }
  const epActivo = document.querySelector('.rp-ep-item.activo .rp-ep-bar-fill')
  if (epActivo) epActivo.style.width = pct + '%'
})

// Click barra progreso overlay — usar mousedown para mejor respuesta
const _progBg = document.getElementById('player-progress-bg')
let _scrubbing = false

function _scrubTo(e) {
  if (!video.duration) return
  const rect = _progBg.getBoundingClientRect()
  const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX
                : (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0].clientX
                : e.clientX
  const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  const t    = pct * video.duration
  const fill  = document.getElementById('player-progress-fill')
  const thumb = document.getElementById('player-progress-thumb')
  if (fill)  fill.style.width = (pct * 100) + '%'
  if (thumb) thumb.style.left = (pct * 100) + '%'
  document.getElementById('player-time-current').textContent = formatTime(t)
  video.currentTime = t
}

_progBg.addEventListener('mousedown', e => {
  e.stopPropagation()
  _toastContinuarDone = true
  if (_urlEpisodioActual) _toastDismissedEps.add(_urlEpisodioActual)
  document.getElementById('toast-progreso')?.remove()
  _scrubbing = true
  _progBg.style.transition = 'none'
  _progBg.style.transform = 'scaleY(1)'
  _scrubTo(e)
  _progBg.classList.add('scrubbing')
})
_progBg.addEventListener('touchstart', e => {
  e.stopPropagation()
  e.preventDefault()
  _toastContinuarDone = true
  if (_urlEpisodioActual) _toastDismissedEps.add(_urlEpisodioActual)
  document.getElementById('toast-progreso')?.remove()
  _scrubbing = true
  _progBg.style.transition = 'none'
  _progBg.style.transform = 'scaleY(1)'
  _scrubTo(e)
  _progBg.classList.add('scrubbing')
}, { passive: false })
document.addEventListener('mousemove', e => { if (_scrubbing) _scrubTo(e) })
document.addEventListener('touchmove', e => {
  if (_scrubbing) { e.preventDefault(); _scrubTo(e) }
}, { passive: false })
document.addEventListener('mouseup', e => {
  if (_scrubbing) {
    _scrubbing = false
    _progBg.classList.remove('scrubbing')
    // Warp squeeze: apretar y rebotar
    _progBg.style.transition = 'none'
    _progBg.style.transform = 'scaleY(0.25)'
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        _progBg.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)'
        _progBg.style.transform = 'scaleY(1)'
      })
    })
    _scrubTo(e)
  }
})
document.addEventListener('touchend', e => {
  if (_scrubbing) {
    _scrubbing = false
    _progBg.classList.remove('scrubbing')
    _progBg.style.transition = 'none'
    _progBg.style.transform = 'scaleY(0.25)'
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        _progBg.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)'
        _progBg.style.transform = 'scaleY(1)'
      })
    })
    _scrubTo(e)
  }
})
_progBg.addEventListener('click', e => { e.stopPropagation() })

// Preview al hover en la barra
document.getElementById('player-progress-bg').addEventListener('mousemove', e => {
  if (!video.duration) return
  const rect = e.currentTarget.getBoundingClientRect()
  const pct  = (e.clientX - rect.left) / rect.width
  const t    = pct * video.duration
  const preview = document.getElementById('rp-prog-preview')
  if (!preview) return
  preview.textContent = formatTime(t)
  preview.style.left  = (pct * 100) + '%'
})
document.getElementById('player-progress-bg').addEventListener('mouseleave', () => {
  const preview = document.getElementById('rp-prog-preview')
  if (preview) preview.style.display = 'none'
})
document.getElementById('player-progress-bg').addEventListener('mouseenter', () => {
  const preview = document.getElementById('rp-prog-preview')
  if (preview) preview.style.display = 'block'
})

// Volumen
const muteBtn = document.getElementById('player-mute')
const volInput = document.getElementById('player-vol')

function _actualizarVolIcon(vol, muted) {
  const iconOn    = document.getElementById('vol-icon-on')
  const iconOff   = document.getElementById('vol-icon-off')
  const waveSmall = document.getElementById('vol-wave-small')
  const waveBig   = document.getElementById('vol-wave-big')
  const volSlider = document.getElementById('player-vol')
  if (!iconOn || !iconOff) return
  const silencio = muted || vol === 0
  iconOn.style.display  = silencio ? 'none' : ''
  iconOff.style.display = silencio ? '' : 'none'
  if (!silencio && waveSmall && waveBig) {
    waveSmall.style.display = vol > 0    ? '' : 'none'
    waveBig.style.display   = vol >= 0.5 ? '' : 'none'
  }
  // Slider visual: 0 si mute, valor real si no
  if (volSlider) volSlider.value = silencio ? 0 : vol
}

muteBtn.addEventListener('click', () => {
  video.muted = !video.muted
  _actualizarVolIcon(video.volume, video.muted)
  _mostrarVolOSD(video.volume, video.muted)
})
volInput.addEventListener('input', e => {
  video.volume = parseFloat(e.target.value)
  if (video.muted && video.volume > 0) video.muted = false
  _actualizarVolIcon(video.volume, video.muted)
})
// Estado inicial del ícono
_actualizarVolIcon(video.volume, video.muted)

// Favorito en reproductor
async function toggleRpBookmark() {
  if (!_animeActual) return
  const favs = await window.api.toggleFav(_animeActual)
  const esFav = favs.some(f => f.url === _animeActual.url)
  _actualizarEstadoFav(esFav)
  cargarFavoritos()
}

function _actualizarEstadoFav(esFav) {
  // Botón bookmark en el player
  const bkBtn = document.getElementById('rp-btn-bookmark')
  if (bkBtn) bkBtn.classList.toggle('activo-bookmark', esFav)
  // Botón flotante en detalle
  const btnFav = document.getElementById('btn-fav')
  if (btnFav) {
    btnFav.classList.toggle('activo', esFav)
    const svg = btnFav.querySelector('svg')
    if (svg) { svg.style.fill = esFav ? '#e63946' : 'none'; svg.style.stroke = esFav ? '#e63946' : 'currentColor' }
  }
}

// ─── COMPLETADOS ANIME ────────────────────────────────────────────────────────
const _COMP_KEY = 'ryoku-completados-anime'

function _getCompletadosAnime() {
  try { return JSON.parse(localStorage.getItem(_COMP_KEY) || '[]') } catch { return [] }
}

function _actualizarEstadoCompletado(url) {
  const btn = document.getElementById('btn-completado')
  if (!btn) return
  const completado = _getCompletadosAnime().some(c => c.url === url)
  btn.classList.toggle('activo', completado)
  btn.title = completado ? 'Quitar de completados' : 'Marcar como completado'
}

window.toggleCompletado = async function () {
  if (!_animeActual) return
  const lista = _getCompletadosAnime()
  const idx   = lista.findIndex(c => c.url === _animeActual.url)
  if (idx > -1) {
    lista.splice(idx, 1)
  } else {
    lista.push({ url: _animeActual.url, titulo: _animeActual.titulo, imagen: _animeActual.imagen, fecha: Date.now() })
    // Marcar todos los episodios como vistos
    if (_animeActual.episodios?.length) {
      const iconSlash = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      const fechaStr = new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })
      await Promise.all(_animeActual.episodios.map(ep => {
        const tituloEp = `${_animeActual.titulo} - Ep ${ep.num}`
        return Promise.all([
          window.api.setProgreso(ep.link, 1000, 1000),
          window.api.addHistorial({ anime: _animeActual.titulo, titulo: tituloEp, link: ep.link, imagen: ep.imagen || _animeActual.imagen || '', animeImagen: _animeActual.imagen || '', fecha: fechaStr })
        ])
      }))
      // Actualizar DOM de la lista de episodios
      document.querySelectorAll('#eps-lista .ep-item').forEach(item => {
        item.classList.add('visto')
        const btn = item.querySelector('.ep-toggle')
        if (btn) { btn.classList.add('visto'); btn.title = 'Marcar como no visto'; btn.innerHTML = iconSlash }
        const estado = item.querySelector('.ep-estado')
        if (estado) estado.innerHTML = ''
      })
      if (typeof cargarContinuarViendo === 'function') cargarContinuarViendo()
    }
  }
  localStorage.setItem(_COMP_KEY, JSON.stringify(lista))
  _actualizarEstadoCompletado(_animeActual.url)
  _recalcAlDiaAnime(_animeActual)
}

function toggleFullscreenPlayer() {
  const shell = document.querySelector('.rp-shell')
  if (!shell) return

  if (document.body.classList.contains('mobile-mode')) {
    const vw = document.getElementById('rp-video-wrap')
    const vid = document.getElementById('player-video')
    const isFull = shell.classList.contains('rp-mobile-fullscreen')
    if (isFull) {
      // Salir fullscreen: restaurar estilos
      shell.classList.remove('rp-mobile-fullscreen')
      document.body.classList.remove('rp-fs-active')
      if (vw) vw.removeAttribute('style')
      if (vid) { vid.removeAttribute('style'); vid.style.opacity = '1' }
      if (window._nativeExtractor && window._nativeExtractor.exitFullscreen) {
        window._nativeExtractor.exitFullscreen()
      }
    } else {
      // Entrar fullscreen: inline styles directamente sobre el elemento
      shell.classList.add('rp-mobile-fullscreen')
      document.body.classList.add('rp-fs-active')
      if (vw) {
        vw.style.cssText = [
          'position:fixed',
          'top:0','left:0','right:0','bottom:0',
          'width:100vw','height:100vh',
          'aspect-ratio:unset',
          'z-index:99998',
          'background:#000'
        ].join('!important;') + '!important'
      }
      if (vid) {
        vid.style.cssText = [
          'position:absolute','top:0','left:0',
          'width:100%','height:100%',
          'object-fit:contain'
        ].join('!important;') + '!important'
      }
      if (window._nativeExtractor && window._nativeExtractor.enterFullscreen) {
        window._nativeExtractor.enterFullscreen()
      }
    }
    return
  }

  // PC: Fullscreen API normal
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen()
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen()
  } else {
    if (shell.requestFullscreen) shell.requestFullscreen()
    else if (shell.webkitRequestFullscreen) shell.webkitRequestFullscreen()
  }
}

function _actualizarMediaSession() {
  if (!navigator.mediaSession) return
  const animeName = _tituloActual.split(' - Ep')[0].trim()
  const artwork = _animeActual?.imagen
    ? [{ src: _animeActual.imagen, sizes: '512x512', type: 'image/jpeg' }]
    : []
  navigator.mediaSession.metadata = new MediaMetadata({
    title: _tituloActual || '—',
    artist: animeName,
    album: 'RYOKU',
    artwork
  })
  _setupMediaSessionHandlers()
}

function _setupMediaSessionHandlers() {
  if (!navigator.mediaSession) return
  const vid = document.getElementById('player-video')
  if (!vid) return

  navigator.mediaSession.setActionHandler('play', () => {
    vid.play().catch(() => {})
    syncPlayBtns(true)
  })
  navigator.mediaSession.setActionHandler('pause', () => {
    vid.pause()
    syncPlayBtns(false)
  })
  // ⏮/⏭ en el PiP = ±10 segundos (son los únicos botones visibles en Chromium)
  navigator.mediaSession.setActionHandler('previoustrack', () => skipSegundo(-10))
  navigator.mediaSession.setActionHandler('nexttrack',     () => skipSegundo(10))
  // Seek desde la barra de progreso del PiP
  try {
    navigator.mediaSession.setActionHandler('seekto', details => {
      if (details.seekTime != null) {
        vid.currentTime = details.seekTime
        _syncMediaSessionPosition()
      }
    })
  } catch (_) {}

  // Actualizar posición en la línea de tiempo del PiP
  vid.addEventListener('timeupdate', _syncMediaSessionPosition)
  vid.addEventListener('durationchange', _syncMediaSessionPosition)
}

function _syncMediaSessionPosition() {
  if (!navigator.mediaSession?.setPositionState) return
  const vid = document.getElementById('player-video')
  if (!vid || !vid.duration || isNaN(vid.duration)) return
  try {
    navigator.mediaSession.setPositionState({
      duration:     vid.duration,
      playbackRate: vid.playbackRate || 1,
      position:     Math.min(vid.currentTime, vid.duration)
    })
  } catch (_) {}
}

function togglePiP() {
  const vid = document.getElementById('player-video')
  if (!vid) return
  const btn = document.getElementById('rp-pip-btn')

  // Cerrar si ya está en PiP
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {})
    btn?.classList.remove('activo')
    return
  }

  // Abrir PiP — llamar directamente sin await previo para conservar el gesto del usuario
  vid.requestPictureInPicture()
    .then(() => {
      btn?.classList.add('activo')
      vid.addEventListener('leavepictureinpicture', () => {
        btn?.classList.remove('activo')
      }, { once: true })
    })
    .catch(e => console.warn('PiP no disponible:', e))
}

let _volOsdTimer = null
function _mostrarVolOSD(vol, muted) {
  const osd    = document.getElementById('rp-vol-osd')
  const fill   = document.getElementById('rp-vol-fill')
  const pct    = document.getElementById('rp-vol-pct')
  const waves  = document.getElementById('rp-vol-waves')
  const muteX  = document.getElementById('rp-vol-mute-x')
  if (!osd) return
  const silencio = muted || vol === 0
  const p = silencio ? 0 : Math.round(vol * 100)
  fill.style.width = `${p}%`
  pct.textContent = `${p}%`
  if (waves) waves.setAttribute('d', silencio ? '' : p < 50 ? 'M15.54 8.46a5 5 0 0 1 0 7.07' : 'M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14')
  if (muteX) muteX.style.display = silencio ? '' : 'none'
  // Solo mostrar si los controles están ocultos
  const wrap = document.getElementById('rp-video-wrap')
  if (wrap?.classList.contains('show-controls')) {
    osd.classList.remove('visible')
    clearTimeout(_volOsdTimer)
    return
  }
  osd.classList.add('visible')
  clearTimeout(_volOsdTimer)
  _volOsdTimer = setTimeout(() => osd.classList.remove('visible'), 1500)
}

function setSpeed(s) {
  video.playbackRate = s
  document.getElementById('rp-speed-label').textContent = s + 'x'
  document.querySelectorAll('#rp-speed-dropdown .rp-dd-item').forEach(el => {
    el.classList.toggle('rp-dd-active', parseFloat(el.textContent) === s)
  })
  document.getElementById('rp-speed-dropdown').classList.remove('visible')
}


function toggleSpeedDropdown() {
  document.getElementById('rp-speed-dropdown').classList.toggle('visible')
}
document.addEventListener('click', e => {
  if (!e.target.closest('#rp-speed-btn')) {
    document.getElementById('rp-speed-dropdown')?.classList.remove('visible')
  }
})

function saltarOpening() {
  if (!video.duration) return  // evita currentTime = NaN si aun no cargo metadata
  video.currentTime = Math.min(video.currentTime + 85, video.duration)
  const skipBtn = document.getElementById('rp-skip-intro')
  if (skipBtn) {
    skipBtn.classList.remove('visible')
    skipBtn.style.opacity = '0'
    skipBtn.style.pointerEvents = 'none'
    skipBtn._usado = true
  }
}
function skipSegundo(s) {
  if (!video.duration) return  // evita currentTime = NaN si aun no cargo metadata
  _toastContinuarDone = true
  if (_urlEpisodioActual) _toastDismissedEps.add(_urlEpisodioActual)
  document.getElementById('toast-progreso')?.remove()
  video.currentTime = Math.max(0, Math.min(video.currentTime + s, video.duration))
}

function mostrarToastProgreso(currentTime) {
  if (_toastDismissedEps.has(_urlEpisodioActual)) return
  if (_toastContinuarDone) return
  document.getElementById('toast-progreso')?.remove()
  const DURACION = 10000
  const toast = document.createElement('div')
  toast.id = 'toast-progreso'
  toast.innerHTML = `
    <div style="position:absolute;top:0;left:0;height:3px;border-radius:8px 8px 0 0;background:var(--primary);width:100%;transition:width linear" id="toast-bar"></div>
    <span style="flex:1">Continuar desde <b>${formatTime(currentTime)}</b></span>
    <button id="toast-continuar" style="background:var(--primary);color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;font-family:Inter,sans-serif;cursor:pointer;white-space:nowrap;font-weight:600">Continuar</button>
  `
  toast.style.cssText = `
    position:absolute; bottom:90px; left:20px; z-index:25;
    background:var(--bg-2,rgba(15,23,42,0.95)); border:1px solid var(--border,rgba(255,255,255,0.15));
    border-radius:8px; padding:12px 16px; display:flex; align-items:center; gap:12px;
    font-family:Inter,sans-serif; font-size:13px; color:var(--text-1,white);
    animation:fadeInUp 0.25s ease; min-width:320px; overflow:hidden;
    transition:opacity 0.25s, pointer-events 0s;
  `
  document.getElementById('rp-video-wrap').appendChild(toast)

  // Barra de cuenta regresiva
  const bar = document.getElementById('toast-bar')
  requestAnimationFrame(() => {
    bar.style.transition = `width ${DURACION}ms linear`
    bar.style.width = '0%'
  })

  const t = setTimeout(() => { _toastContinuarDone = true; toast.remove() }, DURACION)

  document.getElementById('toast-continuar').onclick = () => {
    clearTimeout(t)
    _toastContinuarDone = true
    _toastDismissedEps.add(_urlEpisodioActual)
    video.currentTime = currentTime
    video.play().catch(()=>{})
    toast.remove()
    // Ocultar "Saltar Intro" al continuar
    const skipBtn = document.getElementById('rp-skip-intro')
    if (skipBtn) {
      skipBtn.classList.remove('visible')
      skipBtn.style.opacity = '0'
      skipBtn.style.pointerEvents = 'none'
      skipBtn._usado = true
    }
  }
}
function formatTime(s) {
  if (isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2,'0')}`
}

// ─── CONTROLES FLOTANTES — aparecen con mouse, desaparecen solos ─────────
let _ctrlTimer = null
const videoWrap = document.getElementById('rp-video-wrap')
const rpShell   = document.querySelector('.rp-shell')

function syncSkipIntro() {
  const skipBtn = document.getElementById('rp-skip-intro')
  if (!skipBtn || skipBtn._usado) return
  const mostrar = videoWrap.classList.contains('show-controls') || video.paused
  skipBtn.style.opacity = mostrar ? '1' : '0'
  skipBtn.style.pointerEvents = mostrar ? 'all' : 'none'
}

// El CSS ya oculta el cursor vía ".rp-video-area:not(.show-controls):not(.paused)"
// pero eso depende de que ningún estilo inline/otra regla gane la cascada --
// se fija explícitamente por JS acá para que apagar/prender los controles
// SIEMPRE controle el cursor de verdad, sin depender de la cascada de CSS.
// Además, en los temas con cursor personalizado (Miku/Neru/Berserker) el
// cursor NATIVO ya está en cursor:none permanentemente y lo que se ve es un
// sprite propio (#miku-cursor-fx y similares) que solo se oculta con
// mouseleave -- nunca por inactividad. Sin esto, ese sprite se queda
// pegado en pantalla aunque los controles del reproductor ya se hayan
// ocultado. No hace falta "reponerlo" al mostrar: el próximo mousemove
// real (el mismo que reabre los controles) ya lo vuelve a mostrar solo.
function _cursorVisible(visible) {
  videoWrap.style.cursor = visible ? '' : 'none'
  if (!visible && typeof window._cursorTematicoOcultar === 'function') window._cursorTematicoOcultar()
}

function showControls(e) {
  // No disparar si el mouse viene de la topbar o de los paneles laterales
  if (e) {
    const rect = videoWrap.getBoundingClientRect()
    const fromTop = e.clientY - rect.top
    if (fromTop < 8) return // margen superior — viene del topbar
  }
  videoWrap.classList.add('show-controls')
  _cursorVisible(true)
  clearTimeout(_ctrlTimer)
  syncSkipIntro()
  const toast = document.getElementById('toast-progreso')
  if (toast && !_toastContinuarDone) { toast.style.opacity = '1'; toast.style.pointerEvents = '' }
  if (!_mouseOverControls) {
    _ctrlTimer = setTimeout(() => {
      if (!video.paused) {
        videoWrap.classList.remove('show-controls')
        _cursorVisible(false)
        syncSkipIntro()
      }
    }, 3000)
  }
}

function hideControls() {
  clearTimeout(_ctrlTimer)
  if (!video.paused) {
    videoWrap.classList.remove('show-controls')
    _cursorVisible(false)
    syncSkipIntro()
  }
}

// Bloquear overscroll (estiramiento) de Android en fullscreen
videoWrap.addEventListener('touchmove', function(e) {
  const shell = document.querySelector('.rp-shell')
  if (shell && shell.classList.contains('rp-mobile-fullscreen') && !_scrubbing) {
    e.preventDefault()
  }
}, { passive: false })

videoWrap.addEventListener('mousemove', showControls)

// Mobile: tap muestra/oculta controles sin pausar
videoWrap.addEventListener('touchend', function(e) {
  if (!document.body.classList.contains('mobile-mode')) return
  var t = e.target
  if (t.tagName === 'CANVAS' || t.closest('button') || t.closest('.rp-vc-btns') || t.closest('.rp-vc-progress')) return
  e.preventDefault()
  if (videoWrap.classList.contains('show-controls')) {
    hideControls()
  } else {
    showControls(null)
  }
}, false)
videoWrap.addEventListener('mouseenter', e => {
  const rect = videoWrap.getBoundingClientRect()
  if (e.clientY - rect.top < 20) return
  showControls(e)
})
videoWrap.addEventListener('mouseleave', e => {
  // Si sale por la parte superior (va al topbar) no ocultar con delay, ocultar inmediato
  const rect = videoWrap.getBoundingClientRect()
  if (e.clientY < rect.top + 10) {
    clearTimeout(_ctrlTimer)
    if (!video.paused) {
      videoWrap.classList.remove('show-controls')
      _cursorVisible(false)
      syncSkipIntro()
    }
    return
  }
  hideControls()
})

// Mantener controles visibles mientras el mouse esté encima de ellos
let _mouseOverControls = false
;['rp-video-controls', 'rp-video-title-float'].forEach(id => {
  const el = document.getElementById(id) || document.querySelector('.' + id)
  if (!el) return
  el.addEventListener('mouseenter', () => {
    _mouseOverControls = true
    clearTimeout(_ctrlTimer)
    videoWrap.classList.add('show-controls')
    _cursorVisible(true)
  })
  el.addEventListener('mouseleave', () => {
    _mouseOverControls = false
    clearTimeout(_ctrlTimer)
    if (!video.paused) {
      _ctrlTimer = setTimeout(() => {
        videoWrap.classList.remove('show-controls')
        _cursorVisible(false)
        syncSkipIntro()
      }, 2000)
    }
  })
})

// Fullscreen — solo ocultar/mostrar columnas laterales
function onFullscreenChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement)
  rpShell.classList.toggle('fs-active', isFs)
}
document.addEventListener('fullscreenchange', onFullscreenChange)
document.addEventListener('webkitfullscreenchange', onFullscreenChange)






function imgErrorCal(img) {
  const wrap = img.parentElement
  if (!wrap) return
  const letra = wrap.dataset.letra || '?'
  wrap.innerHTML = `<div class="cal-card-img-placeholder">${letra}</div>`
}

// Slugs +18 conocidos de latanime (misma lista que main.js)


// Formatea un conteo real (miembros/favoritos de MAL) estilo "572k"
function _formatCount(n) {
  if (!n) return ''
  if (n >= 1000000) return (n/1000000).toFixed(1).replace(/\.0$/,'') + 'M'
  if (n >= 1000) return Math.round(n/1000) + 'k'
  return String(n)
}

// Pinta el panel "Top de la semana" con la lista dada (ya en el orden final)
function _renderTopSemana(topSeries) {
  const topList = document.getElementById('home-top-list')
  if (!topList) return
  if (!topSeries.length) { topList.innerHTML = '<div class="loading">Sin datos.</div>'; return }
  topList.innerHTML = topSeries.map((s, idx) => {
    const stat = s._malMiembros
      ? `<div class="home-top-stat">${_formatCount(s._malMiembros)}</div>`
      : (s.rating ? `<div class="home-top-stat">★ ${s.rating}</div>` : '')
    return `<div class="home-top-item" onclick="abrirAnime('${s.link}','${_esc(s.titulo)}')">
      <span class="home-top-rank">${idx+1}</span>
      <div class="home-top-media">
        <img class="home-top-bg" src="${s.imagen||''}" onerror="_ryokuImgHideOnFail(this)" />
        <div class="home-top-overlay"></div>
        <div class="home-top-info">
          <div class="home-top-title">${s.titulo}</div>
          ${stat}
        </div>
        ${s.idioma ? `<div class="home-top-studio">${s.idioma}</div>` : ''}
      </div>
    </div>`
  }).join('')
}

// Pinta el panel "Top de la semana" con el ranking REAL de MyAnimeList/AniList
// cruzado contra el catálogo del sitio activo, para que cada fila abra
// contenido real y reproducible — en vez del orden arbitrario de "recién
// agregados". Se dispara sin esperar (fire-and-forget) desde cargarRecientes,
// así que no atrasa la animación de entrada del resto de la página; mientras
// tanto el panel se queda en "Cargando" (nunca pinta el orden local primero
// para no mostrar, ni por un momento, algo que no es el ranking real).
// seriesCandidatas es solo el respaldo por si la fuente real falla del todo.
async function _cargarTopSemanaReal(seriesCandidatas) {
  if (!window.api?.getTopSemanaReal) { _renderTopSemana(seriesCandidatas.slice(0, 5)); return }
  let real = []
  try {
    real = await window.api.getTopSemanaReal()
  } catch(e) {
    console.error('[TopSemana] error llamando a getTopSemanaReal:', e)
  }
  if (!real || !real.length) { _renderTopSemana(seriesCandidatas.slice(0, 5)); return } // respaldo: la fuente real falló
  const mapeado = real.map(r => ({
    titulo: r.titulo, link: r.link, imagen: r.imagen, idioma: r.idioma,
    _malMiembros: r.malMembers || 0, _malScore: r.malScore || 0
  }))
  // Fundido: pasa de "Cargando..." al contenido real sin un pop seco.
  const topList = document.getElementById('home-top-list')
  if (topList) {
    topList.style.opacity = '0'
    await new Promise(r => setTimeout(r, 220))
    _renderTopSemana(mapeado.slice(0, 5))
    requestAnimationFrame(() => { topList.style.opacity = '1' })
  } else {
    _renderTopSemana(mapeado.slice(0, 5))
  }
}

// Enriquecer tarjetas con MAL en background — actualiza DOM una a una
async function _enriquecerEnBackground(lista, contenedorId) {
  if (!window.api?.enriquecerAnime) return
  // Limitar a los primeros 20 items (lo visible en pantalla) para no saturar la API
  for (const r of lista.slice(0, 20)) {
    try {
      const mal = await window.api.enriquecerAnime(r.titulo)
      if (!mal) continue
      const esAdultoMal = mal.generos?.includes('Hentai') || mal.rating === 'Rx'
      // Buscar tarjeta por link en el contenedor
      const contenedor = document.getElementById(contenedorId)
      if (!contenedor) break
      // Buscar por data-link exacto, luego por slug parcial como fallback
      const linkExacto = r.link || ''
      const slug = linkExacto.split('/').pop() || ''
      let tarjeta = linkExacto
        ? contenedor.querySelector(`.tarjeta[data-link="${CSS.escape(linkExacto)}"]`)
        : null
      // Fallback: buscar por slug en onclick (legacy) o data-link parcial
      if (!tarjeta && slug) {
        tarjeta = contenedor.querySelector(`.tarjeta[data-link*="${slug}"]`) ||
                  contenedor.querySelector(`.tarjeta[onclick*="${slug}"]`)
      }
      if (!tarjeta) continue
      // Guardar datos MAL en la tarjeta para detección futura
      if (mal.generos) tarjeta.dataset.malGeneros = mal.generos.join(',')
      if (mal.rating)  tarjeta.dataset.malRating  = mal.rating
      // Si MAL dice hentai y +18 está OFF → quitar tarjeta
      if (esAdultoMal && !_app18) { tarjeta.remove(); continue }
      // Añadir badge +18 si es adulto por MAL
      if (esAdultoMal && !tarjeta.querySelector('.badge-18')) {
        tarjeta.classList.add('tarjeta-adulto')
        const badge = document.createElement('span')
        badge.className = 'badge-18'; badge.textContent = '+18'
        tarjeta.prepend(badge)
      }
      // Añadir score MAL
      const metaEl = tarjeta.querySelector('.tarjeta-meta')
      if (metaEl && mal.score && !metaEl.querySelector('.tarjeta-score')) {
        const s = document.createElement('span')
        s.className = 'tarjeta-score'; s.textContent = `★ ${mal.score}`
        metaEl.appendChild(s)
      }
      // Añadir géneros MAL
      const infoEl = tarjeta.querySelector('.tarjeta-info')
      if (infoEl && mal.generos?.length && !infoEl.querySelector('.tarjeta-generos')) {
        const gDiv = document.createElement('div')
        gDiv.className = 'tarjeta-generos'
        gDiv.innerHTML = mal.generos.slice(0,2).map(g => `<span class="tarjeta-genero">${g}</span>`).join('')
        infoEl.appendChild(gDiv)
      }
    } catch(e) { /* continuar */ }
  }
}

function renderTarjeta(r) {
  const letra    = r.titulo.charAt(0)
  const esAdulto = r.adulto || _esAdulto(r)
  const imgHtml  = r.imagen
    ? `<img src="${r.imagen}" onload="imgLoaded(this)" onerror="imgError(this)" />`
    : `<div class="tarjeta-thumb"><div class="tarjeta-letra">${letra}</div></div>`

  // Categoría de latanime
  const cat = r.categoria || ''
  const catClass = cat.toLowerCase().includes('sin censura') ? 'cat-adulto'
    : cat.toLowerCase().includes('castellano') ? 'cat-cast'
    : cat.toLowerCase().includes('pelicula') || cat.toLowerCase().includes('película') ? 'cat-peli'
    : cat.toLowerCase().includes('ova') ? 'cat-ova'
    : cat.toLowerCase().includes('donghua') ? 'cat-dong'
    : 'cat-lat'
  const catBadge = cat ? `<span class="tarjeta-cat ${catClass}">${cat}</span>` : ''

  // Géneros de MAL (máx 2)
  const generosBadges = (r.malGeneros || []).slice(0, 2)
    .map(g => `<span class="tarjeta-genero">${g}</span>`).join('')

  // Score MAL
  const scoreBadge = r.malScore ? `<span class="tarjeta-score">★ ${r.malScore}</span>` : ''

  // Año
  const anio = r.anio ? `<span class="tarjeta-anio">${r.anio}</span>` : ''

  // Badge +18
  const badge18 = esAdulto ? `<span class="badge-18">+18</span>` : ''

  return `<div class="tarjeta${esAdulto ? ' tarjeta-adulto' : ''}"
    data-link="${r.link.replace(/"/g,'&quot;')}"
    data-titulo="${r.titulo.replace(/"/g,'&quot;')}">
    <div class="play-overlay">▶</div>
    ${badge18}
    <div class="tarjeta-img-wrap${esAdulto ? ' adulto-img' : ''}${r.imagen ? '' : ' loaded'}" data-letra="${letra}">${imgHtml}</div>
    <div class="tarjeta-info">
      <div class="tarjeta-titulo">${r.titulo}</div>
      <div class="tarjeta-meta">${catBadge}${anio}${scoreBadge}</div>
      ${generosBadges ? `<div class="tarjeta-generos">${generosBadges}</div>` : ''}
    </div>
  </div>`
}

// Auto-retry en el arranque: si falla la primera vez, reintenta después de 1.5s
cargarRecientes().catch(() => setTimeout(() => cargarRecientes(), 1500))


// ─── MÓDULO ANIME BIBLIOTECA ──────────────────────────────────────────────
let _animeBibPag      = 1
let _animeBibQuery    = ''
let _animeBibCat      = ''
let _animeBibGenero   = ''
let _animeBibEmision  = false
let _animeBibCargando = false

function abrirAnimeBiblioteca(query = '') {
  _animeBibPag = 1; _animeBibQuery = query; _animeBibCat = ''; _animeBibGenero = ''
  _animeBibEmision = false; _animeBibCargando = false
  navegar('anime-biblioteca')
  _animeBibSyncUI()
  _animeBibResetUI()
  _animeBibCargar()
}

function _animeBibResetUI() {
  const grilla  = document.getElementById('grilla-anime-biblioteca')
  const footer  = document.getElementById('anime-bib-footer')
  const countEl = document.getElementById('anime-bib-count')
  const pagLbl  = document.getElementById('anime-bib-pag-label')
  if (grilla)  grilla.innerHTML = '<div class="mn-loading"><div class="mn-spinner"></div><span>Cargando...</span></div>'
  if (footer)  footer.style.display = 'none'
  if (countEl) countEl.textContent = ''
  if (pagLbl)  pagLbl.textContent = `Página ${_animeBibPag}`
}

function _animeBibSyncUI() {
  const input  = document.getElementById('anime-bib-input')
  const titulo = document.getElementById('anime-bib-titulo')
  const emBtn  = document.getElementById('anime-bib-emision-btn')
  if (input)  input.value = _animeBibQuery
  if (titulo) titulo.textContent = _animeBibQuery ? `Resultados: ${_animeBibQuery}` : 'Biblioteca'
  if (emBtn)  emBtn.classList.toggle('activo', _animeBibEmision)

  // Categoría
  document.querySelectorAll('#anime-drop-cat-panel [data-cat]').forEach(b =>
    b.classList.toggle('activo', b.dataset.cat === _animeBibCat)
  )
  const catVal = document.getElementById('anime-drop-cat-val')
  if (catVal) catVal.textContent = _animeBibCat || 'Todo'
  document.getElementById('anime-drop-cat')?.classList.toggle('has-filter', !!_animeBibCat)

  // Género
  document.querySelectorAll('#anime-drop-genero-panel [data-gen]').forEach(b =>
    b.classList.toggle('activo', b.dataset.gen === _animeBibGenero)
  )
  const genVal = document.getElementById('anime-drop-genero-val')
  if (genVal) genVal.textContent = _animeBibGenero
    ? (document.querySelector(`#anime-drop-genero-panel [data-gen="${_animeBibGenero}"]`)?.textContent?.trim() || 'Todo')
    : 'Todo'
  document.getElementById('anime-drop-genero')?.classList.toggle('has-filter', !!_animeBibGenero)
}

async function _animeBibCargar() {
  if (_animeBibCargando) return
  _animeBibCargando = true
  const btnPrev = document.getElementById('anime-bib-btn-prev')
  const btnNext = document.getElementById('anime-bib-btn-next')
  const pagLbl  = document.getElementById('anime-bib-pag-label')
  const footer  = document.getElementById('anime-bib-footer')
  const grilla  = document.getElementById('grilla-anime-biblioteca')
  const countEl = document.getElementById('anime-bib-count')
  if (btnPrev) btnPrev.disabled = true
  if (btnNext) btnNext.disabled = true

  try {
    const result = await window.api.getAnimeBiblioteca({
      query:     _animeBibQuery,
      categoria: _animeBibCat,
      genero:    _animeBibGenero,
      emision:   _animeBibEmision,
      page:      _animeBibPag
    })

    const lista  = result?.lista  || []
    const hayMas = result?.hayMas || false

    if (!lista.length) {
      if (grilla)  grilla.innerHTML = '<div class="mn-loading" style="color:var(--text-muted)">Sin resultados.</div>'
      if (footer)  footer.style.display = _animeBibPag > 1 ? '' : 'none'
      if (btnPrev) btnPrev.disabled = _animeBibPag <= 1
      if (btnNext) btnNext.disabled = true
      if (pagLbl)  pagLbl.textContent = `Página ${_animeBibPag}`
      return
    }

    if (grilla) {
      grilla.innerHTML = _filtrarLista(lista)
        .map(r => renderTarjeta({...r, adulto: r.adulto || _esAdulto(r)}))
        .join('')
      // Sin este llamado, las portadas que nunca disparan load NI error (pasa
      // con algunos hosts de imágenes de MonosChinos) se quedaban con el
      // shimmer animando para siempre -- en una captura se ve como un cuadro
      // negro/oscuro fijo, sin la letra de fallback ni la portada real.
      checkLoadedImgs(grilla)
      _enriquecerEnBackground(_filtrarLista(lista), 'grilla-anime-biblioteca')
    }

    if (countEl) countEl.textContent = `${lista.length} animes`
    if (pagLbl)  pagLbl.textContent  = `Página ${_animeBibPag}`
    if (btnPrev) btnPrev.disabled = _animeBibPag <= 1
    if (btnNext) btnNext.disabled = !hayMas
    if (footer)  footer.style.display = (_animeBibPag > 1 || hayMas) ? '' : 'none'

  } catch(e) {
    console.error('[_animeBibCargar]', e.message)
    if (grilla) grilla.innerHTML = '<div class="mn-loading" style="color:var(--text-muted)">Error al cargar. <button onclick="_animeBibCargar()" style="margin-left:8px;padding:4px 12px;border-radius:6px;background:var(--primary);color:white;border:none;cursor:pointer;font-size:11px">🔄 Reintentar</button></div>'
  } finally {
    _animeBibCargando = false
  }
}

function animeBibBuscar() {
  _animeBibQuery = document.getElementById('anime-bib-input')?.value.trim() || ''
  _animeBibPag = 1; _animeBibSyncUI(); _animeBibResetUI(); _animeBibCargar()
}

// Buscar por género en la biblioteca de anime
async function animeBibGenero(genero) {
  // Marcar pill activa
  document.querySelectorAll('#anime-genre-pills .genre-pill').forEach(p => p.classList.remove('activo'))
  document.querySelector(`#anime-genre-pills .genre-pill[onclick*="${genero}"]`)?.classList.add('activo')
  // Limpiar búsqueda y cargar por género
  _animeBibQuery = ''; _animeBibCat = ''; _animeBibEmision = false; _animeBibPag = 1
  _animeBibSyncUI()
  const grilla  = document.getElementById('grilla-anime-biblioteca')
  const footer  = document.getElementById('anime-bib-footer')
  const titulo  = document.getElementById('anime-bib-titulo')
  if (grilla)  grilla.innerHTML = '<div class="mn-loading"><div class="mn-spinner"></div><span>Cargando...</span></div>'
  if (footer)  footer.style.display = 'none'
  if (titulo)  titulo.textContent = genero.charAt(0).toUpperCase() + genero.slice(1)
  const lista = await window.api.buscar('', { genero })
  if (!lista?.length) { if (grilla) grilla.innerHTML = '<div class="mn-loading" style="color:var(--text-muted)">Sin resultados.</div>'; return }
  if (grilla) {
    grilla.innerHTML = _filtrarLista(lista).map(r => renderTarjeta({...r, adulto: r.adulto || _esAdulto(r)})).join('')
    checkLoadedImgs(grilla)
  }
}
function animeBibAplicarOrden() {
  const v = document.getElementById('anime-bib-orden')?.value || ''
  _animeBibEmision = v === 'emision'
  _animeBibPag = 1; _animeBibSyncUI(); _animeBibResetUI(); _animeBibCargar()
}
function animeBibToggleEmision() {
  _animeBibEmision = !_animeBibEmision
  _animeBibPag = 1; _animeBibSyncUI(); _animeBibResetUI(); _animeBibCargar()
}
function animeBibSetCat(btnEl) {
  _animeBibCat = btnEl.dataset.cat
  _animeBibPag = 1; _animeBibSyncUI()
  _cerrarTodosDropsAnimeBib()
  _animeBibResetUI(); _animeBibCargar()
}
function animeBibSetGenero(btnEl) {
  _animeBibGenero = btnEl.dataset.gen || ''
  const genVal = document.getElementById('anime-drop-genero-val')
  if (genVal) genVal.textContent = _animeBibGenero ? btnEl.textContent.trim() : 'Todo'
  document.querySelectorAll('#anime-drop-genero-panel .mnbib-tipo').forEach(b =>
    b.classList.toggle('activo', b.dataset.gen === _animeBibGenero))
  document.getElementById('anime-drop-genero')?.classList.toggle('has-filter', !!_animeBibGenero)
  _cerrarTodosDropsAnimeBib()
  _animeBibPag = 1
  _animeBibResetUI()
  _animeBibCargar()
}
// Cierra todos los dropdowns de biblioteca
function _cerrarTodosDropsAnimeBib() {
  ['cat','genero'].forEach(id => {
    document.getElementById(`anime-drop-${id}-panel`)?.classList.remove('open')
    document.getElementById(`anime-drop-${id}`)?.classList.remove('open')
  })
}

function animeBibToggleDrop(id) {
  const panel = document.getElementById(`anime-drop-${id}-panel`)
  const drop  = document.getElementById(`anime-drop-${id}`)
  if (!panel || !drop) return
  const open = panel.classList.toggle('open')
  drop.classList.toggle('open', open)
  // Cerrar los otros
  ;['cat','genero'].filter(d => d !== id).forEach(d => {
    document.getElementById(`anime-drop-${d}-panel`)?.classList.remove('open')
    document.getElementById(`anime-drop-${d}`)?.classList.remove('open')
  })
  if (open) {
    const close = e => {
      if (!drop.contains(e.target)) {
        panel.classList.remove('open')
        drop.classList.remove('open')
        document.removeEventListener('click', close, true)
      }
    }
    setTimeout(() => document.addEventListener('click', close, true), 10)
  }
}
// ── DELEGACIÓN GLOBAL TARJETAS ANIME ─────────────────────────────────────
// Un solo listener para todas las tarjetas — evita onclick inline con títulos especiales
document.getElementById('app-anime')?.addEventListener('click', e => {
  const tarjeta = e.target.closest('.tarjeta[data-link]')
  if (tarjeta) abrirAnime(tarjeta.dataset.link, tarjeta.dataset.titulo)
})

// ── DELEGACIÓN GLOBAL TARJETAS MANGA ─────────────────────────────────────
document.getElementById('app-manga')?.addEventListener('click', e => {
  const tarjeta = e.target.closest('.mn-tend-card[data-manga-url]')
  if (tarjeta && !e.target.closest('.mn-cont-dots')) {
    abrirManga(tarjeta.dataset.mangaUrl, tarjeta.dataset.titulo || '')
  }
})

function animeBibReset() {
  _animeBibQuery = ''; _animeBibCat = ''; _animeBibGenero = ''
  _animeBibEmision = false; _animeBibPag = 1; _animeBibCargando = false
  _animeBibSyncUI(); _animeBibResetUI(); _animeBibCargar()
}
function animeBibPagAnterior() {
  if (_animeBibPag <= 1) return
  _animeBibPag--; _animeBibResetUI(); _animeBibCargar()
}
function animeBibPagSiguiente() {
  _animeBibPag++; _animeBibResetUI(); _animeBibCargar()
}

// Listener volver desde biblioteca anime
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('anime-bib-volver')?.addEventListener('click', () => navegar('inicio'))
  document.getElementById('anime-bib-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') animeBibBuscar()
  })
})

let _mangaHistorial = []
let _mangaActual = null

// ─── ATAJOS DE TECLADO DEL REPRODUCTOR ───────────────────────────────────────
document.addEventListener('keydown', e => {
  const playerAbierto = document.getElementById('overlay-player')?.classList.contains('activo')
  if (!playerAbierto) return

  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return

  const vid = document.getElementById('player-video')
  if (!vid) return

  switch (e.code) {
    case 'Space':
    case 'KeyK':
      e.preventDefault()
      if (vid.paused) vid.play().catch(() => {})
      else            vid.pause()
      syncPlayBtns(!vid.paused)
      break
    case 'ArrowLeft':
      e.preventDefault()
      skipSegundo(-10)
      break
    case 'ArrowRight':
      e.preventDefault()
      skipSegundo(10)
      break
    case 'ArrowUp':
      e.preventDefault()
      vid.volume = Math.min(1, Math.round((vid.volume + 0.1) * 10) / 10)
      if (vid.muted) vid.muted = false
      if (document.getElementById('player-vol')) document.getElementById('player-vol').value = vid.volume
      _actualizarVolIcon(vid.volume, vid.muted)
      _mostrarVolOSD(vid.volume)
      break
    case 'ArrowDown':
      e.preventDefault()
      vid.volume = Math.max(0, Math.round((vid.volume - 0.1) * 10) / 10)
      if (document.getElementById('player-vol')) document.getElementById('player-vol').value = vid.volume
      _actualizarVolIcon(vid.volume, vid.muted)
      _mostrarVolOSD(vid.volume)
      break
    case 'KeyM':
      e.preventDefault()
      vid.muted = !vid.muted
      _actualizarVolIcon(vid.volume, vid.muted)
      _mostrarVolOSD(vid.volume, vid.muted)
      break
    case 'KeyF':
      e.preventDefault()
      toggleFullscreenPlayer()
      break
    case 'Escape':
      cerrarReproductor()
      break
    default:
      break
  }
})