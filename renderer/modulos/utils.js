// modulos/utils.js — Helpers y funciones compartidas

// _esc: escapa comillas para uso en atributos onclick. NO escapa backslashes para evitar acumulación.
function _esc(s) { return (s||'').replace(/\\/g,'').replace(/'/g,"\\'").replace(/"/g,'&quot;') }

const _ADULTO_SLUGS = [
  'sin-censura', 'uncensored', 'hentai',
  'overflow', 'desbordandose',
  'venida-de-altura', 'gran-jefe-latino', 'grande-jefe-latino',
  'souryo-to-majiwaru', 'ane-naru-mono',
  'tropical-kiss', 'secret-journey',
  'aki-sora', 'oni-chichi',
  'nuki-doki', 'yariman', 'erotica', 'eroge',
  'namaiki', 'gakuen-de-jikan', 'ane-to-boin',
  'oppai-no-ouja', 'majuu-jouka',
  'kanojo-ga-mimai-ni-konai', 'jk-to-orc',
  'elf-no-oshiego', 'brandish',
  'imaizumin-chi', 'okusama-wa-moto-yariman',
  'resort-boin', 'mankitsu-happening', 'buta-hime',
  // Nuevos detectados
  'kuro-gal-ni-natta', 'shinyuu-to-shitemita',
  'classmate-no-moto-idol', 'shikijou-kyoudan',
  'elf-san-wa-yaserarenai', 'omiai-aite-wa-oshiego',
  'katainaka-ni-totsui-de', 'baka-na-imouto',
  'nee-summer', 'koiito-kinenbi', 'maid-san-to-boin'
]

function _esAdulto(r) {
  if (r.adulto) return true
  // MAL marcó como hentai (fuente más confiable)
  if (r.malGeneros?.includes('Hentai')) return true
  if (r.malRating === 'Rx') return true
  // Categoría con Sin Censura = +18
  if ((r.categoria || '').toLowerCase().includes('sin censura')) return true
  const t = (r.titulo || '').toLowerCase()
  const l = (r.link   || r.url || '').toLowerCase()
  if (t.includes('hentai') || l.includes('hentai')) return true
  if (l.includes('sin-censura') || t.includes('sin censura')) return true
  // Revisar slug del link Y del titulo
  if (_ADULTO_SLUGS.some(s => l.includes(s))) return true
  if (_ADULTO_SLUGS.some(s => t.includes(s))) return true
  return false
}

function _filtrarLista(lista) {
  if (_app18) return lista
  return lista.filter(r => !_esAdulto(r))
}

function _marcarAdultos(lista) {
  return lista.map(r => ({ ...r, adulto: r.adulto || _esAdulto(r) }))
}

function imgLoaded(img) {
  img.classList.add('loaded')
  img.parentElement?.classList.add('loaded')
}

function imgError(img) {
  const wrap = img.parentElement
  if (!wrap) return
  const letra = wrap.dataset.letra || '?'
  wrap.innerHTML = `<div class="tarjeta-thumb"><div class="tarjeta-letra">${letra}</div></div>`
}

function checkLoadedImgs(container) {
  const check = () => container?.querySelectorAll('img').forEach(img => {
    if (img.complete && img.naturalWidth > 0) imgLoaded(img)
  })
  check()
  setTimeout(check, 300)
  setTimeout(check, 1500)
  // Forzar stop del shimmer después de 5s
  setTimeout(() => {
    container?.querySelectorAll('.tarjeta-img-wrap:not(.loaded), .cal-card-img-wrap:not(.loaded), .manga-card-img-wrap:not(.loaded), .mn-card-img-wrap:not(.loaded)').forEach(w => w.classList.add('loaded'))
  }, 5000)
}

function _mostrarToast(msg) {
  let toast = document.getElementById('ryoku-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'ryoku-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = msg
  toast.classList.add('visible')
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => toast.classList.remove('visible'), 3000)
}