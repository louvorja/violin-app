# Presentation Core: primeira fatia em shadow mode

`src/presentation/MusicPresentationCore.ts` modela apenas slides de música.
É TypeScript puro, sem Vue, DOM, relógio, BroadcastChannel ou Electron.
`useSlides` continua sendo a autoridade e alimenta o core em paralelo.
Nenhuma janela renderiza o snapshot novo; não há cutover nem novo transporte.

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
