; Idiot Box custom NSIS include (auto-loaded from build/installer.nsh).
; Adds a consent page: "Register Idiot Box as editor?"
; If the user unchecks it, the app still installs but file associations
; registered by electron-builder are rolled back.

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; ---------------------------------------------------------------------------
; Variables (top-level so they exist before any page/function uses them)
; ---------------------------------------------------------------------------
Var IB_RegisterAsEditor
Var IB_RegisterDialog
Var IB_RegisterCheckbox

; ---------------------------------------------------------------------------
; Extra headers needed for the custom page
; ---------------------------------------------------------------------------
!macro customHeader
!macroend

; ---------------------------------------------------------------------------
; Insert our page after the "choose install directory" page, before install.
; assistedInstaller.nsh expands this macro at the right place.
; ---------------------------------------------------------------------------
!macro customPageAfterChangeDir
  Page custom IB_RegisterShow IB_RegisterLeave
!macroend

; ---------------------------------------------------------------------------
; Show function for the consent page
; ---------------------------------------------------------------------------
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

; ---------------------------------------------------------------------------
; Init — runs in .onInit. Sets the default (register) and honours:
;   * silent flags: /NOASSOCIATIONS or /REGISTEREDITOR=0
;   * previous install choice (so updates keep the user's last answer)
; ---------------------------------------------------------------------------
!macro customInit
  StrCpy $IB_RegisterAsEditor "1"

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
; Helper: restore one extension's previous association.
; Mirrors APP_UNASSOCIATE from FileAssociation.nsh so we don't need
; that file included here.
; ---------------------------------------------------------------------------
!macro IB_UNASSOCIATE_ONE EXT FILECLASS
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.${EXT}" "${FILECLASS}_backup"
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" "$R0"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" "${FILECLASS}_backup"
!macroend

; ---------------------------------------------------------------------------
; Install — runs AFTER electron-builder's registerFileAssociations.
; If the user declined, roll the associations back, then remember the choice.
; ---------------------------------------------------------------------------
!macro customInstall
  ; Remember choice for future updates
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "RegisterAsEditor" "$IB_RegisterAsEditor"

  ${If} $IB_RegisterAsEditor == "0"
    ; --- restore per-extension previous handlers ---
    !insertmacro IB_UNASSOCIATE_ONE "js" "IdiotBoxJavaScript"
    !insertmacro IB_UNASSOCIATE_ONE "mjs" "IdiotBoxJavaScript"
    !insertmacro IB_UNASSOCIATE_ONE "cjs" "IdiotBoxJavaScript"
    !insertmacro IB_UNASSOCIATE_ONE "jsx" "IdiotBoxJavaScript"
    !insertmacro IB_UNASSOCIATE_ONE "ts" "IdiotBoxTypeScript"
    !insertmacro IB_UNASSOCIATE_ONE "tsx" "IdiotBoxTypeScript"
    !insertmacro IB_UNASSOCIATE_ONE "html" "IdiotBoxHTML"
    !insertmacro IB_UNASSOCIATE_ONE "htm" "IdiotBoxHTML"
    !insertmacro IB_UNASSOCIATE_ONE "css" "IdiotBoxCSS"
    !insertmacro IB_UNASSOCIATE_ONE "scss" "IdiotBoxSCSS"
    !insertmacro IB_UNASSOCIATE_ONE "less" "IdiotBoxLESS"
    !insertmacro IB_UNASSOCIATE_ONE "json" "IdiotBoxJSON"
    !insertmacro IB_UNASSOCIATE_ONE "jsonc" "IdiotBoxJSON"
    !insertmacro IB_UNASSOCIATE_ONE "md" "IdiotBoxMarkdown"
    !insertmacro IB_UNASSOCIATE_ONE "markdown" "IdiotBoxMarkdown"
    !insertmacro IB_UNASSOCIATE_ONE "py" "IdiotBoxPython"
    !insertmacro IB_UNASSOCIATE_ONE "pyw" "IdiotBoxPython"
    !insertmacro IB_UNASSOCIATE_ONE "c" "IdiotBoxC"
    !insertmacro IB_UNASSOCIATE_ONE "h" "IdiotBoxC"
    !insertmacro IB_UNASSOCIATE_ONE "cpp" "IdiotBoxCpp"
    !insertmacro IB_UNASSOCIATE_ONE "cc" "IdiotBoxCpp"
    !insertmacro IB_UNASSOCIATE_ONE "cxx" "IdiotBoxCpp"
    !insertmacro IB_UNASSOCIATE_ONE "hpp" "IdiotBoxCpp"
    !insertmacro IB_UNASSOCIATE_ONE "hh" "IdiotBoxCpp"
    !insertmacro IB_UNASSOCIATE_ONE "hxx" "IdiotBoxCpp"
    !insertmacro IB_UNASSOCIATE_ONE "java" "IdiotBoxJava"
    !insertmacro IB_UNASSOCIATE_ONE "rs" "IdiotBoxRust"
    !insertmacro IB_UNASSOCIATE_ONE "go" "IdiotBoxGo"
    !insertmacro IB_UNASSOCIATE_ONE "rb" "IdiotBoxRuby"
    !insertmacro IB_UNASSOCIATE_ONE "php" "IdiotBoxPHP"
    !insertmacro IB_UNASSOCIATE_ONE "sh" "IdiotBoxShell"
    !insertmacro IB_UNASSOCIATE_ONE "bash" "IdiotBoxShell"
    !insertmacro IB_UNASSOCIATE_ONE "zsh" "IdiotBoxShell"
    !insertmacro IB_UNASSOCIATE_ONE "sql" "IdiotBoxSQL"
    !insertmacro IB_UNASSOCIATE_ONE "yml" "IdiotBoxYAML"
    !insertmacro IB_UNASSOCIATE_ONE "yaml" "IdiotBoxYAML"
    !insertmacro IB_UNASSOCIATE_ONE "xml" "IdiotBoxXML"
    !insertmacro IB_UNASSOCIATE_ONE "vue" "IdiotBoxVue"
    !insertmacro IB_UNASSOCIATE_ONE "svelte" "IdiotBoxSvelte"
    !insertmacro IB_UNASSOCIATE_ONE "toml" "IdiotBoxTOML"
    !insertmacro IB_UNASSOCIATE_ONE "txt" "IdiotBoxText"
    !insertmacro IB_UNASSOCIATE_ONE "log" "IdiotBoxText"

    ; --- remove our file classes ---
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxJavaScript"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxTypeScript"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxHTML"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxCSS"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxSCSS"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxLESS"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxJSON"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxMarkdown"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxPython"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxC"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxCpp"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxJava"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxRust"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxGo"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxRuby"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxPHP"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxShell"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxSQL"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxYAML"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxXML"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxVue"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxSvelte"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxTOML"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\IdiotBoxText"

    ; Refresh Explorer so the rollback shows immediately
    System::Call 'shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)'
  ${EndIf}
!macroend
