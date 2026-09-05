<template>
  <div class="cat">
    <header class="cat__bar">
      <div class="cat__brand">
        <strong>Catálogo de primitivos</strong>
        <span class="cat__sub">LouvorJA — design system</span>
      </div>
      <div class="cat__themes">
        <button
          v-for="t in THEME_IDS"
          :key="t"
          class="cat__theme"
          :class="{ 'is-active': theme === t }"
          @click="applyTheme(t)"
        >
          {{ t }}
        </button>
      </div>
    </header>

    <main class="cat__main">
      <!-- ══════════ A prova: tudo alinha ══════════ -->
      <section class="cat__section">
        <h2 class="cat__h2">Alinhamento</h2>
        <p class="cat__lead">
          Controles de mesmo
          <code>size</code>
          compartilham altura, traço, raio e anel de foco. É isso que faz a linguagem "conversar" —
          não o estilo individual de cada um.
        </p>
        <div class="cat__align cat__align--touch">
          <span class="cat__sizetag">touch · 44px</span>
          <LjButton size="touch">Botão</LjButton>
          <LjButton size="touch" variant="primary" :icon="ICONS.ACTIONS.SAVE">Salvar</LjButton>
          <LjButton size="touch" variant="ghost" :icon="ICONS.ACTIONS.SEARCH" icon-only />
          <LjInput size="touch" model-value="Campo de texto" style="width: 200px" />
          <p class="cat__note">
            Exceção deliberada, fora da escala da shell: vale só onde o dedo opera, como o controle
            remoto aberto no celular. Aqui o alvo curto custa toque errado no meio do culto.
          </p>
        </div>

        <div v-for="s in SIZES" :key="s" class="cat__align">
          <span class="cat__sizetag">{{ s }} · {{ HEIGHTS[s] }}</span>
          <LjButton :size="s">Botão</LjButton>
          <LjButton :size="s" variant="primary" :icon="ICONS.ACTIONS.SAVE">Salvar</LjButton>
          <LjButton :size="s" variant="ghost" :icon="ICONS.ACTIONS.SEARCH" icon-only />
          <LjInput :size="s" model-value="Campo de texto" style="width: 160px" />
          <LjInput
            :size="s"
            :icon="ICONS.ACTIONS.SEARCH"
            placeholder="Buscar…"
            style="width: 150px"
          />
          <LjChip variant="primary" :size="s === 'lg' ? 'md' : 'sm'">etiqueta</LjChip>
        </div>
      </section>

      <!-- ══════════ Botão ══════════ -->
      <section class="cat__section">
        <h2 class="cat__h2">LjButton</h2>
        <div class="cat__row">
          <LjButton v-for="v in BUTTON_VARIANTS" :key="v" :variant="v">{{ v }}</LjButton>
        </div>
        <div class="cat__row">
          <LjButton :icon="ICONS.ACTIONS.ADD" variant="primary">Com ícone</LjButton>
          <LjButton :icon-end="ICONS.ACTIONS.NEXT">Ícone ao fim</LjButton>
          <LjButton :icon="ICONS.ACTIONS.EDIT" icon-only />
          <LjButton :icon="ICONS.ACTIONS.DELETE" icon-only variant="danger" />
          <LjButton loading>Carregando</LjButton>
          <LjButton disabled>Desabilitado</LjButton>
        </div>
      </section>

      <!-- ══════════ Entrada ══════════ -->
      <section class="cat__section">
        <h2 class="cat__h2">Entrada</h2>
        <div class="cat__form">
          <LjField label="Nome do culto" hint="Aparece no cabeçalho da projeção.">
            <LjInput v-model="demoText" placeholder="Culto de sábado" style="width: 240px" />
          </LjField>
          <LjField label="Busca">
            <LjInput
              v-model="demoSearch"
              :icon="ICONS.ACTIONS.SEARCH"
              clearable
              placeholder="Buscar música…"
              style="width: 240px"
            />
          </LjField>
          <LjField label="Versículo" error="Informe um capítulo válido.">
            <LjInput model-value="Salmos 0" invalid style="width: 240px" />
          </LjField>
          <LjField label="Observações" layout="column">
            <LjTextarea v-model="demoArea" placeholder="Anotações da liturgia…" />
          </LjField>
          <LjField label="Opções" layout="column" group>
            <LjCheckbox v-model="demoCheck" label="Repetir refrão" />
            <LjCheckbox :model-value="false" indeterminate label="Selecionar todas" />
            <LjCheckbox :model-value="true" disabled label="Bloqueado" />
            <LjSwitch v-model="demoSwitch" label="Projetar automaticamente" />
          </LjField>
        </div>
      </section>

      <!-- ══════════ Feedback ══════════ -->
      <section class="cat__section">
        <h2 class="cat__h2">Feedback</h2>
        <div class="cat__grid">
          <LjCard title="Progresso" :icon="ICONS.ACTIONS.DOWNLOAD">
            <LjProgress :value="progress" label="Baixando coletânea" show-value />
            <div style="height: 12px" />
            <LjProgress indeterminate label="Verificando integridade" />
          </LjCard>

          <LjCard title="Carregando">
            <div class="cat__row">
              <LjSpinner :size="13" />
              <LjSpinner :size="15" />
              <LjSpinner :size="17" />
              <LjSpinner :size="24" />
            </div>
            <div style="height: 12px" />
            <LjSkeleton width="70%" />
            <div style="height: 6px" />
            <LjSkeleton width="45%" />
          </LjCard>

          <LjCard title="Etiquetas">
            <div class="cat__row">
              <LjChip v-for="v in CHIP_VARIANTS" :key="v" :variant="v">{{ v }}</LjChip>
            </div>
            <div style="height: 8px" />
            <div class="cat__row">
              <LjChip variant="primary" :icon="ICONS.MEDIA.AUDIO" removable>com áudio</LjChip>
              <LjChip size="sm">pequeno</LjChip>
            </div>
          </LjCard>

          <LjCard title="Avisos">
            <div class="cat-stack">
              <LjAlert variant="info" text="A verificação de integridade roda ao iniciar." />
              <LjAlert variant="success" title="Tudo certo" text="148 músicas conferidas." />
              <LjAlert variant="warning" text="Nenhum monitor secundário detectado." />
              <LjAlert
                variant="danger"
                title="Falha ao baixar"
                text="Não foi possível alcançar o servidor de coletâneas."
                dismissible
              />
            </div>
          </LjCard>

          <LjEmpty
            :icon="ICONS.MODULES.FAVORITES"
            title="Nenhum favorito ainda"
            description="Marque músicas com a estrela para encontrá-las rapidamente durante o culto."
          >
            <LjButton variant="primary" size="sm" :icon="ICONS.ACTIONS.ADD">
              Adicionar música
            </LjButton>
          </LjEmpty>
        </div>
      </section>

      <!-- ══════════ Divisórias ══════════ -->
      <section class="cat__section">
        <h2 class="cat__h2">Divisórias</h2>
        <p class="cat__lead">
          Decorativa por padrão — sai da árvore de acessibilidade, porque anunciar "separador" entre
          cada par de itens só atrapalha quem usa leitor de tela. Marque
          <code>semantic</code>
          quando ela de fato separa grupos.
        </p>
        <div class="cat__divider-demo">
          <span>Antes</span>
          <LjDivider />
          <span>Depois</span>
        </div>
        <div class="cat__row" style="margin-top: 16px">
          <span>Esquerda</span>
          <LjDivider vertical />
          <span>Meio</span>
          <LjDivider vertical />
          <span>Direita</span>
        </div>
      </section>

      <!-- ══════════ Superfícies ══════════ -->
      <section class="cat__section">
        <h2 class="cat__h2">Superfícies</h2>
        <div class="cat__grid">
          <LjCard title="Card padrão" :icon="ICONS.ACTIONS.FORMAT">
            <template #actions>
              <LjButton size="sm" variant="ghost" :icon="ICONS.ACTIONS.EDIT" icon-only />
            </template>
            Conteúdo do card. A moldura é sempre borda de 1px mais sombra — nunca sombra difusa
            sozinha, que é o que dá aparência Material.
            <template #footer>
              <LjButton size="sm">Cancelar</LjButton>
              <LjButton size="sm" variant="primary">Confirmar</LjButton>
            </template>
          </LjCard>
          <LjCard title="Card suave" soft>
            Variante
            <code>soft</code>
            para blocos aninhados dentro de outra superfície.
          </LjCard>
        </div>
      </section>

      <!-- ══════════ Seleção ══════════ -->
      <section class="cat__section">
        <h2 class="cat__h2">Seleção</h2>
        <p class="cat__lead">
          Sobre Reka UI: foco preso, navegação por teclado, ARIA e portal. O painel acompanha a
          largura do campo e tem borda de 1px — dropdown mais largo que o gatilho, com sombra difusa
          e sem traço, é a assinatura do menu Material.
        </p>
        <div class="cat__form">
          <LjField label="Aparência do programa">
            <LjSelect v-model="demoTheme" :items="themeItems" style="width: 240px" />
          </LjField>
          <LjField label="Fonte de projeção" hint="Aplica-se a todas as telas de projeção.">
            <LjSelect v-model="demoFont" :items="fontItems" style="width: 240px" />
          </LjField>
          <LjField label="Música" hint="Combobox filtra a lista conforme você digita.">
            <LjCombobox v-model="demoSong" :items="songItems" style="width: 240px" />
          </LjField>
          <LjField label="Volume">
            <LjSlider v-model="volume" show-value unit="%" style="width: 240px" />
          </LjField>
        </div>
      </section>

      <!-- ══════════ Camadas flutuantes ══════════ -->
      <section class="cat__section">
        <h2 class="cat__h2">Camadas flutuantes</h2>
        <div class="cat__row">
          <LjButton variant="primary" @click="dialogOpen = true">Abrir diálogo</LjButton>

          <LjMenu :items="menuItems">
            <template #trigger>
              <LjButton :icon-end="ICONS.UI.CHEVRON_DOWN">Abrir no monitor</LjButton>
            </template>
          </LjMenu>

          <LjPopover title="Formatação">
            <template #trigger>
              <LjButton :icon="ICONS.ACTIONS.FORMAT">Popover</LjButton>
            </template>
            <LjField label="Tamanho" layout="column">
              <LjSlider v-model="fontSize" :min="10" :max="80" show-value unit="px" />
            </LjField>
            <LjCheckbox v-model="demoCheck" label="Aplicar a todos os slides" />
          </LjPopover>

          <LjTooltip text="Projetar na tela principal" shortcut="F5">
            <LjButton :icon="ICONS.UI.MONITORS" icon-only />
          </LjTooltip>

          <LjTooltip text="Passe o mouse aqui">
            <LjButton variant="ghost">Com dica</LjButton>
          </LjTooltip>

          <LjButton :icon="ICONS.UI.ALERT" @click="toastOpen = true">Aviso</LjButton>
        </div>
      </section>

      <!-- ══════════ Abas ══════════ -->
      <section class="cat__section">
        <h2 class="cat__h2">Abas</h2>
        <LjTabs v-model="tab" :tabs="tabItems" aria-label="Exemplo de abas" />
        <p class="cat__tabbody">
          Conteúdo da aba
          <strong>{{ tab }}</strong>
          .
        </p>
      </section>

      <section class="cat__section">
        <h2 class="cat__h2">Tabela</h2>
        <p class="cat__lead">
          Só a moldura: cabeçalho, listras, realce e rolagem contida. O conteúdo vem por slot, e
          busca, ordenação e paginação continuam com quem usa. A altura de linha é de 36px porque é
          a que as listas do app sempre tiveram — só padding as encolheria um quarto.
        </p>
        <LjTable striped hover sticky max-height="180px">
          <thead>
            <tr>
              <th>Música</th>
              <th>Álbum</th>
              <th class="lj-u-text-end">Duração</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in musicasDemo" :key="m.nome">
              <td>{{ m.nome }}</td>
              <td>{{ m.album }}</td>
              <td class="lj-u-text-end">{{ m.duracao }}</td>
            </tr>
          </tbody>
        </LjTable>
      </section>

      <section class="cat__section">
        <h2 class="cat__h2">Sanfona</h2>
        <p class="cat__lead">
          Um painel aberto por vez, ou vários com
          <code>multiple</code>
          . Teclado e ARIA vêm da Reka.
        </p>
        <LjAccordion v-model="sanfona" :items="sanfonaItens">
          <template #hinario>Hinário Adventista — 613 hinos.</template>
          <template #album>Álbuns por intérprete e coletânea.</template>
          <template #usuario>Coletâneas montadas pelo próprio usuário.</template>
        </LjAccordion>
      </section>

      <section class="cat__section">
        <h2 class="cat__h2">Calendário</h2>
        <p class="cat__lead">
          Grade do mês ou da semana, com eventos posicionados por dia civil e corte com indicador.
          Cada célula carrega a própria data em
          <code>data-date</code>
          , e as setas andam pela grade.
        </p>
        <LjCalendar
          model-value="2026-09-15"
          :events="agendaDemo"
          :max-events="3"
          locale="pt-BR"
          aria-label="Exemplo de agenda"
        />
      </section>

      <section class="cat__section">
        <h2 class="cat__h2">Painel lateral</h2>
        <p class="cat__lead">
          Permanente empurra o conteúdo ao lado; temporário sobrepõe com trava de foco e fecha no
          Esc.
        </p>
        <div class="cat-stack">
          <LjButton size="sm" @click="drawerOpen = true">Abrir painel temporário</LjButton>
        </div>
      </section>

      <LjDrawer v-model="drawerOpen" temporary side="right" :width="280" title="Formatação">
        <template #actions>
          <LjButton size="sm" variant="ghost">Restaurar</LjButton>
        </template>
        <LjField label="Tamanho da letra" layout="column">
          <LjSlider v-model="demoSlider" :min="10" :max="60" />
        </LjField>
      </LjDrawer>

      <LjToast
        v-model="toastOpen"
        variant="success"
        :icon="ICONS.UI.CHECK"
        text="Coletânea baixada — 148 músicas prontas para projetar."
      />

      <LjDialog
        v-model="dialogOpen"
        title="Excluir playlist"
        :icon="ICONS.ACTIONS.DELETE"
        size="sm"
        description="Esta ação não pode ser desfeita."
      >
        <LjField label="Confirme o nome" layout="column">
          <LjInput v-model="demoText" placeholder="Culto de sábado" />
        </LjField>
        <!-- Select dentro de diálogo: o caso que a escala de camadas conserta.
             Com o diálogo numerado acima dos painéis, este menu abria ATRÁS
             dele — invisível e inclicável. -->
        <LjField label="Mover itens para" layout="column">
          <LjSelect v-model="demoFont" :items="fontItems" />
        </LjField>
        <template #footer>
          <LjButton size="sm" @click="dialogOpen = false">Cancelar</LjButton>
          <LjButton size="sm" variant="danger" @click="dialogOpen = false">Excluir</LjButton>
        </template>
      </LjDialog>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useAppTheme } from "@/composables/useAppTheme";
