# Design System — LouvorJA

Documentação do sistema de design do LouvorJA. Todos os tokens visuais estão definidos em
`src/assets/styles/tokens.css` e as classes utilitárias em `src/assets/styles/utilities.css`.

**Regra fundamental:** toda a UI do shell usa exclusivamente esses tokens via `var()`.
Cores hex hardcoded em componentes são consideradas inconsistências e devem ser substituídas.

---

## Paleta de Cores

### Primária — Navy

Azul marinho derivado da skin Delphi original (`officetab` / `BusinessSkinForm`).
Usado em: tabs, titlebar, sidebar do AppMenu, botões primários.

| Token                | Valor                    | Uso                      |
| -------------------- | ------------------------ | ------------------------ |
| `--lj-navy`          | `#1b4f8a`                | Cor base da identidade   |
| `--lj-navy-dark`     | `#143a66`                | Hover sobre navy         |
| `--lj-navy-darker`   | `#0e2a4c`                | Tabs no tema dark        |
| `--lj-navy-active`   | `#2563a4`                | Estado ativo/pressed     |
| `--lj-navy-ch`       | `27 79 138`              | Canais RGB para `rgba()` |
| `--lj-navy-alpha-30` | `rgba(27, 79, 138, 0.3)` | Overlay suave            |

### Secundária — Orange

Laranja de acento. Usado em: tabs contextuais, sidebar ativo.

| Token                  | Valor                      | Uso                  |
| ---------------------- | -------------------------- | -------------------- |
| `--lj-orange`          | `#f39c12`                  | Cor base do acento   |
| `--lj-orange-dark`     | `#cd771b`                  | Estado ativo/pressed |
| `--lj-orange-darker`   | `#b56514`                  | Pressed profundo     |
| `--lj-orange-soft`     | `#fef5e9`                  | Fundo tonal suave    |
| `--lj-orange-alpha-12` | `rgba(243, 156, 18, 0.12)` | Overlay muito suave  |
| `--lj-orange-alpha-30` | `rgba(243, 156, 18, 0.3)`  | Overlay médio        |

### Funcionais

| Token                | Valor                     | Uso                         |
| -------------------- | ------------------------- | --------------------------- |
| `--lj-danger`        | `#dc2626`                 | Erro, exclusão              |
| `--lj-danger-dark`   | `#b91c1c`                 | Hover/pressed em danger     |
| `--lj-danger-light`  | `#fca5a5`                 | Texto de erro no dark theme |
| `--lj-danger-soft`   | `rgba(220, 38, 38, 0.12)` | Fundo de alerta de erro     |
| `--lj-danger-border` | `rgba(220, 38, 38, 0.3)`  | Borda de erro               |
| `--lj-success`       | `#16a34a`                 | Confirmação, sucesso        |
| `--lj-success-soft`  | `rgba(22, 163, 74, 0.12)` | Fundo de alerta de sucesso  |
| `--lj-warning`       | `#ea580c`                 | Aviso                       |
| `--lj-warning-dark`  | `#d97706`                 | Hover em warning            |
| `--lj-info`          | `#2563eb`                 | Informação                  |
| `--lj-info-light`    | `#6ea0d0`                 | Link no dark theme          |

### Cores de Projeção

Específicas para as telas de projeção, operador e stage display — inspiradas nas
cores fixas do app Delphi original.

| Token                        | Valor                    | Uso                                         |
| ---------------------------- | ------------------------ | ------------------------------------------- |
| `--lj-color-cover-gold`      | `#efb400`                | Capa do slide (fundo cover)                 |
| `--lj-slide-text-gold`       | `#f6c32a`                | Texto de slide (cover + repeat)             |
| `--lj-color-projection-bg`   | `#000000`                | Fundo da tela `/projection`                 |
| `--lj-color-return-bg`       | `#293329`                | Fundo do stage display `/projection/return` |
| `--lj-color-operator-panel`  | `#353535`                | Painel lateral do `/operator`               |
| `--lj-color-operator-grid`   | `#232323`                | Grade de slides do `/operator`              |
| `--lj-color-operator-line`   | `#524752`                | Linha de separação no operador              |
| `--lj-color-list-bg`         | `#232323`                | Fundo de listas em projeção                 |
| `--lj-color-splash-bg`       | `#f7fafd`                | Fundo da tela de splash                     |
| `--lj-color-favorites-line`  | `#e8e8e8`                | Linha de favoritos (light)                  |
| `--lj-color-cover-gold-dark` | `#c89500`                | Capa no player dark                         |
| `--lj-gold-alpha-60`         | `rgba(239, 180, 0, 0.6)` | Overlay gold semi-transparente              |

Na área inicial da janela principal, `--lj-home-bg` usa `#2e74aa` no tema
Claro, `#155b8a` no Azul e `#1b2a41` no Azul-escuro. No tema escuro, usa o mesmo
`--lj-body-bg` da ribbon (`#1f2937`), enquanto a barra superior permanece
azul (`#153653`). Os demais temas coloridos usam um tom da própria paleta.
`--lj-shell-chrome-bg` controla a barra superior e a lateral do menu.
Texto, ícones e botões nativos da janela acompanham o contraste do fundo.
No escuro, a aba selecionada também usa `--lj-body-bg`, sem mudar de tom
na passagem para o corpo da ribbon.

---

## Escala de Cinzas

Escala de 9 passos de `#f7f9fc` a `#131820`. Usada como base para superfícies,
bordas, texto muted e outros elementos neutros.

| Token           | Valor     |
| --------------- | --------- |
| `--lj-gray-50`  | `#f7f9fc` |
| `--lj-gray-100` | `#eef2f7` |
| `--lj-gray-200` | `#dde4ed` |
| `--lj-gray-300` | `#c5d0dc` |
| `--lj-gray-400` | `#9aa6b5` |
| `--lj-gray-500` | `#6b7888` |
| `--lj-gray-600` | `#505e6e` |
| `--lj-gray-700` | `#3a4654` |
| `--lj-gray-800` | `#232c38` |
| `--lj-gray-900` | `#131820` |

---

## Superfícies e Texto

Tokens semânticos que mudam automaticamente entre tema light e dark.
Prefira esses em vez dos cinzas diretos.

### Superfícies

| Token                        | Light     | Dark      |
| ---------------------------- | --------- | --------- |
| `--lj-surface-bg`            | `#ffffff` | `#1f2937` |
| `--lj-surface-bg-soft`       | gray-50   | `#161e2c` |
| `--lj-surface-bg-hover`      | gray-100  | `#243248` |
| `--lj-surface-bg-active`     | gray-200  | `#2d3a52` |
| `--lj-surface-border`        | gray-200  | `#2a3441` |
| `--lj-surface-border-strong` | gray-300  | `#3a4654` |
| `--lj-surface-divider`       | gray-100  | `#2a3441` |

### Texto

| Token                     | Light                                     | Dark                                           |
| ------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `--lj-text`               | gray-800                                  | `#e5e7eb`                                      |
| `--lj-text-muted`         | gray-600                                  | `#9aa3ad`                                      |
| `--lj-text-subtle`        | gray-500                                  | `#6b7280`                                      |
| `--lj-text-on-navy`       | `rgba(255,255,255,0.92)`                  | —                                              |
| `--lj-text-on-navy-muted` | `rgba(255,255,255,0.7)`                   | —                                              |
| `--lj-on-surface-ch`      | `35 44 56` (light) / `229 231 235` (dark) | Canais RGB de `--lj-text` para uso em `rgba()` |

