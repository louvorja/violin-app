# Presentation Core: primeira fatia canônica

Slides normais de música são selecionados por `MusicPresentationCore`, um
reducer TypeScript puro sem Vue, DOM, relógio, Broadcast ou Electron. Cada
`setSlides` cria uma sessão nova; `select`, `clock`, `times` e `close` são
comandos ordenados por ID dentro dela. O core devolve um snapshot coeso com
sessão, revisão, estado ativo, título, índice, quantidade e slides atual/próximo.
`useSlides` continua dono dos efeitos de áudio e das marcações; o índice que
publica para projeção vem do core. Não há feature flag nem fallback visual
musical para `SLIDE_CHANGE` neste beta.

## Transporte e recuperação

`BroadcastPresentationTransport` publica `MUSIC_PRESENTATION_SNAPSHOT` no
`BroadcastChannel("louvorja")`, valida o pacote em cada fronteira e responde a
`REQUEST_MUSIC_PRESENTATION_SNAPSHOT`. O pacote tem campos visuais permitidos,
`selectionRevision`, `playbackId`, progresso e marcos de tempo. Não leva o deck
inteiro nem binários. A revisão do core ordena commits; `selectionRevision`
ordena reemissões da mesma seleção, como uma resposta a uma janela tardia.
Sessões anteriores e revisões repetidas/regressivas são descartadas. Um pacote
de fechamento aposenta sua sessão.

O mesmo snapshot é relayado pelo servidor SSE para OBS e clientes HTTP. O
cache local e o cache/fila SSE guardam só o estado atual; `MEDIA_CLOSE` remove
snapshots antigos e preserva a barreira de fechamento sob backpressure. Um
snapshot musical ativo invalida um `SLIDE_CHANGE` antigo de editor no replay;
um novo evento sem versão invalida o snapshot e o deck da música anterior.
Janelas tardias recuperam por
request/reply local ou pelo estado SSE em cache, sem reexecutar comandos.

`useProjectionState` aplica apenas pacotes canônicos validados para música.
`SLIDE_CHANGE` versionado não altera a tela, mesmo se o snapshot faltar ou for
malformado. O evento sem versão continua existindo para o editor. Bíblia,
arquivo, fundo, vídeo e demais fontes conservam seus próprios contratos até
uma fatia específica migrá-los. `SLIDE_PROGRESS` segue como atualização
throttled de 0–100, aceita somente quando sessão lógica, playback, índice e
`selectionRevision` correspondem ao snapshot aplicado.

`SLIDES_DATA` ainda transporta o deck completo para Operator e controle remoto,
agora correlacionado por `presentation_session`. Esses consumidores aguardam o
snapshot da mesma sessão e rejeitam lista de uma sessão aposentada. Operator,
controle remoto e Libras também selecionam música pelo pacote canônico. O
endpoint de playing-check lê o core diretamente. Música não emite mais
`SLIDE_CHANGE`; os emissores não musicais e seus consumidores continuam.
Ao assumir o editor, cards da música antiga são limpos, mesmo se um deck já
foi entregue antes de um socket SSE entrar em backpressure.

Comandos `GO_TO_SLIDE` vindos de outra janela carregam
`presentation_session`; o produtor rejeita comandos sem a sessão vigente e
índices malformados. Um comando atrasado de uma música anterior não pode
mover a nova. Navegação local via `Media.goToSlide()` usa a sessão do core.
Os comandos HTTP de música (`next`, `previous`, `close`, `go-to-slide`) exigem a
sessão observada no controle remoto quando há música ativa; uma sessão antiga
ou ausente é rejeitada no renderer principal e gera no máximo um incidente de
metadados por ação/motivo/sessão.

Quando chega um deck correlacionado sem snapshot, o receptor pede o estado e
faz no máximo uma tentativa retardada após 2 s. Um timeout produz um evento
`presentation_snapshot_missing` por sessão, só com motivo enumerado. Falhas de
publicação registram no máximo um incidente por sessão, com motivo
`broadcast_channel_failed`, `ipc_relay_failed` ou `ipc_relay_unavailable`, e fazem até duas novas
tentativas com intervalo de 1 s, mesmo sem novo tick de áudio. O resultado do
emissor confirma apenas o enfileiramento síncrono local/IPC; não confirma
recebimento remoto nem pintura de frame. Falhas de comando do core também são
limitadas por sessão. Não há log por tick, frame, chunk ou mensagem normal.

## Limites e testes

O áudio principal continua sendo o clock de reprodução. O watcher entrega
amostras ao core e publica nova seleção só quando o índice muda; não envia
snapshot a cada tick. A capa é publicada antes de iniciar a transferência de
áudio. Falha transitória de publicação tenta novamente com intervalo limitado,
sem log ou validação repetida em cada tick. A troca de fonte libera a projeção
de arquivo/vídeo antes de o editor ou a música assumirem o telão, sem pausar
downloads manuais na Utility. Vídeo local/progressivo conserva seu protocolo de
playback/revision e recuperação próprios. Papel/display da janela, Bíblia,
overlays e arquivos ainda não pertencem ao core musical.

Fechar e reabrir a mesma janela nativa aguarda o evento Electron `closed`; essa
confirmação tem limite de 2,5 s. Se não chegar, a tentativa de reabertura é
recusada, a janela segue reservada até fechar e a tentativa registra o motivo
sem sondagem periódica.

Os testes unitários cobrem ordenação, sessão nova, fechamento, reemissão com a
mesma revisão do core, pacote malformado, progresso atrasado, lista de sessão
antiga, comando tardio e timeout de recovery. Os E2Es offline
`presentation-core.spec.js` e `latency.spec.js`
exercitam janelas Chromium reais, ordens opostas de abertura, reabertura,
replay e navegação. Execute-os com `--output` em diretório exclusivo: o
Playwright limpa sua saída. Incluem o primeiro slide enquanto o áudio ainda
carrega e não acessam YouTube.

`projection_slide_frame_opportunity` separa comando, commit, emissão,
recebimento, aplicação de estado, patch Vue e oportunidade de frame com dois
`requestAnimationFrame`. Não prova paint físico no monitor; GPU, hotplug,
DPI/Hz mistos, Defender/OneDrive e soaks continuam no laboratório Windows.
