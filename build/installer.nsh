; Custom NSIS script para LouvorJA
; Documentação: https://www.electron.build/configuration/nsis
;
; Este script é incluído no processo de build do electron-builder
; (via nsis.include em electron-builder.yml).

; O escopo do instalador só define os binários, atalhos e associações. Os
; dados pessoais são criados pelo aplicativo na conta que o executar.
!ifndef BUILD_UNINSTALLER
!include "LogicLib.nsh"
; O template inclui StrContains ao habilitar a página de diretório. Esse
; arquivo não possui include guard e não pode ser incluído duas vezes.
!ifndef allowToChangeInstallationDirectory
  !include "StrContains.nsh"
!endif
!include "StrFunc.nsh"
${StrRep}
Var LouvorJADirectoryInfo
!define MUI_DIRECTORYPAGE_TEXT_TOP "$LouvorJADirectoryInfo"

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
  ; Reinstalações preservam o escopo. Trocar usuário por máquina exige remover
  ; os binários anteriores e instalar de novo, mantendo os dados pessoais.
  ; Isso evita desinstalar o HKCU de outra conta durante uma elevação.
  ${If} $hasPerMachineInstallation == "1"
    StrCpy $isForceMachineInstall "1"
  ${ElseIf} $hasPerUserInstallation == "1"
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}
!macroend

; Verifique depois de o usuário escolher o escopo: credenciais de outra conta
; são válidas para instalar para todos, mas não para criar o perfil errado.
; O hook é expandido depois das declarações de variáveis do template NSIS.
!macro customHeader
Function LouvorJA.EnsureCurrentUserScope
  ${If} $installMode != "all"
  ${AndIf} ${UAC_IsAdmin}
    Call LouvorJA.CompareShellUserSid
    Pop $R0
    ${If} $R0 != "same"
      MessageBox MB_ICONEXCLAMATION|MB_OK "Para instalar somente para você, abra o instalador normalmente, sem as credenciais de outro administrador. Para uma instalação administrativa, escolha Todos os usuários." /SD IDOK
      SetErrorLevel 1
      Quit
    ${EndIf}
  ${EndIf}
FunctionEnd

Function LouvorJA.ValidateScopePage
  Call LouvorJA.EnsureCurrentUserScope
  Abort
FunctionEnd
!macroend

!macro customPageAfterChangeDir
  Page custom LouvorJA.ValidateScopePage
!macroend

!macro customInit
  ${If} $LANGUAGE == 1046
  ${OrIf} $LANGUAGE == 2070
    StrCpy $LouvorJADirectoryInfo "Escolha a pasta do programa. Acervo e vídeos serão configurados no aplicativo."
    ${If} $hasPerUserInstallation == "1"
    ${OrIf} $hasPerMachineInstallation == "1"
      StrCpy $LouvorJADirectoryInfo "$LouvorJADirectoryInfo$\r$\nO escopo atual será mantido. Para mudá-lo, desinstale sem apagar os dados pessoais e instale novamente."
    ${EndIf}
  ${ElseIf} $LANGUAGE == 1034
  ${OrIf} $LANGUAGE == 3082
    StrCpy $LouvorJADirectoryInfo "Elija la carpeta del programa. La biblioteca y los videos se configurarán en la aplicación."
    ${If} $hasPerUserInstallation == "1"
    ${OrIf} $hasPerMachineInstallation == "1"
      StrCpy $LouvorJADirectoryInfo "$LouvorJADirectoryInfo$\r$\nSe conservará el alcance actual. Para cambiarlo, desinstale sin borrar los datos personales e instale de nuevo."
    ${EndIf}
  ${Else}
    StrCpy $LouvorJADirectoryInfo "Choose the program folder. Media and video folders are configured in the application."
    ${If} $hasPerUserInstallation == "1"
    ${OrIf} $hasPerMachineInstallation == "1"
      StrCpy $LouvorJADirectoryInfo "$LouvorJADirectoryInfo$\r$\nThe existing installation scope is preserved. To change it, uninstall without deleting personal data, then install again."
    ${EndIf}
  ${EndIf}

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

  ; O UAC interno é sempre uma instalação para todos, inclusive instalações
  ; novas. Instalações silenciosas não passam pelas páginas do wizard.
  ${If} ${UAC_IsInnerInstance}
    !insertmacro setInstallModePerAllUsers
  ${ElseIf} ${Silent}
    ${If} $hasPerMachineInstallation == "1"
      !insertmacro setInstallModePerAllUsers
    ${Else}
      Call LouvorJA.EnsureCurrentUserScope
    ${EndIf}
  ${EndIf}
!macroend
!endif