### Genéricos

| Token                     | Uso                                        |
| ------------------------- | ------------------------------------------ |
| `--lj-white`              | `#ffffff` fixo (sem override dark)         |
| `--lj-hover-bg`           | Alias de `--lj-surface-bg-hover`           |
| `--lj-active-bg`          | Navy 8% (light) / Azul 15% (dark)          |
| `--lj-focus-ring`         | `0 0 0 2px rgba(navy, 0.4)` — foco visível |
| `--lj-divider`            | Alias de `--lj-surface-divider`            |
| `--lj-link-color`         | Navy (light) / `--lj-info-light` (dark)    |
| `--lj-scrollbar-thumb-bg` | Black 18% (light) / White 18% (dark)       |
| `--lj-alert-error-color`  | danger-dark (light) / danger-light (dark)  |
| `--lj-live-bg`            | Gradiente vermelho (banner live pulsante)  |
| `--lj-live-color`         | `#ffffff`                                  |

### Transparências utilitárias

Overlays pré-definidos para hover, press e sombras.

| Token                 | Valor                    |
| --------------------- | ------------------------ |
| `--lj-white-alpha-08` | `rgba(255,255,255,0.08)` |
| `--lj-white-alpha-10` | `rgba(255,255,255,0.1)`  |
| `--lj-white-alpha-18` | `rgba(255,255,255,0.18)` |
| `--lj-white-alpha-20` | `rgba(255,255,255,0.2)`  |
| `--lj-white-alpha-25` | `rgba(255,255,255,0.25)` |
| `--lj-black-alpha-18` | `rgba(0,0,0,0.18)`       |
| `--lj-black-alpha-20` | `rgba(0,0,0,0.2)`        |
| `--lj-black-alpha-30` | `rgba(0,0,0,0.3)`        |
| `--lj-black-alpha-40` | `rgba(0,0,0,0.4)`        |
| `--lj-black-alpha-75` | `rgba(0,0,0,0.75)`       |
| `--lj-navy-alpha-30`  | `rgba(27,79,138,0.3)`    |

### Escolha do tema e modo Automático

Os tokens de cada tema vivem em `[data-theme="<id>"]` (`tokens.css`), sempre no `<html>`.
A preferência guardada em `options.theme` é um id de tema **ou `"auto"`**, e é o padrão de
quem nunca escolheu. No Automático o tema em uso acompanha o modo do sistema
(`prefers-color-scheme`): escuro vira `dark`; claro volta ao último tema claro escolhido
(ou `darkblue`). O `<html>` recebe sempre o tema já resolvido, nunca `"auto"` — por isso
nenhum CSS precisa conhecer o modo. O botão sol/lua do cabeçalho é uma escolha explícita:
quem o aciona sai do Automático.

A regra vive num lugar só: `resolveTheme` em `src/config/Themes.ts`, aplicada por
`useAppTheme` e, em cada janela, por `startThemeSync` no bootstrap.

---

## Tipografia

### Famílias de Fonte

| Token                  | Família                                                   | Uso                                       |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------- |
| `--lj-font-shell`      | Tahoma, Segoe UI, Helvetica Neue                          | Interface geral do shell                  |
| `--lj-font-projection` | DINCondensedBold, DIN Condensed, Bebas Neue, Arial Narrow | Telas de projeção (`/projection`, `/obs`) |
| `--lj-font-mono`       | SF Mono, Consolas                                         | Código, timestamps                        |

A fonte `DINCondensedBold` é carregada em `src/assets/styles/fonts.css` e replica
a tipografia do app Delphi original.

### Escala de Tamanhos

| Token            | Valor    | Contexto             |
| ---------------- | -------- | -------------------- |
| `--lj-text-xs`   | `10px`   | Badges, group labels |
| `--lj-text-sm`   | `11px`   | Status bar           |
| `--lj-text-base` | `12px`   | Ribbon body (padrão) |
| `--lj-text-md`   | `12.5px` | Tabs                 |
| `--lj-text-lg`   | `14px`   | Títulos de módulos   |
| `--lj-text-xl`   | `16px`   | Títulos de popups    |
| `--lj-text-2xl`  | `22px`   | Hero (Sobre, Opções) |

### Pesos de Fonte

| Token                  | Valor |
| ---------------------- | ----- |
| `--lj-weight-regular`  | `400` |
| `--lj-weight-medium`   | `500` |
| `--lj-weight-semibold` | `600` |
| `--lj-weight-bold`     | `700` |

---

## Espaçamento

Escala de 8 passos com base de 4px.

| Token          | Valor  | Uso                                  |
| -------------- | ------ | ------------------------------------ |
| `--lj-space-1` | `2px`  | Espaço mínimo (ex: padding de badge) |
| `--lj-space-2` | `4px`  | Padrão mínimo de gap                 |
| `--lj-space-3` | `6px`  | Gap interno de itens compactos       |
| `--lj-space-4` | `8px`  | Gap padrão entre elementos           |
| `--lj-space-5` | `12px` | Padding interno de botões/cards      |
| `--lj-space-6` | `16px` | Espaço entre seções                  |
| `--lj-space-7` | `20px` | Padding de painéis                   |
| `--lj-space-8` | `24px` | Espaço maior entre blocos            |

---

## Border Radius

| Token              | Valor         | Uso                         |
| ------------------ | ------------- | --------------------------- |
| `--lj-radius-xs`   | `3px`         | Tags, badges pequenos         |
| `--lj-radius-sm`   | `4px`         | Botões padrão                 |
| `--lj-radius-md`   | `6px`         | Popups, cards                 |
| `--lj-radius-lg`   | `8px`         | Dialogs                       |
| `--lj-radius-pill` | `999px`       | Chip, badge, switch, slider   |
| `--lj-radius-tab`  | `6px 6px 0 0` | Tabs (topo arredondado)       |

A pílula existe porque o valor sozinho não diz a intenção: doze lugares tinham
chegado nela por conta própria, com `10px`, `12px`, `20px` e `999px` — todos
maiores que metade da altura do elemento, que é o ponto em que o navegador
arredonda por completo. Números diferentes, mesmo desenho na tela. Use o token
quando a forma pedida for a cápsula, não um canto arredondado.

---

## Elevação e Sombras

### Sombras de Elevação

Três níveis de profundidade para criar hierarquia visual.

| Token           | Valor                        | Uso                                 |
| --------------- | ---------------------------- | ----------------------------------- |
| `--lj-shadow-1` | `0 1px 3px rgba(0,0,0,0.1)`  | Cards, botões ligeiramente elevados |
| `--lj-shadow-2` | `0 2px 8px rgba(0,0,0,0.15)` | Dropdowns, tooltips                 |
| `--lj-shadow-3` | `0 4px 16px rgba(0,0,0,0.2)` | Modais, drawers                     |

Exemplo:

```css
.card {
  box-shadow: var(--lj-shadow-2);
}
```

### Focus Rings

| Token                       | Valor                        | Uso                              |
| --------------------------- | ---------------------------- | -------------------------------- |
| `--lj-focus-ring`           | `0 0 0 2px rgba(navy, 0.4)`  | Foco acessível padrão            |
| `--lj-shadow-focus-navy`    | `0 0 0 2px rgba(navy, 0.2)`  | Foco suave (elementos embutidos) |
| `--lj-shadow-focus-navy-sm` | `0 0 0 2px rgba(navy, 0.15)` | Foco muito sutil                 |

