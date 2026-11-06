# Item do culto: liturgia e programa sem duplicação

A **liturgia** (módulo `liturgy`) e o **programa** do Modo apresentação
(`presentation_mode`) descrevem a mesma coisa — os itens de um culto — com
propósitos diferentes. A liturgia é a lista do dia da semana, com o formato
herdado do Delphi (`.ja`). O programa é o culto de uma data, em sessões, com
o que a operação ao vivo precisa a mais (versículo, pasta, momento, "muda
toda semana").

Este documento registra como os dois passam a compartilhar uma base em vez
de manter cópias paralelas, e o que fica para decidir junto.

## Ponto de partida

O programa já carrega o item da liturgia inteiro em `ProgramItem.source` e
executa pelo `executeItem` da liturgia. A duplicação estava em volta disso:

| Repetido | Onde |
| --- | --- |
| Classificar o item (o que ele projeta) | `kindFromLiturgy` no programa; `iconForItem` em `helpers/Liturgy.ts` |
| Tipo pela extensão do arquivo | `kindFromPath` no programa |
| Detectar link do YouTube | programa, `useLiturgyExecution`, `helpers/Liturgy.ts` |
| Montar um item com os padrões do formato | `liturgyItem` no programa, `DEFAULT_FORM` e `$liturgy.add` na liturgia |
| Lista de tipos | `ProgramItemKind` repetia os tipos da liturgia |
| Execução | o programa monta itens novos para Canva, arquivo e PDF e toca música por fora do `executeItem` |
| Horários | `liturgy/agenda.ts` (âncoras HH:MM) e `program/time.ts` (minutos, previsão de atraso) |
| Armazenamento | liturgias salvas por dia × modelos de culto e programas por data |

## Decisão

**A liturgia é a fonte da verdade do item; o programa estende.** O
`LiturgyItem` continua sendo o formato gravado — UserData por dia da semana,
`liturgy.library` no DocStore e o `.ja` não mudam. O programa acrescenta o
que é dele (`bible`, `children`, `folder`, `fill`, sessões) sem uma segunda
tabela de tipos ou padrões.

Três formas de interface foram comparadas:

- **Mínima** — três entradas: descrever o item, montar a agenda e executar
  com um adaptador que o programa preenche antes do despacho padrão.
- **Extensível** — um registro de tipos: cada tipo declara ícone, caminhos e
  execução; o programa registra uma camada por cima e guarda extras num
  `ext` livre.
- **Caso comum** — montar o item e classificá-lo, movidos para a liturgia,
  sem mudar execução, agenda nem tipos.

Escolha: o **caso comum agora** e a **execução da mínima em seguida**. O
registro de tipos só se paga quando liturgia e programa forem um módulo só;
antes disso, ele obriga a mudar o formato gravado (o `.ja` descartaria o
`ext`) sem ganho imediato.

## Etapa 1 — o item (esta mudança)

`src/modules/liturgy/item.ts`, puro, sem Vue nem Pinia:

```ts
newItem(tipo, campos?)  // item completo com os padrões do formato; id novo se faltar
kindOf(item)            // o que o item projeta: LiturgyItemKind
kindOfPath(path)        // o que um arquivo projeta, pela extensão
isYoutube(url)
```

`LiturgyItemKind` fica em `src/types/Liturgy.ts`, e `ProgramItemKind` passa
a ser `LiturgyItemKind | "bible" | "moment" | "folder"`.

Nada muda de comportamento: o código foi movido do programa para a
liturgia, e `useLiturgyExecution` usa o mesmo `isYoutube`. Os testes da
classificação mudaram para `src/modules/liturgy/__tests__/item.spec.ts`.

## Etapa 2 — a execução

```ts
useItemExecution(adapter?).execute(item, { musicMode?, startAt? })
  → "projected" | "skipped" | "failed"
```

A ordem fica fixa num lugar só: recolhe o overlay do item anterior, pergunta
ao adaptador (que pode reescrever o item, dizer que já tratou ou abortar),
despacha pelo `tipo` e, se projetou, ativa o overlay vinculado. A liturgia
usa sem adaptador; `executeItem` e `executeAnnouncements` continuam como
atalhos.

O programa vira um adaptador: música no palco com a versão escolhida, Canva
com o link renovado, arquivo da nuvem baixado antes e PowerPoint como PDF.
Isso corrige um defeito de hoje: nesses caminhos o programa executa um item
montado na hora, sem o `linked_overlay_id` do original, então o **overlay
vinculado a um item de Canva, arquivo ou música não é ativado** quando o
item vai pelo programa. O resultado de `execute` também é o que o programa
precisa para saber o que está no ar.

## Para decidir junto (fase 2)

1. **Um módulo só.** Liturgia e programa como um módulo profundo: a sessão
   vira o `BLOCO`, e os extras do programa viram campos opcionais do item.
   As etapas 1 e 2 já recebem `LiturgyItem`, então nenhum chamador delas
   muda.
2. **Agenda.** Âncoras HH:MM da liturgia e minutos com previsão de atraso do
   programa são modelos diferentes. Unificar antes do item 1 daria um módulo
   raso.
3. **Padrões de um item novo.** Hoje há três conjuntos, e eles divergem:

   | Onde | `cor` | `musica` | `dir_info` |
   | --- | --- | --- | --- |
   | `$liturgy.add` | `#4F0000` | `0` | `""` |
   | `DEFAULT_FORM` | `#00004F` | `-1` | `"E"` |
   | programa (`newItem`) | `#4F0000` | `-1` | `"E"` |

   Qual é o certo, e se `newItem` deve ser o único.
4. **Armazenamento e a pasta da igreja.** O programa grava no DocStore e,
   com uma pasta da igreja escolhida (uma pasta sincronizada pela nuvem, como o
   OneDrive), também lá,
   conferindo se outro computador alterou o arquivo. Para a liturgia ganhar
   o mesmo, a lista do dia precisa sair das preferências (UserData) para um
   documento próprio — uma migração de dados, que não volta atrás. O modo
   nativo continua o padrão; a pasta seria opcional.
5. **Ícone por tipo.** `iconForItem` (liturgia) e `KIND_ICONS` (programa)
   ainda são duas tabelas. Juntá-las fica natural depois do item 1.