; Defaults compartilhados só são publicados depois de preparar as duas
; pastas de mídia. O perfil nunca é provisionado pelo instalador elevado.
!macro LouvorJAProvisionSharedMedia
  ${If} $installMode == "all"
    ; No contexto all, APPDATA = ProgramData e DOCUMENTS = Public Documents.
    StrCpy $R2 "$APPDATA\LouvorJA Violin"
    IfFileExists "$R2\storage-defaults.json" louvorja_shared_done
    ; Não aplique permissões através de junctions existentes.
    System::Call 'kernel32::GetFileAttributesW(w R2) i.R0'
    IntOp $R1 $R0 & 0x400
    ${If} $R0 != -1
    ${AndIf} $R1 != 0
      Goto louvorja_shared_unavailable
    ${EndIf}
    CreateDirectory "$R2"
    ; Uma pasta remanescente de tentativa anterior também deve ter dono admin.
    nsExec::ExecToStack '"$SYSDIR\icacls.exe" "$R2" /setowner "*S-1-5-32-544"'
    Pop $R0
    Pop $R1
    ${If} $R0 != 0
      Goto louvorja_shared_unavailable
    ${EndIf}
    nsExec::ExecToStack '"$SYSDIR\icacls.exe" "$R2" /reset'
    Pop $R0
    Pop $R1
    ${If} $R0 != 0
      Goto louvorja_shared_unavailable
    ${EndIf}
    ; Users podem ler a localização, mas somente administradores/SYSTEM podem
    ; mudá-la. Estes são SIDs estáveis em Windows de qualquer idioma.
    nsExec::ExecToStack '"$SYSDIR\icacls.exe" "$R2" /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX"'
    Pop $R0
    Pop $R1
    ${If} $R0 != 0
      Goto louvorja_shared_unavailable
    ${EndIf}

    StrCpy $R3 "$DOCUMENTS\LouvorJA Violin"
    System::Call 'kernel32::GetFileAttributesW(w R3) i.R0'
    IntOp $R1 $R0 & 0x400
    ${If} $R0 != -1
    ${AndIf} $R1 != 0
      Goto louvorja_shared_unavailable
    ${EndIf}
    StrCpy $R4 "$R3\Acervo"
    StrCpy $R5 "$R3\Videos"
    Push $R4
    Push $R5
    StrCpy $R6 2
louvorja_shared_folder:
    Pop $R7
    System::Call 'kernel32::GetFileAttributesW(w R7) i.R0'
    IntOp $R1 $R0 & 0x400
    ${If} $R0 != -1
    ${AndIf} $R1 != 0
      ; Balance the remaining stack before returning.
      ${If} $R6 == 2
        Pop $R7
      ${EndIf}
      Goto louvorja_shared_unavailable
    ${EndIf}
    CreateDirectory "$R7"
    nsExec::ExecToStack '"$SYSDIR\icacls.exe" "$R7" /grant:r "*S-1-5-32-545:(OI)(CI)M"'
    Pop $R0
    Pop $R1
    ${If} $R0 != 0
      ${If} $R6 == 2
        Pop $R7
      ${EndIf}
      Goto louvorja_shared_unavailable
    ${EndIf}
    IntOp $R6 $R6 - 1
    ${If} $R6 > 0
      Goto louvorja_shared_folder
    ${EndIf}

    ; JSON aceita '/' no Windows; normalize para não escrever escapes inválidos.
    ${StrRep} $R4 "$R4" "\" "/"
    ${StrRep} $R5 "$R5" "\" "/"
    Delete "$R2\storage-defaults.json.tmp"
    ClearErrors
    FileOpen $R0 "$R2\storage-defaults.json.tmp" w
    ${If} ${Errors}
      Goto louvorja_shared_unavailable
    ${EndIf}
    ; FileWrite usa a página ANSI do Windows. Escreva UTF-8 explicitamente
    ; para preservar pastas redirecionadas com acentos ou outros alfabetos.
    StrCpy $R8 '{"version":1,"mediaDir":"$R4","videosDir":"$R5"}'
    System::Call 'kernel32::WideCharToMultiByte(i 65001, i 0, w R8, i -1, p 0, i 0, p 0, p 0) i.R9'
    ${If} $R9 <= 1
      FileClose $R0
      Goto louvorja_shared_unavailable
    ${EndIf}
    System::Alloc $R9
    Pop $R1
    ${If} $R1 == 0
      FileClose $R0
      Goto louvorja_shared_unavailable
    ${EndIf}
    System::Call 'kernel32::WideCharToMultiByte(i 65001, i 0, w R8, i -1, p R1, i R9, p 0, p 0) i.R6'
    ${If} $R6 != $R9
      System::Free $R1
      FileClose $R0
      Goto louvorja_shared_unavailable
    ${EndIf}
    IntOp $R9 $R9 - 1
    System::Call 'kernel32::WriteFile(p R0, p R1, i R9, *i .R6, p 0) i.R7'
    System::Free $R1
    FileClose $R0
    ${If} $R7 == 0
    ${OrIf} $R6 != $R9
      Delete "$R2\storage-defaults.json.tmp"
      Goto louvorja_shared_unavailable
    ${EndIf}
    Rename "$R2\storage-defaults.json.tmp" "$R2\storage-defaults.json"
    Goto louvorja_shared_done
louvorja_shared_unavailable:
    DetailPrint "Não foi possível preparar o acervo compartilhado. Configure as pastas ao abrir o LouvorJA."
louvorja_shared_done:
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro LouvorJAProvisionSharedMedia
  ; Permite ao atualizador reconhecer uma instalação para todos mesmo quando
  ; o administrador escolheu uma pasta fora de Program Files.
  CreateDirectory "$INSTDIR\resources"
  FileOpen $R0 "$INSTDIR\resources\install-scope.json" w
  ${If} $installMode == "all"
    FileWrite $R0 '{"version":1,"scope":"machine"}'
  ${Else}
    FileWrite $R0 '{"version":1,"scope":"user"}'
  ${EndIf}
  FileClose $R0

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