---

## Animações e Transições

Quatro famílias de tokens, uma pergunta para escolher: **o que está mudando?**

| O que muda                                   | Família               |
| -------------------------------------------- | --------------------- |
| Cor, opacidade, sombra                       | `--lj-transition-*`   |
| Lugar ou tamanho, ao **entrar** (`transform`) | `--lj-motion-*`       |
| Qualquer coisa, ao **sair**                  | `--lj-exit-*`         |
| Layout (`width`, `height`, `margin`…)        | `--lj-reflow-*`       |

### Curva — cor, opacidade, sombra

| Token                    | Valor                  | Uso                              |
| ------------------------ | ---------------------- | -------------------------------- |
| `--lj-transition-fast`   | `110ms --lj-ease-out`  | Hover imediato (botões, ícones)  |
| `--lj-transition-normal` | `180ms --lj-ease-out`  | Transição padrão de estado, véus |
| `--lj-transition-slow`   | `260ms --lj-ease-out`  | Fade de painel                   |

São curtas e só desaceleram: resposta de hover não pode parecer que está
pensando. A exceção é a projeção, que lê `--fade-ms` em tempo de execução porque
a duração do fade é ajuste do operador, não do design system.

`--lj-ease` (a curva de ida e volta, `cubic-bezier(0.4, 0, 0.2, 1)`) **não se
reajusta**: o sorteio a usa no telão (`DrawProjection`, `DrawWheel`). Curva nova
de interface ganha nome próprio.

```css
.btn {
  transition: background-color var(--lj-transition-fast);
}
```

### Mola — `transform`, na entrada

Uma curva tem roteiro: sai, acelera, freia, chega. Uma mola arranca rápido e
pousa devagar, e é o pouso que faz a interface parecer física. O tempo declarado
engana para mais: a cauda é longa e quase parada, então 95% do percurso se
cumpre em pouco mais da metade do tempo. Dá para ser suave sem atrasar quem
opera ao vivo.

| Token                 | Valor                            | 95% do percurso | Uso                                                |
| --------------------- | -------------------------------- | --------------- | -------------------------------------------------- |
| `--lj-motion-fast`    | `0.18s --lj-ease-spring`         | ~0,10s          | Filho de `<Transition>` (alerta, paleta, loading), seta e marca de select |
| `--lj-motion-normal`  | `0.28s --lj-ease-spring`         | ~0,15s          | Menu, select, combobox, popover, diálogo, janela, painel, troca de página, indicador de aba |
| `--lj-motion-bounce`  | `0.32s --lj-ease-spring-bounce`  | ~0,11s          | Peça pequena e solta: pino do switch, toast                   |

As duas curvas:

- **`--lj-ease-spring`** — amortecimento 1, chega **sem passar do alvo**. É a
  padrão, e a única que serve para o que nasce encostado numa borda: um painel
  que passasse do alvo abriria uma fresta atrás de si.
- **`--lj-ease-spring-bounce`** — amortecimento 0,7, passa ~5% e volta. Só em
  peça pequena e solta. Num pino de 12px é meio pixel; num painel de 300px
  seriam 14px de tranco.

### Traço que se desenha

| Token       | Valor              | Uso                                          |
| ----------- | ------------------ | -------------------------------------------- |
| `--lj-draw` | `0.26s --lj-ease`  | A marca do checkbox, riscada ao marcar       |

Não é entrada nem saída: é progresso ao longo de um caminho
(`stroke-dashoffset`). A curva que arranca e freia lê como mão riscando; a
exponencial de `--lj-transition-*` faria o traço aparecer quase inteiro no
primeiro quadro. Ao desmarcar, o traço é recolhido em `--lj-exit-panel`.

`<input type="checkbox">` solto (telas que ainda não usam `LjCheckbox`) recebe a
classe `lj-native-check` (ui.css): mesma caixa e o mesmo tique desenhado, em dois
traços que crescem em sequência (`--lj-draw-time`) e são recolhidos na ordem
inversa (`--lj-draw-back-time`). `.opt-checkbox input` já a herda.

### Saída

| Token              | Valor                 | Uso                                        |
| ------------------ | --------------------- | ------------------------------------------ |
| `--lj-exit-fast`   | `100ms --lj-ease-in`  | Camada que percorre poucos pixels          |
| `--lj-exit-panel`  | `150ms --lj-ease-in`  | Painel que cruza a própria largura         |

Quem sai acelera e some. Ninguém olha para o que está fechando, e enquanto o véu
não some ele segura os cliques.

Animação de saída (`@keyframes` em `data-state="closed"`) leva `both`: sem o
preenchimento, entre o fim da animação e a Reka desmontar a camada ela volta um
quadro inteiro ao estado visível.

### Layout

| Token                 | Valor                  |
| --------------------- | ---------------------- |
| `--lj-reflow-enter`   | `200ms --lj-ease-out`  |
| `--lj-reflow-exit`    | `140ms --lj-ease-in`   |

Para `width`, `height`, `margin`, `padding` — e para todo `transform` que
precisa andar **junto** com um deles. Cada quadro refaz o layout do que está em
volta, então aqui não há mola e o par é curto.

Duas duplas dependem disso, e nas duas os dois lados usam o MESMO token nas duas
direções — com tempos diferentes aparece uma faixa vazia entre eles no meio do
caminho:

- o rodapé do player sobe (`transform`) enquanto o conteúdo ganha
  `padding-bottom` (`Footer.vue` ↔ `.shell-root` em `Shell.vue`);
- o chat pinado desliza (`transform`) enquanto o conteúdo ganha `margin-left`
  (`ChatDrawer.vue` ↔ `.shell-center` em `Shell.vue`).

```css
.painel-enter-active {
  transition: transform var(--lj-motion-normal); /* entra com mola */
}
.painel-leave-active {
  transition: transform var(--lj-exit-panel); /* sai seco */
}
```

#### O que a mola NÃO faz aqui

- **Não anima layout.** `width`, `height`, `margin`, `top`… refazem o layout a
  cada quadro e usam `--lj-reflow-*`. A única exceção é o indicador do
  `LjTabs`, que é absoluto e não empurra ninguém.
- **Não anima cor nem opacidade.** A de quique faria a opacidade "passar" de 1.
  Quando o mesmo elemento muda de lugar e esmaece, são duas transições:
  `opacity var(--lj-transition-normal), transform var(--lj-motion-fast)`.
- **Não vai na saída.** Quem sai usa `--lj-exit-*`.
- **Não entra na projeção.** O que vai para o telão tem transição escolhida
  pelo operador (`--fade-ms`, os efeitos de `transitions.css`).
- **Não vira lista em cascata.** Entrada escalonada de itens fica bonita com
  dez linhas e pesada com o hinário inteiro.
- **Não entra na troca de aba de módulo.** Ela é instantânea, sem fade: uma aba
  que entra transparente deixa a cor do tema aparecer atrás dela por alguns
  quadros. Quem evita o buraco é `Modules.vue`, que mantém a aba anterior
  desenhada até a nova estar pronta (`composables/useModuleSwap.ts`).

`src/__tests__/Motion.spec.ts` trava as regras de layout, de cor e opacidade,
da projeção e da troca de aba.

#### Por que `linear()` e não uma biblioteca

