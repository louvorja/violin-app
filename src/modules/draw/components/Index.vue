<template>
  <ModuleContainer
    ref="moduleContainer"
    :manifest="manifest"
    :style="{ minWidth: isMobileWeb ? '0' : '340px' }"
    @close="close()"
  >
    <template #right>
      <LjButton
        variant="ghost"
        size="sm"
        :icon="ICONS.PLAYER.FULLSCREEN"
        :title="tm('actions.fullscreen')"
        icon-only
        @click="fullscreen = true"
      />
    </template>

    <div class="draw-body">
      <ModuleFormatDrawer v-model="show_format" :module-id="'draw'" :manifest="manifest" />

      <div class="draw-main">
        <div class="draw-toolbar">
          <LjTabs
            :model-value="mode"
            :tabs="modeTabs"
            :aria-label="tm('ribbon.type')"
            :disabled="listLocked"
            @update:model-value="setMode"
          />
          <span class="lj-u-spacer" />
          <LjButton
            size="sm"
            variant="subtle"
            :icon="ICONS.FORMAT.LIST_BULLETED"
            @click="showList = !showList"
          >
            {{ tm("actions.list") }}
          </LjButton>
        </div>

        <!-- Preview WYSIWYG: mesmo componente da projeção /projection/module?module=draw.
             O que aparece aqui é exatamente o que será projetado. -->
        <div class="draw-preview">
          <div style="position: absolute; inset: 0">
            <DrawProjection
              :text="current != null ? String(current) : ''"
              :reference="drawnHistory()"
              :active="wheel != null || current != null"
              :mode="mode"
              :wheel="wheel"
              :tick-sound="!fullscreen && rouletteSoundEnabled"
            />
          </div>
        </div>
      </div>

      <div class="draw-list-host">
        <LjDrawer v-model="showList" side="right" :width="drawerWidth" :title="tm('data.list')">
          <div class="draw-list-body">
            <!-- No modo Números as opções vêm do intervalo, não da lista. -->
            <div v-if="mode === 'number'" class="draw-list-range">
              <LjField layout="column" :label="tm('inputs.min')">
                <LjInput type="number" :model-value="rangeMin" @update:model-value="setRangeMin" />
              </LjField>
              <LjField layout="column" :label="tm('inputs.max')">
                <LjInput type="number" :model-value="rangeMax" @update:model-value="setRangeMax" />
              </LjField>
            </div>

            <div class="draw-list-options" role="list">
              <div
                v-for="(option, index) in options"
                :key="`${option}-${index}`"
                class="draw-option"
                role="listitem"
              >
                <input
                  type="checkbox"
                  class="draw-option__check"
                  :checked="isOptionDrawn(option)"
                  tabindex="-1"
                  aria-hidden="true"
                  @click.prevent
                  @keydown.prevent
                />
                <template v-if="editingNameIndex === index">
                  <div class="draw-option__edit">
                    <input
                      :ref="setEditInput"
                      type="text"
                      class="draw-option__edit-input"
                      :value="editingNameValue"
                      @input="editingNameValue = ($event.target as HTMLInputElement).value"
                      @keydown.enter.prevent="confirmEditName"
                      @keydown.esc.prevent="cancelEditName"
                    />
                  </div>
                  <LjButton
                    size="sm"
                    variant="ghost"
                    icon-only
                    :icon="ICONS.UI.CHECK"
                    :title="tm('actions.save')"
                    :aria-label="tm('actions.save')"
                    :disabled="listLocked"
                    @click="confirmEditName"
                  />
                  <LjButton
                    size="sm"
                    variant="ghost"
                    icon-only
                    :icon="ICONS.ACTIONS.CLOSE"
                    :title="tm('actions.cancel')"
                    :aria-label="tm('actions.cancel')"
                    @click="cancelEditName"
                  />
                </template>
                <template v-else>
                  <span class="draw-option__name">{{ option }}</span>
                  <LjButton
                    v-if="mode === 'names'"
                    size="sm"
                    variant="ghost"
                    icon-only
                    class="draw-option__edit-btn"
                    :icon="ICONS.ACTIONS.EDIT"
                    :title="tm('actions.edit')"
                    :aria-label="tm('actions.edit')"
                    :disabled="listLocked"
                    @click="startEditName(index)"
                  />
                  <LjButton
                    v-if="mode === 'names'"
                    size="sm"
                    variant="ghost"
                    icon-only
                    class="draw-option__remove"
                    :icon="ICONS.ACTIONS.CLOSE"
                    :title="tm('actions.remove')"
                    :aria-label="tm('actions.remove')"
                    :disabled="listLocked"
                    @click="removeName(index)"
                  />
                </template>
              </div>
              <p v-if="!options.length" class="draw-list-empty">{{ tm("data.no_options") }}</p>
            </div>

            <template v-if="mode === 'names'">
              <div class="draw-list-add">
                <LjTextarea
                  v-model="nameDraft"
                  :placeholder="tm('inputs.names')"
                  :rows="2"
                  :disabled="listLocked"
                  @keydown="onNameKeydown"
                />
              </div>

              <div class="draw-list-actions">
                <input
                  ref="txtInput"
                  type="file"
                  accept=".txt,text/plain"
                  class="draw-txt-input"
                  @change="importTxt"
                />
                <LjButton
                  variant="subtle"
                  size="sm"
                  :icon="ICONS.ACTIONS.UPLOAD"
                  :disabled="listLocked"
                  @click="txtInput?.click()"
                >
                  {{ tm("actions.import_txt") }}
                </LjButton>
                <LjButton
                  variant="subtle"
                  size="sm"
                  :icon="ICONS.ACTIONS.DOWNLOAD"
                  :disabled="!names.length"
                  @click="exportNames"
                >
                  {{ tm("actions.export_txt") }}
                </LjButton>
              </div>
            </template>
          </div>
        </LjDrawer>
      </div>
    </div>

    <!-- Rodapé — sorteados aparecem quando a roda assenta -->
    <template #footer>
      <Transition name="draw-history">
        <div v-if="showDrawnSection" class="draw-fs-footer">
          <span class="lj-u-caption lj-u-muted">{{ tm("data.drawn") }}:</span>
          <div class="draw-fs-chips">
            <LjChip v-for="(n, i) in drawn" :key="`${n}-${i}`" variant="primary">{{ n }}</LjChip>
          </div>
          <div class="lj-u-caption lj-u-muted">
            <div class="draw-fs-footer-progress">
              <LjProgress :value="progressPercent" :height="17" />
            </div>
            {{ tm("data.remaining") }}: {{ remaining }} / {{ total }}
          </div>
        </div>
      </Transition>
    </template>
  </ModuleContainer>

  <!-- Fullscreen overlay — não há primitivo de diálogo em tela cheia -->
  <Teleport to="body">
    <Transition name="draw-fade">
      <div
        v-if="fullscreen"
        ref="fsRoot"
        class="draw-fs-root"
        tabindex="0"
        @keydown.space.prevent="drawCurrent"
        @keydown.esc="fullscreen = false"
      >
        <DrawWheel
          v-if="wheel"
          :wheel="wheel"
          large
          :tick-sound="rouletteSoundEnabled"
          class="draw-fs-wheel"
        />
        <div v-else class="draw-fs-number" :class="{ 'draw-fs-number--name': mode === 'names' }">
          {{ current ?? "—" }}
        </div>
        <div class="draw-fs-remaining">{{ remaining }} / {{ total }}</div>
        <div class="draw-fs-actions">
          <LjButton
            variant="primary"
            size="lg"
            :disabled="remaining === 0"
            :icon="ICONS.SORT.DICE"
            @click="drawCurrent"
          >
            {{ tm("actions.draw") }}
          </LjButton>
          <LjButton size="lg" :icon="ICONS.ACTIONS.RESTART" @click="reset">
            {{ tm("actions.reset") }}
          </LjButton>
          <LjButton
            variant="ghost"
            size="lg"
            :icon="ICONS.PLAYER.FULLSCREEN_EXIT"
            icon-only
            @click="fullscreen = false"
          />
        </div>
        <Transition name="draw-history">
          <div v-if="showDrawnSection" class="draw-fs-history">
            <LjChip v-for="(n, i) in drawn" :key="`${n}-${i}`">{{ n }}</LjChip>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>

  <LjDialog
    v-model="showResetConfirm"
    :title="tm('confirm.reset_title')"
    :description="tm('confirm.reset_text')"
    :icon="ICONS.ACTIONS.RESTART"
    icon-variant="warning"
    size="sm"
  >
    <template #footer>
      <LjButton size="sm" variant="subtle" @click="showResetConfirm = false">
        {{ tm("actions.cancel") }}
      </LjButton>
      <LjButton size="sm" variant="danger" :icon="ICONS.ACTIONS.RESTART" @click="confirmReset">
        {{ tm("actions.reset") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import {
  LjButton,
  LjChip,
  LjDialog,
  LjDrawer,
  LjField,
  LjInput,
  LjProgress,
  LjTabs,
  LjTextarea,
} from "@/components/ui";
import type { LjTab } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { useViewport } from "@/composables/useViewport";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import ModuleFormatDrawer from "@/components/ModuleFormatDrawer.vue";
import UserData from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { useModuleProjection } from "@/composables/useModuleProjection";
import { useModuleFormat } from "@/composables/useModuleFormat";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import type { ModuleWheelState } from "@/presentation/ModulePresentationState";
import DrawProjection from "./DrawProjection.vue";
import DrawWheel from "./DrawWheel.vue";
import { DRAW_DURATION_MAX_MS, DRAW_DURATION_MIN_MS } from "../constants";
import { createBoomerangPlan } from "../boomerang";
import { primeRouletteAudio } from "@/helpers/RouletteTick";

type DrawMode = "number" | "names";

const { show_format } = useModuleFormat("draw", manifest);
const { width: viewportWidth } = useViewport();
const isMobileWeb = computed(() => viewportWidth.value > 0 && viewportWidth.value <= 700);
const drawerWidth = computed(() => Math.min(340, Math.max(260, viewportWidth.value - 16)));

const projection = useModuleProjection("draw", {
  onAction(action) {
    if (action === "draw") drawCurrent();
    else if (action === "reset") requestReset();
    else if (action === "toggle_list") showList.value = !showList.value;
    else if (action === "toggle") namesRunning.value = !namesRunning.value;
    else if (action === "toggle_format") show_format.value = !show_format.value;
  },
});

const moduleContainer = ref<{ tm(_key: string): string } | null>(null);
const tm = (key: string): string => moduleContainer.value?.tm(key) || key;
const fsRoot = ref<HTMLElement | null>(null);
const current = ref<number | string | null>(null);
const drawnNumbers = ref<number[]>([]);
const drawnNames = ref<string[]>([]);
const wheel = ref<ModuleWheelState | null>(null);
const animating = ref(false);
const fullscreen = ref(false);
const showResetConfirm = ref(false);
const showList = computed({
  get: () => UserData.get<unknown>(KEYS.MODULES.DRAW.LIST_OPEN, false) === true,
  set: (value: boolean) => UserData.set(KEYS.MODULES.DRAW.LIST_OPEN, !!value),
});
const names = ref<string[]>([]);
const nameDraft = ref("");
const editingNameIndex = ref<number | null>(null);
const editingNameValue = ref("");
const editInputEl = ref<HTMLInputElement | null>(null);
const txtInput = ref<HTMLInputElement | null>(null);
const namesRunning = computed({
  get: () =>
    UserData.get<unknown>(
      KEYS.MODULES.DRAW.NAMES_RUNNING,
      UserData.get<unknown>(KEYS.MODULES.NAME_DRAW.RUNNING, false)
    ) === true,
  set: (value: boolean) => UserData.set(KEYS.MODULES.DRAW.NAMES_RUNNING, value),
});
const listLocked = computed(() => animating.value || namesRunning.value);

const mode = computed<DrawMode>({
  get: () =>
    UserData.get<string>(KEYS.MODULES.DRAW.MODE, "number") === "names" ? "names" : "number",
  set: (value) => UserData.set(KEYS.MODULES.DRAW.MODE, value),
});

const modeTabs = computed<LjTab[]>(() => [
  { value: "number", label: tm("modes.numbers") },
  { value: "names", label: tm("modes.names") },
]);

const drawn = computed<(number | string)[]>(() =>
  mode.value === "names" ? drawnNames.value : drawnNumbers.value
);

// Range do sorteio — configurado na ribbon contextual.
const min = ref(1);
const max = ref(100);
const rangeTick = ref(0);

function readRange() {
  let mn = Number(UserData.get(KEYS.MODULES.DRAW.RANGE_MIN, 1));
  let mx = Number(UserData.get(KEYS.MODULES.DRAW.RANGE_MAX, 100));
  if (!Number.isFinite(mn)) mn = 1;
  if (!Number.isFinite(mx)) mx = 100;
  if (mn > mx) [mn, mx] = [mx, mn];
  return { mn, mx };
}

function applyRange() {
  const { mn, mx } = readRange();
  min.value = mn;
  max.value = mx;
}
applyRange();

function currentRange() {
  void rangeTick.value;
  return readRange();
}

const numberPool = computed(() => {
  const { mn, mx } = currentRange();
  const all: number[] = [];
  for (let i = mn; i <= mx; i++) {
    if (!drawnNumbers.value.includes(i)) all.push(i);
  }
  return all;
});

const namePool = computed(() => names.value.filter((name) => !drawnNames.value.includes(name)));

function rawRangeValue(key: string, fallback: number): number {
  const value = Number(UserData.get(key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

const rangeMin = computed(() => rawRangeValue(KEYS.MODULES.DRAW.RANGE_MIN, 1));
const rangeMax = computed(() => rawRangeValue(KEYS.MODULES.DRAW.RANGE_MAX, 100));

function setRangeMin(value: string): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  UserData.set(KEYS.MODULES.DRAW.RANGE_MIN, Math.trunc(parsed));
  rangeTick.value += 1;
  applyRange();
}

function setRangeMax(value: string): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  UserData.set(KEYS.MODULES.DRAW.RANGE_MAX, Math.trunc(parsed));
  rangeTick.value += 1;
  applyRange();
}

const numberOptions = computed(() => {
  const { mn, mx } = currentRange();
  const length = Math.max(0, mx - mn + 1);
  return Array.from({ length }, (_, index) => String(mn + index));
});

const options = computed(() => (mode.value === "names" ? names.value : numberOptions.value));

function isOptionDrawn(option: string): boolean {
  return mode.value === "names"
    ? drawnNames.value.includes(option)
    : drawnNumbers.value.includes(Number(option));
}

const rouletteSoundEnabled = computed(() => {
  void rangeTick.value;
  return UserData.get<unknown>(KEYS.MODULES.DRAW.ROULETTE_SOUND, true) !== false;
});

const numberTotal = computed(() => {
  const { mn, mx } = currentRange();
  return Math.max(0, mx - mn + 1);
});
const total = computed(() => (mode.value === "names" ? names.value.length : numberTotal.value));
const remaining = computed(() =>
  mode.value === "names" ? namePool.value.length : numberPool.value.length
);
const progressPercent = computed(() =>
  total.value ? ((total.value - remaining.value) / total.value) * 100 : 0
);

watch(fullscreen, (val) => {
  if (val) nextTick(() => fsRoot.value?.focus());
});

watch(mode, () => {
  clearDrawTimer();
  wheel.value = null;
  animating.value = false;
  current.value = null;
  cancelEditName();
  if (mode.value !== "names") namesRunning.value = false;
  emitProjection();
});

watch(listLocked, (locked) => {
  if (locked) cancelEditName();
});

// Ribbon usa optionKey (UserData.set → USERDATA_PATCH). Re-aplica o range e
// reemite o estado na projeção (ex: toggle do histórico de sorteados).
useBroadcastListener(BROADCAST_TYPE.USERDATA_PATCH, (payload) => {
  const p = payload as { path?: string } | null;
  if (!p || typeof p.path !== "string") return;
  if (p.path.startsWith("modules.draw.") || p.path.startsWith("modules.name_draw.")) {
    applyRange();
    rangeTick.value += 1;
    if (current.value != null) emitProjection();
  }
});

function effectDuration(): number {
  const stored = UserData.get(KEYS.MODULES.DRAW.EFFECT_DURATION, null);
  const value =
    stored != null
      ? Number(stored)
      : Number(UserData.get(KEYS.MODULES.NAME_DRAW.EFFECT_DURATION, 2000));
  if (!Number.isFinite(value)) return 2000;
  return Math.max(DRAW_DURATION_MIN_MS, Math.min(DRAW_DURATION_MAX_MS, value));
}

function randomFinish(): boolean {
  return UserData.get<unknown>(KEYS.MODULES.DRAW.RANDOM_FINISH, true) !== false;
}

function showDrawnHistory(): boolean {
  const stored = UserData.get<unknown>(KEYS.MODULES.DRAW.SHOW_DRAWN_HISTORY, null);
  if (stored != null) return stored === true;
  return UserData.get<unknown>(KEYS.MODULES.NAME_DRAW.SHOW_DRAWN, false) === true;
}

function drawnHistory(): string[] {
  if (!showDrawnHistory()) return [];
  return drawn.value.map(String);
}

let drawTimer: ReturnType<typeof setTimeout> | null = null;

const WHEEL_ITEMS_LIMIT = 1_000;

function wheelWindow<T>(pool: T[], target: T): T[] {
  if (pool.length <= WHEEL_ITEMS_LIMIT) return [...pool];
  const index = Math.max(0, pool.indexOf(target));
  const first = Math.max(
    0,
    Math.min(pool.length - WHEEL_ITEMS_LIMIT, index - Math.floor(WHEEL_ITEMS_LIMIT / 2))
  );
  return pool.slice(first, first + WHEEL_ITEMS_LIMIT);
}

// A roda mostra apenas o que ainda pode ser sorteado. O valor recém-sorteado
// continua no overlay de reinício, mas não volta para as opções.
function wheelItemsFor(target: string): string[] {
  if (mode.value === "names") return wheelWindow(namePool.value, target);
  return wheelWindow(numberPool.value, Number(target)).map(String);
}

function startWheel(picked: number | string): void {
  const duration = effectDuration();
  const target = String(picked);
  const { mn, mx } = currentRange();
  const runId = crypto.randomUUID();
  const randomFinishEnabled = randomFinish();
  const boomerang = createBoomerangPlan(runId, randomFinishEnabled);
  wheel.value = {
    run_id: runId,
    mode: mode.value,
    target,
    duration,
    settled: false,
    random_finish: randomFinishEnabled,
    ...(mode.value === "number" ? { min: mn, max: mx } : {}),
    items: wheelItemsFor(target),
  };
  animating.value = true;
  current.value = null;
  emitProjection();

  // Pequena folga para o último frame do bounce ser pintado antes de trocar
  // o wheel pelo valor final.
  drawTimer = setTimeout(
    () => {
      drawTimer = null;
      if (!wheel.value) return;
      wheel.value = { ...wheel.value, settled: true };
      animating.value = false;
      current.value = picked;
      if (mode.value === "names") drawnNames.value.push(String(picked));
      else drawnNumbers.value.push(Number(picked));
      emitProjection();
    },
    duration + boomerang.totalMs + 60
  );
}

function drawNumber(): void {
  if (animating.value || !numberPool.value.length) return;
  const values = numberPool.value;
  startWheel(values[Math.floor(Math.random() * values.length)]);
}

function drawName(): void {
  if (animating.value || !namePool.value.length) return;
  const values = namePool.value;
  startWheel(values[Math.floor(Math.random() * values.length)]);
}

function clearDrawTimer(): void {
  if (drawTimer) clearTimeout(drawTimer);
  drawTimer = null;
}

function drawCurrent(): void {
  if (animating.value) return;
  const hasOptions =
    mode.value === "names" ? namePool.value.length > 0 : numberPool.value.length > 0;
  if (!hasOptions) return;
  if (rouletteSoundEnabled.value) primeRouletteAudio();
  // O primeiro "Sortear" inicia a sessão automaticamente; o Reiniciar finaliza.
  if (!namesRunning.value) namesRunning.value = true;
  if (mode.value === "names") drawName();
  else drawNumber();
}

const showDrawnSection = computed(
  () => drawn.value.length > 0 && (wheel.value == null || wheel.value.settled === true)
);

function emitProjection(): void {
  const history = wheel.value == null || wheel.value.settled === true ? drawnHistory() : [];
  projection.emit({
    text: current.value != null ? String(current.value) : "",
    reference: history,
    active: wheel.value != null || current.value != null,
    mode: mode.value,
    wheel: wheel.value ?? undefined,
  });
}

function setMode(value: string): void {
  mode.value = value === "names" ? "names" : "number";
}

function persistNames(): void {
  UserData.set(KEYS.MODULES.DRAW.NAMES, [...names.value]);
}

function loadNames(): void {
  const current = UserData.get<unknown>(KEYS.MODULES.DRAW.NAMES, null);
  const saved = current ?? UserData.get<unknown>(KEYS.MODULES.NAME_DRAW.NAMES, null);
  names.value = Array.isArray(saved)
    ? saved.filter((name): name is string => typeof name === "string")
    : [];

  // Quem vinha do módulo antigo abre no modo Nomes; quem já tem uma lista no
  // draw mantém o modo salvo (ou o padrão Números).
  if (
    current == null &&
    names.value.length > 0 &&
    UserData.get<unknown>(KEYS.MODULES.DRAW.MODE, null) == null
  ) {
    mode.value = "names";
  }
}

function onNameKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key !== "Enter") return;
  event.preventDefault();
  addName();
}

function addName(): void {
  if (listLocked.value) return;
  const name = nameDraft.value.trim();
  if (!name) return;
  nameDraft.value = "";
  cancelEditName();
  if (names.value.includes(name)) return;
  names.value.push(name);
  persistNames();
}

function setEditInput(element: unknown): void {
  editInputEl.value = element instanceof HTMLInputElement ? element : null;
}

function startEditName(index: number): void {
  if (listLocked.value) return;
  const name = names.value[index];
  if (name == null) return;
  editingNameIndex.value = index;
  editingNameValue.value = name;
  void nextTick(() => {
    editInputEl.value?.focus();
    editInputEl.value?.select();
  });
}

function confirmEditName(): void {
  const index = editingNameIndex.value;
  if (index == null || listLocked.value) return;
  const oldName = names.value[index];
  const nextName = editingNameValue.value.trim();
  if (oldName == null || !nextName) return;
  if (names.value.some((name, i) => i !== index && name === nextName)) return;

  names.value.splice(index, 1, nextName);
  drawnNames.value = drawnNames.value.map((name) => (name === oldName ? nextName : name));
  if (wheel.value) {
    wheel.value = {
      ...wheel.value,
      ...(wheel.value.target === oldName ? { target: nextName } : {}),
      ...(wheel.value.items
        ? { items: wheel.value.items.map((name) => (name === oldName ? nextName : name)) }
        : {}),
    };
  }
  if (current.value === oldName) current.value = nextName;
  editingNameIndex.value = null;
  editingNameValue.value = "";
  persistNames();
  emitProjection();
}

function cancelEditName(): void {
  editingNameIndex.value = null;
  editingNameValue.value = "";
}

function removeName(index: number): void {
  if (listLocked.value) return;
  const [removed] = names.value.splice(index, 1);
  if (removed == null) return;
  cancelEditName();
  drawnNames.value = drawnNames.value.filter((name) => name !== removed);
  // Se o nome exibido foi removido, não há mais roda válida para mostrar. Os
  // demais casos ficam com o estado antigo até o próximo sorteio; filtrar os
  // itens sem reindexar o offset mostraria outro nome no centro.
  if (wheel.value?.target === removed) wheel.value = null;
  if (current.value === removed) current.value = null;
  persistNames();
  emitProjection();
}

function exportNames(): void {
  if (!names.value.length) return;
  const blob = new Blob([`${names.value.join("\n")}\n`], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "lista-do-sorteio.txt";
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function importTxt(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || listLocked.value) return;

  try {
    const text = await file.text();
    const imported = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (!imported.length) return;
    const merged = [...names.value];
    for (const name of imported) {
      if (!merged.includes(name)) merged.push(name);
    }
    names.value = merged;
    cancelEditName();
    persistNames();
  } catch (error) {
    console.warn("[draw] falha ao importar lista de nomes:", error);
  }
}

function requestReset(): void {
  showResetConfirm.value = true;
}

function confirmReset(): void {
  showResetConfirm.value = false;
  reset();
}

function reset(): void {
  clearDrawTimer();
  cancelEditName();
  wheel.value = null;
  animating.value = false;
  // Reiniciar também finaliza um sorteio automático que esteja iniciado.
  namesRunning.value = false;
  if (mode.value === "names") drawnNames.value = [];
  else drawnNumbers.value = [];
  current.value = null;
  emitProjection();
}

function close(): void {
  showList.value = false;
  reset();
}

onMounted(loadNames);

onBeforeUnmount(() => {
  clearDrawTimer();
});
</script>

<style scoped>
.draw-number {
  position: relative;
  z-index: 1;
  font-size: 5rem;
  font-weight: 200;
  font-variant-numeric: tabular-nums;
  min-width: 3ch;
  text-align: center;
  transition:
    transform 0.2s,
    opacity 0.2s;
}
.draw-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}
.draw-animating {
  animation: draw-pulse 0.8s ease-in-out infinite;
  opacity: 1;
}

@keyframes draw-pulse {
  0%,
  100% {
    transform: scale(1);
    filter: none;
  }
  50% {
    transform: scale(1.12);
    filter: blur(0.5px);
  }
}

/* Corpo do módulo */
.draw-body {
  position: relative;
  display: flex;
  height: 100%;
}
.draw-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.draw-toolbar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: var(--lj-space-2) var(--lj-space-4);
  flex-shrink: 0;
}
.draw-preview {
  position: relative;
  flex-grow: 1;
  min-width: 0;
  /* A fonte do wheel pode crescer além do preview; sem o recorte ele cobria a
     toolbar e bloqueava a troca de abas. */
  overflow: hidden;
}
.draw-list-host {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
}
/* Corpo do drawer: intervalo/opções rolam, ações ficam fixas embaixo. */
.draw-list-body {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  height: 100%;
  min-height: 0;
  padding: var(--lj-space-5);
}