import { ICONS } from "@/config/Icons";
import { COLOR_THEMES } from "@/config/Theme";
import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "@/config/Themes";
import {
  LjButton,
  LjCard,
  LjCheckbox,
  LjAlert,
  LjChip,
  LjDivider,
  LjEmpty,
  LjField,
  LjInput,
  LjProgress,
  LjSkeleton,
  LjSpinner,
  LjSwitch,
  LjTextarea,
  LjSelect,
  LjCombobox,
  LjDialog,
  LjMenu,
  LjPopover,
  LjSlider,
  LjTabs,
  LjToast,
  LjTooltip,
  LjAccordion,
  LjCalendar,
  LjDrawer,
  LjTable,
  type LjAccordionItem,
  type LjMenuItem,
  type LjTab,
  type UiSize,
} from "@/components/ui";

const SIZES: UiSize[] = ["sm", "md", "lg"];
const HEIGHTS: Record<UiSize, string> = {
  sm: "22px",
  md: "26px",
  lg: "32px",
  touch: "44px",
};
const BUTTON_VARIANTS = ["default", "primary", "ghost", "danger", "subtle"] as const;
const CHIP_VARIANTS = ["neutral", "primary", "success", "warning", "danger"] as const;
const THEME_IDS = [...new Set(Object.values(COLOR_THEMES))].filter(isThemeId);
const themeItems = THEME_IDS.map((id) => ({ value: id, label: id }));
const fontItems = ["Padrão", "Advent Sans", "Arial", "Calibri Bold", "DIN Condensed Bold"];
const songItems = [
  "Ó Deus de Amor",
  "Vós, ó nações rendei louvor",
  "És Tu, Senhor o poderoso Vencedor",
  "És Criador e Rei",
  "Castelo Forte",
];
const tabItems: LjTab[] = [
  { value: "geral", label: "Geral" },
  { value: "biblia", label: "Bíblia" },
  { value: "slides", label: "Slides", badge: 3 },
];
const menuItems: LjMenuItem[] = [
  { label: "Abrir no monitor" },
  { label: "Mesma janela", checked: true, action: () => {} },
  { label: "Tela principal", icon: ICONS.UI.MONITORS, hint: "1470×918", action: () => {} },
  { label: "Tela de retorno", icon: ICONS.UI.MONITORS, hint: "1470×918", action: () => {} },
  { separator: true },
  { label: "Identificar monitores", icon: ICONS.ACTIONS.SEARCH, shortcut: "F9", action: () => {} },
];

