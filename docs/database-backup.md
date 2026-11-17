# Backup do Banco de Dados

Este documento descreve o fluxo de exportação e importação do banco local do LouvorJA Violin.

## Formato do arquivo

- Nome: `louvorja-violin-db-YYYY-MM-DD.zip`
- Conteúdo:
  - `manifest.json` (versão 3; registra `omittedFiles` quando algum arquivo gerenciado não existe no armazenamento)
  - um arquivo `.json` por tabela IndexedDB
  - `binary/<n>.bin` para Blobs/ArrayBuffers ainda dentro do IndexedDB
  - `opfs/<pasta>/<id>/<arquivo>` para os arquivos das bibliotecas web no OPFS
  - `desktop/<pasta>/<id>/<arquivo>` para os arquivos das bibliotecas desktop no acervo local

Exemplo:

```text
louvorja-violin-db-2026-09-01.zip
├── manifest.json
├── cache.json
├── musics.json
├── albums.json
├── ...
└── libras.bundles.json
```

## Exportação

- A tela de atualizações ganhou o botão `Exportar banco de dados`.
- O export usa `@zip.js/zip.js` em streaming: as tabelas viram JSON comprimido e
  os binários/arquivos das bibliotecas (OPFS no web, acervo no desktop) entram sem compressão.
- No desktop o ZIP é gravado direto no destino escolhido; no web com OPFS ele é
  montado num temporário e baixado como `File` (sem carregar tudo na memória).
- Erros de leitura/permissão em arquivos gerenciados interrompem a exportação com
  erro explícito; arquivos ausentes (`ENOENT`) são listados em `omittedFiles`
  no `manifest.json` e exibem aviso ao usuário (ou falham com `{ failOnMissingFiles: true }`).
- O arquivo gerado inclui metadados de versão, data, contagem de registros por
  tabela e a lista de arquivos das bibliotecas.
- A exportação mostra barra de progresso enquanto percorre as tabelas.

## Importação

- A tela de atualizações ganhou o botão `Importar banco de dados`.
- O usuário seleciona um arquivo `.zip` exportado pelo próprio app.
- O arquivo é validado pelo `manifest.json` antes de qualquer gravação.
- Se o arquivo for válido, todas as tabelas são limpas e os dados são gravados novamente.
- Os arquivos das bibliotecas são gravados primeiro em `.staging/<token>/restore/`
  (no OPFS ou via IPC desktop em `<acervo>/.staging/<token>/`); no desktop o
  diário `.staging/<token>/journal.json` registra os passos (`committing-files`
  → `committing-db` → `committed`) e o arquivo antigo é movido para
  `.staging/<token>/rollback/` antes da troca.
- Se qualquer etapa falhar ou o app fechar no meio, as tabelas anteriores voltam
  (marcador `__backup_commit__` no IndexedDB + diário desktop/OPFS) e os arquivos
  antigos são repostos no próximo boot antes de montar os módulos.
- No sucesso, o staging é apagado e os arquivos que nenhuma tabela restaurada
  referencia são limpos (respeitando permissão de escrita em acervo compartilhado).
- A importação também exibe barra de progresso, aparece nas tarefas em segundo
  plano e avisa caso o pacote tenha `omittedFiles`.
- **Armazenamento → Arquivos sem registro → Limpar** faz a mesma varredura sob
  demanda, preservando arquivos com menos de 24 h para não interromper uma
  importação em andamento.
- Backups versão 1/2 continuam sendo lidos pelo caminho antigo baseado em JSZip.

## Observações

- O backup exporta **todo o conteúdo local** do IndexedDB e os arquivos das
  bibliotecas gerenciadas (OPFS no web e acervo no desktop).
- A importação substitui completamente o conteúdo atual do banco.
- O botão de reinstalação do banco continua disponível ao lado dos novos botões.