/* Controles de intervalo no topo do drawer, usados no modo Números. */
.draw-list-range {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--lj-space-3);
  flex-shrink: 0;
}

.draw-list-range :deep(.lj-field) {
  margin-bottom: 0;
}

/* Lista rolável de opções (nomes ou números). */
.draw-list-options {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* Card de uma opção do sorteio, com checkbox readonly. */
.draw-option {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  min-height: 34px;
  padding: var(--lj-space-1) var(--lj-space-2);
  border: 1px solid var(--lj-surface-border);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg-soft);
}

/* Checkbox readonly que indica se a opção já foi sorteada. */
.draw-option__check {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--lj-ui-accent);
  cursor: default;
  flex-shrink: 0;
}

/* Nome/número da opção. */
.draw-option__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--lj-text-base);
}

/* Área do input de edição inline. */
.draw-option__edit {
  flex: 1;
  min-width: 0;
}

/* Input usado no editar inline da opção. */
.draw-option__edit-input {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0 var(--lj-space-2);
  border: 1px solid var(--lj-ui-accent);
  border-radius: var(--lj-radius-sm);
  outline: none;
  background: var(--lj-surface-bg);
  color: var(--lj-text);
  font: inherit;
  font-size: var(--lj-text-base);
}

.draw-option__edit-input:focus {
  box-shadow: var(--lj-ui-focus);
}

