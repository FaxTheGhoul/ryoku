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
  const SERVER_URL   = window._RYOKU_SERVER || 'https://ryoku-server.up.railway.app'

  // ── Helper fetch ─────────────────────────────────────────────────────────────
  async function _get(path, params = {}) {
    const url = new URL(SERVER_URL + path)
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
    })
    const r = await fetch(url.toString())
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  }

  async function _post(path, body) {
    const r = await fetch(SERVER_URL + path, {
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

  // ── API web/Android (llama al servidor REST) ───────────────────────────────
  const webApi = {
    // Anime
    getRecientes:      ()             => _get('/api/anime/recientes',  { source: _getAnimeSource() }),
    buscar:            (q, filtros)   => _get('/api/anime/buscar',     { q, source: _getAnimeSource(), ...filtros }),
    getAnime:          (url)          => _get('/api/anime/detalle',    { url, source: _getAnimeSource() }),
    getServidores:     (url)          => _get('/api/anime/servidores', { url, source: _getAnimeSource() }),
    getStream:         (url)          => _get('/api/anime/stream',     { url }),
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
    getFavs:          ()          => Promise.resolve(JSON.parse(localStorage.getItem('ryoku-favs') || '[]')),
    toggleFav:        (anime)     => {
      const favs = JSON.parse(localStorage.getItem('ryoku-favs') || '[]')
      const idx  = favs.findIndex(f => f.url === anime.url)
      idx >= 0 ? favs.splice(idx, 1) : favs.push(anime)
      localStorage.setItem('ryoku-favs', JSON.stringify(favs))
      return Promise.resolve(favs)
    },
    isFav:            (url)       => {
      const favs = JSON.parse(localStorage.getItem('ryoku-favs') || '[]')
      return Promise.resolve(favs.some(f => f.url === url))
    },
    getHistorial:     ()          => Promise.resolve(JSON.parse(localStorage.getItem('ryoku-hist') || '[]')),
    addHistorial:     (ep)        => {
      const hist = JSON.parse(localStorage.getItem('ryoku-hist') || '[]').filter(h => h.link !== ep.link)
      hist.unshift(ep)
      localStorage.setItem('ryoku-hist', JSON.stringify(hist.slice(0, 200)))
      return Promise.resolve(hist)
    },
    removeHistorial:  (link)      => {
      const hist = JSON.parse(localStorage.getItem('ryoku-hist') || '[]').filter(h => h.link !== link)
      localStorage.setItem('ryoku-hist', JSON.stringify(hist))
      return Promise.resolve()
    },
    clearHistorial:   ()          => { localStorage.removeItem('ryoku-hist'); return Promise.resolve([]) },
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
    openBgImage:      () => Promise.resolve(null),
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
  // que llama window.api.* funcione 