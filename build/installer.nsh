; Idiot Box custom NSIS include (auto-loaded from build/installer.nsh).
; Adds a consent page: "Register Idiot Box as editor?"
; If the user unchecks it, the app still installs but file associations
; registered by electron-builder are rolled back.
;
; NOTE (electron-builder v27): file associations are registered under GENERATED
; ProgIDs ("IdiotBox." + name + UUIDv5 tail), no longer under the plain
; association name, and v27 keeps no backup of previous ".ext" defaults.
; This script therefore snapshots the previous defaults itself in customInit
; (into $TEMP\IdiotBoxAssocBackup.ini) and restores them on opt-out.
; The IB_PROGID_* values below are deterministic for appId
; com.thewonderlandstudio.idiotbox + productFilename "Idiot Box".
; If appId / productName / association names change, regenerate via:
;   node build/print-progids.cjs --nsis

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; ---------------------------------------------------------------------------
; Variables (top-level so they exist before any page/function uses them)
; ---------------------------------------------------------------------------
; Vars + page functions are installer-only (in the uninstaller, unreferenced
; warnings 6001/6010 become errors). customInit/customInstall macros expand
; only in the installer context, so this guard is safe.
!ifndef BUILD_UNINSTALLER
Var IB_RegisterAsEditor
Var IB_RegisterDialog
Var IB_RegisterCheckbox
!endif

; ---------------------------------------------------------------------------
; Generated v27 ProgIDs (see header note). Regenerate with
;   node build/print-progids.cjs --nsis
; ---------------------------------------------------------------------------
!define IB_PROGID_IdiotBoxJavaScript "IdiotBox.IdiotBoxJavaScriptdec33ece203d"
!define IB_PROGID_IdiotBoxReact "IdiotBox.IdiotBoxReact951663f39ccf5862b"
!define IB_PROGID_IdiotBoxTypeScript "IdiotBox.IdiotBoxTypeScript09857832ef9c"
!define IB_PROGID_IdiotBoxReactTS "IdiotBox.IdiotBoxReactTSbd2078aa8a0b58d"
!define IB_PROGID_IdiotBoxHTML "IdiotBox.IdiotBoxHTML658c858c31f75572a7"
!define IB_PROGID_IdiotBoxCSS "IdiotBox.IdiotBoxCSS29657b368e70576a8f1"
!define IB_PROGID_IdiotBoxSCSS "IdiotBox.IdiotBoxSCSS8ae26d882ee1551aba"
!define IB_PROGID_IdiotBoxLESS "IdiotBox.IdiotBoxLESS7ff7178c25eb5ef4a1"
!define IB_PROGID_IdiotBoxJSON "IdiotBox.IdiotBoxJSONa144731874175552a2"
!define IB_PROGID_IdiotBoxMarkdown "IdiotBox.IdiotBoxMarkdownbab6998fcfb356"
!define IB_PROGID_IdiotBoxPython "IdiotBox.IdiotBoxPythond57f404bdec952b6"
!define IB_PROGID_IdiotBoxC "IdiotBox.IdiotBoxCd01a4723103753c5b7092"
!define IB_PROGID_IdiotBoxCHeader "IdiotBox.IdiotBoxCHeader2d334b16fcf3501"
!define IB_PROGID_IdiotBoxCpp "IdiotBox.IdiotBoxCpp42b2aeca86ca55faafc"
!define IB_PROGID_IdiotBoxCppHeader "IdiotBox.IdiotBoxCppHeader594babca41585"
!define IB_PROGID_IdiotBoxJava "IdiotBox.IdiotBoxJava57bee55bbbed5a8995"
!define IB_PROGID_IdiotBoxRust "IdiotBox.IdiotBoxRust1d155d5d7ab55dca85"
!define IB_PROGID_IdiotBoxGo "IdiotBox.IdiotBoxGo2b90dc6207e55ad185af"
!define IB_PROGID_IdiotBoxRuby "IdiotBox.IdiotBoxRuby989b684604815848a4"
!define IB_PROGID_IdiotBoxPHP "IdiotBox.IdiotBoxPHP5984f49e7c28527d9df"
!define IB_PROGID_IdiotBoxShell "IdiotBox.IdiotBoxShell72fb2d2658075d4fb"
!define IB_PROGID_IdiotBoxSQL "IdiotBox.IdiotBoxSQLb943e1b00b3a59c9892"
!define IB_PROGID_IdiotBoxYAML "IdiotBox.IdiotBoxYAMLa800a144f74c5b4b83"
!define IB_PROGID_IdiotBoxXML "IdiotBox.IdiotBoxXML46e53b1cfa965127a14"
!define IB_PROGID_IdiotBoxVue "IdiotBox.IdiotBoxVue38baa208270158ebbdf"
!define IB_PROGID_IdiotBoxSvelte "IdiotBox.IdiotBoxSvelte0bb77e492bb45970"
!define IB_PROGID_IdiotBoxTOML "IdiotBox.IdiotBoxTOML3f58b104cd7c5c1d86"
!define IB_PROGID_IdiotBoxText "IdiotBox.IdiotBoxText0d715b86dcc25de8ad"
!define IB_PROGID_IdiotBoxLog "IdiotBox.IdiotBoxLog85587dca6dce58dfb53"