As molas são curvas pré-calculadas — a resposta de uma mola amortecida,
amostrada e entregue ao CSS como `linear(...)`. Continuam sendo transições
comuns: rodam no compositor, sem JavaScript por quadro e sem dependência nova.
`scripts/spring-curves.mjs` gera os pontos; para mudar o caráter, mexa nos
parâmetros lá e cole o resultado em `tokens.css`.

O preço é que a transição não carrega velocidade: interrompida no meio, ela
retoma da posição atual, mas parte de novo do repouso. Para menus, diálogos e
painéis isso é imperceptível. Arrasto com inércia de verdade precisaria de mola
simulada em JavaScript — não há nenhum caso assim no app hoje.

Navegador sem `linear()` (Safari antes do 17.2 — o controle remoto roda no
celular de quem estiver na igreja) descartaria a declaração inteira e a camada
apareceria seca. Por isso os tokens nascem com uma reserva em `cubic-bezier` e
um `@supports` troca pela mola. Nunca escreva `linear(...)` direto num
componente: use o token.

#### Transição em filho de `<Transition>`

O Vue encerra a transição quando termina a do **elemento raiz**. No alerta e na
paleta de comandos a raiz é o véu (opacidade) e quem se move é a caixa, filha.
Se a mola da caixa durar mais que a opacidade do véu, a classe `-active` sai no
meio do caminho e a caixa salta para o lugar. Por isso `--lj-motion-fast` e
`--lj-transition-normal` têm os mesmos 0,18s — mude um, mude o outro.

### Aperto

`LjButton` cede enquanto está apertado. A ida é seca (0,08s) e a volta usa
`--lj-motion-bounce`.

| Token              | Valor  | Onde                                             |
| ------------------ | ------ | ------------------------------------------------ |
| `--lj-press-shift` | `1px`  | Botão com texto: afunda uma distância fixa       |
| `--lj-press-scale` | `0.92` | Botão só-ícone: encolhe                          |

São dois gestos porque escala é proporcional ao tamanho, e botão aqui tem a
largura que o layout der: os 3% que mal se veem num botão de 96px são 30px num
botão esticado pela coluna. O só-ícone é quadrado e pequeno por contrato, então
nele a escala é segura.

Mexer no botão mexe na área de clique: quem aperta na borda solta o ponteiro
fora do botão já deslocado, e o navegador entrega o `click` ao elemento pai — o
botão afunda e a ação não acontece, sem erro. Medido no Chrome: sem guarda, o
só-ícone de 44px perdia o clique nas quatro bordas. O `::after` com `inset`
negativo em `LjButton.vue` devolve essa faixa, e com ele o resultado é idêntico
ao do botão parado — em 96px, em 44px e num botão de 1100px esticado. Se for dar
aperto a outro controle, leve a guarda junto.

Os outros controles apertam por dentro, sem mexer na caixa que recebe o clique:
a caixa do `LjCheckbox` encolhe dentro do `<label>`, o pino do `LjSwitch` e o do
`LjSlider` usam a propriedade `scale` — que é independente do `transform`. No
slider isso não é estilo, é necessidade: a Reka posiciona o pino com `transform`
inline, e um `transform: scale()` numa regra simplesmente não acontece.

A marca do `LjCheckbox` só "pula" depois que o operador mexe naquela caixa
(classe `lj-check--toggled`). Animar toda caixa marcada que aparece na tela
dispara cem pulos de uma vez ao abrir uma lista já marcada.

### Amplitude — o tamanho de quem entra

O tempo sozinho não faz ninguém ver a animação. A primeira rodada deste
trabalho tinha as curvas certas e amplitudes de 4px e 0,97: tudo "animado", e
na tela parecia cortar seco. Estes são os tamanhos a partir dos quais a entrada
se lê como movimento — e o teto, acima do qual ela vira espetáculo.

| Token                     | Valor  | Uso                                                           |
| ------------------------- | ------ | ------------------------------------------------------------- |
| `--lj-enter-layer-shift`  | `8px`  | Menu, select, combobox, popover: afastamento do gatilho       |
| `--lj-enter-layer-scale`  | `0.92` | Idem: cresce a partir do gatilho (`transform-origin` da Reka) |
| `--lj-enter-edge-shift` | `12px` | Toast, barra de abertura: quanto sobem da borda de baixo      |
| `--lj-enter-dialog-scale` | `0.94` | Diálogo, janela, alerta, paleta: crescem a partir do clique que os abriu|
| `--lj-enter-page-shift`   | `12px` | Troca de página: deslize pelo lado para onde se navegou               |

Página não escala: uma tela inteira encolhendo é pesada de desenhar e de ver.

Diálogo, janela, alerta e paleta **não têm deslocamento fixo**. Subir sempre os
mesmos pixels, venha de onde vier, tem cara de efeito aplicado por cima. A
escala é ancorada no ponto do clique que abriu a camada
(`applyMotionOrigin()`, `src/helpers/MotionOrigin.ts`, chamado no
`open-auto-focus`): o diálogo cresce a partir do botão, e o deslocamento que se
vê é consequência disso. Aberta pelo teclado, a camada escala a partir da
origem natural dela — o centro; para a paleta de comandos, o topo.
A saída usa amplitude menor que a entrada e fica escrita no keyframe — ninguém
olha para o que está fechando.

### Troca de página — `.lj-page-in`

Conteúdo que troca **no mesmo lugar**: o módulo aberto, o corpo da ribbon, o
painel de uma aba, a tela do menu do app, o painel do controle remoto.

```html
<div v-show="tab === 'bible'" class="rc-pane lj-page-in">…</div>
```

A classe é uma animação CSS que reinicia sozinha quando o elemento entra no DOM
ou sai de `display: none` — serve igual para `v-if`, `v-show` e KeepAlive, sem
`<Transition>` e sem JavaScript. São duas animações: o deslize com mola
(`--lj-motion-normal`) e a opacidade com curva (`--lj-transition-normal`).

- **Direção — sempre a do contexto.** Um deslize que é igual em todo lugar não
  diz nada; ele precisa mostrar para onde se foi. Quem navega publica o lado no
  container dos painéis, com `useNavDirection()`
  (`src/composables/useNavDirection.ts`): `--lj-nav-x` para abas lado a lado
  (`-1` esquerda, `1` direita), `--lj-nav-y` para itens empilhados (`-1` acima,
  `1` abaixo) — e zera o outro eixo, para não herdar o de um container de fora.
  Hoje: abas de módulos (`Modules.vue`), menu lateral do AppMenu (vertical),
  abas de Sincronizar, Acessibilidade, controle remoto e editor de sobreposição
  (horizontal). Sem ordem conhecida (as duas em 0) o painel só esmaece.
- **Entre dois módulos, opaca.** A página que entra por cima de outra não
  esmaece (`--lj-page-from-opacity: 1`, posto por `Modules.vue`): semitransparente,
  o texto de uma tela aparece atravessado no da outra por alguns quadros.
  Quem sai deixa de ser desenhado na hora (`[data-page="leaving"]`,
  `visibility: hidden`): a página nova entra deslocada 12px, e na faixa que ela
  ainda não cobriu aparecia a borda de uma barra da tela anterior. Escondida, o
  que aparece ali é o fundo da área, da mesma cor da superfície do módulo. A
  página **não** muda de tamanho ao entrar — já entrou 2% maior para cobrir
  essa faixa, e o texto inteiro pulsava.