.draw-list-empty {
  margin: 0;
  padding: var(--lj-space-4);
  color: var(--lj-text-subtle);
  text-align: center;
}

/* Área de digitação de novos nomes (Enter adiciona à lista). */
.draw-list-add {
  flex-shrink: 0;
}

.draw-list-add :deep(.lj-textarea) {
  width: 100%;
  min-height: 58px;
  resize: vertical;
}

/* Ações inferiores do drawer: importar/exportar TXT. */
.draw-list-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
  flex-shrink: 0;
}

.draw-txt-input {
  display: none;
}

/* Fullscreen */
.draw-fs-root {
  position: fixed;
  inset: 0;
  z-index: 2500;
  width: 100vw;
  height: 100vh;
  background: var(--lj-color-projection-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-8);
  outline: none;
  cursor: default;
}
.draw-fs-number {
  font-size: clamp(6rem, 30vw, 20rem);
  font-weight: 100;
  font-variant-numeric: tabular-nums;
  color: var(--lj-white);
  line-height: 1;
  transition:
    transform 0.25s,
    opacity 0.25s;
}
/* Wheel em tamanho de tela cheia. */
.draw-fs-wheel {
  width: min(80vw, 900px);
  color: var(--lj-white);
  font-size: clamp(1.75rem, 7vw, 4rem);
}

