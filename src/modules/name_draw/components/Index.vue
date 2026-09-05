<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    :style="{ minWidth: '340px' }"
    @close="close()"
  >
    <div class="ndraw-body">
      <ModuleFormatDrawer v-model="show_format" :module-id="'name_draw'" :manifest="manifest" />

      <!-- Drawer direito — edição da lista de nomes a sortear.
           O painel é permanente dentro de um host absoluto para sobrepor a
           prévia em vez de estreitá-la: a prévia é WYSIWYG e o tamanho da
           letra projetada vem da largura dela. -->
      <div class="ndraw-list-host">
        <LjDrawer v-model="showList" side="right" :width="280" :title="t('data.list')">
          <div class="ndraw-list-drawer__body">
            <LjTextarea
              v-model="namesText"
              :placeholder="t('inputs.names')"
              :rows="10"
              :disabled="running"
            />
            <LjButton
              variant="primary"
              size="sm"
              :disabled="running"
              :icon="ICONS.UI.CHECK"
              @click="applyList"
            >
              {{ t("actions.apply") }}
            </LjButton>
            <div v-if="running" class="lj-u-caption lj-u-muted">
              {{ t("data.locked") }}
            </div>
          </div>
        </LjDrawer>
      </div>

      <!-- Preview WYSIWYG: mesmo componente da projeção /projection/module?module=name_draw.
           O que aparece aqui é exatamente o que será projetado. -->
      <div class="ndraw-preview">
        <div style="position: absolute; inset: 0">
          <NameDrawProjection
            :text="current || ''"
            :reference="showDrawn ? drawn : []"
            :active="current != null"
          />
        </div>
      </div>
    </div>

    <!-- Rodapé — nomes sorteados sempre visíveis -->
    <template #footer>
      <div v-if="drawn.length" class="ndraw-fs-footer">
        <span class="lj-u-caption lj-u-muted">{{ t("data.drawn") }}:</span>
        <div class="ndraw-fs-chips">
          <LjChip v-for="n in drawn" :key="n" variant="primary">{{ n }}</LjChip>
        </div>
        <div class="lj-u-caption lj-u-muted">
          <div class="ndraw-fs-footer-progress">
            <LjProgress :value="progressPercent" :height="17" />
          </div>
          {{ t("data.remaining") }}: {{ pool.length }} / {{ names.length }}
        </div>
      </div>
    </template>
  </ModuleContainer>
</template>

<script setup>
import { LjButton, LjChip, LjDrawer, LjProgress, LjTextarea } from "@/components/ui";
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import ModuleFormatDrawer from "@/components/ModuleFormatDrawer.vue";
import UserData from "@/helpers/UserData";
import { useModuleProjection } from "@/composables/useModuleProjection";
import { useModuleFormat } from "@/composables/useModuleFormat";
import { ICONS } from "@/config/Icons";
import { KEYS } from "@/constants/UserDataKeys";
import NameDrawProjection from "./NameDrawProjection.vue";

const { show_format } = useModuleFormat("name_draw", manifest);

const projection = useModuleProjection("name_draw", {
  onAction(action) {
    if (action === "toggle") toggle();
    else if (action === "draw") drawName();
    else if (action === "reset") reset();
    else if (action === "toggle_list") showList.value = !showList.value;
    else if (action === "toggle_format") show_format.value = !show_format.value;
  },
});

const moduleContainer = ref(null);
const showList = ref(false);
const namesText = ref("");
const names = ref([]);
const drawn = ref([]);
const current = ref(null);
const animating = ref(false);
let spinTimer = null;

const running = computed({
  get: () => UserData.get(KEYS.MODULES.NAME_DRAW.RUNNING, false) === true,
  set: (v) => UserData.set(KEYS.MODULES.NAME_DRAW.RUNNING, !!v),
});

const showDrawn = computed(() => UserData.get(KEYS.MODULES.NAME_DRAW.SHOW_DRAWN, false) === true);

