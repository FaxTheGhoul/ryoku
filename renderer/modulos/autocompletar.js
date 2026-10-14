// modulos/autocompletar.js — sugerencias de títulos en los buscadores
// Mientras escribes (2+ letras) muestra títulos de AniList con portada, tipo y
// año. Al elegir uno se escribe en el buscador y se busca en la fuente activa.
// Teclado: ↑ ↓ para moverte, Enter / Tab para elegir, Esc para cerrar.
// Convive con el historial de búsquedas (que sale con el campo vacío).
;(function () {
  const _esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

  function acAdjuntar({ inputId, tipo, alElegir }) {
    const input = document.getElementById(inputId)
    if (!input || input._acListo) return
    input._acListo = true
    input.setAttribute('autocomplete', 'off')
    const cont = input.parentElement
    if (getComputedStyle(cont).position === 'static') cont.style.position = 'relative'
    const drop = document.createElement('div')
    drop.className = 'ac-drop'
    cont.appendChild(drop)

    let timer = null, seq = 0, items = [], idx = -1

    const ocultar = () => { drop.classList.remove('visible'); drop.innerHTML = ''; items = []; idx = -1 }
    const marcar = () => [...drop.querySelectorAll('.ac-item')].forEach((el, i) => el.classList.toggle('activo', i === idx))
    const elegir = i => {
      const it = items[i]; if (!it) return
      clearTimeout(timer); seq++
      ocultar()
      input.value = it.titulo
      input.dispatchEvent(new Event('ac-elegido'))
      alElegir(it.titulo)
    }
    const pintar = lista => {
      items = lista; idx = -1
      if (!lista.length) { ocultar(); return }
      // el historial no debe quedar encima
      cont.querySelector('.sb-history-dropdown')?.classList.remove('visible')
      drop.innerHTML = `<div class="ac-header">Sugerencias</div>` + lista.map((it, i) => `
        <div class="ac-item" data-i="${i}">
          ${it.imagen ? `<img class="ac-img" src="${_esc(it.imagen)}" loading="lazy" alt="">` : '<div class="ac-img"></div>'}
          <div class="ac-txt">
            <div class="ac-tit">${_esc(it.titulo)}</div>
            <div class="ac-meta">${[it.formato, it.anio, it.alterno].filter(Boolean).map(_esc).join(' · ')}</div>
          </div>
        </div>`).join('')
      drop.querySelectorAll('.ac-item').forEach(el => {
        el.addEventListener('mousedown', e => { e.preventDefault(); elegir(Number(el.dataset.i)) })
        el.addEventListener('mouseenter', () => { idx = Number(el.dataset.i); marcar() })
      })
      drop.classList.add('visible')
    }

    input.addEventListener('input', () => {
      clearTimeout(timer)
      const q = input.value.trim()
      if (q.length < 2 || !window.api?.autocompletar) { seq++; ocultar(); return }
      const mio = ++seq
      timer = setTimeout(async () => {
        let lista = []
        try { lista = await window.api.autocompletar(tipo, q) } catch (e) {}
        if (mio === seq && document.activeElement === input && input.value.trim() === q) pintar(lista || [])
      }, 220)
    })
    // Captura: así Enter con una sugerencia marcada no dispara la búsqueda del texto a medias
    input.addEventListener('keydown', e => {
      if (!items.length) return
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; marcar() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; marcar() }
      else if ((e.key === 'Enter' || e.key === 'Tab') && idx >= 0) { e.preventDefault(); e.stopImmediatePropagation(); elegir(idx) }
      else if (e.key === 'Escape') { e.stopPropagation(); ocultar() }
      else if (e.key === 'Enter') { clearTimeout(timer); seq++; ocultar() }   // Enter sin elegir: búsqueda normal
    }, true)
    input.addEventListener('blur', () => setTimeout(ocultar, 150))
  }

  // Al elegir se simula Enter en el buscador: así cada uno busca con su propia
  // lógica (historial, página de resultados, filtros) y además se cancela el
  // "buscar al dejar de escribir" pendiente con el texto a medias.
  const _enter = id => () => document.getElementById(id)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  document.addEventListener('DOMContentLoaded', () => {
    acAdjuntar({ inputId: 'buscador-2',       tipo: 'anime', alElegir: _enter('buscador-2') })
    acAdjuntar({ inputId: 'anime-bib-input',  tipo: 'anime', alElegir: _enter('anime-bib-input') })
    acAdjuntar({ inputId: 'manga-buscador-2', tipo: 'manga', alElegir: _enter('manga-buscador-2') })
    acAdjuntar({ inputId: 'mnbib-input',      tipo: 'manga', alElegir: _enter('mnbib-input') })
  })
  window.acAdjuntar = acAdjuntar
})()
