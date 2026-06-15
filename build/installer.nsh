; ── RYOKU — Script NSIS personalizado ────────────────────────────────────
; Se incluye automáticamente por electron-builder en el instalador/desinstalador.

; ── Al terminar la instalación ──────────────────────────────────────────
!macro customInstall
  ; (nada extra por ahora)
!macroend

; ── Al desinstalar ───────────────────────────────────────────────────────
!macro customUnInstall
  ; Preguntar si el usuario quiere borrar los datos de la app
  ; (progreso, configuración, caché de Firebase, etc.)
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "¿Deseas eliminar también los datos guardados de RYOKU?$\n$\n\
(Progreso de series, manga, configuración, caché)$\n$\n\
Si dices NO, estos archivos quedarán en tu equipo." \
    IDNO ryoku_skip_data

  ; Borrar userData de Electron (%APPDATA%\RYOKU)
  RMDir /r "$APPDATA\RYOKU"

  ; Borrar caché GPU y otros archivos temporales (%LOCALAPPDATA%\RYOKU)
  RMDir /r "$LOCALAPPDATA\RYOKU"

  ; Borrar carpeta de logs si existe
  RMDir /r "$APPDATA\ryoku"
  RMDir /r "$LOCALAPPDATA\ryoku"

  ryoku_skip_data:

!macroend
