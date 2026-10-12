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

; ── Al iniciar el instalador ──────────────────────────────────────────────
; Bug conocido de electron-builder/NSIS: cuando se actualiza RYOKU sobre una
; instalación existente, uninstallOldVersion() (installUtil.nsh) ejecuta el
; desinstalador de la versión anterior en modo SILENCIOSO (/S). Ese camino
; silencioso dispara un chequeo de "aplicación en ejecución" que da falsos
; positivos de forma intermitente, incluso con RYOKU ya cerrado, mostrando
; "No se puede cerrar RYOKU" o "Fallo al desinstalar archivos antiguos de la
; aplicación...: 2" y dejando la actualización a medias.
;
; uninstallOldVersion() busca el valor UninstallString en la clave de registro
; de desinstalación; si no lo encuentra, retorna de inmediato sin ejecutar
; nada (ver installUtil.nsh). Como installApplicationFiles sobrescribe de
; todas formas todos los archivos con los de la nueva versión, evitamos por
; completo ese desinstalador silencioso limpiando ese valor ANTES de que se
; lea. Esto NO afecta la detección de la carpeta de instalación existente:
; esa se lee de una clave de registro distinta (Software\${APP_GUID}), así
; que la actualización sigue instalando en el mismo directorio de siempre.
;
; GUID confirmado en este equipo vía:
;   reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall" /s /f "RYOKU"
; Ese GUID se deriva de forma determinística del appId (com.ryoku.anime), así
; que es estable entre versiones mientras el appId no cambie.
!macro customInit
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\4590067f-5602-534c-af96-512b9bd98f24" "UninstallString"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\4590067f-5602-534c-af96-512b9bd98f24" "UninstallString"
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