.draw-fs-number--name {
  max-width: 90vw;
  font-size: clamp(2.5rem, 10vw, 7rem);
  font-variant-numeric: normal;
  overflow-wrap: anywhere;
  text-align: center;
}
.draw-fs-remaining {
  font-size: 1rem;
  color: var(--lj-white-alpha-50);
  font-variant-numeric: tabular-nums;
}
.draw-fs-actions {
  display: flex;
  gap: var(--lj-space-5);
  align-items: center;
}
.draw-fs-history {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-3);
  justify-content: center;
  max-width: 80vw;
  padding: 0 var(--lj-space-8);
}
/* Sobre o fundo preto da tela cheia o chip não pode seguir o tema da janela. */
.draw-fs-history :deep(.lj-chip) {
  background: var(--lj-white-alpha-10);
  border-color: transparent;
  color: var(--lj-white);
}

.draw-fade-enter-active,
.draw-fade-leave-active {
  transition: opacity var(--lj-transition-slow);
}
.draw-fade-enter-from,
.draw-fade-leave-to {
  opacity: 0;
}

/* Entrada/saída do histórico no rodapé do módulo e no fullscreen. */
.draw-history-enter-active,
.draw-history-leave-active {
  transition:
    opacity 240ms var(--lj-ease, ease),
    transform 240ms var(--lj-ease, ease);
}

.draw-history-enter-from,
.draw-history-leave-to {
  opacity: 0;
  transform: scale(0.82);
}

.draw-fs-footer {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
}
.draw-fs-chips {
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

.draw-fs-chips > * {
  flex: 0 0 auto;
}
.draw-fs-footer-progress {
  width: 400px;
}

@media (max-width: 700px) {
  .draw-fs-root {
    height: 100dvh;
    gap: var(--lj-space-5);
    padding: var(--lj-space-4);
  }

  .draw-fs-actions {
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--lj-space-2);
  }

  .draw-fs-actions :deep(.lj-btn) {
    min-height: 44px;
  }

  .draw-fs-footer {
    width: 100%;
    min-width: 0;
  }

  .draw-fs-footer-progress {
    width: min(400px, 100%);
  }
}
</style>
