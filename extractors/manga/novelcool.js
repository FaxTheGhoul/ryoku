'use strict'
// ── Fuente: NovelCool ────────────────────────────────────────────────────────
// Recibe las dependencias compartidas del proceso principal (main.js)
// y devuelve el objeto fuente con la interfaz estándar:
//   { id, nombre, dominio, BASE, HEADERS, _tendCache,
//     fetchTendencias(), buscarManga(q), getDetalle(url, t), getPaginas(url) }

const cheerio = require('cheerio')
const axios   = require('axios')

module.exports = function createNovelcoolSource(deps) {
  const {
    tmoBrowser, tmoCapBrowser, tmoCapBrowserFast, _browserRunJS, _browserRunJS2Step, _ncCapBrowser,
    lcCoverCache, lcDetailCache, LC_DETAIL_TTL,
    saveLCCache, saveLCDetailCache,
    UA
  } = deps

  // JS que se ejecuta dentro del BrowserWindow para extraer los manga de la homepage
  const _ncExtractJS = [
    '(function(){',
    '  var items=[], seen=new Set();',
    '  var links=Array.from(document.querySelectorAll("a[href]")).filter(function(a){',
    '    var h=a.href||""; return h.indexOf("/novel/")>-1 && !h.match(/\\/category\\/|\\/search\\//);',
    '  });',
    '  links.forEach(function(a){',
    '    if(seen.has(a.href))return; seen.add(a.href);',
    '    var titulo=a.getAttribute("title")||"";',
    '    if(!titulo){var h=a.querySelector("p,h4,h3,h2,.book-name,.title,.novel-title");titulo=h?h.textContent:"";}',
    '    if(!titulo) titulo=a.textContent;',
    '    titulo=(titulo||"").replace(/\\s+/g," ").trim();',
    '    if(!titulo||titulo.length<2||titulo.length>200)return;',
    '    var img=a.querySelector("img");',
    '    var imagen=img?(img.src||img.getAttribute("data-src")||img.getAttribute("data-lazy")||""):"";',
    '    var tipo="MANGA";',
    '    items.push({titulo:titulo, link:a.href, imagen:imagen, cap:"", tipo:tipo});',
    '  });',
    '  return items.slice(0,60);',
    '})()'
  ].join('\n')

  return {
    id:     'novelcool',
    nombre: 'NovelCool',
    dominio: 'es.novelcool.com',
    BASE: 'https://es.novelcool.com',
    HEADERS: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Referer': 'https://es.novelcool.com/'
    },
    _tendCache: null,

    _parsearLinks($, aEls, limite) {
      limite = limite || 24
      const lista = [], vistos = new Set()
      aEls.each((i, el) => {
        if (lista.length >= limite) return false
        const href = $(el).attr('href') || ''
        if (!href.match(/\/novel\/.+/)) return
        const link = href.startsWith('http') ? href : this.BASE + href
        if (vistos.has(link)) return

        // Título: preferir atributo title (compacto y correcto) sobre textContent
        // IMPORTANTE: agregar a vistos SOLO si el título es válido
        // (NovelCool repite el mismo href dos veces — el primer <a> tiene texto largo
        //  sin title, el segundo tiene title="Titulo correcto"; si bloqueamos en el
        //  primero nunca procesamos el segundo)
        let titulo = $(el).attr('title') || ''
        if (!titulo) {
          // Sin title attribute: intentar selector interno antes de caer al textContent
          const hEl = $(el).find('.book-name,.novel-title,.title,h4,h3,h2').first()
          titulo = hEl.length ? hEl.text() : $(el).text().split('\n')[0]
        }
        titulo = titulo.replace(/\s+/g, ' ').trim()
        // Quitar solo rating numérico al final ("Titulo 5.0 Jul 01 2020…")
        // NO quitar texto después de guión — es parte del título ("Bleach - Digital Colored Comics")
        titulo = titulo.replace(/\s+\d+\.?\d*\s+.*$/, '').trim()
        // Descartar si no hay título válido (textos largos = bloques de sinopsis sin title)
        if (!titulo || titulo.length < 2 || titulo.length > 180) return

        // Solo marcar como visto cuando el título es válido
        vistos.add(link)

        const _firstWord = ($(el).text().trim().split(/\s+/)[0] || '').toUpperCase()
        const tipo = _firstWord === 'MANHWA' ? 'MANHWA' : _firstWord === 'MANHUA' ? 'MANHUA' : 'MANGA'

        // Imagen: probar data-src / data-lazy antes de src
        let imagen = lcCoverCache.get(link) || ''
        if (!imagen) {
          const img = $(el).find('img').first()
          if (img.length) {
            imagen = img.attr('data-src') || img.attr('data-lazy') || img.attr('data-original') || img.attr('src') || ''
            if (imagen && !imagen.startsWith('http')) imagen = this.BASE + imagen
            if (imagen && !imagen.includes('novelcool')) imagen = ''
          }
          if (!imagen) {
            const prevImg = $(el).prev('img')
            if (prevImg.length) {
              imagen = prevImg.attr('data-src') || prevImg.attr('data-lazy') || prevImg.attr('src') || ''
              if (imagen && !imagen.startsWith('http')) imagen = this.BASE + imagen
            }
          }
        }
        // Guardar en cache para que getMangaPortada no tenga que re-fetchear la página
        if (imagen) lcCoverCache.set(link, imagen)
        lista.push({ titulo, link, imagen, cap: '', tipo })
      })
      return lista
    },

    async _fetchCategoria(path, limite) {
      const max = limite || 24
      // Async JS: scroll progresivo para forzar lazy loading, luego extrae con mapa href→imagen
      const extractJS = '(async function(){' +
        'window.scrollTo(0,document.body.scrollHeight/2);' +
        'await new Promise(function(r){setTimeout(r,800)});' +
        'window.scrollTo(0,document.body.scrollHeight);' +
        'await new Promise(function(r){setTimeout(r,1000)});' +
        'var imgPorHref=new Map();' +
        'Array.from(document.querySelectorAll("img")).forEach(function(img){' +
          'var src=img.getAttribute("data-src")||img.getAttribute("data-lazy")||img.getAttribute("data-original")||img.getAttribute("data-img-src")||"";' +
          'if(!src||src.indexOf("default_pic")>-1||src.indexOf("placeholder")>-1)src=img.src||"";' +
          'if(!src||src.indexOf("http")!==0)return;' +
          'var a=img.closest("a[href]");' +
          'if(a&&!imgPorHref.has(a.href))imgPorHref.set(a.href,src);' +
        '});' +
        'var items=[],seen=new Set();' +
        'var links=Array.from(document.querySelectorAll("a[href]")).filter(function(a){' +
          'var h=a.href||"";' +
          'return h.indexOf("/novel/")>-1&&!h.match(/\\/category\\/|\\/search\\/|\\/tag\\/|\\/author\\//);' +
        '});' +
        'links.forEach(function(a){' +
          'if(seen.has(a.href))return;seen.add(a.href);' +
          'var hEl=a.querySelector(".book-name,.novel-title,.title,h4,h3,h2,p");' +
          'var titulo=hEl?hEl.textContent.trim():"";' +
          'if(!titulo||titulo.length<2){' +
            'var slug=(a.href||"").replace(/.*\\/novel\\//,"").replace(/\\.html$/,"").replace(/[-_]/g," ").trim();' +
            'if(slug&&slug.length>1&&slug.length<120)titulo=slug;' +
          '}' +
          'titulo=(titulo||"").replace(/\\s+/g," ").trim();' +
          'if(!titulo||titulo.length<2||titulo.length>150)return;' +
          'var imagen=imgPorHref.get(a.href)||"";' +
          'if(!imagen){var img=a.querySelector("img");if(img)imagen=img.getAttribute("data-src")||img.getAttribute("data-lazy")||img.src||"";}' +
          'var _dt=function(a,t){var fw=(a.textContent||\'\'). trim().split(/\\s+/)[0]||\'\';fw=fw.toUpperCase();if(fw===\'MANHWA\')return \'MANHWA\';if(fw===\'MANHUA\')return \'MANHUA\';return \'MANGA\';};' +
        'items.push({titulo:titulo,link:a.href,imagen:imagen,cap:"",tipo:_dt(a,titulo)});' +
        '});' +
        'return items.slice(0,' + max + ');' +
        '})()'
      const items = await _browserRunJS(this.BASE + path, this.BASE, extractJS, 4000)
      if (!items || !items.length) return []
      items.forEach(m => { if (!m.imagen) m.imagen = lcCoverCache.get(m.link) || '' })
      return items
    },

    async fetchTendencias() {
      try {
        console.log('[manga-tendencias][novelcool] cargando 3 categorías en paralelo...')
        const [popItems, trendItems, nuevosItems] = await Promise.all([
          this._fetchCategoria('/category/popular.html', 24),
          this._fetchCategoria('/category/latest.html',  24),
          this._fetchCategoria('/category/new_list.html', 24),
        ])
        const total = popItems.length + trendItems.length + nuevosItems.length
        if (!total) {
          console.warn('[manga-tendencias][novelcool] sin resultados en ninguna categoría')
          return null
        }
        console.log('[manga-tendencias][novelcool] OK — pop:', popItems.length, 'trend:', trendItems.length, 'nuevos:', nuevosItems.length)
        return {
          pop:    { general: popItems,    seinen: [], josei: [] },
          trend:  { general: trendItems,  seinen: [], josei: [] },
          nuevos: nuevosItems
        }
      } catch(e) {
        console.error('[manga-tendencias][novelcool]', e.message)
        return null
      }
    },

    async buscarManga(query) {
      let url, isSearch = false, _filterType = '', _useAdvSearch = false
      const _typeToPath = { manga: '/category/manga.html', manhwa: '/category/manhwa.html', manhua: '/category/manhua.html' }

      // Mapa de IDs numéricos de la UI → nombres exactos del buscador avanzado de NovelCool
      const NC_GENRE = {
        1:'Acción',    2:'Aventura',   3:'Comedia',   4:'Drama',    5:'Fantasía',
        6:'Romance',   7:'Horror',     8:'Ciencia Ficción', 9:'Slice Of Life',
        10:'Sobrenatural', 11:'Deportes', 12:'Isekai', 13:'Histórico',
        14:'Misterio', 15:'Psicológico', 16:'Ecchi',  17:'Harem',
        18:'Magia',    19:'Escolar'
      }
      // Demografía: Seinen no aparece en NC como género
      const NC_DEMO = { 1:null /*Seinen*/, 2:'Shounen', 3:'Josei', 4:'Shoujo' }
      // Mapa de nombre (UI) → slug URL real de NovelCool (/category/SLUG.html)
      // Las URLs de NovelCool usan nombres en inglés
      const NC_SLUG = {
        'Acción':'Action', 'Aventura':'Adventure', 'Animación':'Animation',
        'Apocalíptico':'Post-Apocalyptic', 'Artes marciales':'Martial Arts',
        'Ciberpunk':'Cyberpunk', 'Ciencia Ficción':'Sci-Fi', 'Comedia':'Comedy',
        'Crimen':'Crime', 'Cultivo':'Cultivation', 'Demonios':'Demons',
        'Deporte':'Sports', 'Deportes':'Sports', 'Escolar':'School Life',
        'Extranjero':'Alien', 'Familia':'Family', 'Fantasía':'Fantasy',
        'Género Bender':'Gender Bender', 'Guerra':'Military',
        'Historia':'Historical', 'Histórico':'Historical',
        'Maduro':'Mature', 'Magia':'Magic', 'Militar':'Military',
        'Misterio':'Mystery', 'Musical':'Music', 'Música':'Music',
        'Niños':'Kids', 'Novela':'Novel', 'Oeste':'Western',
        'Parodia':'Parody', 'Policíaca':'Police', 'Policiaco':'Police', 'Policial':'Police',
        'Psicológica':'Psychological', 'Psicológico':'Psychological',
        'Realidad Virtual':'Virtual Reality', 'Reencarnación':'Reincarnation',
        'Retornado':'Isekai', 'Sistema':'System',
        'Sobrenatural':'Super Natural', 'Super Poderes':'Superhero',
        'Superpoderes':'Superhero', 'Supervivencia':'Survival',
        'Telenovela':'Drama', 'Tragedia':'Tragedy', 'Vampiros':'Vampires',
        'Venganza':'Revenge', 'Vida Cotidiana':'Slice Of Life',
        'BL (Boys Love)':'Boys Love', 'GL (Girls Love)':'Girls Love',
        'Shojo':'Shoujo', 'Shojo Ai':'Shoujo-ai',
        'Shonen':'Shounen', 'Shonen Ai':'Shounen Ai',
        'Shonen-Ai':'Shounen Ai', 'Shojo-Ai (Yuri Soft)':'Shoujo-ai',
        'Shonen-Ai (Yaoi Soft)':'Shounen Ai',
      }

      let _incGenres = [], _excGenres = [], _status = '', _year = '', _rate = '', _pTitle = ''
      let _titleFilter = ''

      if (query && query.startsWith('{')) {
        const p = JSON.parse(query)
        const pag = parseInt(p.pg) || 1
        _filterType = (p.type || '').toLowerCase()
        _pTitle = p.title || ''

        // Géneros NC directos (strings del buscador avanzado) tienen prioridad
        if (p.nc_genders?.length)      _incGenres = [...p.nc_genders]
        else if (p.genders?.length)    _incGenres = p.genders.map(id => NC_GENRE[id]).filter(Boolean)
        if (p.nc_exclude?.length)      _excGenres = [...p.nc_exclude]
        else if (p.exclude_genders?.length) _excGenres = p.exclude_genders.map(id => NC_GENRE[id]).filter(Boolean)
        if (p.demography && NC_DEMO[p.demography]) _incGenres.push(NC_DEMO[p.demography])

        _status = p.status || ''
        _year   = p.year   || ''
        _rate   = p.rate   || ''
        const hasFilters = _incGenres.length || _excGenres.length || _status || _year || _rate

        // Añadir tipo como género de inclusión cuando hay otras condiciones activas
        if (_filterType === 'manga')       _incGenres.push('Manga')
        else if (_filterType === 'manhwa') _incGenres.push('Manhwa')
        else if (_filterType === 'manhua') _incGenres.push('Manhua')

        if (_pTitle || hasFilters) {
          // NovelCool: la búsqueda avanzada JS no produce URLs reproducibles.
          // Estrategia:
          //   solo 1 género, sin título       → página de categoría (SSR)
          //   solo título, sin géneros        → ?wd= (SSR)
          //   título + géneros / otros filtros → página de categoría del 1er género
          //                                      + filtro de título en cliente
          //   múltiples géneros sin título    → formulario automatizado (fallback)
          // Mapa Estado → slug de categoría NovelCool
          const NC_STATUS_SLUG = { updated: 'updated', completed: 'completed' }
          const _statusSlug = _status ? NC_STATUS_SLUG[_status] : ''

          const soloUnGenero      = _incGenres.length === 1 && _excGenres.length === 0 && !_pTitle && !_status && !_year && !_rate
          const soloEstado        = !!_statusSlug && !_incGenres.length && !_pTitle && !_year && !_rate
          const soloTitulo        = !!_pTitle && !_incGenres.length && !_excGenres.length && !_status && !_year && !_rate
          const tituloPlusGeneros = !!_pTitle && _incGenres.length >= 1 && _excGenres.length === 0 && !_status && !_year && !_rate

          if (soloEstado) {
            // Estado solo → página de categoría de NC
            url = pag <= 1
              ? this.BASE + '/category/' + _statusSlug + '.html'
              : this.BASE + '/category/' + _statusSlug + '_' + pag + '.html'
            isSearch = false
            _useAdvSearch = false
          } else if (soloUnGenero) {
            // Solo género → página de categoría (SSR)
            const _rawGenre = _incGenres[0]
            const _slugName = NC_SLUG[_rawGenre] || _rawGenre
            const slug = _slugName.replace(/ /g, '+')
            url = pag <= 1
              ? this.BASE + '/category/' + slug + '.html'
              : this.BASE + '/category/' + slug + '_' + pag + '.html'
            isSearch = false
            _useAdvSearch = false
          } else if (tituloPlusGeneros) {
            // Texto + género → buscar por texto (?wd=) que es SSR y fiable.
            // NC no permite filtrado combinado texto+género en SSR;
            // la página de categoría solo tiene los primeros ~48 resultados.
            url = this.BASE + '/search/?wd=' + encodeURIComponent(_pTitle)
            isSearch = true
            _useAdvSearch = false
          } else if (soloTitulo) {
            url = this.BASE + '/search/?wd=' + encodeURIComponent(_pTitle)
            isSearch = true
            _useAdvSearch = false
          } else {
            // Fallback: formulario automatizado (multi-género sin título, o con filtros extra)
            url = this.BASE + '/search/?type=high'
            isSearch = true
            _useAdvSearch = true
          }
        } else if (_filterType && _typeToPath[_filterType]) {
          const basePath = _typeToPath[_filterType].replace('.html', '')
          url = pag <= 1 ? this.BASE + _typeToPath[_filterType] : this.BASE + basePath + '/index_' + pag + '.html'
        } else {
          url = pag <= 1 ? this.BASE + '/category.html' : this.BASE + '/category/index_' + pag + '.html'
        }
      } else if (query.startsWith('__seccion__')) {
        const parts = query.replace('__seccion__', '').split(':')
        const pag = parseInt(parts[1]) || 1
        url = pag <= 1 ? this.BASE + '/category.html' : this.BASE + '/category/index_' + pag + '.html'
      } else {
        // NovelCool usa ?wd= (busca en título+descripción+tags, más amplio que ?name=)
        url = this.BASE + '/search/?wd=' + encodeURIComponent(query)
        isSearch = true
      }
      console.log('[buscar-manga][novelcool]', url, _filterType ? '(tipo: ' + _filterType + ')' : '', _incGenres.length ? '(géneros: ' + _incGenres.join(',') + ')' : '')

      // Fast path: axios solo para búsquedas simples de título (SSR ~500ms)
      // La búsqueda avanzada con géneros es JS-rendered → siempre usar browser
      if (isSearch && !_useAdvSearch) {
        try {
          const res = await axios.get(url, { headers: this.HEADERS, timeout: 8000 })
          const html = res.data
          if (html && !html.includes('Just a moment') && !html.includes('cf-browser-verification') && html.length > 3000) {
            const $ = require('cheerio').load(html)
            let lista = this._parsearLinks($, $('a[href*="/novel/"]'), 48)
            lista.forEach(m => { if (!m.imagen) m.imagen = lcCoverCache.get(m.link) || '' })
            if (_filterType && lista.length) lista = lista.filter(m => (m.tipo||'').toLowerCase() === _filterType)
            // Solo retornar si hay imágenes suficientes (el HTML estático puede tener data-src vacío)
            const _conImagen = lista.filter(m => m.imagen).length
            if (lista.length && _conImagen >= Math.min(3, lista.length)) return lista
          }
        } catch(e) {}
      }

      // JS de extracción de resultados (usado en categorías y como resultado final del form)
      const _extractResultsJS =
        'var imgPorHref=new Map();' +
        'Array.from(document.querySelectorAll("img")).forEach(function(img){' +
          'var src=img.getAttribute("data-src")||img.getAttribute("data-lazy")||img.getAttribute("data-original")||img.getAttribute("data-img-src")||"";' +
          'if(!src||src.indexOf("default_pic")>-1||src.indexOf("placeholder")>-1)src=img.src||"";' +
          'if(!src||src.indexOf("http")!==0)return;' +
          'var a=img.closest("a[href]");' +
          'if(a&&!imgPorHref.has(a.href))imgPorHref.set(a.href,src);' +
        '});' +
        'var items=[],seen=new Set();' +
        'var links=Array.from(document.querySelectorAll("a[href]")).filter(function(a){' +
          'var h=a.href||"";' +
          'return h.indexOf("/novel/")>-1&&!h.match(/\\/category\\/|\\/search\\/|\\/tag\\/|\\/author\\//);' +
        '});' +
        'links.forEach(function(a){' +
          'if(seen.has(a.href))return;seen.add(a.href);' +
          'var hEl=a.querySelector(".book-name,.novel-title,.title,h4,h3,h2,p");' +
          'var titulo=hEl?hEl.textContent.trim():"";' +
          'if(!titulo||titulo.length<2){' +
            'var slug=(a.href||"").replace(/.*\\/novel\\//,"").replace(/\\.html$/,"").replace(/[-_]/g," ").trim();' +
            'if(slug&&slug.length>1&&slug.length<120)titulo=slug;' +
          '}' +
          'titulo=(titulo||"").replace(/\\s+/g," ").trim();' +
          'if(!titulo||titulo.length<2||titulo.length>150)return;' +
          'var imagen=imgPorHref.get(a.href)||"";' +
          'if(!imagen){var img=a.querySelector("img");if(img)imagen=img.getAttribute("data-src")||img.getAttribute("data-lazy")||img.src||"";}' +
          'var _dt=function(a){var fw=(a.textContent||\'\'). trim().split(/\\s+/)[0]||\'\';fw=fw.toUpperCase();if(fw===\'MANHWA\')return \'MANHWA\';if(fw===\'MANHUA\')return \'MANHUA\';return \'MANGA\';};' +
          'items.push({titulo:titulo,link:a.href,imagen:imagen,cap:"",tipo:_dt(a)});' +
        '});' +
        'return items.slice(0,48);'

      let items
      if (_useAdvSearch) {
        // Formulario avanzado: usar _browserRunJS2Step para manejar tanto AJAX como navegación
        const _iJSON = JSON.stringify(_incGenres)
        const _eJSON = JSON.stringify(_excGenres)
        const _title = _pTitle ? JSON.stringify(_pTitle) : 'null'
        const _statusVal = _status ? JSON.stringify(_status) : 'null'
        const _yearVal   = _year   ? JSON.stringify(_year)   : 'null'
        const _rateVal   = _rate   ? JSON.stringify(_rate)   : 'null'

        // fillJs: síncrono, sin async/await — rellena y hace submit del formulario
        // (si hay navegación tras submit, el JS no se interrumpe porque no tiene awaits)
        const fillJs =
          'function _ncClickText(names,times){' +
            'names.forEach(function(g){' +
              'var gL=g.toLowerCase();var found=false;' +
              'var all=document.querySelectorAll("li,span,div,a,td,label,button");' +
              'for(var i=0;i<all.length&&!found;i++){' +
                'var el=all[i];if(el.children.length>0)continue;' +
                'var t=el.textContent.trim();' +
                'if(t===g||t.toLowerCase()===gL){for(var k=0;k<times;k++)el.click();found=true;}' +
              '}' +
            '});' +
          '}' +
          '_ncClickText(' + _iJSON + ',1);' +
          '_ncClickText(' + _eJSON + ',2);' +
          // Título — prueba múltiples selectores y usa setter nativo (compatible React/Vue)
          (_title !== 'null' ? (
            '(function(){' +
            'var ti=document.querySelector("input[name=name],input[name=wd],input[name=keyword],input[name=q],input[type=search],input[type=text]");' +
            'if(ti){' +
              'try{var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;s.call(ti,' + _title + ');}catch(e){ti.value=' + _title + ';}' +
              'ti.dispatchEvent(new Event("input",{bubbles:true}));' +
              'ti.dispatchEvent(new Event("change",{bubbles:true}));' +
            '}' +
            '})();'
          ) : '') +
          // Estado
          (_statusVal !== 'null' ? (
            '(function(){var ss=document.querySelector("select[name=status]");' +
            'if(ss){ss.value=' + _statusVal + ';ss.dispatchEvent(new Event("change",{bubbles:true}));}})();'
          ) : '') +
          // Año
          (_yearVal !== 'null' ? (
            '(function(){var ys=document.querySelector("select[name=year]");' +
            'if(ys){ys.value=' + _yearVal + ';ys.dispatchEvent(new Event("change",{bubbles:true}));}})();'
          ) : '') +
          // Rating
          (_rateVal !== 'null' ? (
            '(function(){var rs=document.querySelector("select[name=rate]");' +
            'if(rs){rs.value=' + _rateVal + ';rs.dispatchEvent(new Event("change",{bubbles:true}));}})();'
          ) : '') +
          // Click en botón de búsqueda — selector permisivo
          '(function(){' +
          'var allB=Array.from(document.querySelectorAll("button,input[type=submit]"));' +
          'var sbtn=allB.find(function(b){var t=(b.textContent||b.value||"").trim().toLowerCase();return /buscar|search/.test(t)||b.type==="submit";});' +
          'if(sbtn){sbtn.click();return;}' +
          'var frm=document.querySelector("form");' +
          'if(frm){var fb=frm.querySelector("button,input[type=submit]");if(fb){fb.click();return;}}' +
          'if(frm){frm.submit();}' +
          '})();'

        // extractJs: scroll + extracción (mismo JS que antes)
        const extractJs = '(async function(){' +
          'window.scrollTo(0,document.body.scrollHeight/2);' +
          'await new Promise(function(r){setTimeout(r,600)});' +
          'window.scrollTo(0,document.body.scrollHeight);' +
          'await new Promise(function(r){setTimeout(r,600)});' +
          _extractResultsJS +
          '})()'

        items = await _browserRunJS2Step(url, fillJs, extractJs, 2500, 5000)
      } else {
        // Categoría normal: scroll + extracción
        const extractBusqJS = '(async function(){' +
          'window.scrollTo(0,document.body.scrollHeight/2);' +
          'await new Promise(function(r){setTimeout(r,800)});' +
          'window.scrollTo(0,document.body.scrollHeight);' +
          'await new Promise(function(r){setTimeout(r,1000)});' +
          _extractResultsJS +
          '})()'
        items = await _browserRunJS(url, this.BASE, extractBusqJS, 4000)
      }

      if (!items || !items.length) return []
      items.forEach(m => { if (!m.imagen) m.imagen = lcCoverCache.get(m.link) || '' })
      // Filtrar por título cuando se combinó género + texto
      if (_titleFilter) items = items.filter(m => m.titulo.toLowerCase().includes(_titleFilter))
      // Si el filtro combinado dejó 0 resultados, hacer fallback a búsqueda por texto
      if (!items.length && _titleFilter) {
        try {
          const _fbUrl = this.BASE + '/search/?wd=' + encodeURIComponent(_titleFilter)
          const _fbRes = await axios.get(_fbUrl, { headers: this.HEADERS, timeout: 8000 })
          if (_fbRes.data && !_fbRes.data.includes('Just a moment') && _fbRes.data.length > 3000) {
            const $ = require('cheerio').load(_fbRes.data)
            items = this._parsearLinks($, $('a[href*="/novel/"]'), 48)
            items.forEach(m => { if (!m.imagen) m.imagen = lcCoverCache.get(m.link) || '' })
          }
        } catch(e) {}
      }
      // Filtrar por tipo si se especificó
      if (_filterType) items = items.filter(m => (m.tipo||'').toLowerCase() === _filterType)
      return items
    },
    // Sugerencias rápidas para autocomplete mientras se escribe
    // Límite alto (30) para capturar también resultados "relacionados"
    // (títulos que contienen la query en cualquier posición, no solo al inicio)
    async sugerencias(query) {
      if (!query || query.length < 2) return []
      try {
        // ?wd= busca en título+descripción+tags (igual que el buscador real del sitio)
        const url = this.BASE + '/search/?wd=' + encodeURIComponent(query)
        const res = await axios.get(url, { headers: this.HEADERS, timeout: 5000 })
        const html = res.data
        if (!html || html.includes('Just a moment') || html.length < 3000) return []
        const $ = cheerio.load(html)
        return this._parsearLinks($, $('a[href*="/novel/"]'), 60)
      } catch(e) {
        return []
      }
    },

    async getDetalle(url, tituloFallback) {
      const cached = lcDetailCache.get(url)
      if (cached && Date.now() - cached.ts < LC_DETAIL_TTL && cached.data && cached.data.capitulos && cached.data.capitulos.length && cached.data.imagen) return cached.data

      // Fast path: axios (~500ms). NovelCool detail pages son mayormente SSR.
      let data = null
      try {
        const res = await axios.get(url, { headers: this.HEADERS, timeout: 8000 })
        const html = res.data
        if (html && !html.includes('Just a moment') && !html.includes('cf-browser-verification') && html.length > 3000) {
          data = html
        }
      } catch(e) {}
      // Browser fallback — wait reducido a 1500ms (SSR, no necesita JS rendering)
      if (!data) data = await tmoBrowser(url, this.BASE, 1500)
      if (!data) return null
      const $ = cheerio.load(data)

      let titulo = ''
      $('h1').each((i, el) => {
        const t = $(el).text().trim()
        if (t.length > 2 && !['manga','manhwa','manhua'].includes(t.toLowerCase())) { titulo = t; return false }
      })
      if (!titulo) titulo = ($('meta[property="og:title"]').attr('content') || '').replace(/\s*[-–|].*$/, '').trim()
      if (!titulo) titulo = tituloFallback || ''

      // Imagen: NovelCool pone la portada en <a href="/chapter/..."><img src="img.novelcool.com/logo/...">
      let imagen = $('meta[property="og:image"]').attr('content') ||
                   $('a[href*="/chapter/"] img[src*="img.novelcool.com/logo"]').first().attr('src') ||
                   $('a[href*="/chapter/"] img[src*="novelcool"]').first().attr('src') ||
                   $('img[src*="img.novelcool.com/logo"]').first().attr('src') ||
                   $('img.book-img, img.book-pic, img.book-img-pic').first().attr('src') || ''
      if (imagen && !imagen.startsWith('http')) imagen = this.BASE + imagen
      if (imagen) { lcCoverCache.set(url, imagen); saveLCCache() }

      // Sinopsis: meta description → selectores específicos → primer párrafo largo
      let sinopsis = $('meta[property="og:description"]').attr('content') || ''
      sinopsis = sinopsis.replace(/Lea la novela ligera en l[íi]nea gratis.*$/i, '').replace(/Read .+ manga online free.*$/i, '').trim()
      if (sinopsis.length < 20) {
        sinopsis = $('.book-intro p, .book-detail-intro p, [class*="intro"] p, [class*="description"] p, .synopsis p, .summary p').first().text().trim() || ''
      }
      if (sinopsis.length < 20) {
        $('p').each((i, el) => {
          const t = $(el).text().trim()
          if (t.length > 80 && !t.match(/novela ligera|NovelCool|Lea (el|la)|leer gratis/i)) { sinopsis = t; return false }
        })
      }

      // Géneros: excluir links de navegación (/category/updated, popular, latest, etc.)
      const NAV_CATS = ['updated','completed','latest','popular','new_list','alphabetic','score','new','hot']
      const generos = []
      $('a[href*="/category/"]').each((i, el) => {
        const href = $(el).attr('href') || ''
        if (NAV_CATS.some(c => href.includes('/category/' + c))) return
        const g = $(el).text().trim()
        if (g && g.length > 1 && g.length < 40 && !generos.includes(g)) generos.push(g)
      })

      let estadoTxt = ''
      $('a[href*="/category/updated"]').each(() => { estadoTxt = 'En marcha'; return false })
      if (!estadoTxt) $('a[href*="/category/completed"]').each(() => { estadoTxt = 'Completado'; return false })

      let tipo = 'MANGA'
      const pageText = (data || '').toUpperCase()
      if (pageText.includes('MANHWA')) tipo = 'MANHWA'
      else if (pageText.includes('MANHUA')) tipo = 'MANHUA'

      const capitulos = [], vistosC = new Set()
      $('a[href*="/chapter/"]').each((i, el) => {
        const href = $(el).attr('href') || ''
        if (!href.match(/\/chapter\/.+\/\d+/)) return
        if (href.match(/\/\d+-\d+\.html/)) return
        const link = (href.startsWith('http') ? href : this.BASE + href).replace(/\.html$/, '').replace(/\/$/, '') + '/'
        if (vistosC.has(link)) return
        vistosC.add(link)
        const texto = $(el).text().replace(/\s+/g, ' ').trim()
        // Extraer número desde el slug — NovelCool codifica "1.50" como "capitulo-1-50" en la URL.
        // Patrón: buscar "capitulo-N" o "cap-N" donde N puede ser "M-D" (decimal separado con guión).
        // Ejemplos:
        //   /chapter/manga-capitulo-445/ID/          → 445
        //   /chapter/manga-capitulo-1-50-extras/ID/  → 1.50
        //   /chapter/manga-cap-tulo-1/ID/            → 1
        const slugPart = href.match(/\/chapter\/([^/]+)\//)?.[1] || ''
        const capMatch = slugPart.match(/(?:cap(?:[a-zíi]+)?|chapter)\b[^0-9]*(\d+(?:[\-.]\d+)?)/i)
        let num
        if (capMatch) {
          // Reemplazar guión decimal: "1-50" → "1.50"
          num = capMatch[1].replace(/^(\d+)-(\d+)$/, '$1.$2')
        } else {
          // Fallback: última secuencia numérica del slug o del texto
          const allNums = [...slugPart.matchAll(/(\d+(?:\.\d+)?)/g)]
          const fromSlug = allNums.length ? allNums[allNums.length - 1][1] : null
          const fromText = texto.match(/(\d+(?:[.-]\d+)?)/)?.[1]
          num = fromSlug || fromText || String(capitulos.length + 1)
        }
        const parentTxt = ($(el).parent().text() + $(el).closest('li, .chapter-item').text()).replace(/\s+/g, ' ')
        const fechaMatch = parentTxt.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}|\d+\s+horas?\s+atras?|\d+\s+d\u00edas?\s+atras?)/i)
        capitulos.push({ num, link, fecha: fechaMatch ? fechaMatch[1] : '', titulo: texto })
      })
      capitulos.sort((a, b) => parseFloat(b.num) - parseFloat(a.num))

      const result = { titulo, imagen, sinopsis, generos: generos.slice(0, 8), capitulos, estado: estadoTxt, tipo }
      lcDetailCache.set(url, { data: result, ts: Date.now() })
      saveLCDetailCache()
      return result
    },

    async getPaginas(url, sourceIdx, onChunk) {
      sourceIdx = sourceIdx || 1
      console.log('[getPaginas][novelcool] fuente', sourceIdx, 'url:', url)

      // Fuentes 2 y 3: browser + source picker de techsmartideas
      if (sourceIdx >= 2) {
        return _ncCapBrowser(url, this.BASE, sourceIdx - 1, 32000, onChunk)
      }

      // Fuente 1: intentar axios SSR primero, browser como fallback
      const extractImg = ($doc) => {
        const BAD = /logo|icon|avatar|header|banner|sprite|favicon|transparent|default_pic|novelcool\.com\/files/i
        let found = ''
        $doc('img').each((_, el) => {
          const s = $doc(el).attr('data-original') ||
                    $doc(el).attr('data-src') ||
                    $doc(el).attr('data-lazy') ||
                    $doc(el).attr('src') || ''
          if (s.startsWith('http') && !BAD.test(s)) { found = s; return false }
        })
        return found
      }

      try {
        const res1 = await axios.get(url, { headers: this.HEADERS, timeout: 12000 })
        const html1 = res1.data
        if (!html1 || html1.includes('Just a moment') || html1.includes('cf-browser-verification')) throw new Error('cf')

        const $1 = cheerio.load(html1)
        const img1 = extractImg($1)
        if (!img1) throw new Error('noimg')

        const totalMatch = html1.match(/\b1\/(\d+)\b/)
        const total = totalMatch ? parseInt(totalMatch[1]) : 1
        if (total <= 1) return [img1]

        const baseU = url.replace(/\/$/, '').replace(/\.html$/, '')
        const subUrls = []
        for (let i = 2; i <= total; i++) subUrls.push(baseU + '-' + i + '.html')

        const BATCH = 8
        const allImgs = [img1]
        for (let b = 0; b < subUrls.length; b += BATCH) {
          const results = await Promise.all(subUrls.slice(b, b + BATCH).map(async (u) => {
            try {
              const r = await axios.get(u, { headers: this.HEADERS, timeout: 8000 })
              if (!r.data || r.data.includes('Just a moment')) return ''
              return extractImg(cheerio.load(r.data))
            } catch(e) { return '' }
          }))
          allImgs.push(...results.filter(Boolean))
        }
        console.log('[getPaginas][novelcool] SSR OK — páginas:', allImgs.length, '/', total)
        return allImgs

      } catch(e) {
        console.warn('[getPaginas][novelcool] SSR falló:', e.message, '— usando browser')
        return _ncCapBrowser(url, this.BASE, 1, 35000, onChunk)
      }
    }
  }
}
