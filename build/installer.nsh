; ── RYOKU — Script NSIS personalizado ────────────────────────────────────

; ── Tema oscuro ───────────────────────────────────────────────────────────
!macro customHeader
  !ifdef MUI_BGCOLOR
    !undef MUI_BGCOLOR
  !endif
  !ifdef MUI_TEXTCOLOR
    !undef MUI_TEXTCOLOR
  !endif
  !define MUI_BGCOLOR               "0D1525"
  !define MUI_TEXTCOLOR             "F1F5F9"
!macroend

; ── Al terminar la instalación ────────────────────────────────────────────
!macro customInstall
!macroend

; ── Al desinstalar ────────────────────────────────────────────────────────
!macro customUnInstall
  ; Si es actualización (modo silencioso), no tocar los datos del usuario
  IfSilent ryoku_skip_data

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "¿Deseas eliminar también los datos guardados de RYOKU?$\n$\n\
(Progreso de series, manga, configuración, caché)$\n$\n\
Si dices NO, estos archivos quedarán en tu equipo." \
    IDNO ryoku_skip_data

  RMDir /r "$APPDATA\RYOKU"
  RMDir /r "$LOCALAPPDATA\RYOKU"
  RMDir /r "$APPDATA\ryoku"
  RMDir /r "$LOCALAPPDATA\ryoku"

  ryoku_skip_data:
!macroend