; Pre-install snapshot of ".ext" defaults (v27 keeps no backup itself).
!define IB_BACKUP_INI "$TEMP\IdiotBoxAssocBackup.ini"

; Snapshot one extension's current default handler (runs in customInit,
; BEFORE electron-builder registers our ProgIDs).
!macro IB_BACKUP_ONE EXT
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  WriteINIStr "${IB_BACKUP_INI}" "backup" "${EXT}" "$R0"
!macroend

!macro IB_BACKUP_ALL
  !insertmacro IB_BACKUP_ONE "js"
  !insertmacro IB_BACKUP_ONE "mjs"
  !insertmacro IB_BACKUP_ONE "cjs"
  !insertmacro IB_BACKUP_ONE "jsx"
  !insertmacro IB_BACKUP_ONE "ts"
  !insertmacro IB_BACKUP_ONE "tsx"
  !insertmacro IB_BACKUP_ONE "html"
  !insertmacro IB_BACKUP_ONE "htm"
  !insertmacro IB_BACKUP_ONE "css"
  !insertmacro IB_BACKUP_ONE "scss"
  !insertmacro IB_BACKUP_ONE "less"
  !insertmacro IB_BACKUP_ONE "json"
  !insertmacro IB_BACKUP_ONE "jsonc"
  !insertmacro IB_BACKUP_ONE "md"
  !insertmacro IB_BACKUP_ONE "markdown"
  !insertmacro IB_BACKUP_ONE "py"
  !insertmacro IB_BACKUP_ONE "pyw"
  !insertmacro IB_BACKUP_ONE "c"
  !insertmacro IB_BACKUP_ONE "h"
  !insertmacro IB_BACKUP_ONE "cpp"
  !insertmacro IB_BACKUP_ONE "cc"
  !insertmacro IB_BACKUP_ONE "cxx"
  !insertmacro IB_BACKUP_ONE "hpp"
  !insertmacro IB_BACKUP_ONE "hh"
  !insertmacro IB_BACKUP_ONE "hxx"
  !insertmacro IB_BACKUP_ONE "java"
  !insertmacro IB_BACKUP_ONE "rs"
  !insertmacro IB_BACKUP_ONE "go"
  !insertmacro IB_BACKUP_ONE "rb"
  !insertmacro IB_BACKUP_ONE "php"
  !insertmacro IB_BACKUP_ONE "sh"
  !insertmacro IB_BACKUP_ONE "bash"
  !insertmacro IB_BACKUP_ONE "zsh"
  !insertmacro IB_BACKUP_ONE "sql"
  !insertmacro IB_BACKUP_ONE "yml"
  !insertmacro IB_BACKUP_ONE "yaml"
  !insertmacro IB_BACKUP_ONE "xml"
  !insertmacro IB_BACKUP_ONE "vue"
  !insertmacro IB_BACKUP_ONE "svelte"
  !insertmacro IB_BACKUP_ONE "toml"
  !insertmacro IB_BACKUP_ONE "txt"
  !insertmacro IB_BACKUP_ONE "log"
