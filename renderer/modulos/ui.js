// modulos/ui.js — Controles ventana, atajos, búsqueda, animaciones
// Requiere: utils.js, core.js

document.getElementById('btn-min').addEventListener('click', () => window.api.minimize())
document.getElementById('btn-max').addEventListener('click', () => window.api.maximize())
let _ventanaMaximizada = false
// Sincronizar estado inicial de maximizado
window.api?.isMaximized?.().then(v => {
  const isMax = !!v
  if (isMax !== _ventanaMaximizada) {
    _ventanaMaximizada = isMax
  }
})
window.api?.onMaximizeChange?.((_, isMax) => {
  _ventanaMaximizada = isMax
  const btn = document.getElementById('btn-max')
  if (!btn) return
  btn.innerHTML = isMax
    ? `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="1,3.5 1,1 3.5,1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><polyline points="6.5,1 9,1 9,3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><polyline points="9,6.5 9,9 6.5,9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><polyline points="3.5,9 1,9 1,6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><span class="tb-line"></span>`
    : `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1.5" y="1.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/></svg><span class="tb-line"></span>`
})
document.addEventListener('keydown', e => {
  if (e.key === 'F11') {
    e.preventDefault()
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      document.exitFullscreen?.() || document.webkitExitFullscreen?.()
    } else {
      document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.()
    }
  }
  if (e.key === 'F5') {
    e.preventDefault()
    const playerAbierto = document.getElementById('overlay-player')?.classList.contains('activo')
    if (playerAbierto) return

    if (_moduloActivo === 'manga') {
      const paginaManga = document.querySelector('#app-manga .pagina.activa')?.id?.replace('page-manga-', '') || 'inicio'
      switch (paginaManga) {
        case 'detalle':
          if (typeof _mangaUrlActual !== 'undefined' && _mangaUrlActual)
            abrirManga(_mangaUrlActual, _mangaActual?.titulo || '')
          break
        case 'buscar': {
          const q = document.getElementById('manga-buscador-2')?.value.trim()
          if (q) buscarManga(q)
          break
        }
        case 'biblioteca': _mnBibAbrirConQuery(''); break
        case 'favoritos':  cargarMangaFavoritos?.(); break
        default:           cargarMangaTendencias(); break
      }
      return
    }

    // Detectar página activa de anime y recargar la función correcta
    const paginaActiva = document.querySelector('#app-anime .pagina.activa')?.id?.replace('page-', '') || 'inicio'
    switch (paginaActiva) {
      case 'anime':
        if (typeof _animeActual !== 'undefined' && _animeActual?.url)
          abrirAnime(_animeActual.url, _animeActual.titulo || '')
        break
      case 'inicio':       cargarRecientes(); break
      case 'favoritos':    cargarFavoritos(); break
      case 'calendario':   cargarCalendario(); break
      case 'buscar': {
        const q = document.getElementById('buscador-2')?.value.trim()
        if (q) buscar(q)
        break
      }
      case 'anime-biblioteca': _animeBibCargar(); break
      case 'continuar':    abrirPaginaContinuar(); break
      default:             cargarRecientes(); break
    }
  }
})
document.getElementById('btn-close').addEventListener('click', () => window.api.close())

// Fullscreen: ocultar titlebar y quitar padding-top del layout
function _onFullscreenChange() {
  const fs = !!(document.fullscreenElement || document.webkitFullscreenElement)
  document.body.classList.toggle('is-fullscreen', fs)
}
document.addEventListener('fullscreenchange', _onFullscreenChange)
document.addEventListener('webkitfullscreenchange', _onFullscreenChange)


document.getElementById('buscador')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value.trim()) irBuscar(e.target.value.trim())
})

function irBuscar(q) {
  navegar('buscar')
  document.getElementById('buscador-2').value = q
  document.getElementById('sb-anime-clear')?.classList.toggle('visible', q.length > 0)
  if (typeof sbSaveHistory === 'function') sbSaveHistory('anime', q)
  buscar(q)
}

// ── BÚSQUEDA MEJORADA: debounce + × + historial ──────────────────────────────
const SB_HIST_MAX = 8

function sbGetHistory(ns) {
  try { return JSON.parse(localStorage.getItem(`sb_hist_${ns}`) || '[]') } catch { return [] }
}
function sbSaveHistory(ns, q) {
  let h = sbGetHistory(ns).filter(x => x !== q)
  h.unshift(q)
  if (h.length > SB_HIST_MAX) h = h.slice(0, SB_HIST_MAX)
  localStorage.setItem(`sb_hist_${ns}`, JSON.stringify(h))
}
function sbDeleteHistory(ns, q) {
  const h = sbGetHistory(ns).filter(x => x !== q)
  localStorage.setItem(`sb_hist_${ns}`, JSON.stringify(h))
}
function sbClearHistory(ns) { localStorage.removeItem(`sb_hist_${ns}`) }