- **Fechar não é trocar.** Quando a aba é fechada, é a página dela que some por
  cima (`data-page="closing"`: recua 1,5% e esmaece em `--lj-exit-panel`), e a
  vizinha — ou a tela inicial — já está no lugar, parada, atrás. Uma vizinha
  "entrando" não diria que algo foi fechado.
- **Rolagem.** Um painel deslocado para baixo ou para a direita aumenta a área
  de rolagem do container enquanto anima, e a barra de rolagem pisca (no Windows
  ela ocupa espaço e empurra o layout). O pai do painel animado precisa cortar:
  `.shell-content--has-module` e `.app-menu-screen-clip` (`overflow: clip`),
  `.rc-content` e `.overlay-slot-editor` (eixo horizontal). O corpo da ribbon
  rola na horizontal de propósito, então ali só a esmaecida (`.lj-fade-in`).
- **Não troque a lista de animações no meio.** Uma regra que acrescenta ou tira
  uma animação quando um atributo muda faz a animação "nova" começar do zero —
  a página piscava no fim da entrada, quando `data-page` saía. O que varia entre
  os casos vai numa variável lida pelo keyframe.
- **Sem `forwards`/`both`.** Uma animação de `transform` que continua em vigor
  depois de acabar mantém o elemento como bloco de referência dos filhos
  `position: fixed`: a tela cheia do sorteio passaria a se posicionar pelo
  módulo, e não pela janela.
- **O que fica atrás importa.** Um fade sobre o vazio mostra o fundo. Entre
  dois módulos, `Modules.vue` segura o que saiu desenhado por baixo durante a
  entrada (`data-page`, `PAGE_LEAVE_MS`); sem isso, sair do Relógio
  (preto) para o Cronômetro (escuro) dava um clarão branco, e antes de
  `.shell-content--has-module` existir o clarão era da cor do tema. Voltando à
  tela inicial o módulo esmaece sobre ela. Num painel de aba o fundo é o mesmo
  dos dois lados, e a classe sozinha basta.

### Onde cada animação fica

A regra por trás da tabela, na ordem em que decide:

1. **Quem está assistindo?** O telão é da congregação: ali a transição é a que
   o operador escolheu, e a janela só dissolve.
2. **Com que frequência, e sob que pressão?** O que o operador faz dezenas de
   vezes por música (trocar de slide, andar na lista com as setas) não anima o
   conteúdo: só a cor do realce, em 60ms.
3. **O que muda?** Lugar ou tamanho → mola em `transform`. Cor, opacidade,
   sombra → curva. Layout → curva curta.
4. **Está encostado numa borda?** Mola sem ultrapassagem. Peça pequena e solta
   pode quicar.
5. **Entrando ou saindo?** A saída é sempre curva seca e mais curta.

| Onde                                                                 | Animação                                                            | Tokens                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| Projeção, retorno, OBS, sorteio no telão                             | A escolhida pelo operador; fora do design system                    | `transitions.css`, `--lj-ease`               |
| Janela de projeção (Electron)                                        | Dissolve, sem mola nem deslize                                      | `windowAnimation.js`                         |
| Troca de slide, realce de linha, navegação por seta                  | Nada no conteúdo; realce em 60ms                                    | —                                            |
| Troca de módulo (abas abertas)                                       | Página nova desliza OPACA pelo lado da aba, por cima da anterior               | `.lj-page-in`, `--lj-nav-x`                   |
| Tela inicial ↔ módulo                                                | Módulo esmaece sobre ela; fechando a última aba, recua e some       | `.lj-page-in`, `lj-page-close`               |
| Fechar uma aba                                                       | A página fechada recua e esmaece por cima; a vizinha é revelada parada| `data-page="closing"`, `--lj-exit-panel`     |
| Faixa de abas abertas                                                | Aba nova cresce da base; a fechada some no lugar; vizinhas deslizam | `--lj-motion-fast`, `--lj-exit-fast`         |
| Corpo da ribbon                                                      | Grupos esmaecem, sem deslize (o corpo rola na horizontal)           | `.lj-fade-in`                                |
| Painel de aba (`LjTabs`), tela do AppMenu, painel do controle remoto | Desliza pelo lado da aba (horizontal) ou do item (vertical) e esmaece| `.lj-page-in`, `useNavDirection`             |
| Sublinhado da aba                                                    | Corre até a aba e pousa, sem ultrapassagem                          | `--lj-motion-normal`                         |
| Menu, select, combobox, popover                                      | Cresce a partir do gatilho + esmaece; sai seco                      | `--lj-ui-float-*`, `--lj-enter-layer-*`      |
| Seta do select/combobox, marca do item                               | Gira / surge                                                        | `--lj-motion-fast`                           |
| Tooltip                                                              | Esmaece + 2px; instantâneo ao trocar de alvo vizinho                | 100ms / 70ms                                 |
| Diálogo, janela de módulo, spotlight                                 | Cresce a partir do clique que abriu; pelo teclado, do centro; sai seco| `--lj-enter-dialog-scale`, `MotionOrigin`    |
| Alerta, paleta de comandos, loading                                  | Idem; a paleta sem clique nasce do topo; caixa em `--lj-motion-fast`| `--lj-motion-fast`, `MotionOrigin`           |
| Drawer temporário, chat, painel de formatação                        | Desliza da borda com mola sem ultrapassagem; sai seco               | `--lj-motion-normal`, `--lj-exit-panel`      |
| Chat pinado, rodapé do player, painel de liturgia                    | Anda junto com o layout: curva curta, mesmo token nos dois lados    | `--lj-reflow-*`                              |
| Acordeão                                                             | Altura com curva curta; seta gira                                   | `--lj-reflow-*`                              |
| Toast, barra de abertura                                             | Sobem da borda de baixo com um quique; saem secos                   | `--lj-enter-edge-shift`, `--lj-motion-bounce`|
| Checkbox                                                             | O tique é desenhado ao marcar e recolhido ao desmarcar; caixa afunda| `--lj-draw`; nativo: `.lj-native-check`      |
| Switch                                                               | Pino desliza com um quique                                          | `--lj-motion-bounce`                         |
| Slider                                                               | Pino cresce no hover; o arrasto não anima                           | `--lj-motion-bounce` (em `scale`)            |
| Botão                                                                | Cor em curva; afunda 1px (só-ícone encolhe); volta com quique       | `--lj-press-*`, `--lj-motion-bounce`         |
| Hover, foco, seleção                                                 | Cor e sombra                                                        | `--lj-transition-fast`                       |
| Reordenar por arrasto                                                | 150ms do vuedraggable                                               | `:animation="150"`                           |
| Progresso, spinner, pulso de alarme                                  | Contínuos, lineares; não são transição de estado                    | literais, de propósito                       |
| Lista ao filtrar, ordenar ou paginar                                 | Nada: cascata é bonita com dez linhas e pesada com o hinário        | —                                            |

### Movimento reduzido

`main.css` zera a duração de toda animação e transição sob
`prefers-reduced-motion: reduce`. Os tokens de mola passam por essa regra como
qualquer outro — não é preciso tratar caso a caso.

### Camadas flutuantes — entram e saem

Diálogo, menu, select, popover e tooltip têm um par próprio, e a assimetria é
deliberada: quem chega pousa com mola, quem sai acelera e some.

