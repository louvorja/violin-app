# Backup do Banco de Dados

Este documento descreve o fluxo de exportação e importação do banco local do LouvorJA Violin.

## Formato do arquivo

- Nome: `louvorja-violin-db-YYYY-MM-DD.zip`
- Conteúdo:
  - `manifest.json` (versão 3)
  - um arquivo `.json` por tabela IndexedDB
  - `binary/<n>.bin` para Blobs/ArrayBuffers ainda dentro do IndexedDB
  - `opfs/<pasta>/<id>/<arquivo>` para os arquivos das bibliotecas web no OPFS

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
  os binários/arquivos OPFS entram sem compressão.
- No desktop o ZIP é gravado direto no destino escolhido; no web com OPFS ele é
  montado num temporário e baixado como `File` (sem carregar tudo na memória).
- O arquivo gerado inclui metadados de versão, data, contagem de registros por
  tabela e a lista de arquivos OPFS.
- A exportação mostra barra de progresso enquanto percorre as tabelas.

## Importação

- A tela de atualizações ganhou o botão `Importar banco de dados`.
- O usuário seleciona um arquivo `.zip` exportado pelo próprio app.
- O arquivo é validado pelo `manifest.json` antes de qualquer gravação.
- Se o arquivo for válido, todas as tabelas são limpas e os dados são gravados novamente.
- Os arquivos OPFS são importados primeiro para `.staging/<token>/restore/`;
  o arquivo antigo é copiado para `.staging/<token>/rollback/` antes da troca.
- Se qualquer etapa falhar, as tabelas anteriores voltam e os arquivos antigos
  são repostos a partir do rollback; arquivos novos são removidos.
- No sucesso, o staging é apagado e os arquivos OPFS que nenhuma tabela restaurada
  referencia são limpos.
- O staging abandonado por uma sessão encerrada é removido no boot.
- A importação também exibe barra de progresso e aparece nas tarefas em segundo
  plano.
- **Armazenamento → Arquivos sem registro → Limpar** faz a mesma varredura sob
  demanda, preservando arquivos com menos de 24 h para não interromper uma
  importação em andamento.
- Backups versão 1/2 continuam sendo lidos pelo caminho antigo baseado em JSZip.

## Observações

- O backup exporta **todo o conteúdo local** do IndexedDB e, no web, os arquivos
  das bibliotecas que estão no OPFS.
- A importação substitui completamente o conteúdo atual do banco.
- O botão de reinstalação do banco continua disponível ao lado dos novos botões.
