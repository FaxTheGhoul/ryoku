'use strict'

const { BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const ACCENTS = {
  blue:   { primary:'#2563EB', glow:'#60A5FA', rgb:'37,99,235'   },
  purple: { primary:'#7C3AED', glow:'#A78BFA', rgb:'124,58,237'  },
  rose:   { primary:'#E11D48', glow:'#FB7185', rgb:'225,29,72'   },
  green:  { primary:'#059669', glow:'#34D399', rgb:'5,150,105'   },
  orange: { primary:'#EA580C', glow:'#FB923C', rgb:'234,88,12'   },
  cyan:   { primary:'#0891B2', glow:'#22D3EE', rgb:'8,145,178'   },
  gold:   { primary:'#D97706', glow:'#FCD34D', rgb:'217,119,6'   },
  pink:   { primary:'#DB2777', glow:'#F472B6', rgb:'219,39,119'  },
}

const TEMAS = {
  oscuro: { bg:'#0F172A', door1:'#111827', door2:'#0d1525' },
  oled:   { bg:'#000000', door1:'#080808', door2:'#040404' },
  claro:  { bg:'#F1F5F9', door1:'#E2E8F0', door2:'#CBD5E1' },
}

const MIN_SPLASH_MS = 8000


function createSplash(mainWindow, appConfig = {}) {
  const startTime = Date.now()

  // Leer tema y acento directamente del appConfig pasado desde main.js
  const modo = appConfig['app-modo'] || 'oscuro'
  let tema = TEMAS[modo] || TEMAS.oscuro
  let brightness = 0.55, ssOpacity = 0.92
  if (modo === 'claro')  { brightness = 0.92; ssOpacity = 0.88 }
  else if (modo === 'oled') { brightness = 0.35; ssOpacity = 0.92 }
  let accent = ACCENTS[appConfig['app-accent']] || ACCENTS.blue

  let screenshotUrl = ''
  try {
    const p = path.join(os.homedir(), '.ryoku-screenshot.png')
    if (fs.existsSync(p)) screenshotUrl = 'file:///' + p.replace(/\\/g, '/')
  } catch(e) {}

  const bounds = mainWindow.getBounds()
  const splash = new BrowserWindow({
    width: bounds.width, height: bounds.height,
    x: bounds.x, y: bounds.y,
    frame: false, resizable: false,
    alwaysOnTop: false, skipTaskbar: false,
    backgroundColor: tema.bg,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'renderer', 'splash_preload.js')
    }
  })

  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'), {
    query: {
      bg: tema.bg, door1: tema.door1, door2: tema.door2,
      brightness: String(brightness), ssOpacity: String(ssOpacity),
      accentPrimary: accent.primary, accentGlow: accent.glow, accentRgb: accent.rgb,
      screenshot: screenshotUrl,
    }
  })
  splash.focus()
  // mainWindow permanece oculto (show:false) hasta que el splash cierre
  // → el preview de la barra de tareas muestra el splash, no el home

  function cerrarSplash() {
    if (!splash.isDestroyed()) splash.close()
    if (!mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  }

  function pedirCierre() {
    clearTimeout(timeout)
    if (splash.isDestroyed()) { cerrarSplash(); return }

    const elapsed   = Date.now() - startTime
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed)

    setTimeout(() => {
      if (splash.isDestroyed()) { cerrarSplash(); return }
      try { splash.setIgnoreMouseEvents(true, { forward: true }) } catch(e) {}
      splash.webContents.send('splash-close')
    }, remaining)
  }

  const timeout = setTimeout(pedirCierre, 20000)
  ipcMain.once('splash-done', cerrarSplash)
  ipcMain.once('app-ready',   pedirCierre)

  return splash
}

module.exports = { createSplash }