!macroend

; Restore one extension's previous handler from the snapshot.
; A snapshot that is empty OR points at our own "IdiotBox.*" ProgID
; (upgrade over a previous Idiot Box install) means "no previous handler":
; clear the default instead of leaving a dangling pointer.
!macro IB_RESTORE_ONE EXT
  ReadINIStr $R0 "${IB_BACKUP_INI}" "backup" "${EXT}"
  StrCpy $R2 $R0 9
  ${If} $R0 == ""
  ${OrIf} $R2 == "IdiotBox."
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${Else}
    WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" "$R0"
  ${EndIf}
!macroend

; Roll back one extension: restore previous handler, drop our
; OpenWithProgids entry and delete our ProgID key.
!macro IB_UNASSOCIATE_ONE EXT PROGID
  !insertmacro IB_RESTORE_ONE ${EXT}
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${PROGID}"
!macroend

; ---------------------------------------------------------------------------
; Extra headers needed for the custom page
; ---------------------------------------------------------------------------
!macro customHeader
!macroend

; ---------------------------------------------------------------------------
; Show + leave functions for the consent page, wrapped in a macro.
; IMPORTANT: this file is included by electron-builder BEFORE its
; `!addplugindir` directive runs. If nsDialogs plugin commands were compiled
; here, NSIS would resolve them from its default plugin dir and then abort with
; "Plugin command nsDialogs::Create conflicts with a plugin in another
; directory!" once electron-builder's addplugindir is processed. Defining the
; functions inside a macro that customPageAfterChangeDir inserts (in
; assistedInstaller.nsh — after addplugindir) avoids that.
; ---------------------------------------------------------------------------
; NOTE: this page + functions are installer-only. In the uninstaller pass
; (BUILD_UNINSTALLER) they have no Page reference → makensis
; warning 6010 (error). Kept under a guard for that reason (Vars guarded above).
!macro IB_RegisterPageFunctions
!ifndef BUILD_UNINSTALLER
Function IB_RegisterShow
  ; NOTE: MUI_HEADER_TEXT must NOT be used here — this file is included
  ; before MUI2.nsh in the electron-builder flow, so MUI macros don't
  ; exist yet at this point (real-build verified).

  nsDialogs::Create 1018
  Pop $IB_RegisterDialog
  ${If} $IB_RegisterDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 36u "Register Idiot Box as editor?$\r$\n$\r$\nIdiot Box can open your code files when you double-click them.$\r$\nTick the box below to associate supported file types with Idiot Box."
  Pop $0

  ${NSD_CreateCheckbox} 0 44u 100% 12u "Register Idiot Box as editor for supported file types (recommended)"
  Pop $IB_RegisterCheckbox

  ${If} $IB_RegisterAsEditor == "0"
    ${NSD_SetState} $IB_RegisterCheckbox 0
  ${Else}
    ${NSD_SetState} $IB_RegisterCheckbox 1
  ${EndIf}

  nsDialogs::Show
FunctionEnd

; ---------------------------------------------------------------------------
; Leave function — remember the checkbox state
; ---------------------------------------------------------------------------
Function IB_RegisterLeave
  ${NSD_GetState} $IB_RegisterCheckbox $IB_RegisterAsEditor
FunctionEnd
!endif
!macroend

; ---------------------------------------------------------------------------
; Insert our page after the "choose install directory" page, before install.
; assistedInstaller.nsh expands this macro at the right place — after
; electron-builder's addplugindir, so nsDialogs resolves from one dir only.
; ---------------------------------------------------------------------------
!macro customPageAfterChangeDir
  !insertmacro IB_RegisterPageFunctions
  Page custom IB_RegisterShow IB_RegisterLeave