| Token                  | Valor                  | Uso                     |
| ---------------------- | ---------------------- | ----------------------- |
| `--lj-ui-float-enter` | `--lj-motion-normal`     | Abertura da camada      |
| `--lj-ui-float-exit`  | `--lj-exit-fast`         | Fechamento da camada    |
| `--lj-ui-float-shift` | `--lj-enter-layer-shift` | Deslocamento da entrada |

A Reka carimba `data-state` na camada, e é dele que a animação pende — **as duas
direções são obrigatórias**:

```css
.minha-camada[data-state="open"] {
  animation: lj-float-in var(--lj-ui-float-enter);
}
.minha-camada[data-state="closed"] {
  animation: lj-float-out var(--lj-ui-float-exit);
}
```

Esquecer o `closed` não dá erro: a camada só some seca, enquanto as vizinhas
saem animadas — o mesmo gesto de fechar com duas resoluções na tela. Foi o que
aconteceu com o `LjDialog`, que nasceu só com a entrada.

O `closed` também é o que segura a camada montada: a Reka espera a animação
terminar para desmontar. Uma animação que não termina deixa o overlay preso
bloqueando cliques — teste o desmonte, não só a aparência.

---

## Dimensões de Componentes Shell

Valores fixos que replicam as dimensões originais do app Delphi (`fmMenu.dfm`).
Não alterar sem validar o layout completo.

### Alturas

| Token                      | Valor  | Componente                    |
| -------------------------- | ------ | ----------------------------- |
| `--lj-systembar-height`    | `28px` | SystemBar superior            |
| `--lj-tab-height`          | `28px` | Tabs do Ribbon                |
| `--lj-ribbon-body-height`  | `80px` | Body do Ribbon                |
| `--lj-group-label-height`  | `18px` | Label de grupo no Ribbon      |
| `--lj-subtabs-height`      | `30px` | Sub-tabs internas dos módulos |
| `--lj-player-height`       | `88px` | Footer / Player               |
| `--lj-player-title-height` | `22px` | Título no player              |
| `--lj-player-row-height`   | `46px` | Linha de controles do player  |
| `--lj-player-gauge-height` | `20px` | Barra de progresso do player  |
| `--lj-statusbar-height`    | `24px` | Status bar inferior           |
| `--lj-small-btn-height`    | `22px` | Botão pequeno do Ribbon       |
| `--lj-large-btn-height`    | `70px` | Botão grande do Ribbon        |
| `--lj-player-btn-height`   | `38px` | Botão do player               |

### Larguras

| Token                           | Valor   | Componente                            |
| ------------------------------- | ------- | ------------------------------------- |
| `--lj-sidebar-width`            | `250px` | Sidebar expandida                     |
| `--lj-sidebar-collapsed`        | `28px`  | Sidebar colapsada                     |
| `--lj-appmenu-width`            | `44px`  | Botão do App Menu (hambúrguer)        |
| `--lj-fixed-btn-width`          | `30px`  | Botão fixo pequeno                    |
| `--lj-large-btn-width`          | `76px`  | Botão grande do Ribbon                |
| `--lj-player-btn-width`         | `36px`  | Botão padrão do player                |
| `--lj-player-btn-primary-width` | `55px`  | Botão primário do player (play/pause) |

---

## Tokens por Componente

### Ribbon — TitleBar e Body

```css
/* TitleBar (acima das tabs) */
background: var(--lj-titlebar-bg); /* navy */
color: var(--lj-titlebar-color); /* #ffffff */

/* Body (sempre claro, sem variação contextual de tab) */
background: var(--lj-body-bg);
background: var(--lj-body-bg-ctx); /* idem para tabs contextuais */
border: 1px solid var(--lj-body-border);
border-color: var(--lj-body-divider); /* divisor interno entre grupos */
```

### Ribbon — Group Label e Kbd

```css
/* Rótulo de grupo de botões */
color: var(--lj-group-label-color); /* text-subtle */

/* Badge de tecla de atalho (<kbd>) */
background: var(--lj-kbd-bg);
border: 1px solid var(--lj-kbd-border);
```

### Status Bar

```css
background: var(--lj-statusbar-bg);
border-top: 1px solid var(--lj-statusbar-border);
color: var(--lj-statusbar-color);
border-color: var(--lj-statusbar-divider); /* divisor entre seções */
```

### Player — Gauge

```css
/* Cores brutas para compor gradiente (use os compostos abaixo) */
/* --lj-player-gauge-light-start: #c4d8ef */
/* --lj-player-gauge-light-end:   #aabfd5 */
/* --lj-player-gauge-dark-end:    #0f172a  */

/* Token composto (já adaptado por tema): */
background: var(--lj-player-gauge-bg);

/* Faixa de buffer (carregado mas não reproduzido) */
background: var(--lj-player-gauge-buffer-bg); /* white 25% (light) / white 8% (dark) */
```

### Sub-tab — Botão Fechar

```css
.subtab-close {
  color: var(--lj-subtab-close-color);
}
.subtab-close:hover {
  background: var(--lj-subtab-close-hover-bg); /* círculo neutro, como no Chrome */
}
```

---

### Ribbon — Tabs

```css
/* fundo navy com item ativo branco */
background: var(--lj-tabs-bg); /* navy */
color: var(--lj-tabs-color); /* white 92% */

/* hover */
background: var(--lj-tabs-hover-bg); /* white 8% */
color: var(--lj-tabs-color-hover); /* white 100% */

/* ativo */
background: var(--lj-tabs-active-bg); /* #fff (light) / #243248 (dark) */
color: var(--lj-tabs-active-color); /* gray-800 (light) / #fff (dark) */
```

### Ribbon — Tabs Contextuais (laranja)

```css
background: var(--lj-tabs-ctx-bg); /* orange */
color: var(--lj-tabs-ctx-color); /* #fff */

/* hover */
background: var(--lj-tabs-ctx-hover-bg); /* orange clareado */

/* ativo */
background: var(--lj-tabs-ctx-active-bg); /* gradiente orange → orange-dark */
```

### Ribbon — Botões

```css
color: var(--lj-rbtn-color);

/* hover */
background: var(--lj-rbtn-hover-bg);
border-color: var(--lj-rbtn-hover-border);

/* pressed */
background: var(--lj-rbtn-active-bg);
border-color: var(--lj-rbtn-active-border);
```

### Sub-tabs (módulos)

```css
/* faixa — mais escura que a aba ativa, como a moldura do Chrome. A linha da base
   é fundo (gradiente), não borda: a aba ativa desce sobre ela */
background: var(--lj-subtabs-bg);

/* tab inativa — sem fundo nem moldura; filete de 1px entre inativas vizinhas,
   escondido junto da ativa, do hover e depois da última */
background: var(--lj-subtab-bg);
color: var(--lj-subtab-color);

/* tab hover — pílula translúcida */
background: var(--lj-subtab-hover-bg);

/* tab ativa — fundo igual ao do cabeçalho do módulo logo abaixo (surface-bg-soft),
   para se fundir ao painel; pontas côncavas (::before/::after com radial-gradient)
   ligam a aba à linha da base. Sem barra nem borda de cor: quem a destaca é o
   contraste com a faixa */
background: var(--lj-subtab-active-bg);
color: var(--lj-subtab-active-color);

/* botão fechar */
color: var(--lj-subtab-close-color);
```

### Player / Footer

```css
background: var(--lj-footer-bg);
border-top: 1px solid var(--lj-footer-border);

/* gauge */
background: var(--lj-player-gauge-bg); /* gradiente (muda por tema) */

/* texto de slide */
color: var(--lj-player-slide-text-color); /* text (light) / gold (dark) */
```