const { previewTheme } = useAppTheme();
const theme = ref<ThemeId>(DEFAULT_THEME_ID);

const demoText = ref("");
const demoSearch = ref("Ó Deus de Amor");
const demoArea = ref("");
const demoCheck = ref(true);
const demoSwitch = ref(false);
const progress = ref(38);
const demoTheme = ref<string>(COLOR_THEMES.DEFAULT);
const demoFont = ref("DIN Condensed Bold");
const demoSong = ref<string>("Ó Deus de Amor");
const volume = ref(70);
const fontSize = ref(42);
const tab = ref("geral");
const dialogOpen = ref(false);
const toastOpen = ref(false);
const drawerOpen = ref(false);
const demoSlider = ref(32);
const sanfona = ref<string | string[] | undefined>("hinario");

const sanfonaItens: LjAccordionItem[] = [
  { value: "hinario", label: "Hinário", icon: ICONS.MODULES.HYMNAL },
  { value: "album", label: "Álbuns", icon: ICONS.MODULES.ALBUM },
  { value: "usuario", label: "Coletâneas do usuário", icon: ICONS.MODULES.COLLECTIONS },
];

const musicasDemo = [
  { nome: "Ó Deus de Amor", album: "Hinário Adventista", duracao: "3:12" },
  { nome: "Castelo Forte", album: "Hinário Adventista", duracao: "2:48" },
  { nome: "Vem, ó Cristo", album: "Arautos do Rei", duracao: "4:05" },
  { nome: "Grandioso És Tu", album: "Hinário Adventista", duracao: "3:57" },
  { nome: "Firme nas Promessas", album: "Novo Tempo", duracao: "3:20" },
];

