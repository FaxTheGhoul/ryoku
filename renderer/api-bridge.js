'use strict'
// ── renderer/api-bridge.js ────────────────────────────────────────────────────
// Capa de abstracción: detecta si corre en Electron o en Android/Web
// y enruta las llamadas al IPC local o al servidor REST.
//
// USO en cualquier módulo del renderer:
//   const { api } = window._apiBridge   (disponible globalmente desde index.html)
//
// Las firmas son idénticas a window.api de Electron.

;(function() {
  const IS_ELECTRON = !!(window.api && window.api.getRecientes)
  const SERVER_URL   = window._RYOKU_SERVER || 'https://ryoku.onrender.com'

  // ── Helper fetch ─────────────────────────────────────────────────────────────
  async function _get(path, params = {}) {
    const url = new URL((window._RYOKU_SERVER || SERVER_URL) + path)
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
    })
    const r = await fetch(url.toString())
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  }

  async function _post(path, body) {
    const r = await fetch((window._RYOKU_SERVER || SERVER_URL) + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  }

  // ── Fuente activa (guardada localmente en web/Android) ─────────────────────
  function _getAnimeSource()  { return localStorage.getItem('ryoku-anime-src')  || 'latanime' }
  function _getMangaSource()  { return localStorage.getItem('ryoku-manga-src')  || 'zonatmo'  }
  function _setAnimeSource(id){ localStorage.setItem('ryoku-anime-src', id) }
  function _setMangaSource(id){ localStorage.setItem('ryoku-manga-src', id) }

  // ── Config local (web/Android usa localStorage) ────────────────────────────
  const _localConfig = JSON.parse(localStorage.getItem('ryoku-config') || '{}')
  function _saveConfig() { localStorage.setItem('ryoku-config', JSON.stringify(_localConfig)) }


  // ── Extractor local: usa WebView nativo de Android (MainActivity.java) ──────
  // Cada dispositivo extrae su propio stream — el servidor no necesita Playwright.
  let _cbCounter = 0
  function _getStreamLocal(url) {
    if (!window._nativeExtractor) {
      // PC/web: caer al servidor REST directamente
      return _get('/api/anime/stream', { url }).catch(() => null)
    }
    return new Promise((resolve) => {
      const cbId = 'sc' + (++_cbCounter)
      window._ryokuNativeCb = (id, streamUrl) => {
        if (id !== cbId) return
        window._ryokuNativeCb = null
        if (streamUrl) {
          const tipo = streamUrl.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4'
          resolve({ tipo, url: streamUrl })
        } else {
          // Timeout: fallback al servidor REST
          _get('/api/anime/stream', { url }).then(resolve).catch(() => resolve(null))
        }
      }
      window._nativeExtractor.extractStream(url, cbId)
    })
  }

  // ── API web/Android (llama al servidor REST) ───────────────────────────────
  const webApi = {
    // Anime
    getRecientes:      ()             => _get('/api/anime/recientes',  { source: _getAnimeSource() }),
    buscar:            (q, filtros)   => _get('/api/anime/buscar',     { q, source: _getAnimeSource(), ...filtros }),
    getAnime:          (url)          => _get('/api/anime/detalle',    { url, source: _getAnimeSource() }),
    getServidores:     (url)          => _get('/api/anime/servidores', { url, source: _getAnimeSource() }),
    getStream:         (url)          => _getStreamLocal(url),
    getCalendario:     ()             => _get('/api/anime/calendario', { source: _getAnimeSource() }),
    getAnimeBiblioteca:(params)       => _get('/api/anime/biblioteca', { source: _getAnimeSource(), ...params }),
    checkServidores:   (servidores)   => _post('/api/anime/check-servidores', { servidores }),
    checkNuevosEps:    (items)        => _post('/api/anime/check-nuevos-eps', { items }),
    getProxyUrl:       (url, referer) => Promise.resolve(`${SERVER_URL}/proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer||url)}`),

    // Manga
    getMangaTendencias: ()            => _get('/api/manga/tendencias', { source: _getMangaSource() }),
    buscarManga:        (q)           => _get('/api/manga/buscar',     { q, source: _getMangaSource() }),
    getMangaDetalle:    (url, titulo) => _get('/api/manga/detalle',    { url, source: _getMangaSource() }),
    getMangaPaginas:    (url, si)     => _get('/api/manga/paginas',    { url, source: _getMangaSource(), sourceIdx: si }),
    getMangaPortada:    (url)         => _get('/api/manga/portada',    { url }),
    sugerirManga:       (q)           => _get('/api/manga/buscar',     { q, source: _getMangaSource() }),

    // Fuentes
    getAnimeSources: () => Promise.resolve([{ id:'latanime', nombre:'Latanime' },{ id:'animeflv', nombre:'AnimeFLV' }]),
    getAnimeSource:  () => Promise.resolve(_getAnimeSource()),
    setAnimeSource:  (id) => { _setAnimeSource(id); return Promise.resolve(true) },
    getMangaSources: () => Promise.resolve([{ id:'zonatmo', nombre:'ZonaTMO' },{ id:'novelcool', nombre:'NovelCool' }]),
    getMangaSource:  () => Promise.resolve(_getMangaSource()),
    setMangaSource:  (id) => { _setMangaSource(id); return Promise.resolve(true) },

    // Config
    configGet:    ()        => Promise.resolve(_localConfig),
    configSet:    (k, v)    => { _localConfig[k] = v; _saveConfig(); return Promise.resolve() },
    configSetAll: (data)    => { Object.assign(_localConfig, data); _saveConfig(); return Promise.resolve() },

    // Datos de usuario — manejados por Firebase directamente (sync.js los guarda en Firestore)
    // En Android no hay almacenamiento local de archivos, todo va a Firebase.
    getFavs:          ()          => {
      const _srcDomain = { latanime:'latanime.org', animeflv:'animeflv.net', monoschinos:'monoschinos.st' }[_getAnimeSource()] || ''
      const all = JSON.parse(localStorage.getItem('ryoku-favs') || '[]')
      return Promise.resolve(_srcDomain ? all.filter(f => (f.url||'').includes(_srcDomain)) : all)
    },
    toggleFav:        (anime)     => {
      const favs = JSON.parse(localStorage.getItem('ryoku-favs') || '[]')
      const idx  = favs.findIndex(f => f.url === anime.url)
      idx >= 0 ? favs.splice(idx, 1) : favs.push(anime)
      localStorage.setItem('ryoku-favs', JSON.stringify(favs))
      const _srcDomain = { latanime:'latanime.org', animeflv:'animeflv.net', monoschinos:'monoschinos.st' }[_getAnimeSource()] || ''
      return Promise.resolve(_srcDomain ? favs.filter(f => (f.url||'').includes(_srcDomain)) : favs)
    },
    isFav:            (url)       => {
      const favs = JSON.parse(localStorage.getItem('ryoku-favs') || '[]')
      return Promise.resolve(favs.some(f => f.url === url))
    },
    getHistorial:     ()          => {
      const _srcDomain = { latanime:'latanime.org', animeflv:'animeflv.net', monoschinos:'monoschinos.st' }[_getAnimeSource()] || ''
      const all = JSON.parse(localStorage.getItem('ryoku-hist') || '[]')
      return Promise.resolve(_srcDomain ? all.filter(h => (h.link||'').includes(_srcDomain)) : all)
    },
    addHistorial:     (ep)        => {
      const hist = JSON.parse(localStorage.getItem('ryoku-hist') || '[]').filter(h => h.link !== ep.link)
      hist.unshift(ep)
      localStorage.setItem('ryoku-hist', JSON.stringify(hist.slice(0, 200)))
      const _srcDomain = { latanime:'latanime.org', animeflv:'animeflv.net', monoschinos:'monoschinos.st' }[_getAnimeSource()] || ''
      return Promise.resolve(_srcDomain ? hist.filter(h => (h.link||'').includes(_srcDomain)) : hist)
    },
    removeHistorial:  (link)      => {
      const hist = JSON.parse(localStorage.getItem('ryoku-hist') || '[]').filter(h => h.link !== link)
      localStorage.setItem('ryoku-hist', JSON.stringify(hist))
      return Promise.resolve()
    },
    clearHistorial:   ()          => {
      const _srcDomain = { latanime:'latanime.org', animeflv:'animeflv.net', monoschinos:'monoschinos.st' }[_getAnimeSource()] || ''
      const hist = JSON.parse(localStorage.getItem('ryoku-hist') || '[]').filter(h => _srcDomain ? !(h.link||'').includes(_srcDomain) : false)
      localStorage.setItem('ryoku-hist', JSON.stringify(hist))
      return Promise.resolve([])
    },
    setProgreso:      (link,t,d)  => {
      const prog = JSON.parse(localStorage.getItem('ryoku-prog') || '{}')
      prog[link] = { currentTime:t, duration:d, porcentaje: d>0?(t/d)*100:0 }
      localStorage.setItem('ryoku-prog', JSON.stringify(prog))
      return Promise.resolve()
    },
    getProgreso:      (link)      => {
      const prog = JSON.parse(localStorage.getItem('ryoku-prog') || '{}')
      return Promise.resolve(prog[link] || null)
    },
    getTodosProgresos:()          => Promise.resolve(JSON.parse(localStorage.getItem('ryoku-prog') || '{}')),
    removeProgreso:   (link)      => {
      const prog = JSON.parse(localStorage.getItem('ryoku-prog') || '{}')
      delete prog[link]
      localStorage.setItem('ryoku-prog', JSON.stringify(prog))
      return Promise.resolve()
    },
    restoreFavs:      (lista)     => { localStorage.setItem('ryoku-favs', JSON.stringify(lista)); return Promise.resolve() },
    restoreHistorial: (lista)     => { localStorage.setItem('ryoku-hist', JSON.stringify(lista)); return Promise.resolve() },
    restoreProgresos: (datos)     => { localStorage.setItem('ryoku-prog', JSON.stringify(datos)); return Promise.resolve() },

    // Fondo e imagen
    bgGet: ()         => Promise.resolve(localStorage.getItem('ryoku-bg') || null),
    bgSet: (dataUrl)  => { localStorage.setItem('ryoku-bg', dataUrl); return Promise.resolve() },

    // Versión (para auto-update Android)
    getAppVersion: () => fetch(`${SERVER_URL}/version`).then(r=>r.json()).then(v=>v.version).catch(()=>'0.0.0'),

    // Eventos de ciclo de vida (no-op en web/Android)
    onSaveBeforeQuit:   ()   => {},
    saveBeforeQuitDone: ()   => {},
    onMaximizeChange:   ()   => {},
    isMaximized:        ()   => Promise.resolve(false),
    minimize:           ()   => {},
    maximize:           ()   => {},
    close:              ()   => {},
    winDrag:            ()   => {},
    startMove:          ()   => {},
    appReady:           ()   => {},
    discordUpdate:      ()   => {},
    discordClear:       ()   => {},

    // Auth
    googleAuth: () => {
      // En Android, usar Firebase Auth directamente (popup o redirect)
      // sync.js ya maneja esto a través de Firebase SDK
      return Promise.resolve({ error: 'use-firebase-sdk' })
    },

    // Enriquecimiento MAL
    enriquecerAnime: (titulo) => Promise.resolve(null),

    // Eventos NovelCool (no-op en web — se emiten desde el servidor si aplica)
    onNcPagesMore:  () => {},
    offNcPagesMore: () => {},
    onNcPagesDone:  () => {},
    offNcPagesDone: () => {},
    onAoCFUnlocking:() => {},

    // Auto-updater (Android lo maneja diferente)
    onUpdateAvailable:  () => {},
    onUpdateProgress:   () => {},
    onUpdateDownloaded: () => {},
    onUpdateError:      () => {},
    updateDownload:     () => {},
    updateInstall:      () => {},
    checkForUpdates:    () => Promise.resolve(null),

    // Historial antiguo (clear)
    clearStreamCache: () => Promise.resolve(),
    clearCache:       () => Promise.resolve(),
    openBgImage: () => new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.style.display = 'none'
      document.body.appendChild(input)
      input.onchange = () => {
        const file = input.files && input.files[0]
        document.body.removeChild(input)
        if (!file) { resolve(null); return }
        const reader = new FileReader()
        reader.onload = (e) => resolve(e.target.result)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
      }
      input.addEventListener('cancel', () => { document.body.removeChild(input); resolve(null) })
      input.click()
    }),
    setWinBg:         () => {},
    onSplashBg:       () => {},
  }

  // ── Exportar: usa Electron si está disponible, sino la API web ─────────────
  window._apiBridge = {
    api:        IS_ELECTRON ? window.api : webApi,
    isElectron: IS_ELECTRON,
    serverUrl:  SERVER_URL,
  }

  // En Android/Web: exponer webApi como window.api para que el código existente
  // que llama window.api.* funcione sin ningún cambio.
  if (!IS_ELECTRON) {
    window.api = webApi
    // Activar layout mobile cuando el DOM esté listo
    const _IS_ELECTRON_UA = /Electron\//.test(navigator.userAgent)
    const _applyMobile = () => {
      if (!_IS_ELECTRON_UA) document.body.classList.add('mobile-mode')

      // ── Posicionar FABs por encima del nav bar real ──────────────────────
      const _fixFabPos = () => {
        const sidebar  = document.querySelector('.sidebar')
        const fabFr    = document.getElementById('friends-fab')
        const fabCh    = document.getElementById('chat-fab')
        if (!sidebar || !fabFr || !fabCh) { setTimeout(_fixFabPos, 300); return }
        const navH = sidebar.getBoundingClientRect().height
        const base = Math.ceil(navH) + 18          // 18px sobre el nav
        fabFr.style.setProperty('bottom', base + 'px', 'important')
        fabCh.style.setProperty('bottom', (base + 52 + 12) + 'px', 'important')
        fabFr.style.setProperty('right', '14px', 'important')
        fabCh.style.setProperty('right', '14px', 'important')
      }
      if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', () => setTimeout(_fixFabPos, 400))
      else setTimeout(_fixFabPos, 400)

      // ── Botón atrás / gesto de volver de Android ───────────────────────
      // MainActivity.java llama window._ryokuHandleBack() directamente desde
      // onBackPressed() — sin depender de @capacitor/app.
      // Devuelve true si el JS manejó el evento (no cerrar la app),
      // false para que Android ejecute el comportamiento por defecto (salir).
      window._ryokuHandleBack = () => {
        // 1. Fullscreen mobile activo → salir del fullscreen (sin cerrar el player)
        const shell = document.querySelector('.rp-shell')
        if (shell && shell.classList.contains('rp-mobile-fullscreen')) {
          if (typeof toggleFullscreenPlayer === 'function') {
            toggleFullscreenPlayer()
          } else {
            shell.classList.remove('rp-mobile-fullscreen')
            document.body.classList.remove('rp-fs-active')
            const vw = document.getElementById('rp-video-wrap')
            const vid = document.getElementById('player-video')
            if (vw) vw.removeAttribute('style')
            if (vid) { vid.removeAttribute('style'); vid.style.opacity = '1' }
            if (window._nativeExtractor?.exitFullscreen) window._nativeExtractor.exitFullscreen()
          }
          return true
        }

        // 2. Player abierto → cerrar el player
        const playerOverlay = document.getElementById('overlay-player')
        if (playerOverlay?.classList.contains('activo')) {
          if (window.cerrarReproductor) window.cerrarReproductor()
          else playerOverlay.classList.remove('activo')
          return true
        }

        // 3. Selector de servidor abierto → cerrarlo
        const srvOverlay = document.getElementById('overlay-servidor')
        if (srvOverlay?.classList.contains('activo')) {
          srvOverlay.classList.remove('activo')
          return true
        }

        // 4. Overlays generales (módulos, perfil, cuenta)
        const overlays = ['overlay-modulos', 'overlay-perfil', 'account-modal']
        for (const id of overlays) {
          const el = document.getElementById(id)
          if (el && el.style.display !== 'none' && el.style.display !== '') {
            if (window.cerrarSwitcherModulos && id === 'overlay-modulos') window.cerrarSwitcherModulos()
            else el.style.display = 'none'
            return true
          }
        }

        // 5. Página de detalle anime → volver
        const btnVolver = document.getElementById('btn-volver')
        if (btnVolver && document.getElementById('page-anime')?.classList.contains('activa')) {
          btnVolver.click(); return true
        }

        // 6. Página de detalle manga → volver
        const mangaVolver = document.getElementById('manga-btn-volver')
        if (mangaVolver && document.getElementById('page-manga-detalle')?.classList.contains('activa')) {
          mangaVolver.click(); return true
        }

        // 7. Lector de manga → volver
        const lectorVolver = document.getElementById('mn-lector-volver')
        if (lectorVolver && document.getElementById('page-manga-lector')?.classList.contains('activa')) {
          lectorVolver.click(); return true
        }

        // 8. Inicio → false para que MainActivity llame super.onBackPressed() (sale de la app)
        return false
      }

      // ── Pull-to-refresh (arrastrar desde el tope hacia abajo) ────────────────
      

      // Splash creado en index.html (inline script al inicio de <body>)
      // window._triggerSplashOpen() es definido alli


      // Observar grilla-recientes: cuando todas sus imgs cargan → abrir splash
      // Mantener grilla visible mientras carga (cargarRecientes la oculta)
      ;(function _initForceVisible() {
        var _IDS = ['grilla-recientes', 'grilla-series']
        function _fv(el) {
          el.style.setProperty('opacity',    '1', 'important')
          el.style.setProperty('visibility', 'visible', 'important')
        }
        function _watch() {
          _IDS.forEach(function(id) {
            var el = document.getElementById(id)
            if (!el) return
            _fv(el)
            new MutationObserver(function() { _fv(el) }).observe(el, {
              attributes: true, attributeFilter: ['style']
            })
          })
          // Re-intentar si los elementos aun no existen
          setTimeout(function() {
            _IDS.forEach(function(id) {
              var el = document.getElementById(id)
              if (el) _fv(el)
            })
          }, 2000)
        }
        if (document.readyState === 'loading')
          document.addEventListener('DOMContentLoaded', _watch)
        else _watch()
      })()


      // Patch animarEntrada: evitar animacion de entrada en mobile
      ;(function _patchAnimarEntrada() {
        var _mobile_ae = function(mod) {
          var sels = [
            '.home-hero-continuar', '.home-hero-banner',
            '#page-inicio .seccion-titulo:nth-of-type(1)', '#grilla-recientes',
            '#page-inicio .seccion-titulo:nth-of-type(2)', '#grilla-series'
          ]
          sels.forEach(function(s) {
            var el = document.querySelector(s)
            if (!el) return
            el.style.visibility = ''
            el.style.opacity = ''
            el.classList.remove('ryoku-animar')
          })
        }
        _mobile_ae._patched = true

        function _tryPatch() {
          if (typeof window.animarEntrada==='function' && !window.animarEntrada._patched) {
            window.animarEntrada = _mobile_ae
            return true
          }
          return false
        }

        if (!_tryPatch()) {
          var _iv = setInterval(function() {
            if (_tryPatch()) clearInterval(_iv)
          }, 80)
          setTimeout(function() { clearInterval(_iv) }, 8000)
        }
      })()

// Pull-to-refresh manejado por modulos/pull-refresh.js
    }
    if (document.body) _applyMobile()
    else document.addEventListener('DOMContentLoaded', _applyMobile)
  }

  // Warmup: despertar el servidor y mostrar banner mientras espera
  if (!IS_ELECTRON) {
    const _warmup = () => {
      let _banner = null

      const _showBanner = () => {
        if (_banner) re