**O que nasce na base da janela se apoia no rodapé por token, não por altura fixa.** O
`Footer` publica em `:root` a altura real do que está ancorado — `--lj-dock-offset` — e o
valor volta a `0px` com o rodapé recolhido. O `LjToast` usa
`bottom: calc(var(--lj-dock-offset) + var(--lj-space-7))`. Sem isso o aviso cobre a barra
de progresso e os controles do player justamente quando ele aparece, com um hino tocando;
nada dá erro, o toast só fica em cima do que o operador precisa clicar.

### Popups e Dialogs

```css
background: var(--lj-popup-bg);
border: 1px solid var(--lj-popup-border);
box-shadow: var(--lj-popup-shadow);
border-radius: var(--lj-radius-md); /* cards */
/* ou */
border-radius: var(--lj-radius-lg); /* dialogs */
```

### AppMenu Sidebar

```css
background: var(--lj-appmenu-sidebar-bg); /* acompanha --lj-shell-chrome-bg */
color: var(--lj-appmenu-sidebar-color); /* branco */

/* item hover */
background: var(--lj-appmenu-sidebar-hover-bg); /* white 8% */

/* item ativo */
background: var(--lj-appmenu-sidebar-active-bg); /* orange */
color: var(--lj-appmenu-sidebar-active-color); /* texto escuro sobre laranja */
```

---

## Classes Utilitárias (`.lj-u-*`)

Definidas em `src/assets/styles/utilities.css`. Aplicar apenas em componentes do
shell (`src/components/`, `src/layout/`). Módulos em `src/modules/` mantêm CSS
`<style scoped>` próprio.

### Flexbox

```html
<!-- linha alinhada ao centro -->
<div class="lj-u-row">...</div>

<!-- linha com space-between -->
<div class="lj-u-row-between">...</div>

<!-- preenche espaço disponível sem overflow (flex: 1 + min-width: 0) -->
<span class="lj-u-fill">texto longo truncado</span>
```

### Texto

```html
<!-- truncar com reticências (precisa de largura definida no pai) -->
<span class="lj-u-truncate">Título muito longo que será truncado...</span>
```

### Interação

```html
<!-- desabilitar seleção de texto (ex: labels, botões do ribbon) -->
<div class="lj-u-no-select">Rótulo</div>
```

### Gap

Use em containers flex/grid combinado com `.lj-u-row`:

```html
<div class="lj-u-row lj-u-gap-3">
  <span>Item 1</span>
  <span>Item 2</span>
</div>
```

| Classe        | Gap    |
| ------------- | ------ |
| `.lj-u-gap-1` | `2px`  |
| `.lj-u-gap-2` | `4px`  |
| `.lj-u-gap-3` | `6px`  |
| `.lj-u-gap-4` | `8px`  |
| `.lj-u-gap-5` | `12px` |
| `.lj-u-gap-6` | `16px` |

### Larguras Percentuais (legacy)

Classes `.w-10` a `.w-100` (step 10%) com `!important`. Usar apenas quando
necessário — prefira flexbox com `lj-u-fill` para layouts responsivos.

---

## Convenções de Uso

### Nunca usar cores hex diretamente em componentes

```css
/* ERRADO */
.meu-componente {
  background: #1b4f8a;
}

/* CORRETO */
.meu-componente {
  background: var(--lj-navy);
}
```

### Usar tokens semânticos de superfície em vez de cinzas diretos

```css
/* ERRADO */
.painel {
  background: var(--lj-gray-50);
  border: 1px solid var(--lj-gray-200);
}

/* CORRETO — muda automaticamente no dark theme */
.painel {
  background: var(--lj-surface-bg-soft);
  border: 1px solid var(--lj-surface-border);
}
```

### Usar `!important` somente nas classes `.w-*` (legacy)

Outros estilos não devem precisar de `!important`. Se precisar, revisar especificidade.

### Escopo de utilitárias

```
src/components/  ✅ usar .lj-u-*
src/layout/      ✅ usar .lj-u-*
src/modules/     ❌ não usar (CSS scoped próprio de cada módulo)
```

---

## A base do documento

`src/assets/styles/main.css` abre declarando `box-sizing: border-box`,
`line-height: 1.5` e `font: inherit` nos controles nativos. Não são preferências
de estilo: são o piso que o app assumia sem declarar, porque vinha do reset
dentro de `vuetify/styles`. Cada medida deste sistema foi calibrada com eles em
vigor.

Sem `box-sizing`, `width: 100%` mais padding estoura o container. Sem
`line-height`, toda caixa de linha encolhe de 1,5 para o `normal` do navegador.
Sem `font: inherit`, os `<button>` nativos caem na fonte de sistema do Chrome a
13,33px. Nenhum dos três dá erro no console.

Mexer nesse bloco muda a geometria do app inteiro de uma vez. Trate-o como
contrato.

---

## Primitivos (`src/components/ui/`)

Inventário **fechado** de componentes de interface. A UI do app usa exclusivamente
estes. Precisou de um controle que não existe aqui? Ele entra no catálogo
primeiro — não como variação local dentro de uma tela.

Veja todos lado a lado, nos 10 temas, na rota **`/ui`**.

### Sem biblioteca — markup + CSS sobre os tokens

`LjButton` · `LjInput` · `LjTextarea` · `LjCheckbox` · `LjSwitch` · `LjField` ·
`LjCard` · `LjChip` · `LjSpinner` · `LjProgress` · `LjSkeleton` · `LjEmpty` ·
`LjAlert` · `LjDivider` · `LjToast` · `LjTable` · `LjCalendar`

### Sobre Reka UI — onde há comportamento acessível

Foco preso, navegação por teclado, ARIA e portal:

`LjSelect` · `LjCombobox` · `LjDialog` · `LjMenu` · `LjContextMenu` · `LjTooltip` ·
`LjTabs` · `LjSlider` · `LjPopover` · `LjAccordion` · `LjDrawer` · `LjColorPicker`

`LjContextMenu` é o `LjMenu` aberto pelo clique direito (ou pela tecla de menu)
sobre o elemento do slot: mesma lista de itens, mesmo desenho.

```ts
import { LjButton, LjSelect, LjDialog } from "@/components/ui";
```

### Contratos compartilhados (`src/assets/styles/ui.css`)

A coerência não vem de cada componente ser bonito isoladamente — vem de todos
obedecerem aos mesmos contratos. Um controle `size="md"` alinha na horizontal
com qualquer outro `size="md"`.

| Token                            | `sm` | `md` | `lg`   |
| -------------------------------- | ---- | ---- | ------ |
| `--lj-ui-h-*` (altura)           | 22px | 26px | 32px   |
| `--lj-ui-px-*` (padding lateral) | 8px  | 10px | 16px   |
| `--lj-ui-icon-*`                 | 13px | 15px | 17px   |
| `--lj-ui-font-*`                 | 11px | 12px | 12.5px |

Há um quarto tamanho, `touch` (44px), fora dessa escala de propósito: vale só
para superfícies operadas com o dedo — hoje, o controle remoto que o operador
abre no celular. Na shell, use `sm`/`md`/`lg`; 32px é alvo curto demais para
toque, e num culto o toque errado custa caro.

Invariantes:

