// modulos/anime.js — Recientes, slider, continuar, calendario, búsqueda, player
// Requiere: utils.js, core.js, ui.js

// Convierte link de episodio (/ver/...) en URL de página del anime, según la fuente
function _epLinkToAnimeUrl(link) {
  if (!link) return ''
  if (link.includes('animeflv.net/ver/')) {
    const slug = link.split('/ver/')[1]?.replace(/-\d+$/, '') || ''
    return slug ? `https://www4.animeflv.net/anime/${slug}` : ''
  }
  const slug = link.split('/ver/')[1]?.replace(/-episodio-\d+$/, '') || ''
  return slug ? `https://latanime.org/anime/${slug}` : ''
}

async function cargarRecientes(onDone) {
  const grilla   = document.getElementById('grilla-recientes')
  const gSeries  = document.getElementById('grilla-series')
  grilla.innerHTML  = '<div class="loading">Cargando...</div>'
  if (gSeries) gSeries.innerHTML = '<div class="loading">Cargando...</div>'
  // Ocultar para la animación de entrada
  const _elemsAnime = ['.home-hero-continuar','.home-hero-banner',
    '#page-inicio .seccion-titulo:nth-of-type(1)','#grilla-recientes',
    '#page-inicio .seccion-titulo:nth-of-type(2)','#grilla-series']
  _elemsAnime.forEach(s => { const el=document.querySelector(s); if(el){el.style.visibility='hidden';el.style.opacity='0'} })

  let _recData
  try {
    _recData = await window.api.getRecientes()
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
    const sliderFiltrado = _filtrarLista(slider)
    _sliderTotal = sliderFiltrado.length
    const track = document.getElementById('slider-track')
    const dots  = document.getElementById('slider-dots')
    const _isMobileSlider = document.body.classList.contains('mobile-mode')
    track.innerHTML = sliderFiltrado.map(s => {
      const esA = s.adulto || _esAdulto(s)
      return `<div class="slider-slide">
        <img class="slider-slide-img" src="${s.imagen}" alt="${s.titulo}" style="${esA ? 'filter:blur(14px);transform:scale(1.05)' : ''}" />
        ${esA ? '<span class="badge-18 badge-18-slider">+18</span>' : ''}
        ${_isMobileSlider && !esA ? '<div class="slider-nuevo-badge">★ NUEVO EPISODIO ★</div>' : ''}
        <div class="slider-info">
          ${s.idioma && !_isMobileSlider ? `<div class="slider-ep-badge">${s.idioma}</div>` : ''}
          <h2>${s.titulo}</h2>
          ${s.desc && !esA ? `<p class="slider-desc">${s.desc}</p>` : ''}
          <div class="slider-btns">
            <button class="slider-btn-ver" onclick="abrirAnime('${s.link}','${_esc(s.titulo)}')">▶ Ver ahora</button>
            ${_isMobileSlider ? `<button class="slider-btn-add" onclick="event.stopPropagation()" title="Añadir">+</button>` : ''}
          </div>
        </div>
      </div>`
    }).join('')
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
        <div class="tarjeta-img-wrap tarjeta-ep" data-letra="${letra}">${imgHtml}
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
  if (!gSeries) return
  if (!series || !series.length) {
    gSeries.innerHTML = '<div class="loading">Sin series.</div>'
    return
  }
  const _isMobileSeries = document.body.classList.contains('mobile-mode')
  const _rankColors = ['#2563eb','#f97316','#7c3aed','#16a34a','#dc2626']
  gSeries.innerHTML = _marcarAdultos(_filtrarLista(series)).map((s, idx) => {
    const letra = s.titulo.charAt(0)
    const tieneImg = s.imagen && !s.imagen.includes('logito') && !s.imagen.includes('web.jpg')
    const rankColor = _rankColors[idx] || '#6b7280'
    return `
    <div class="tarjeta tarjeta-serie" onclick="abrirAnime('${s.link}','${_esc(s.titulo)}')">
      <div class="tarjeta-img-wrap tarjeta-serie-cover" data-letra="${letra}">
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
  cargarContinuarViendo()
  if (typeof onDone === 'function') onDone()
  animarEntrada('anime')
}

// ── CONTINUAR VIENDO ─────────────────────────────────────────────────────
// 4 en ventana normal, 6 maximizada
function _getContinuarMax() {
  return _ventanaMaximizada ? 6 : 4
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
    // Hay historial pero todo visto — mostrar header y chequear nuevos eps
    panel.style.display = hayHistorial ? 'flex' : 'none'
    lista.innerHTML = ''
    if (hayHistorial) {
      const vistos = Object.values(porAnime).filter(h => h.link?.includes('/ver/'))
      if (vistos.length > 0) _chequearNuevosEpisodios(vistos, progresos)
    }
    return
  }
  panel.style.display = 'flex'
  lista.innerHTML = todos.slice(0,_getContinuarMax()).map(h => _continuarCard(h,progresos)).join('')
  if (todos.length > _getContinuarMax()) {
    const restantes = todos.length - _getContinuarMax()
    lista.innerHTML += `<button class="continuar-ver-mas" onclick="abrirPaginaContinuar()"><span class="continuar-ver-num">+${restantes}</span><span class="continuar-ver-label">más</span></button>`
  }
  // Cargar portadas faltantes en background
  _continuarCargarPortadas(todos.slice(0, _getContinuarMax()), progresos)

  // Chequear en background si hay nuevos episodios en animes ya vistos
  const vistos = Object.values(porAnime).filter(h => {
    const prog = progresos[h.link]
    const pct = prog?.duration ? (prog.currentTime / prog.duration) * 100 : 0
    return pct >= 94 && h.link?.includes('/ver/')
  })
  if (vistos.length > 0) _chequearNuevosEpisodios(vistos, progresos)
}

async function _chequearNuevosEpisodios(vistos, progresos) {
  for (const h of vistos) {
    const nombre = h.anime || h.titulo?.split(' - Ep')[0].trim() || ''
    const animeUrl = _epLinkToAnimeUrl(h.link)
    if (!animeUrl) continue
    try {
      const info = await window.api.getAnime(animeUrl)
      if (!info?.episodios?.length) continue
      // Primer episodio sin ver (<94%)
      const sigEp = info.episodios.find(ep => {
        const p = progresos[ep.link]
        return !p || (p.porcentaje || 0) < 94
      })
      if (!sigEp) continue // Todo visto, no hay nuevo
      const lista = document.getElementById('continuar-lista')
      if (!lista) continue
      // No duplicar si ya hay una card para este link
      if (lista.querySelector(`[data-anime-link="${CSS.escape(sigEp.link)}"]`)) continue
      // Construir card con el nuevo episodio
      const hNuevo = { link: sigEp.link, titulo: `${nombre} - Ep ${sigEp.num}`, anime: nombre, imagen: h.imagen || info.imagen }
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = _continuarCard(hNuevo, progresos)
      const cardEl = tempDiv.firstChild
      // Badge "NUEVO"
      const capEl = cardEl?.querySelector('.ac-cont-cap')
      if (capEl) capEl.innerHTML = `<span style="color:#60a5fa;font-weight:700;font-size:10px">● NUEVO · Ep ${sigEp.num}</span>`
      // Insertar al inicio (antes del +X más)
      const verMas = lista.querySelector('.continuar-ver-mas')
      if (verMas) lista.insertBefore(cardEl, verMas)
      else lista.prepend(cardEl)
      // Asegurar panel visible
      const panel = document.getElementById('home-hero-continuar')
      if (panel) panel.style.display = 'flex'
    } catch(e) {}
    await new Promise(r => setTimeout(r, 400)) // delay entre requests
  }
}


async function _continuarCargarPortadas(items, progresos) {
  // Cargar el historial completo una sola vez para actualizar las entradas
  const historialCompleto = await window.api.getHistorial()

  for (let i = 0; i < items.length; i++) {
    const h = items[i]
    if (h.imagen) continue
    if (!h.link?.includes('/ver/')) continue
    const animeUrl = _epLinkToAnimeUrl(h.link)
    if (!animeUrl) continue
    try {
      const info = await window.api.getAnime(animeUrl)
      if (info?.imagen) {
        h.imagen = info.imagen
        // Actualizar card en DOM
        const card = document.querySelector(`.ac-cont-card[data-anime-link="${CSS.escape(h.link)}"]`)
        if (card) {
          const ph = card.querySelector('.ac-cont-cover-ph')
          if (ph) {
            const img = document.createElement('img')
            img.className = 'ac-cont-cover'
            img.src = info.imagen
            img.onerror = () => img.remove()
            ph.replaceWith(img)
          }
        }
        // Persistir imagen en TODAS las entradas del historial de este anime
        const nombre = h.anime || h.titulo?.split(' - Ep')[0].trim() || h.titulo
        let actualizado = false
        historialCompleto.forEach(entry => {
          const entryNombre = entry.anime || entry.titulo?.split(' - Ep')[0].trim() || entry.titulo
          if (entryNombre === nombre && !entry.imagen) {
            entry.imagen = info.imagen
            actualizado = true
          }
        })
        if (actualizado) {
          await window.api.clearHistorial()
          for (const entry of historialCompleto) await window.api.addHistorial(entry)
        }
      }
    } catch(e) {}
  }
}
function _continuarCard(h, progresos) {
  const prog=progresos[h.link]
  const pct=prog?.duration?Math.round((prog.currentTime/prog.duration)*100):0
  const tiempoTexto=prog?.currentTime>0?formatTime(prog.currentTime):''
  const visto=pct>=94
  const epNum=h.titulo?.includes(' - Ep')?h.titulo.split(' - Ep')[1]?.trim():''
  const nombre=h.anime||h.titulo?.split(' - Ep')[0].trim()||h.titulo
  const animeUrl=h.link?.includes('/ver/')?_epLinkToAnimeUrl(h.link):(h.link||'')
  const imgHtml=h.imagen?`<img class="ac-cont-cover" src="${h.imagen}" onerror="this.style.display='none'" />`:`<div class="ac-cont-cover-ph">${nombre.charAt(0)}</div>`
  const capTexto = visto ? 'Visto ✓' : (epNum ? `Ep ${epNum}${tiempoTexto?' · '+tiempoTexto:''}` : 'Ver anime')
  return `<div class="ac-cont-card" data-anime-url="${_esc(animeUrl)}" data-anime-nombre="${_esc(nombre)}" data-anime-titulo="${_esc(h.titulo||nombre)}" data-anime-link="${_esc(h.link)}" data-anime-visto="${visto}" onclick="continuarClickCard(event,this)">${imgHtml}<div class="ac-cont-dots" onclick="continuarDotsClick(event,this)" data-anime-url="${_esc(animeUrl)}" data-anime-nombre="${_esc(nombre)}" data-anime-link="${_esc(h.link)}">⋯</div><div class="ac-cont-info"><div class="ac-cont-title">${nombre}</div><div class="ac-cont-cap">${capTexto}</div><div class="ac-cont-prog"><div class="ac-cont-prog-fill" style="width:${pct}%"></div></div><div class="ac-cont-pct">${pct>0?pct+'%':''}</div></div></div>`
}
let _animeContinuarCtx=null
document.addEventListener('DOMContentLoaded',()=>{
  const menu=document.getElementById('continuar-ctx-menu'); if(!menu)return
  document.getElementById('ctx-ver-eps')?.addEventListener('click',()=>{ menu.classList.remove('visible'); if(_animeContinuarCtx)abrirAnime(_animeContinuarCtx.anime,_animeContinuarCtx.nombre) })
  document.getElementById('ctx-quitar')?.addEventListener('click',async()=>{
    menu.classList.remove('visible'); if(!_animeContinuarCtx)return
    const nombre=_animeContinuarCtx.nombre
    const hist=await window.api.getHistorial()
    const nuevos=hist.filter(h=>(h.anime||h.titulo?.split(' - Ep')[0].trim()||h.titulo)!==nombre)
    await window.api.clearHistorial(); for(const h of nuevos)await window.api.addHistorial(h)
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
  if(link?.includes('/ver/')&&!visto){ abrirSelector(link,titulo) }
  // Si está visto o no tiene link de episodio, ir a la página del anime
  else { abrirAnime(animeUrl,nombre) }
}
async function abrirPaginaContinuar(){
  navegar('continuar')
  // Actualizar título de la página
  const h2 = document.querySelector('#page-continuar .seccion-titulo')
  if (h2) h2.textContent = 'Historial'
  const lista = document.getElementById('continuar-full-lista')
  if (!lista) return
  lista.innerHTML = '<div class="loading">Cargando...</div>'
  const hist = await window.api.getHistorial()
  const progresos = await window.api.getTodosProgresos()
  // Agrupar por anime — mostrar TODOS (en progreso + vistos)
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
  lista.innerHTML = todos.map(h => _continuarCard(h, progresos)).join('')
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

  tabs.innerHTML = Object.keys(_calData).map(dia => {
    const esHoy = dia === hoyKey
    return `<button class="cal-tab${esHoy ? ' hoy' : ''}" data-dia="${dia}" onclick="selCalDia('${dia}')">${DIAS_ES[dia] || dia}</button>`
  }).join('')

  const diasDisp = Object.keys(_calData)
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
      <div class="cal-card-img-wrap" data-letra="${letra}">${imgHtml}</div>
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

async function abrirAnime(url, titulo) {
  const activa = document.querySelector('#app-anime .pagina.activa')
  _paginaAnterior = activa ? activa.id.replace('page-','') : 'inicio'
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
  const linksVistos = new Set(historial.map(h => h.link))

  document.getElementById('eps-lista').innerHTML = info.episodios.map(ep => {
    const prog     = progresos[ep.link]
    const visto    = linksVistos.has(ep.link) && prog?.porcentaje >= 95
    const enProg   = prog && prog.porcentaje > 5 && prog.porcentaje < 95
    const pct      = prog ? Math.round(prog.porcentaje) : 0
    const thumbSrc = ep.imagen || ''
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
    await window.api.addHistorial({
      anime:  (_animeActual?.titulo || tituloE.split(' - Ep')[0]).trim(),
      titulo: tituloE,
      link,
      imagen: _animeActual?.imagen || '',
      fecha:  new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })
    })
    item.classList.add('visto')
    btn.classList.add('visto')
    btn.title = 'Marcar como no visto'
    btn.innerHTML = iconOjoSlash
    if (estado) estado.innerHTML = ''
  }
  // Refrescar "Continuar viendo"
  if (typeof cargarContinuarViendo === 'function') cargarContinuarViendo()
}

document.getElementById('btn-volver').addEventListener('click', () => {
  const fb = document.getElementById('anime-floating-btns')
  if (fb) { fb.classList.add('saliendo'); setTimeout(() => navegar(_paginaAnterior||'inicio'), 240) }
  else navegar(_paginaAnterior||'inicio')
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
}

async function cargarFavoritos() {
  const grilla = document.getElementById('grilla-favoritos')
  if (!grilla) return
  const favs = await window.api.getFavs()
  if (!favs.length) { grilla.innerHTML = '<div class="fav-vacio">No tienes animes guardados aún.<br>Dale ❤️ a un anime para guardarlo.</div>'; return }
  grilla.innerHTML = favs.map(f => renderTarjeta({ titulo: f.titulo, link: f.url, imagen: f.imagen })).join('')
  checkLoadedImgs(grilla)
}

// ─── PASO 1: SELECTOR DE SERVIDOR ─────────────────────────────────────────
let _servidores = [], _tituloActual = '', _urlEpisodioActual = ''
let _pendingEp = null

// Cache de streams pre-fetcheados: { [urlServidor]: Promise<resultado> }
const _streamCache = {}
const _SRV_OK = ['mp4upload','uqload','voe','savefiles','mixdrop','doodstream','streamwish','sw']
const _esFuncional = n => _SRV_OK.some(k => (n || '').toLowerCase().includes(k))

function _preFetchServidores(lista) {
  // Solo pre-fetchear 1 servidor (el primero funcional) para no saturar la RAM de Render
  for (const s of lista) {
    if (!s?.url || _streamCache[s.url]) continue
    _streamCache[s.url] = window.api.getStream(s.url).catch(() => null)
    break  // solo 1 a la vez
  }
}

async function abrirSelector(url, titulo) {
  _tituloActual = titulo
  _urlEpisodioActual = url
  _pendingEp = null  // limpiar cualquier pendiente residual
  const overlay = document.getElementById('overlay-servidor')
  const lista   = document.getElementById('srv-lista')
  document.getElementById('srv-titulo').textContent = titulo
  lista.innerHTML = '<div class="loading">Cargando servidores...</div>'
  overlay.classList.add('activo')

  // Cargar datos del anime en paralelo para tenerlos listos al abrir el player
  const animeName = titulo.split(' - Ep')[0].trim()
  if (!_animeActual || _animeActual.titulo !== animeName) {
    _animeActual = null // resetear para no mostrar datos del anime anterior
    // Buscar URL del anime desde la URL del episodio
    const animeUrl = url.includes('/ver/')
      ? _epLinkToAnimeUrl(url)
      : ''
    if (animeUrl) {
      window.api.getAnime(animeUrl).then(info => {
        if (info) _animeActual = { url: animeUrl, titulo: info.titulo || animeName, imagen: info.imagen || '', sinopsis: info.sinopsis || '', episodios: info.episodios }
      }).catch(() => {})
    }
  }

  _servidores = await window.api.getServidores(url)

  if (!_servidores.length) {
    lista.innerHTML = '<div class="loading" style="color:#e63946">Sin servidores disponibles.</div>'
    return
  }

  // Renderizar: funcionales en verde, resto en neutro
  const _indexados = _servidores.map((s, i) => ({ ...s, _idx: i }))
  _indexados.sort((a, b) => _esFuncional(b.nombre) - _esFuncional(a.nombre))

  lista.innerHTML = _indexados.map(s => {
    const ok = _esFuncional(s.nombre)
    return `<button class="srv-btn ${ok ? 'srv-funcional' : ''}" id="srv-btn-${s._idx}" onclick="elegirServidor(${s._idx})">
      <div class="srv-dot ${ok ? 'srv-dot-ok' : ''}"></div>
      <span class="srv-nombre">${s.nombre}</span>
    </button>`
  }).join('')

  // Pre-fetch en background: los primeros funcionales primero, luego el resto
  const ordenPrefetch = [..._indexados].sort((a, b) => _esFuncional(b.nombre) - _esFuncional(a.nombre))
  _preFetchServidores(ordenPrefetch)
}

async function pedirServidorEp(url, titulo) {
  _pendingEp = { url, titulo }
  const overlay = document.getElementById('overlay-servidor')
  const lista   = document.getElementById('srv-lista')
  document.getElementById('srv-titulo').textContent = titulo
  lista.innerHTML = '<div class="loading">Cargando servidores...</div>'
  overlay.classList.add('activo')

  _servidores = await window.api.getServidores(url)

  if (!_servidores.length) {
    lista.innerHTML = '<div class="loading" style="color:#e63946">Sin servidores disponibles.</div>'
    return
  }

  const _indexados2 = _servidores.map((s, i) => ({ ...s, _idx: i }))
  _indexados2.sort((a, b) => _esFuncional(b.nombre) - _esFuncional(a.nombre))

  lista.innerHTML = _indexados2.map(s => {
    const ok = _esFuncional(s.nombre)
    return `<button class="srv-btn ${ok ? 'srv-funcional' : ''}" id="srv-btn-${s._idx}" onclick="elegirServidor(${s._idx})">
      <div class="srv-dot ${ok ? 'srv-dot-ok' : ''}"></div>
      <span class="srv-nombre">${s.nombre}</span>
    </button>`
  }).join('')

  // Pre-fetch en background
  const ordenPrefetch2 = [..._indexados2].sort((a, b) => _esFuncional(b.nombre) - _esFuncional(a.nombre))
  _preFetchServidores(ordenPrefetch2)
}

document.getElementById('srv-cerrar').addEventListener('click', () => {
  _pendingEp = null
  // Limpiar cache al cerrar sin elegir servidor
  for (const k in _streamCache) delete _streamCache[k]
  document.getElementById('overlay-servidor').classList.remove('activo')
})

// ─── PASO 2: REPRODUCTOR ──────────────────────────────────────────────────
let hls = null, _idxActivo = 0
let _reproducirToken = 0  // token de cancelación — se incrementa al cerrar/cambiar
let _toastContinuarDone = false  // true una vez que el toast fue atendido/descartado en el episodio actual
const _nombresDisplay = ['Ultra HD','Rápido','Respaldo','Alternativo','HD','Backup']
const _proveedores = ['byse','voe','mp4upload','dsvplay','mixdrop','hexload']

function spinnerShow(v) {
  document.getElementById('player-spinner').classList.toggle('oculto', !v)
  if (v) drawPlayPauseCanvas(false, true)
}

async function elegirServidor(idx) {
  const s = _servidores[idx]
  if (!s) return

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

  if (!resultado?.url) {
    // Falló — tachado + pill rojo
    if (btn) {
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
    return
  }

  // Éxito — cerrar selector y abrir player
  document.getElementById('overlay-servidor').classList.remove('activo')
  // Si hay episodio pendiente (cambio desde el player), confirmar ahora
  if (_pendingEp) {
    _urlEpisodioActual = _pendingEp.url
    _tituloActual = _pendingEp.titulo
    _pendingEp = null
    if (hls) { hls.destroy(); hls = null }
    const _vid = document.getElementById('player-video')
    if (_vid) _vid.src = ''
  }
  _idxActivo = idx
  const overlay = document.getElementById('overlay-player')
  overlay.classList.add('activo')
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
      if (nextThumb && _animeActual.imagen) {
        nextThumb.src = _animeActual.imagen
        nextThumb.onerror = () => { nextThumb.style.display = 'none' }
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
      if (prevThumb && _animeActual.imagen) {
        prevThumb.src = _animeActual.imagen
        prevThumb.onerror = () => { prevThumb.style.display = 'none' }
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

async function cambiarEpisodioPlayer(url, titulo) {
  _reproducirToken++  // cancela carga anterior
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



async function reproducir(idx, renovar = false, _streamPreload = null) {
  const s = _servidores[idx]
  if (!s) { spinnerShow(false); return }
  const miToken = ++_reproducirToken
  const cancelado = () => miToken !== _reproducirToken
  const video = document.getElementById('player-video')

  document.getElementById('rp-skip-intro')?.classList.remove('visible')
  const skipBtnReset = document.getElementById('rp-skip-intro')
  if (skipBtnReset) skipBtnReset._usado = false
  document.getElementById('toast-progreso')?.remove()
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

  const resultado = _streamPreload || await window.api.getStream(s.url)

  if (cancelado()) { spinnerShow(false); return }

  if (!resultado || !resultado.url) {
    if (window.api.clearStreamCache) await window.api.clearStreamCache(s.url)
    spinnerShow(false)
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
  }

  const onListo = async () => {
    spinnerShow(false)
    if (window._friendsSetActivity) {
      const epPart = _tituloActual.split(' - Ep')[1]
      window._friendsSetActivity({ type: 'anime', title: _tituloActual.split(' - Ep')[0].trim(), episode: epPart ? epPart.trim() : '' })
    }
    const ahora = new Date()
    await window.api.addHistorial({
      anime: _tituloActual.split(' - Ep')[0].trim(),
      titulo: _tituloActual,
      link: _urlEpisodioActual || '',
      imagen: _animeActual?.imagen || '',
      fecha: ahora.toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })
    })
    if (video._progresoInterval) clearInterval(video._progresoInterval)
    video._progresoInterval = setInterval(() => {
      if (video.duration > 0 && _urlEpisodioActual && !video.paused)
        window.api.setProgreso(_urlEpisodioActual, video.currentTime, video.duration)
    }, 15000)
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
    hls = new Hls()
    hls.loadSource(url)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, onListo)
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal && video.readyState < 2 && video.currentTime < 1) {
        if (window.api.clearStreamCache) window.api.clearStreamCache(s.url)
        spinnerShow(false)
      }
    })
  } else {
    // Mobile: reproducción nativa del elemento <video> (Android soporta HLS
    // nativamente sin CORS, funciona para .m3u8 y .mp4)
    if (hls) { hls.destroy(); hls = null }
    video.src = url
    video.oncanplay = onListo
    video.onerror = () => {
      if (video.currentTime > 2) return
      if (window.api.clearStreamCache) window.api.clearStreamCache(s.url)
      spinnerShow(false)
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
  const srcMap = { latanime: 'Latanime', animeflv: 'AnimeFLV' }
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

async function cerrarReproductor() {
  _reproducirToken++  // invalida cualquier reproducir() pendiente
  document.getElementById('overlay-player').classList.remove('activo')
  if (window._chatUpdateFAB) window._chatUpdateFAB()
  if (window._ryokuDiscordActivity !== false) window.api?.discordClear?.()
  if (window._friendsSetActivity) window._friendsSetActivity(null)
  const video = document.getElementById('player-video')
  const epUrl = _urlEpisodioActual
  const ct = video.currentTime, dur = video.duration
  if (dur > 0 && epUrl) {
    await window.api.setProgreso(epUrl, ct, dur)  // esperar antes de refrescar
  }
  if (video._progresoInterval) { clearInterval(video._progresoInterval); video._progresoInterval = null }
  video.pause(); video.src = ''
  if (hls) { hls.destroy(); hls = null }
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen()
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen()
  }
  // Actualizar barra de progreso del episodio en la lista de detalle (sin recrear el DOM)
  if (epUrl && dur > 0) _actualizarEpProgresoEnLista(epUrl, ct, dur)
  // Refrescar sección continuar viendo con el progreso actualizado
  cargarContinuarViendo()
}

function _actualizarEpProgresoEnLista(link, currentTime, duration) {
  const item = document.querySelector(`.ep-item[data-ep-link="${CSS.escape(link)}"]`)
  if (!item) return
  const pct = Math.round((currentTime / duration) * 100)
  const visto = pct >= 95
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
  if (e.target === video) { if (video.paused) video.play(); else video.pause() }
})

// Botón play/pause pequeño de la barra inferior
document.getElementById('rp-play-small')?.addEventListener('click', (e) => {
  e.stopPropagation()
  if (video.paused) video.play(); else video.pause()
})
video.addEventListener('play',    () => { syncPlayBtns(true);  document.getElementById('rp-video-wrap')?.classList.remove('paused') })
video.addEventListener('pause',   () => { syncPlayBtns(false); document.getElementById('rp-video-wrap')?.classList.add('paused') })
video.addEventListener('waiting', () => drawPlayPauseCanvas(false, true))
video.addEventListener('playing', () => drawPlayPauseCanvas(true,  false))
video.addEventListener('canplay', () => drawPlayPauseCanvas(!video.paused, false))

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
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
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
  document.getElementById('toast-progreso')?.remove()
  _scrubbing = true
  _progBg.style.transition = 'none'
  _progBg.style.transform = 'scaleY(1)'
  _scrubTo(e)
  _progBg.classList.add('scrubbing')
})
document.addEventListener('mousemove', e => { if (_scrubbing) _scrubTo(e) })
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
          window.api.addHistorial({ anime: _animeActual.titulo, titulo: tituloEp, link: ep.link, imagen: _animeActual.imagen || '', fecha: fechaStr })
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
}

function toggleFullscreenPlayer() {
  const shell = document.querySelector('.rp-shell')
  if (!shell) return

  // En mobile usar fullscreen CSS (evita el espacio vacío que deja la API nativa en Android)
  if (document.body.classList.contains('mobile-mode')) {
    const isFull = shell.classList.contains('rp-mobile-fullscreen')
    if (isFull) {
      shell.classList.remove('rp-mobile-fullscreen')
      document.body.classList.remove('rp-fs-active')
      // Salir de fullscreen nativo (restaura barras del sistema + orientación libre)
      if (window._nativeExtractor?.exitFullscreen) {
        window._nativeExtractor.exitFullscreen()
      } else if (screen.orientation?.unlock) {
        screen.orientation.unlock()
      }
    } else {
      shell.classList.add('rp-mobile-fullscreen')
      document.body.classList.add('rp-fs-active')
      // Entrar en fullscreen nativo: rota a landscape y oculta barras del sistema
      if (window._nativeExtractor?.enterFullscreen) {
        window._nativeExtractor.enterFullscreen()
      } else if (screen.orientation?.lock) {
        screen.orientation.lock('landscape').catch(() => {})
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
  _toastContinuarDone = true
  document.getElementById('toast-progreso')?.remove()
  video.currentTime = Math.max(0, Math.min(video.currentTime + s, video.duration))
}

function mostrarToastProgreso(currentTime) {
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

function showControls(e) {
  // No disparar si el mouse viene de la topbar o de los paneles laterales
  if (e) {
    const rect = videoWrap.getBoundingClientRect()
    const fromTop = e.clientY - rect.top
    if (fromTop < 8) return // margen superior — viene del topbar
  }
  videoWrap.classList.add('show-controls')
  clearTimeout(_ctrlTimer)
  syncSkipIntro()
  const toast = document.getElementById('toast-progreso')
  if (toast && !_toastContinuarDone) { toast.style.opacity = '1'; toast.style.pointerEvents = '' }
  if (!_mouseOverControls) {
    _ctrlTimer = setTimeout(() => {
      if (!video.paused) {
        videoWrap.classList.remove('show-controls')
        syncSkipIntro()
        const toast = document.getElementById('toast-progreso')
        if (toast) { _toastContinuarDone = true; toast.remove() }
      }
    }, 3000)
  }
}

function hideControls() {
  clearTimeout(_ctrlTimer)
  if (!video.paused) {
    videoWrap.classList.remove('show-controls')
    syncSkipIntro()
    const toast = document.getElementById('toast-progreso')
    if (toast) { _toastContinuarDone = true; toast.remove() }
  }
}

videoWrap.addEventListener('mousemove', showControls)
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
  })
  el.addEventListener('mouseleave', () => {
    _mouseOverControls = false
    clearTimeout(_ctrlTimer)
    if (!video.paused) {
      _ctrlTimer = setTimeout(() => {
        videoWrap.classList.remove('show-controls')
        syncSkipIntro()
        const toast = document.getElementById('toast-progreso')
        if (toast) { _toastContinuarDone = true; toast.remove() }
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
    <div class="tarjeta-img-wrap${esAdulto ? ' adulto-img' : ''}" data-letra="${letra}">${imgHtml}</div>
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
  if (grilla) grilla.innerHTML = _filtrarLista(lista).map(r => renderTarjeta({...r, adulto: r.adulto || _esAdulto(r)})).join('')
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
      if (e.code.startsWith('Digit') && vid.duration > 0) {
        const n = parseInt(e.code.replace('Digit', ''), 10)
        vid.currentTime = vid.duration * n / 10
      }
      break
  }
})
