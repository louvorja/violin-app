# Remover a migração do formato antigo da tabela `devices`

> **Documento temporário.** Ele existe só para a tarefa de limpeza. Ao concluir,
> apague este arquivo e os comentários `TODO` que apontam para ele.

## O que é

A tabela `devices` (IndexedDB) guardava **um registro agregado** —
`{ id: "authorized_devices", devices: [ … ] }` — que o renderer reescrevia
inteiro a cada mudança. Agora ela guarda **um registro por dispositivo**, com a
chave sendo o `id` do aparelho, e o banco é a lista de **autorizados**: recusar
ou remover apaga a linha, e pendente nunca é gravado (a pendência vive só em
memória, até o operador aprovar).

A migração em `src/composables/useDevices.ts` cobre dois caminhos que ainda
podem trazer o formato antigo:

| Peça | O que faz |
| --- | --- |
| Expansão do agregado | Lê `authorized_devices`, grava uma linha por dispositivo e apaga o registro antigo |
| Limpeza de pendente persistido | Linha `status: "pending"` gravada por versão antiga sai da tabela, mas **continua na memória** — a tela de aprovação abre uma última vez |

Ambas rodam numa única leitura (`_lerDispositivos`), chamada por `syncFromIdb`.

## Quando remover

**Critério:** no próximo release, com uma ressalva importante — a migração
**também atende restauração de backup**. `DatabaseBackup.importAll`
(`src/helpers/DatabaseBackup.ts`) grava as linhas como vieram do arquivo e o
fluxo de import recarrega a janela; a leitura seguinte é que normalizava um
backup antigo. Sem a migração, **um backup no formato antigo importado perde os
dispositivos em silêncio** (a linha agregada fica na tabela e ninguém a lê).

Escolha uma das duas antes de remover:

- **só remover** — quando backups no formato antigo não importarem mais (alguns
  releases depois da mudança); ou
- **mover a normalização** para o `importAll` do backup, se quiser continuar
  aceitando backups antigos. Nesse caso o código sai do leitor e passa a viver
  na fronteira de importação, com o mesmo teste.

`DB_VERSION` **não** foi incrementado (mesma store, mesmo `keyPath: "id"`), então
a remoção é só código: não há `upgrade()`, selo ou schema para mexer.

## Passo a passo

Âncoras por texto: os números de linha mudam entre versões.

### 1. `src/composables/useDevices.ts`

Remova, nesta ordem:

- a constante `ID_REGISTRO_ANTIGO` (com o comentário `Id do registro agregado do
  formato ANTIGO`, que traz um dos `TODO`);
- a interface `RegistroAgregado` e a função `_ehRegistroAgregado`;
- dentro de `_lerDispositivos`, o bloco de migração (o comentário começa com
  `TODO: remover a migração logo abaixo no próximo release`) — ou seja, os
  filtros `agregados`/`doAgregado`, o `console.log` da migração e a chamada
  `$idb.putMany(...)`.

Também remova o trecho do docstring de `_lerDispositivos` que descreve a
migração, deixando o comentário focado no formato por linha.

A função deve ficar essencialmente assim:

```ts
async function _lerDispositivos(): Promise<Device[]> {
  const rows = await $idb.getAll<Device>(DB_TABLE.DEVICES);
  return rows
    .filter((row) => !!row && typeof row.id === "string")
    .sort(_porRegistro);
}
```

**Não** remova `_ehAutorizado` nem `_persistirDispositivo`: eles são o formato
novo (pendente não vai para o banco), não a migração.

### 2. `src/composables/__tests__/useDevices.storage.spec.ts`

Remova o `describe("migração do formato antigo (registro agregado)")` inteiro —
ele existe só para a migração. Os demais blocos (um registro por dispositivo,
banco = lista de autorizados) continuam valendo, inclusive o caso "pendente novo
não é gravado".

`useDevices.pendencia.spec.ts` **não** depende da migração (o mock devolve
linhas por dispositivo) — nada a fazer nele.

### 3. Confirme que não sobrou resíduo

```bash
rg "ID_REGISTRO_ANTIGO|_ehRegistroAgregado|RegistroAgregado|authorized_devices"
```

A busca deve voltar vazia. Se sobrar algo em `docs/security.md`
(a frase sobre a tabela `devices` descreve o formato novo, **não** a migração)
ou em `src/constants/DbTables.ts`, ajuste junto.

### 4. Apague este documento

## O que **não** remover

- O formato por linha: `$idb.put`/`$idb.del` por dispositivo em `addDevice`,
  `updateDevice`, `removeDevice`, `acceptPendingDevice` e `rejectPendingDevice`.
- A ordenação por `registeredAt` (`_porRegistro`).
- `status` como marcador de pendência **em memória**, `_ehPendente` e
  `_syncPendingFromList` — inclusive a inferência de boot para registro sem
  `status` sem permissões (decisão explícita; já coberta por teste em
  `useDevices.pendencia.spec.ts`).
- `_syncToMainProcess` enviando a lista **completa** (pendentes incluídos): é
  dela que o auth do main precisa para liberar `/api/ping` de device pendente.

## Verificação

```bash
npm run validate:agent-context
npm run validate:manifests
npm run typecheck
npm test
npm run lint
```

Teste manual (perfil de teste): aprovar um dispositivo → **uma linha por
dispositivo** na tabela `devices`; remover → a linha some; registrar um pendente
→ **nenhuma** linha nova. Se você escolheu continuar aceitando backups antigos,
teste também a importação de um backup no formato agregado.

## Checklist

- [ ] `ID_REGISTRO_ANTIGO`, `RegistroAgregado` e `_ehRegistroAgregado` removidos
- [ ] bloco de migração (e `putMany`) removido de `_lerDispositivos`
- [ ] comentários `TODO` da migração removidos
- [ ] `describe` de migração removido do `useDevices.storage.spec.ts`
- [ ] busca de resíduo vazia
- [ ] verificações do bloco acima passando
- [ ] decisão registrada sobre backups antigos (remover ou normalizar no import)
- [ ] este arquivo apagado
