; Custom NSIS script para LouvorJA
; Documentação: https://www.electron.build/configuration/nsis
;
; Este script é incluído no processo de build do electron-builder
; (via nsis.include em electron-builder.yml).

; O instalador assistido chama este hook antes de desenhar as páginas. Assim a
; instalação nova nunca oferece a opção "todos os usuários". Se existir uma
; versão antiga registrada por usuário dentro de Program Files, marcamos o
; upgrade como por máquina: o NSIS/elevate.exe pede UAC e atualiza a cópia
; existente em vez de deixar duas instalações disputando o protocolo.
!ifndef BUILD_UNINSTALLER
!include "StrContains.nsh"

!macro customInstallMode
  ${If} $hasPerMachineInstallation == "1"
    StrCpy $isForceMachineInstall "1"
  ${Else}
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}
!macroend

!macro customInit
  ; Versões antigas permitiam escolher C:\Program Files, mas registravam a
  ; instalação em HKCU. No upgrade silencioso o electron-updater não tinha
  ; como saber que os arquivos exigem UAC. Detecte os três roots possíveis do
  ; Windows e faça o template tratar a cópia como per-machine.
  ${If} $hasPerUserInstallation == "1"
    StrCpy $R7 "$PROGRAMFILES\"
    ${StrContains} $R0 "$R7" "$perUserInstallationFolder"
    ${If} $R0 != ""
      StrCpy $hasPerMachineInstallation "1"
      StrCpy $hasPerUserInstallation "0"
    ${Else}
      ${If} $PROGRAMFILES64 != ""
        StrCpy $R7 "$PROGRAMFILES64\"
        ${StrContains} $R0 "$R7" "$perUserInstallationFolder"
        ${If} $R0 != ""
          StrCpy $hasPerMachineInstallation "1"
          StrCpy $hasPerUserInstallation "0"
        ${EndIf}
      ${EndIf}
      ${If} $hasPerMachineInstallation == "0"
      ${AndIf} $PROGRAMFILES32 != ""
        StrCpy $R7 "$PROGRAMFILES32\"
        ${StrContains} $R0 "$R7" "$perUserInstallationFolder"
        ${If} $R0 != ""
          StrCpy $hasPerMachineInstallation "1"
          StrCpy $hasPerUserInstallation "0"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; O modo por usuário com token elevado gravaria HKCU no perfil do
  ; administrador (e não no usuário que abriu o instalador). Só aceitamos um
  ; processo já elevado quando estamos recuperando uma instalação por máquina.
  ; A detecção acima precisa vir antes: o electron-updater pode relançar este
  ; instalador já elevado para recuperar uma cópia antiga em Program Files.
  ${If} ${UAC_IsInnerInstance}
    ; A instância interna é criada pelo UAC_RunElevated para atualizar o
    ; legado. Ela enxerga o HKCU do administrador, não o do operador, então
    ; não pode repetir a detecção acima; o template já a usa exclusivamente
    ; para o modo por máquina.
    !insertmacro setInstallModePerAllUsers
  ${Else}
    ${If} ${UAC_IsAdmin}
    ${AndIf} $hasPerMachineInstallation != "1"
      MessageBox MB_ICONEXCLAMATION|MB_OK "Execute o instalador normalmente, sem 'Executar como administrador'. O LouvorJA será instalado apenas para este usuário."
      Quit
    ${EndIf}
  ${EndIf}
!macroend
!endif

!macro customInstall
  ; Registrar o protocolo louvorja:// no escopo escolhido. HKCR é uma visão
  ; mesclada e uma escrita sem escopo pode cair em HKLM mesmo no modo por
  ; usuário, fazendo o instalador falhar sem UAC.
  ${If} $installMode == "all"
    WriteRegStr HKLM "Software\Classes\louvorja" "" "URL:LouvorJA Protocol"
    WriteRegStr HKLM "Software\Classes\louvorja" "URL Protocol" ""
    WriteRegStr HKLM "Software\Classes\louvorja\DefaultIcon" "" "$INSTDIR\${PRODUCT_FILENAME}.exe,1"
    WriteRegStr HKLM "Software\Classes\louvorja\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'
  ${Else}
    WriteRegStr HKCU "Software\Classes\louvorja" "" "URL:LouvorJA Protocol"
    WriteRegStr HKCU "Software\Classes\louvorja" "URL Protocol" ""
    WriteRegStr HKCU "Software\Classes\louvorja\DefaultIcon" "" "$INSTDIR\${PRODUCT_FILENAME}.exe,1"
    WriteRegStr HKCU "Software\Classes\louvorja\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'
  ${EndIf}
!macroend

!macro customUnInstall
  ; Remover apenas o registro do escopo que esta cópia realmente instalou.
  ${If} $installMode == "all"
    DeleteRegKey HKLM "Software\Classes\louvorja"
  ${Else}
    DeleteRegKey HKCU "Software\Classes\louvorja"
  ${EndIf}
!macroend
