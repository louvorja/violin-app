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

      <!-- ══════════ Comparação com Material ══════════ -->
      <section class="cat__section">
        <h2 class="cat__h2">Antes e depois</h2>
        <p class="cat__lead">Os mesmos controles, Vuetify à esquerda e o catálogo à direita.</p>
        <div class="cat__vs">
          <div class="cat__vs-col cat__vs-col--old">
            <span class="cat__vs-tag cat__vs-tag--old">Vuetify (Material)</span>
            <v-btn color="primary" variant="flat" size="small">Salvar</v-btn>
            <v-btn variant="tonal" size="small">Cancelar</v-btn>
            <v-text-field density="compact" variant="outlined" hide-details placeholder="Buscar…" />
            <v-checkbox density="compact" hide-details label="Ativar recurso" />
            <v-switch density="compact" hide-details color="primary" label="Modo escuro" />
            <v-progress-linear model-value="62" height="8" rounded />
          </div>
          <div class="cat__vs-col">
            <span class="cat__vs-tag">Catálogo LouvorJA</span>
            <LjButton variant="primary" :icon="ICONS.ACTIONS.SAVE">Salvar</LjButton>
            <LjButton>Cancelar</LjButton>
            <LjInput :icon="ICONS.ACTIONS.SEARCH" placeholder="Buscar…" />
            <LjCheckbox v-model="demoCheck" label="Ativar recurso" />
            <LjSwitch v-model="demoSwitch" label="Modo escuro" />
            <LjProgress :value="62" />
          </div>
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
import { useTheme } from "vuetify";
import { ICONS } from "@/config/Icons";
import { COLOR_THEMES } from "@/config/Theme";
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
  type LjMenuItem,
  type LjTab,
  type UiSize,
} from "@/components/ui";

const SIZES: UiSize[] = ["sm", "md", "lg"];
const HEIGHTS: Record<UiSize, string> = { sm: "22px", md: "26px", lg: "32px" };
const BUTTON_VARIANTS = ["default", "primary", "ghost", "danger", "subtle"] as const;
const CHIP_VARIANTS = ["neutral", "primary", "success", "warning", "danger"] as const;
const THEME_IDS = [...new Set(Object.values(COLOR_THEMES))];
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

const vuetifyTheme = useTheme();
const theme = ref<string>(COLOR_THEMES.DEFAULT);

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

function applyTheme(id: string): void {
  theme.value = id;
  document.documentElement.dataset.theme = id;
  try {
    vuetifyTheme.change(id);
  } catch {
    /* tema sem equivalente no Vuetify — os tokens --lj-* já mudaram */
  }
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

.cat__sizetag {
  min-width: 92px;
  color: var(--lj-text-subtle);
  font-family: var(--lj-font-mono);
  font-size: var(--lj-text-xs);
}

.cat__vs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--lj-space-6);
}

.cat__vs-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-5);
  padding: var(--lj-space-6);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
}

.cat__vs-col--old {
  background: var(--lj-surface-bg-soft);
}

/* Só os campos ocupam a coluna toda; botões ficam no tamanho natural para
   que a diferença de altura entre Material e catálogo fique visível. */
.cat__vs-col :deep(.v-input),
.cat__vs-col :deep(.lj-input),
.cat__vs-col :deep(.lj-progress),
.cat__vs-col :deep(.v-progress-linear) {
  width: 100%;
}

.cat__vs-tag {
  align-self: flex-start;
  padding: 2px var(--lj-space-4);
  width: auto !important;
  background: var(--lj-ui-accent-soft);
  border-radius: var(--lj-radius-xs);
  color: var(--lj-ui-accent-text);
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cat__vs-tag--old {
  background: var(--lj-danger-soft);
  color: var(--lj-alert-error-color, var(--lj-danger));
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