!macroend

; ---------------------------------------------------------------------------
; Init — runs in .onInit. Sets the default (register) and honours:
;   * silent flags: /NOASSOCIATIONS or /REGISTEREDITOR=0
;   * previous install choice (so updates keep the user's last answer)
; ---------------------------------------------------------------------------
!macro customInit
  StrCpy $IB_RegisterAsEditor "1"

  ; Snapshot current ".ext" defaults BEFORE electron-builder registers ours,
  ; so an opt-out can restore them (v27 keeps no backup itself).
  !insertmacro IB_BACKUP_ALL

  ; Silent / command-line opt-out
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/NOASSOCIATIONS" $R1
  ${IfNot} ${Errors}
    StrCpy $IB_RegisterAsEditor "0"
    Goto IB_InitDone
  ${EndIf}

  ClearErrors
  ${GetOptions} $R0 "/REGISTEREDITOR=0" $R1
  ${IfNot} ${Errors}
    StrCpy $IB_RegisterAsEditor "0"
    Goto IB_InitDone
  ${EndIf}

  ; Remember last choice on updates (check both hives, either "0" wins)
  ClearErrors
  ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" "RegisterAsEditor"
  ${If} $R1 == "0"
    StrCpy $IB_RegisterAsEditor "0"
  ${EndIf}
  ReadRegStr $R1 HKLM "${INSTALL_REGISTRY_KEY}" "RegisterAsEditor"
  ${If} $R1 == "0"
    StrCpy $IB_RegisterAsEditor "0"
  ${EndIf}

  IB_InitDone:
!macroend

; ---------------------------------------------------------------------------
; Install — runs AFTER electron-builder's registerFileAssociations.
; If the user declined, roll the associations back, then remember the choice.
; ---------------------------------------------------------------------------
!macro customInstall
  ; Remember choice for future updates
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "RegisterAsEditor" "$IB_RegisterAsEditor"

  ${If} $IB_RegisterAsEditor == "0"
    ; --- roll back the associations electron-builder just registered ---
    ; (ProgIDs are the v27 generated ones — see IB_PROGID_* defines above)
    !insertmacro IB_UNASSOCIATE_ONE "js" "${IB_PROGID_IdiotBoxJavaScript}"
    !insertmacro IB_UNASSOCIATE_ONE "mjs" "${IB_PROGID_IdiotBoxJavaScript}"
    !insertmacro IB_UNASSOCIATE_ONE "cjs" "${IB_PROGID_IdiotBoxJavaScript}"
    !insertmacro IB_UNASSOCIATE_ONE "jsx" "${IB_PROGID_IdiotBoxReact}"
    !insertmacro IB_UNASSOCIATE_ONE "ts" "${IB_PROGID_IdiotBoxTypeScript}"
    !insertmacro IB_UNASSOCIATE_ONE "tsx" "${IB_PROGID_IdiotBoxReactTS}"
    !insertmacro IB_UNASSOCIATE_ONE "html" "${IB_PROGID_IdiotBoxHTML}"
    !insertmacro IB_UNASSOCIATE_ONE "htm" "${IB_PROGID_IdiotBoxHTML}"
    !insertmacro IB_UNASSOCIATE_ONE "css" "${IB_PROGID_IdiotBoxCSS}"
    !insertmacro IB_UNASSOCIATE_ONE "scss" "${IB_PROGID_IdiotBoxSCSS}"
    !insertmacro IB_UNASSOCIATE_ONE "less" "${IB_PROGID_IdiotBoxLESS}"
    !insertmacro IB_UNASSOCIATE_ONE "json" "${IB_PROGID_IdiotBoxJSON}"
    !insertmacro IB_UNASSOCIATE_ONE "jsonc" "${IB_PROGID_IdiotBoxJSON}"
    !insertmacro IB_UNASSOCIATE_ONE "md" "${IB_PROGID_IdiotBoxMarkdown}"
    !insertmacro IB_UNASSOCIATE_ONE "markdown" "${IB_PROGID_IdiotBoxMarkdown}"
    !insertmacro IB_UNASSOCIATE_ONE "py" "${IB_PROGID_IdiotBoxPython}"
    !insertmacro IB_UNASSOCIATE_ONE "pyw" "${IB_PROGID_IdiotBoxPython}"
    !insertmacro IB_UNASSOCIATE_ONE "c" "${IB_PROGID_IdiotBoxC}"
    !insertmacro IB_UNASSOCIATE_ONE "h" "${IB_PROGID_IdiotBoxCHeader}"
    !insertmacro IB_UNASSOCIATE_ONE "cpp" "${IB_PROGID_IdiotBoxCpp}"
    !insertmacro IB_UNASSOCIATE_ONE "cc" "${IB_PROGID_IdiotBoxCpp}"
    !insertmacro IB_UNASSOCIATE_ONE "cxx" "${IB_PROGID_IdiotBoxCpp}"
    !insertmacro IB_UNASSOCIATE_ONE "hpp" "${IB_PROGID_IdiotBoxCppHeader}"
    !insertmacro IB_UNASSOCIATE_ONE "hh" "${IB_PROGID_IdiotBoxCppHeader}"
    !insertmacro IB_UNASSOCIATE_ONE "hxx" "${IB_PROGID_IdiotBoxCppHeader}"
    !insertmacro IB_UNASSOCIATE_ONE "java" "${IB_PROGID_IdiotBoxJava}"
    !insertmacro IB_UNASSOCIATE_ONE "rs" "${IB_PROGID_IdiotBoxRust}"
    !insertmacro IB_UNASSOCIATE_ONE "go" "${IB_PROGID_IdiotBoxGo}"
    !insertmacro IB_UNASSOCIATE_ONE "rb" "${IB_PROGID_IdiotBoxRuby}"
    !insertmacro IB_UNASSOCIATE_ONE "php" "${IB_PROGID_IdiotBoxPHP}"
    !insertmacro IB_UNASSOCIATE_ONE "sh" "${IB_PROGID_IdiotBoxShell}"
    !insertmacro IB_UNASSOCIATE_ONE "bash" "${IB_PROGID_IdiotBoxShell}"
    !insertmacro IB_UNASSOCIATE_ONE "zsh" "${IB_PROGID_IdiotBoxShell}"
    !insertmacro IB_UNASSOCIATE_ONE "sql" "${IB_PROGID_IdiotBoxSQL}"
    !insertmacro IB_UNASSOCIATE_ONE "yml" "${IB_PROGID_IdiotBoxYAML}"
    !insertmacro IB_UNASSOCIATE_ONE "yaml" "${IB_PROGID_IdiotBoxYAML}"
    !insertmacro IB_UNASSOCIATE_ONE "xml" "${IB_PROGID_IdiotBoxXML}"
    !insertmacro IB_UNASSOCIATE_ONE "vue" "${IB_PROGID_IdiotBoxVue}"
    !insertmacro IB_UNASSOCIATE_ONE "svelte" "${IB_PROGID_IdiotBoxSvelte}"
    !insertmacro IB_UNASSOCIATE_ONE "toml" "${IB_PROGID_IdiotBoxTOML}"
    !insertmacro IB_UNASSOCIATE_ONE "txt" "${IB_PROGID_IdiotBoxText}"
    !insertmacro IB_UNASSOCIATE_ONE "log" "${IB_PROGID_IdiotBoxLog}"

    ; Refresh Explorer so the rollback shows immediately
    System::Call 'shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)'
  ${EndIf}

  ; Drop the pre-install snapshot (used only for the rollback above)
  Delete "${IB_BACKUP_INI}"
!macroend