const agendaDemo = [
  { id: "1", name: "Ensaio do coral", start: "2026-09-09", color: "#0ea5e9" },
  { id: "2", name: "Culto Jovem", start: "2026-09-12", color: "#f59e0b" },
  { id: "3", name: "Escola Sabatina", start: "2026-09-12", color: "#22c55e" },
  { id: "4", name: "Reunião de anciãos", start: "2026-09-12", color: "#a855f7" },
  { id: "5", name: "Batismo", start: "2026-09-12", color: "#ef4444" },
  { id: "6", name: "Semana de oração", start: "2026-09-21", end: "2026-09-26", color: "#6366f1" },
];

/* Só carimba o tema no documento: esta página é vitrine, não muda a
   preferência salva do usuário. */
function applyTheme(id: ThemeId): void {
  theme.value = id;
  previewTheme(id);
}

onMounted(() => {
  applyTheme(theme.value);
  // Progresso animado só para a barra não parecer congelada na inspeção visual
  setInterval(() => {
    progress.value = progress.value >= 100 ? 0 : progress.value + 2;
  }, 400);
});
</script>

<style scoped>
.cat {
  height: 100vh;
  overflow: auto;
  background: var(--lj-surface-bg-soft);
  color: var(--lj-text);
  font-family: var(--lj-font-shell);
  font-size: var(--lj-text-base);
}