const pool = computed(() => names.value.filter((n) => !drawn.value.includes(n)));

const progressPercent = computed(() =>
  names.value.length ? (drawn.value.length / names.value.length) * 100 : 0
);

const t = (key) => moduleContainer.value?.t(key) || key;

// Carrega a lista persistida do UserData e prepara o textarea.
function loadNames() {
  const saved = UserData.get(KEYS.MODULES.NAME_DRAW.NAMES, null);
  names.value = Array.isArray(saved) ? saved.filter((n) => typeof n === "string") : [];
  namesText.value = names.value.join("\n");
}

onMounted(loadNames);

// Reage a mudanças da ribbon (ex: toggle "exibir sorteados na projeção").
watch(
  [running, showDrawn],
  () => {
    emitProjection();
  },
  { immediate: true }
);

function applyList() {
  names.value = namesText.value
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
  UserData.set(KEYS.MODULES.NAME_DRAW.NAMES, names.value);
  drawn.value = [];
  current.value = null;
  showList.value = false;
  emitProjection();
}

function toggle() {
  running.value = !running.value;
  // Ao iniciar, garante que a lista atual seja aplicada e trava a edição.
  if (running.value && showList.value) applyList();
}

function effectDuration() {
  const v = Number(UserData.get(KEYS.MODULES.NAME_DRAW.EFFECT_DURATION, 2000));
  return v >= 100 ? v : 2000;
}

function drawName() {
  if (!pool.value.length || animating.value) return;
  const n = pool.value[Math.floor(Math.random() * pool.value.length)];
  const duration = effectDuration();
  const spinStep = 80; // ms entre cada troca de nome

  animating.value = true;

  let elapsed = 0;
  spinTimer = setInterval(() => {
    elapsed += spinStep;
    if (elapsed >= duration) {
      clearInterval(spinTimer);
      spinTimer = null;
      // Revela o nome sorteado somente após a animação.
      drawn.value.push(n);
      current.value = n;
      animating.value = false;
      emitProjection();
      return;
    }
    // Mostra um nome aleatório qualquer (sem remover do pool) — efeito roleta.
    const spin = pool.value[Math.floor(Math.random() * pool.value.length)];
    current.value = spin;
    emitProjection();
  }, spinStep);
}

function emitProjection() {
  projection.emit({
    text: current.value || "",
    reference: showDrawn.value ? drawn.value.slice() : [],
    active: current.value != null,
  });
}

function reset() {
  clearInterval(spinTimer);
  spinTimer = null;
  animating.value = false;
  drawn.value = [];
  current.value = null;
  emitProjection();
}

function close() {
  reset();
}

onBeforeUnmount(() => {
  clearInterval(spinTimer);
  spinTimer = null;
});
</script>

<style scoped>
.ndraw-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

.ndraw-body {
  position: relative;
  display: flex;
  height: 100%;
}

.ndraw-preview {
  position: relative;
  flex-grow: 1;
  min-width: 0;
}

.ndraw-list-host {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
}
.ndraw-list-drawer__body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-4);
  padding: var(--lj-space-5);
}

.ndraw-fs-footer {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}
.ndraw-fs-chips {
  /* Uma linha que rola de lado, como o grupo de chips do Vuetify — não `wrap`.
     O rodapé do ModuleContainer não encolhe, então cada linha nova sai da altura
     da prévia do slide, que é a única conferência do operador sobre o que está
     no telão. Com dezenas de sorteados isso comia a prévia inteira. */
  display: flex;
  flex-wrap: nowrap;
  gap: var(--lj-space-2);
  min-width: 0;
  overflow-x: auto;
  padding-block: var(--lj-space-1);
}

.ndraw-fs-chips > * {
  flex: 0 0 auto;
}
.ndraw-fs-footer-progress {
  width: 400px;
}
</style>
