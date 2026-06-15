'use strict'
// ── Fuente: ZonaTMO ──────────────────────────────────────────────────────────
// Recibe las dependencias compartidas del proceso principal (main.js)
// y devuelve el objeto fuente con la interfaz estándar:
//   { id, nombre, dominio, BASE, HEADERS, _tendCache,
//     fetchTendencias(), buscarManga(q), getDetalle(url, t), getPaginas(url) }

const axios   = require('axios')
const cheerio = require('cheerio')

module.exports = function createZonatmoSource(deps) {
  const {
    tmoBrowser, tmoCapBrowser,
    lcCoverCache, lcDetailCache, LC_DETAIL_TTL,
    saveLCCache, saveLCDetailCache,
    UA
  } = deps

  return {
    id:     'zonatmo',
    nombre: 'ZonaTMO',
    dominio: 'zonatmo.org',
    BASE: 'https://zonatmo.org',
    HEADERS: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Referer': 'https://zonatmo.org/'
    },
    _tendCache: null,

    _parsearLinks($, aEls, limite) {
      limite = limite || 24
      const lista = [], vistos = new Set()
      aEls.each((i, el) => {
        if (lista.length >= limite) return false
        const href = $(el).attr('href') || ''
        if (!href.match(/\/library\/(manga|manhwa|manhua)\//)) return
        const link = href.startsWith('http') ? href : this.BASE + href
        if (vistos.has(link)) return
        vistos.add(link)
        let titulo = $(el).attr('title') || ''
        if (!titulo) titulo = $(el).closest('.thumbnail-title, .book-item, [class*="thumb"]').find('h4 a, h3 a').first().text().trim()
        if (!titulo) titulo = $(el).text().trim()
        titulo = titulo.replace(/\s+/g, ' ').trim()
        if (!titulo || titulo.length < 2 || titulo.length > 200) return
        const tipo = href.includes('/manhwa/') ? 'MANHWA' : href.includes('/manhua/') ? 'MANHUA' : 'MANGA'
        let imagen = lcCoverCache.get(link) || ''
        if (!imagen) { const img = $(el).find('img').first().attr('src') || ''; if (img) imagen = img.startsWith('http') ? img : this.BASE + img }
        lista.push({ titulo, link, imagen, cap: '', tipo })
      })
      return lista
    },

    async fetchTendencias() {
      const self = this
      // Parsear links con metadatos completos (título, tipo, rating, demografía)
      function parsearLinks($, aEls, limite) {
        limite = limite || 24
        const lista = [], vistos = new Set()
        aEls.each((i, el) => {
          if (lista.length >= limite) return false
          const href = $(el).attr('href') || ''
          if (!href.match(/\/library\/(manga|manhwa|manhua)\/\d+\//)) return
          const link = href.startsWith('http') ? href : self.BASE + href
          if (vistos.has(link)) return
          vistos.add(link)
          const textoRaw = $(el).text().replace(/\s+/g, ' ').trim()
          const tipoMatch = textoRaw.match(/\s+(MANGA|MANHWA|MANHUA)\s+/)
          let titulo = '', tipo = 'MANGA', rating = 0, demografia = ''
          if (tipoMatch) {
            titulo = textoRaw.slice(0, tipoMatch.index).trim()
            tipo = tipoMatch[1]
            const rm = textoRaw.slice(tipoMatch.index + tipoMatch[0].length).trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/)
            if (rm) { rating = parseFloat(rm[1]) || 0; demografia = rm[2].trim() }
          } else {
            titulo = textoRaw
          }
          if (!titulo || titulo.length < 2 || titulo.length > 150) return
          const imagen = lcCoverCache.get(link) || ''
          lista.push({ titulo: titulo.trim(), link, imagen, cap: '', tipo, rating: rating > 0 ? rating : undefined, demografia: demografia || undefined })
        })
        return lista
      }

      const parseSlice = ($all, html, from, to, lim) => {
        if (from < 0) return []
        const slice = (to > 0) ? html.slice(from, to) : html.slice(from)
        const $s = cheerio.load(slice)
        return parsearLinks($s, $s('a[href*="/library/"]'), lim || 18)
      }

      for (let intento = 0; intento < 2; intento++) {
        try {
          const { data: html } = await axios.get(this.BASE, { headers: this.HEADERS, timeout: 15000 })
          const $ = cheerio.load(html)

          const m = {
            popG:  html.search(/id="pills-populars"/),
            popS:  html.search(/id="pills-populars-boys"/),
            popJ:  html.search(/id="pills-populars-girls"/),
            trendG:html.search(/id="pills-trending"/),
            trendS:html.search(/id="pills-trending-boys"/),
            trendJ:html.search(/id="pills-trending-girls"/),
          }

          const pop = {
            general: parseSlice($, html, m.popG,  m.popS  > 0 ? m.popS  : m.trendG, 18),
            seinen:  parseSlice($, html, m.popS  > 0 ? m.popS  : m.popG,  m.popJ  > 0 ? m.popJ  : m.trendG, 18),
            josei:   parseSlice($, html, m.popJ  > 0 ? m.popJ  : m.popG,  m.trendG > 0 ? m.trendG : html.length, 18),
          }
          const trend = {
            general: parseSlice($, html, m.trendG > 0 ? m.trendG : html.length * 0.6, m.trendS > 0 ? m.trendS : html.length, 18),
            seinen:  parseSlice($, html, m.trendS > 0 ? m.trendS : html.length * 0.7, m.trendJ > 0 ? m.trendJ : html.length, 18),
            josei:   parseSlice($, html, m.trendJ > 0 ? m.trendJ : html.length * 0.8, html.length, 18),
          }

          // Fallback: si no hay markers, usar todos los links del home
          if (!pop.general.length && !trend.general.length) {
            console.warn('[zonatmo] markers no encontrados, usando fallback global')
            const todos = parsearLinks($, $('a[href*="/library/"]'), 54)
            pop.general   = todos.slice(0, 18)
            trend.general = todos.slice(18, 36)
            const nuevosFb = todos.slice(36, 54)
            ;[pop.general, pop.seinen, pop.josei, trend.general, trend.seinen, trend.josei, nuevosFb]
              .forEach(l => l.forEach(mn => { if (!mn.imagen) mn.imagen = lcCoverCache.get(mn.link) || '' }))
            return { pop, trend, nuevos: nuevosFb }
          }

          // Dedup entre tabs
          const dedup = (listas) => {
            const seen = new Set()
            listas.forEach(l => l.forEach(mn => { if (seen.has(mn.link)) mn._dup = true; else seen.add(mn.link) }))
            listas.forEach((l, i) => { if (i > 0) listas[i] = l.filter(mn => !mn._dup) })
          }
          dedup([pop.general, pop.seinen, pop.josei])
          dedup([trend.general, trend.seinen, trend.josei])

          // Nuevos: /biblioteca ordenado por fecha de creación
          let nuevos = []
          try {
            const { data: bHtml } = await axios.get(
              this.BASE + '/biblioteca?order_item=creation&order_dir=desc&_pg=1',
              { headers: this.HEADERS, timeout: 8000 }
            )
            const $b = cheerio.load(bHtml)
            nuevos = parsearLinks($b, $b('a[href*="/library/"]'), 18)
          } catch(e) { console.error('[zonatmo] nuevos:', e.message) }

          const todas = [pop.general, pop.seinen, pop.josei, trend.general, trend.seinen, trend.josei, nuevos]
          todas.forEach(l => l.forEach(mn => { if (!mn.imagen) mn.imagen = lcCoverCache.get(mn.link) || '' }))

          return { pop, trend, nuevos }
        } catch(e) {
          console.error('[zonatmo] fetchTendencias intento ' + (intento+1) + ':', e.message)
          if (intento === 0) await new Promise(r => setTimeout(r, 2000))
        }
      }
      return null
    },

    async buscarManga(query) {
      let url
      if (query && query.startsWith('{')) {
        const p = JSON.parse(query)
        const params = new URLSearchParams()
        if (p.title)      params.set('title', p.title)
        if (p.type)       params.set('type', p.type)
        if (p.demography) params.set('demography', p.demography)
        if (p.order_item) params.set('order_item', p.order_item || 'likes')
        if (p.order_dir)  params.set('order_dir',  p.order_dir  || 'desc')
        if (p.pg)         params.set('pg', p.pg)
        if (p.genders && p.genders.length)               p.genders.forEach(g => params.append('genders[]', g))
        if (p.exclude_genders && p.exclude_genders.length) p.exclude_genders.forEach(g => params.append('exclude_genders[]', g))
        url = this.BASE + '/biblioteca?' + params.toString()
      } else if (query.startsWith('__seccion__')) {
        const parts = query.replace('__seccion__', '').split(':')
        const ordenMap = { likes:'likes_count', score:'score', creation:'creation', trending:'trending', alphabetic:'alphabetic' }
        const orden = ordenMap[parts[0]] || parts[0]
        const pag = parts[1] || '1'
        url = this.BASE + '/biblioteca?order_item=' + orden + '&order_dir=desc&_pg=' + pag + '&filter_by=title&title=&type=&demography=&status='
        if (parseInt(pag) > 1) url += '&page=' + pag
      } else {
        url = this.BASE + '/biblioteca?order_item=likes_count&order_dir=desc&title=' + encodeURIComponent(query) + '&filter_by=title&_pg=1'
      }
      console.log('[buscar-manga][zonatmo]', url)
      const html = await tmoBrowser(url, this.BASE, 3000)
      if (!html) return []
      const $ = cheerio.load(html)
      const lista = this._parsearLinks($, $('a[href*="/library/"]'), 48)
      lista.forEach(m => { if (!m.imagen) m.imagen = lcCoverCache.get(m.link) || '' })
      return lista
    },

    async getDetalle(url, tituloFallback) {
      // Cache con TTL
      const cached = lcDetailCache.get(url)
      if (cached && cached.ts && Date.now() - cached.ts < LC_DETAIL_TTL) return cached.data

      try {
        const { data } = await axios.get(url, { headers: this.HEADERS, timeout: 10000 })
        const $ = cheerio.load(data)

        const TIPOS = new Set(['MANGA','MANHWA','MANHUA'])
        let titulo = ''
        $('h1').each((i, el) => {
          const t = $(el).text().trim()
          if (!TIPOS.has(t.toUpperCase()) && t.length > 1) { titulo = t; return false }
        })
        if (!titulo) titulo = ($('meta[property="og:title"]').attr('content') || '').replace(/^Ver\s+/i,'').replace(/\s+Online Gratis.*$/i,'').trim()
        if (!titulo) titulo = tituloFallback || ''

        const imagen = $('meta[property="og:image"]').attr('content') || lcCoverCache.get(url) || ''
        if (imagen) { lcCoverCache.set(url, imagen); saveLCCache() }

        let sinopsis = $('meta[property="og:description"]').attr('content') || ''
        sinopsis = sinopsis.replace(/^Lee .+ en l[íi]nea gratis\.\s*/i,'').trim()
        if (sinopsis.length < 30) sinopsis = $('[class*="description"] p, [class*="sinopsis"] p').first().text().trim() || sinopsis

        const generos = []
        $('h6 a[href*="genders"]').each((i, el) => {
          const g = $(el).text().trim()
          if (g && g.length < 30 && !generos.includes(g)) generos.push(g)
        })

        let estadoTxt = ''
        $('h5, h6, strong, b').each((i, el) => {
          if ($(el).text().trim().toLowerCase() === 'estado') {
            estadoTxt = $(el).next().text().trim() || $(el).parent().next().text().trim()
            return false
          }
        })

        const capitulos = [], vistos = new Set()
        $('li').each((i, liEl) => {
          const leerLink = $(liEl).find('a[href*="/view_uploads/"]').first()
          if (!leerLink.length) return
          const href = leerLink.attr('href') || ''
          if (vistos.has(href)) return
          vistos.add(href)
          const fullLink = href.startsWith('http') ? href : this.BASE + href
          const h4Text = $(liEl).find('h4, h3').first().text().trim()
          const numMatch = h4Text.match(/(\d+(?:\.\d+)?)/)
          const num = numMatch ? numMatch[1] : String(capitulos.length + 1)
          const liTexto = $(liEl).text()
          const fechaMatch = liTexto.match(/(\d{2}\/\d{2}\/\d{4})/)
          const fecha = fechaMatch ? fechaMatch[1] : ''
          capitulos.push({ num, link: fullLink, fecha })
        })
        capitulos.sort((a, b) => parseFloat(b.num) - parseFloat(a.num))

        let tipo = 'MANGA'
        $('h1').each((i, el) => {
          const t = $(el).text().trim().toUpperCase()
          if (TIPOS.has(t)) { tipo = t; return false }
        })
        if (tipo === 'MANGA') {
          if (url.includes('/library/manhwa/')) tipo = 'MANHWA'
          else if (url.includes('/library/manhua/')) tipo = 'MANHUA'
        }

        const result = { titulo, imagen, sinopsis, generos: generos.slice(0, 8), capitulos, estado: estadoTxt, tipo }
        lcDetailCache.set(url, { data: result, ts: Date.now() })
        saveLCDetailCache()
        return result
      } catch(e) { console.error('[manga-detalle][zonatmo]', e.message); return null }
    },

    async getPaginas(url) {
      return tmoCapBrowser(url, this.BASE, 4500)
    }
  }
}

