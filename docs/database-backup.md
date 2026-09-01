# Backup do Banco de Dados

Este documento descreve o fluxo de exportação e importação do banco local do LouvorJA Violin.

## Formato do arquivo

- Nome: `louvorja-violin-db-YYYY-MM-DD.zip`
- Conteúdo:
  - `manifest.json`
  - um arquivo `.json` por tabela IndexedDB

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
- O export usa `jszip` para montar um ZIP com todas as tabelas do banco local.
- O arquivo gerado inclui metadados de versão, data e contagem de registros por tabela.
- A exportação mostra barra de progresso enquanto percorre as tabelas.

## Importação

- A tela de atualizações ganhou o botão `Importar banco de dados`.
- O usuário seleciona um arquivo `.zip` exportado pelo próprio app.
- O arquivo é validado pelo `manifest.json` antes de qualquer gravação.
- Se o arquivo for válido, todas as tabelas são limpas e os dados são gravados novamente.
- A importação também exibe barra de progresso.

## Observações

- O backup exporta **todo o conteúdo local** do IndexedDB.
- A importação substitui completamente o conteúdo atual do banco.
- O botão de reinstalação do banco continua disponível ao lado dos novos botões.