.cat__bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--lj-space-6);
  padding: var(--lj-space-4) var(--lj-space-7);
  background: var(--lj-navy);
  color: var(--lj-text-on-navy);
}

.cat__brand strong {
  font-size: var(--lj-text-lg);
  color: var(--lj-white);
}

.cat__sub {
  margin-left: var(--lj-space-3);
  color: var(--lj-text-on-navy-muted);
  font-size: var(--lj-text-sm);
}

.cat__themes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
  margin-left: auto;
}

.cat__theme {
  padding: 3px var(--lj-space-4);
  background: var(--lj-white-alpha-10);
  border: 1px solid transparent;
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text-on-navy);
  font: inherit;
  font-size: var(--lj-text-xs);
  cursor: pointer;
}
.cat__theme:hover {
  background: var(--lj-white-alpha-20);
}
.cat__theme.is-active {
  background: var(--lj-orange);
  color: var(--lj-white);
}

.cat__main {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--lj-space-7);
}

.cat__section {
  margin-bottom: var(--lj-space-8);
  padding: var(--lj-space-6);
  background: var(--lj-surface-bg);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.cat__h2 {
  margin: 0 0 var(--lj-space-3);
  font-size: var(--lj-text-xl);
  font-weight: var(--lj-weight-semibold);
}

.cat__lead {
  margin: 0 0 var(--lj-space-6);
  max-width: 76ch;
  color: var(--lj-text-muted);
  line-height: 1.6;
}

.cat__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lj-space-4);
  margin-bottom: var(--lj-space-5);
}

/* Formulário em coluna única: reproduz a densidade real da tela de Opções */
.cat__form {
  max-width: 620px;
}

.cat__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--lj-space-6);
  align-items: start;
}

.cat__align {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4) 0;
  border-bottom: 1px dashed var(--lj-surface-border);
}

.cat__align--touch {
  border-bottom-style: solid;
  border-color: var(--lj-surface-border-strong);
}

.cat__note {
  flex-basis: 100%;
  margin: var(--lj-space-2) 0 0 96px;
  max-width: 62ch;
  font-size: var(--lj-text-sm);
  color: var(--lj-text-muted);
}

.cat__sizetag {
  min-width: 92px;
  color: var(--lj-text-subtle);
  font-family: var(--lj-font-mono);
  font-size: var(--lj-text-xs);
}

.cat-stack {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
}

.cat__divider-demo {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  max-width: 380px;
}

.cat__tabbody {
  margin: 0;
  padding: var(--lj-space-6) 0 0;
  color: var(--lj-text-muted);
}

code {
  padding: 1px 4px;
  background: var(--lj-surface-bg-active);
  border-radius: var(--lj-radius-xs);
  font-family: var(--lj-font-mono);
  font-size: 0.92em;
}
</style>