- **um traço**: `--lj-ui-border` (1px sólido) em todo controle;
- **um raio**: `--lj-ui-radius`;
- **um anel de foco**: `--lj-ui-focus`;
- **superfície flutuante = borda + sombra** (`.lj-ui-float`), nunca sombra
  difusa sozinha — é isso que dá aparência Material a menus e dropdowns.

### Linhas de seleção de músicas

Use `.lj-music-row` em cada linha de música, tanto em tabelas quanto em listas.
O estado compartilhado em `ui.css` usa um fundo com 10% de `--lj-ui-accent` sobre
`--lj-surface-bg` e uma faixa interna de 3px na mesma cor de acento, sem deslocar
o conteúdo. Ele aparece ao passar o mouse, ao focar uma ação pelo teclado e
enquanto o menu da linha estiver aberto, inclusive quando renderizado em portal.
No toque, exibir os atalhos de todas as músicas não destaca todas as linhas.
Seleção persistente no hinário e indicação de reprodução na playlist continuam
com seus próprios marcadores. A transição respeita a preferência de movimento
reduzido do sistema.

### Acento: por que não usar `--lj-navy` direto

`--lj-navy` é a cor de **marca** do tema; `--lj-ui-accent` é a cor de **estado**
de um controle. Nos temas `dark` e `black` a marca é acromática (`#2e2e2e`) e
some contra a superfície escura, então o acento passa a ser o laranja — que já é
o acento do app nesses temas (sidebar ativa, tabs contextuais).

Em componente de UI use sempre `--lj-ui-accent`, `--lj-ui-accent-hover`,
`--lj-ui-accent-fg`, `--lj-ui-accent-text` e `--lj-ui-accent-soft`.

### Duas armadilhas já resolvidas

**Portal e `<style scoped>`.** O CSS com escopo mira `.classe[data-v-…]`, e o
Vue só carimba esse atributo nos elementos do próprio template — incluindo a
raiz de um componente filho, mas não os elementos que esse filho renderiza
internamente. O conteúdo flutuante é emitido lá dentro, pela Reka, várias
camadas abaixo, então nenhuma regra `scoped` casa com ele. Os primitivos com
painel flutuante usam `<style>` sem `scoped`; o isolamento vem do prefixo
`lj-`. Pelo mesmo motivo, um consumidor não consegue estilizar o gatilho de
`LjSelect` a partir do seu próprio `scoped`: envolva o primitivo num elemento
do consumidor e use `:deep()` a partir dele — é o que `MonitorSelect` e
`SelectFont` fazem.

**Atalhos globais.** `Hotkeys.js` escuta `keydown` na window em `capture` e
chama `preventDefault()`. Sem guarda, ele neutralizava o Escape das camadas
flutuantes e disparava o atalho por baixo do diálogo aberto. O handler retorna
cedo quando o **foco** está dentro de `[data-dismissable-layer]`. O critério é
o foco, e não a presença da camada: tooltip também é camada, mas nunca recebe
foco — testar só a presença desligava todos os atalhos enquanto o operador
passasse o mouse por um botão da barra.

### Estado da migração

`.opt-*` em `appmenu-options.css` são controles legados **já alinhados ao
contrato** — visualmente indistinguíveis dos primitivos enquanto a migração
avança. Ao migrar o último deles, o arquivo sai junto.

Não existe `LjSpacer`: o equivalente do `v-spacer` é a classe utilitária
`.lj-u-spacer`, e um componente para `flex: 1` seria cerimônia sem ganho.

Componentes já migrados: `SelectFont`, `MonitorSelect`, `FieldSelect`,
`ProgressBar`, `ShellTools`, `ClassicVersionDialog`, `PlayerActions`,
`ReleaseNotesDialog`, `UpdateAvailableDialog`, `CategoryManagerDialog`,
`LiturgyManageDialog`, `Screen`, `RibbonScreenButton`, `AppMenuSobre`,
`collections/Index`, `OverlaySlotEditor`.

### Autofoco dentro de diálogo

O atributo `autofocus` do HTML é ignorado pelo navegador em elementos inseridos
depois do carregamento — sempre o caso dentro de um `LjDialog`. Use a prop
`autofocus` do `LjInput`, que foca de fato no próximo tick, ou o método
`focus()` que ele expõe.

### Uma armadilha de prop que já custou caro

Nunca use `false` como sentinela numa prop que também aceita string
(`icon?: string | false`). O Vue faz _casting_ de Boolean: uma prop cujo tipo
inclui `Boolean` nasce `false` quando não é passada, e o ramo "desligado" vale
sempre. Use `null` (`icon?: string | null`).

---

## Logo e ícones do app

`src/assets/img/logo.svg` é a fonte de todos os ícones. Ele é desenhado em cinco
grupos `<g id="camada-*">`, de trás para a frente: fundo, violino, cordas,
clave e arco. Cada forma é inteira, inclusive onde outra camada a cobre: o
ícone do macOS mostra as camadas separadas, e o vidro deixa ver o que fica
embaixo. Ao editar o logo, mantenha os grupos e rode `npm run assets:brand`; o
`validate:brand-assets` (no `prebuild`) falha se algo ficar para trás.

O gerador produz, a partir do logo:

| Saída                                                      | Como                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `build/icon-mac.icon/Assets/*.svg`                         | Um arquivo por grupo `camada-*`                                       |
| `src/assets/img/logo-profundidade.svg`                     | Cada camada projeta sombra, na cor dela, só sobre o disco             |
| PNGs de 144 px para cima, `icon-512.png`, 256 px do `.ico` | Renderizados do logo com profundidade                                 |
| PNGs de 16, 32 e 48 px                                     | Logo plano: nesse tamanho a sombra só borra o desenho                 |
| `icon-mac.png` e `icon-mac.icns`                           | Render do `.icon` pelo `ictool` quando o Icon Composer está instalado |

O `icon.json` do `.icon` (vidro, sombras, translucidez, placa branca no claro e
preta no escuro) é editado à mão ou no Icon Composer, e o gerador não o toca. O
`LjLogo` usa a versão com profundidade a partir de 32 px.

O `.icon` só vale no app empacotado, que o compila em `Assets.car`; isso exige
Xcode 26, e por isso o job macOS do release roda em `macos-26`. No
`electron:dev` o Dock mostra o `icon-mac.png`, que é estático: só a aparência
clara.
Em um Mac sem Xcode 26, `electron:build:mac` usa automaticamente o
`icon-mac.icns` gerado, com aparência estática. O release continua exigindo
Xcode 26 e usa o `.icon` em camadas.

---

## Arquivos de Referência

| Arquivo                                   | Conteúdo                                                             |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `src/assets/styles/tokens.css`            | Tokens de identidade (cores, tipografia, dimensões) — fonte canônica |
| `src/assets/styles/ui.css`                | Contratos dos primitivos: altura, traço, raio, foco, acento          |
| `src/components/ui/`                      | Catálogo de primitivos (`index.ts` exporta todos)                    |
| `src/views/UiCatalog.vue`                 | Página `/ui` — todos os primitivos nos 10 temas                      |
| `src/assets/styles/utilities.css`         | Classes `.lj-u-*` (61 linhas)                                        |
| `src/assets/styles/main.css`              | Base do documento (box-sizing, line-height, controles) e scrollbar   |
| `src/assets/styles/fonts.css`             | Declarações `@font-face` do acervo de fontes                         |
| `src/__tests__/SemVuetify.spec.ts`        | Trava a volta do Vuetify: tag, classe, variável, import, dependência  |
