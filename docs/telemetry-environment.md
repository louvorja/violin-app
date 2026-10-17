# Ambiente nos eventos de telemetria

`Telemetry.ts` coleta o ambiente uma vez por inicialização do SDK, com a
telemetria habilitada, e registra as propriedades em todos os eventos do PostHog.
`app_opened` também as inclui explicitamente. Resetar o identificador ou reativar
a telemetria preserva esse contexto. Os campos automáticos `$os_version` e
`$browser_version` continuam disponíveis, com as limitações do navegador.

| Ambiente | Propriedades | Origem e significado |
| --- | --- | --- |
| macOS desktop | `macos_version`, `os_version` | `process.getSystemVersion()`; versão do produto, sem o limite `10.15.7` do user-agent |
| Windows desktop | `windows_version`, `os_version`, `windows_build` | Versão nativa NT e número do build, por exemplo `10.0.26100` e `26100` |
| Windows desktop | `windows_name`, `windows_name_source` | Nome/edição via `os.version()` (`node_os`); preserva Windows Server |
| Linux desktop | `linux_distro`, `linux_distro_name`, `linux_distro_version`, `os_version` | `ID`, `PRETTY_NAME`/`NAME` e `VERSION_ID` de `/etc/os-release`, com fallback para `/usr/lib/os-release` |
| Todos os desktops | `os_kernel_version`, `process_arch` | `os.release()` e arquitetura do executável; não necessariamente a arquitetura física quando há emulação |
| Electron | `electron_version`, `chromium_version`, `node_version` | Versões do runtime expostas pelo preload |
| Todos | `browser_name`, `browser_version`, `browser_version_source` | Electron no desktop; Client Hints ou user-agent na web/PWA |
| Web/PWA compatível | `browser_platform`, `browser_platform_version`, `browser_platform_version_source` | Plataforma e versão reportadas pelos Client Hints |
| Web/PWA compatível | `browser_architecture`, `browser_bitness` | Arquitetura e tamanho reportados pelos Client Hints |
| macOS/Android/iOS/Chrome OS web compatível | `os_version`, `os_version_source`; também `macos_version` no Mac | Versão exposta pelos Client Hints, quando disponível |
| Windows web compatível | `windows_name`, `windows_name_source` | Classificação `Windows 10` ou `Windows 11 or later`, derivada do contrato de Client Hints |

`os_version_source` distingue `electron`, `os-release` e `client_hints`.
`browser_version_source` distingue `electron`, `client_hints` e `user_agent`.
Dados ausentes, inválidos ou negados são omitidos. Uma distro rolling release pode
ter identificação sem `VERSION_ID`; sua versão fica ausente. O kernel Linux não
é usado como versão da distro.

No Windows web, `browser_platform_version` representa **UniversalApiContract**,
não o build NT: `13.0.0` indica Windows 11 ou posterior. Portanto esse valor não
é copiado para `windows_version`, `windows_build` ou `os_version`. Safari/Firefox
e políticas do navegador podem não expor Client Hints; o fallback identifica o
navegador com precisão limitada pelo user-agent, sem inventar uma versão nativa
do sistema. A web não identifica a distro Linux.

## Fronteiras e falhas

- `telemetry:system-info` é uma operação IPC específica, sem argumentos. O main
  guarda o snapshot em memória durante o processo. Tipos ficam em
  `src/types/TelemetryEnvironment.ts` e a resposta é validada no renderer.
- A leitura Linux aceita no máximo 16 KiB e somente campos conhecidos. Não há
  execução de shell nem coleta de hostname, usuário, machine-id ou caminhos pessoais.
- IPC e Client Hints têm espera máxima de 500 ms no renderer. Falha preserva os
  demais metadados; desativar a telemetria durante a leitura impede iniciar o SDK.
- Nenhum histórico é corrigido retroativamente. Os campos novos dependem da
  distribuição desta implementação e de eventos enviados com ela.

Para analisar versões, filtre por `app_platform`, `os` e, quando necessário,
`window_role = main`; use o campo específico e sua origem. Contagens por
`distinct_id` representam instalações observadas, não pessoas.

Referências: [Electron](https://www.electronjs.org/docs/latest/api/process#processgetsystemversion),
[os-release](https://www.freedesktop.org/software/systemd/man/latest/os-release.html),
[Client Hints](https://developer.chrome.com/docs/privacy-security/user-agent-client-hints),
[Windows via Client Hints](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/how-to-detect-win11)
e [super properties do PostHog](https://posthog.com/docs/libraries/js/usage#super-properties).