function sbRenderDropdown(dropEl, ns, onSelect) {
  const h = sbGetHistory(ns)
  if (!h.length) { dropEl.classList.remove('visible'); return }
  dropEl.innerHTML = `
    <div class="sb-hist-header">
      <span>Búsquedas recientes</span>
      <button class="sb-hist-clear-all" data-ns="${ns}">Limpiar todo</button>
    </div>
    ${h.map(q => `
      <div class="sb-hist-item" data-q="${q.replace(/"/g,'&quot;')}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="12 8 12 12 14 14"/><circle cx="12" cy="12" r="10"/></svg>
        <span>${q}</span>
        <button class="sb-hist-del" data-q="${q.replace(/"/g,'&quot;')}" data-ns="${ns}">×</button>
      </div>`).join('')}
  `
  dropEl.classList.add('visible')

  dropEl.querySelector('.sb-hist-clear-all').addEventListener('click', e => {
    e.stopPropagation()
    sbClearHistory(ns)
    dropEl.classList.remove('visible')
  })
  dropEl.querySelectorAll('.sb-hist-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('sb-hist-del')) return
      onSelect(el.dataset.q)
      dropEl.classList.remove('visible')
    })
  })
  dropEl.querySelectorAll('.sb-hist-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      sbDeleteHistory(ns, btn.dataset.q)
      sbRenderDropdown(dropEl, ns, onSelect)
    })
  })
}

function sbSetup({ inputId, clearId, dropId, ns, onSearch, debounceMs = 450 }) {
  const input   = document.getElementById(inputId)
  const clearBtn = document.getElementById(clearId)
  const dropEl  = document.getElementById(dropId)
  if (!input) return

  let _debTimer = null

  const doSearch = (q) => {
    sbSaveHistory(ns, q)
    dropEl?.classList.remove('visible')
    onSearch(q)
  }

  const syncClear = () => {
    clearBtn?.classList.toggle('visible', input.value.length > 0)
  }

  // Debounce en input
  input.addEventListener('input', () => {
    syncClear()
    clearTimeout(_debTimer)
    const q = input.value.trim()
    if (!q) { dropEl && sbRenderDropdown(dropEl, ns, sel => { input.value = sel; syncClear(); doSearch(sel) }); return }
    _debTimer = setTimeout(() => doSearch(q), debounceMs)
  })

  // Enter sigue funcionando inmediatamente
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      clearTimeout(_debTimer)
      const q = input.value.trim()
      if (q) doSearch(q)
      dropEl?.classList.remove('visible')
    }
    if (e.key === 'Escape') dropEl?.classList.remove('visible')
  })

  // Mostrar historial al enfocar con input vacío
  input.addEventListener('focus', () => {
    if (!input.value.trim() && dropEl) sbRenderDropdown(dropEl, ns, sel => { input.value = sel; syncClear(); doSearch(sel) })
  })

  // Cerrar dropdown al hacer click fuera
  document.addEventListener('click', e => {
    if (!input.closest('.sb-input-wrap, .mn-searchbar')?.contains(e.target)) {
      dropEl?.classList.remove('visible')
    }
  })

  // Botón ×
  clearBtn?.addEventListener('click', () => {
    input.value = ''
    syncClear()
    dropEl?.classList.remove('visible')
    input.focus()
  })
}

// Instanciar para anime
sbSetup({
  inputId: 'buscador-2', clearId: 'sb-anime-clear', dropId: 'sb-anime-history',
  ns: 'anime',
  onSearch: q => buscar(q)
})

document.getElementById('btn-buscar').addEventListener('click', () => {
  const q = document.getElementById('buscador-2').value.trim()
  if (q) { sbSaveHistory('anime', q); buscar(q) }
})

// CARGAR RECIENTES + SLIDER
let _sliderIdx = 0, _sliderTotal = 0, _sliderTimer = null


function animarEntrada(modulo) {
  const mod = modulo || _moduloActivo || 'anime'
  const DELAY = 220   // ms entre cada elemento
  const PAUSA = 400   // ms de pantalla vacía antes de empezar

  const selAnime = [
    '.home-hero-continuar',
    '.home-hero-banner',
    '#page-inicio .seccion-titulo:nth-of-type(1)',
    '#grilla-recientes',
    '#page-inicio .seccion-titulo:nth-of-type(2)',
    '#grilla-series',
  ]
  const selManga = [
    '#page-manga-inicio .mn-searchbar',
    '#mn-continuar-wrap',
    '#page-manga-inicio .mn-home-sec:nth-of-type(1)',
    '#page-manga-inicio .mn-home-sec:nth-of-type(2)',
    '#page-manga-inicio .mn-home-sec:nth-of-type(3)',
  ]

  const lista = mod === 'manga' ? selManga : selAnime

  // Ocultar todos inmediatamente
  lista.forEach(s => {
    const el = document.querySelector(s)
    if (el) { el.style.visibility = 'hidden'; el.style.opacity = '0' }
  })

  // Después de la pausa, animar uno por uno en escalera
  setTimeout(() => {
    lista.forEach((s, i) => {
      const el = document.querySelector(s)
      if (!el) return
      setTimeout(() => {
        el.style.visibility = ''
        el.style.opacity = ''
        el.classList.remove('ryoku-animar')
        void el.offsetWidth
        el.classList.add('ryoku-animar')
        el.addEventListener('animationend', () => el.classList.remove('ryoku-animar'), { once: true })
      }, i * DELAY)
    })
  }, PAUSA)
}