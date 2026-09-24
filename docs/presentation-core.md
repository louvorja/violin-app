# Presentation Core: primeira fatia em shadow mode

`src/presentation/MusicPresentationCore.ts` modela apenas slides de música.
É TypeScript puro, sem Vue, DOM, relógio, BroadcastChannel ou Electron.
`useSlides` continua sendo a autoridade e alimenta o core em paralelo.
Nenhuma janela renderiza o snapshot novo; não há cutover.

O produtor usa `PresentationTransport` com adapter em memória para despachar
comandos, observar commits e consultar um snapshot coeso. O contrato nasce
desse consumidor real: `dispatch`, `subscribe`, `requestSnapshot`. A inscrição
recebe apenas commits futuros; após desinscrição/perda de notificações, uma
consulta recupera o estado atual sem replay da sequência de comandos. Falha de
um observador não bloqueia outros. `connect` e `reportApplied` não são expostos:
o receptor remoto é diagnóstico e não aplica snapshots à tela. Ainda não existe
cutover nem recovery visual novo: as projeções continuam usando o transporte
legado. A recuperação em memória é validada por testes de
desconexão, perda de atualização e fechamento não observado.

Uma segunda fatia exercita Broadcast nas janelas auxiliares: o produtor publica
`MUSIC_SHADOW_SNAPSHOT` e responde a `REQUEST_MUSIC_SHADOW_SNAPSHOT`. O payload
versionado passa por validação de runtime e contém apenas estado coeso,
slide atual/próximo e campos escalares usados na comparação; nunca o deck todo.
O transporte não encaminha esses eventos para IPC/SSE. Os listeners são
registrados antes do request, incluindo o caso de resposta síncrona in-window.

`useProjectionState` tem um receptor diagnóstico independente das refs usadas
para renderizar. Ele compara somente quando sessão e revisão do broadcast
coincidem exatamente com o legado aplicado; descarta snapshots anteriores,
ignora outra sessão e suspende comparação sob Bíblia. Close pode chegar antes
ou depois de seu snapshot, por isso só se compara quando ambos estão fechados.
Reabrir uma janela solicita o snapshot atual, sem depender dos anteriores.
Cada instância produtora gera um prefixo UUID fora do core, evitando colisão de
sessões após reload. Divergências do renderer geram no máximo um incidente por
sessão, contendo somente os nomes dos campos. Não se registra sucesso por
comando, não se transmite progresso contínuo e nada no shadow controla a tela.

Limites: comparação exige um broadcast legado correlacionado. Perder esse
broadcast não produz divergência artificial; recovery visual ainda pertence ao
legado. Este protocolo diagnóstico usa apenas Broadcast local/cross-window,
não valida a entrega a clientes HTTP/SSE. Não há acknowledgements de paint.

O harness `e2e/presentation-shadow.spec.js` executa Chromium com duas páginas
reais, fixtures locais e bloqueio de origens externas. Exercita as duas ordens
de abertura produtor/projetor, navegação e reabertura após perder mensagens.
Em desenvolvimento, `window.__ljMusicShadowDiagnostics` expõe apenas três
campos de tamanho constante: número de comparações efetivamente realizadas,
incidentes e ID da sessão. O contador vem do ponto de comparação do receptor;
receber um pacote ou não emitir divergência não conta como evidência de paridade.
Esse objeto é removido ao desmontar e não é exposto no build de produção.
O teste exige comparação positiva e zero divergências em cada etapa e anexa
os contadores como JSON, sem letras/títulos. Não envia eventos de sucesso ao
PostHog. Para preservar outros artefatos, execute com `--output` apontando para
um diretório temporário exclusivo.

Cada `setSlides` cria uma sessão local nova, independente de `playback_id`.
Trocar cantada/playback pode mudar a identidade do áudio e seus timestamps
preservando a sessão de apresentação e o slide atual. O produtor atribui IDs
numéricos estritamente crescentes aos comandos da sessão. IDs repetidos ou
anteriores e comandos de outra sessão são ignorados. Esse contrato supõe um
único produtor ordenado; ainda não é um protocolo para múltiplos emissores.

O snapshot reúne sessão, revisão, estado ativo, título, índice, quantidade,
slide atual e próximo. Revisão aumenta por comando aceito, inclusive atualização
das marcações. Reemissão de Broadcast para recovery não altera essa revisão.
Fechar encerra a sessão; reabrir exige uma sessão nova. Cópias de slides protegem
os campos escalares usados nesta fatia; metadados aninhados não são modelados.

Sem áudio, o shadow recebe o índice solicitado e calcula os limites. Com áudio,
um pedido de navegação primeiro faz seek no player legado; o shadow recebe o
tempo somente quando o watcher confirma uma mudança real de slide. O core
calcula independentemente o índice a partir das marcações. Progresso contínuo,
clock de vídeo, Bíblia, overlays e formatação ficam fora desta fatia.

A comparação automática verifica título, índice, quantidade e campos visuais
escalares do slide atual/próximo após os commits. A primeira divergência de cada
sessão gera `presentation_shadow_divergence` contendo somente nomes dos campos,
sem letra, título ou outros conteúdos. Falha do shadow não bloqueia o legado.
`presentationShadow()` permite inspeção local e testes; não deve ser usado para
controle ou renderização. Ausência de divergências nesses campos não demonstra
paridade de todos os módulos nem autoriza cutover automático.

Validação: testes de replay determinístico, deduplicação, sessão antiga,
fechamento/reabertura, limites, cópia de inputs, troca de marcações, divergência
deliberada, seek assíncrono e requests de recovery. O trabalho não depende de
hardware Windows. Transporte revisionado, recovery de snapshots nas janelas e
validação física multiplataforma permanecem etapas posteriores.
