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
!include "LogicLib.nsh"
!include "StrContains.nsh"

!define LOUVORJA_PROCESS_QUERY_LIMITED_INFORMATION 0x1000
!define LOUVORJA_TOKEN_QUERY 0x0008
!define LOUVORJA_TOKEN_USER 1

; Retorna na pilha se o token atual pertence ao mesmo usuário que mantém o
; shell do Windows. Não basta testar se o processo está elevado: com UAC
; desativado ou a conta Administrator interna, um duplo clique legítimo também
; chega elevado. A comparação de SID distingue esse caso de uma elevação com
; credenciais de outra conta, que apontaria HKCU e LocalAppData para o perfil
; errado. Qualquer falha de inspeção retorna "error" para falhar de modo seguro.
Function LouvorJA.CompareShellUserSid
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  Push $R1
  Push $R2

  StrCpy $0 "error"
  StrCpy $3 0 ; handle do processo do shell
  StrCpy $4 0 ; handle do token do shell
  StrCpy $5 0 ; handle do token atual
  StrCpy $8 0 ; buffer TOKEN_USER do shell
  StrCpy $9 0 ; buffer TOKEN_USER atual

  System::Call 'user32::GetShellWindow() p.r1'
  ${If} $1 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  StrCpy $2 0
  System::Call 'user32::GetWindowThreadProcessId(p r1, *i .r2) i.R2'
  ${If} $R2 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  System::Call 'kernel32::OpenProcess(i ${LOUVORJA_PROCESS_QUERY_LIMITED_INFORMATION}, i 0, i r2) p.r3'
  ${If} $3 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  System::Call 'advapi32::OpenProcessToken(p r3, i ${LOUVORJA_TOKEN_QUERY}, *p .r4) i.R2'
  ${If} $R2 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  System::Call 'kernel32::GetCurrentProcess() p.r1'
  System::Call 'advapi32::OpenProcessToken(p r1, i ${LOUVORJA_TOKEN_QUERY}, *p .r5) i.R2'
  ${If} $R2 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  StrCpy $6 0
  System::Call 'advapi32::GetTokenInformation(p r4, i ${LOUVORJA_TOKEN_USER}, p 0, i 0, *i .r6) i.R2'
  ${If} $6 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  StrCpy $7 0
  System::Call 'advapi32::GetTokenInformation(p r5, i ${LOUVORJA_TOKEN_USER}, p 0, i 0, *i .r7) i.R2'
  ${If} $7 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  System::Alloc $6
  Pop $8
  ${If} $8 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  System::Alloc $7
  Pop $9
  ${If} $9 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  System::Call 'advapi32::GetTokenInformation(p r4, i ${LOUVORJA_TOKEN_USER}, p r8, i r6, *i .r6) i.R2'
  ${If} $R2 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  System::Call 'advapi32::GetTokenInformation(p r5, i ${LOUVORJA_TOKEN_USER}, p r9, i r7, *i .r7) i.R2'
  ${If} $R2 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  System::Call '*$8(p .R0)'
  System::Call '*$9(p .R1)'
  System::Call 'advapi32::IsValidSid(p R0) i.R2'
  ${If} $R2 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  System::Call 'advapi32::IsValidSid(p R1) i.R2'
  ${If} $R2 == 0
    Goto louvorja_compare_shell_sid_done
  ${EndIf}

  System::Call 'advapi32::EqualSid(p R0, p R1) i.R2'
  ${If} $R2 == 0
    StrCpy $0 "different"
  ${Else}
    StrCpy $0 "same"
  ${EndIf}

louvorja_compare_shell_sid_done:
  ${If} $9 != 0
    System::Free $9
  ${EndIf}
  ${If} $8 != 0
    System::Free $8
  ${EndIf}
  ${If} $5 != 0
    System::Call 'kernel32::CloseHandle(p r5)'
  ${EndIf}
  ${If} $4 != 0
    System::Call 'kernel32::CloseHandle(p r4)'
  ${EndIf}
  ${If} $3 != 0
    System::Call 'kernel32::CloseHandle(p r3)'
  ${EndIf}

  Pop $R2
  Pop $R1
  Pop $R0
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

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

  ; A instância interna criada pelo UAC_RunElevated existe somente para
  ; recuperar uma cópia legada em Program Files. Nas demais elevações, permita
  ; prosseguir somente quando o token ainda pertence ao usuário do Explorer.
  ${If} ${UAC_IsInnerInstance}
    !insertmacro setInstallModePerAllUsers
  ${Else}
    ${If} ${UAC_IsAdmin}
    ${AndIf} $hasPerMachineInstallation != "1"
      Call LouvorJA.CompareShellUserSid
      Pop $R0
      ${If} $R0 != "same"
        MessageBox MB_ICONEXCLAMATION|MB_OK "Não foi possível instalar no perfil do usuário conectado porque o instalador está executando com as credenciais de outro administrador. Feche-o e abra normalmente, sem 'Executar como administrador'." /SD IDOK
        SetErrorLevel 1
        Quit
      ${EndIf}
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
