<template>
  <form class="storage-locations" @submit.prevent="save">
    <p v-if="setup" class="storage-locations__hint">{{ t("options.storage.setup_hint") }}</p>
    <p v-if="loading" role="status">{{ t("options.storage.loading_locations") }}</p>
    <template v-if="locations">
      <section v-for="kind in editableKinds" :key="kind" class="storage-locations__section">
        <h3>{{ t(`options.storage.${kind}_folder`) }}</h3>
        <code class="storage-locations__path" :data-testid="`${kind}-path`">
          {{ draft[`${kind}Dir`] }}
        </code>
        <p class="storage-locations__hint">{{ t(`options.storage.${kind}_hint`) }}</p>
        <p v-if="locations.access?.[kind].shared" class="storage-locations__hint">
          {{ t("options.storage.shared_hint") }}
        </p>
        <p v-if="locations.access?.[kind].writable === false" class="storage-locations__warning">
          {{ t("options.storage.read_only_hint") }}
        </p>
        <div class="storage-locations__actions">
          <LjButton size="sm" :disabled="busy" @click="openDir(kind)">
            {{ t("options.storage.open_folder") }}
          </LjButton>
          <LjButton size="sm" :disabled="busy || !!locations.pending" @click="chooseFolder(kind)">
            {{ t("options.storage.change_folder") }}
          </LjButton>
        </div>
        <label
          v-if="draft[`${kind}Dir`] !== locations[`${kind}Dir`]"
          class="storage-locations__action"
        >
          <span>{{ t("options.storage.existing_files") }}</span>
          <select
            v-model="draft[`${kind}Action`]"
            :disabled="busy"
            class="lj-ui-control lj-ui-size-md"
          >
            <option value="copy">{{ t("options.storage.copy_existing") }}</option>
            <option value="reuse">{{ t("options.storage.reuse_existing") }}</option>
          </select>
          <span class="storage-locations__hint">
            {{ t(`options.storage.${draft[`${kind}Action`]}_hint`) }}
          </span>
        </label>
      </section>

      <section class="storage-locations__section">
        <h3>{{ t("options.storage.profile_folder") }}</h3>
        <code class="storage-locations__path" data-testid="profile-path">
          {{ locations.profileDir }}
        </code>
        <p class="storage-locations__hint">{{ t("options.storage.profile_hint") }}</p>
        <LjButton size="sm" :disabled="busy" @click="openDir('profile')">
          {{ t("options.storage.open_folder") }}
        </LjButton>
      </section>

      <section v-if="classicApi" class="storage-locations__section">
        <h3>{{ t("options.storage.classic.title") }}</h3>
        <p class="storage-locations__hint">{{ t("options.storage.classic.hint") }}</p>
        <label class="storage-locations__checkbox">
          <input v-model="classic.enabled" type="checkbox" :disabled="busy || !classic.dir" />
          <span>{{ t("options.storage.classic.enabled") }}</span>
        </label>
        <code v-if="classic.dir" class="storage-locations__path">{{ classic.dir }}</code>
        <p v-else class="storage-locations__hint">{{ t("options.storage.classic.none") }}</p>
        <label v-if="classic.dir" class="storage-locations__action">
          <span>{{ t("options.storage.classic.language") }}</span>
          <select v-model="classic.lang" :disabled="busy" class="lj-ui-control lj-ui-size-md">
            <option :value="null" disabled>
              {{ t("options.storage.classic.choose_language") }}
            </option>
            <option value="pt">Português</option>
            <option value="es">Español</option>
          </select>
        </label>
        <p v-if="classic.dir && !classic.available" class="storage-locations__warning">
          {{ t("options.storage.classic.unavailable") }}
        </p>
        <div class="storage-locations__actions">
          <LjButton size="sm" :disabled="busy" @click="detectClassic">
            {{ t("options.storage.classic.detect") }}
          </LjButton>
          <LjButton size="sm" :disabled="busy" @click="chooseClassic">
            {{ t("options.storage.classic.choose") }}
          </LjButton>
          <LjButton v-if="classic.dir" size="sm" :disabled="busy" @click="removeClassic">
            {{ t("options.storage.classic.remove") }}
          </LjButton>
          <LjButton
            v-if="!setup && classic.dir && classic.available"
            size="sm"
            :disabled="busy || dirty || !classic.lang || !!locations.pending"
            @click="copyClassic"
          >
            {{ t("options.storage.classic.import") }}
          </LjButton>
        </div>
        <div v-if="candidates.length" class="storage-locations__candidates">
          <p class="storage-locations__hint">{{ t("options.storage.classic.choose_found") }}</p>
          <div
            v-for="candidate in candidates"
            :key="candidate.dir"
            class="storage-locations__candidate"
          >
            <code class="storage-locations__path">{{ candidate.dir }}</code>
            <LjButton size="sm" :disabled="busy" @click="selectClassic(candidate)">
              {{ t("options.storage.classic.use_folder") }}
            </LjButton>
          </div>
        </div>
        <p v-else-if="searched" class="storage-locations__hint" role="status">
          {{ t("options.storage.classic.not_found_hint") }}
        </p>
      </section>

      <div
        v-if="locations.pending || locations.restartRequired"
        class="storage-locations__notice"
        role="status"
      >
        <p>{{ t("options.storage.restart_required") }}</p>
        <template v-if="locations.pending">
          <p>
            {{ t("options.storage.media_folder") }}:
            <code>{{ locations.pending.mediaDir }}</code>
          </p>
          <p>
            {{ t("options.storage.videos_folder") }}:
            <code>{{ locations.pending.videosDir }}</code>
          </p>
        </template>
        <LjButton :disabled="busy || dirty" @click="restart">
          {{ t("options.storage.restart_now") }}
        </LjButton>
        <LjButton v-if="locations.pending" :disabled="busy" @click="cancelPending">
          {{ t("options.storage.cancel_pending") }}
        </LjButton>
      </div>
    </template>

    <p v-if="locations?.changeError" class="storage-locations__warning" role="alert">
      {{ t("options.storage.apply_failed") }} {{ locations.changeError }}
    </p>
    <p v-if="error" class="storage-locations__warning" role="alert">{{ error }}</p>
    <p v-if="saved && !dirty && !locations?.pending" role="status">
      {{ t("options.storage.saved") }}
    </p>
    <div class="storage-locations__actions">
      <LjButton v-if="!locations && !loading" :disabled="busy" @click="load">
        {{ t("options.storage.refresh") }}
      </LjButton>
      <LjButton
        v-if="locations && (!setup || !locations.pending || dirty)"
        type="submit"
        variant="primary"
        :loading="busy"
        :disabled="(!setup && !dirty) || (classic.enabled && !classic.lang)"
        data-testid="save-storage"
      >
        {{ t(setup ? "options.storage.setup_continue" : "options.storage.save_locations") }}
      </LjButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton } from "@/components/ui";
import Platform from "@/helpers/Platform";
import Alert from "@/helpers/Alert";

const props = defineProps<{ setup?: boolean }>();
const emit = defineEmits<{ complete: []; changed: [] }>();
const { t } = useI18n();
const storage = Platform.api?.storage;
const classicApi = Platform.classic;
type ClassicCandidate = Awaited<ReturnType<NonNullable<typeof classicApi>["detect"]>>[number];
type Locations = Awaited<ReturnType<LouvorjaApi["storage"]["locations"]>>;
type LocationsInput = Parameters<LouvorjaApi["storage"]["configureLocations"]>[0];
const editableKinds = ["media", "videos"] as const;
const locations = ref<Locations | null>(null);
const draft = reactive<LocationsInput>({
  mediaDir: "",
  videosDir: "",
  mediaAction: "copy",
  videosAction: "copy",
});
const classic = reactive({
  dir: null as string | null,
  lang: null as string | null,
  enabled: false,
  available: false,
});
const originalClassic = ref("");
const candidates = ref<ClassicCandidate[]>([]);
const searched = ref(false);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const saved = ref(false);
const classicValue = () =>
  JSON.stringify({ dir: classic.dir, lang: classic.lang, enabled: classic.enabled });
const pathsChanged = computed(
  () =>
    !!locations.value &&
    editableKinds.some((kind) => draft[`${kind}Dir`] !== locations.value![`${kind}Dir`])
);
const dirty = computed(() => pathsChanged.value || classicValue() !== originalClassic.value);

function reportError(cause: unknown, key = "options.storage.change_failed"): void {
  error.value = `${t(key)}${cause instanceof Error && cause.message ? ` ${cause.message}` : ""}`;
}

function classicError(code?: string): string {
  if (code === "language-required" || code === "invalid-language")
    return t("options.storage.classic.choose_language");
  if (code === "destination-exists") return t("options.storage.classic.destination_exists");
  if (code === "overlapping") return t("options.storage.classic.overlapping");
  if (code === "symbolic-link") return t("options.storage.classic.symbolic_link");
  return t("options.storage.classic.invalid");
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    if (!storage) throw new Error(t("options.storage.locations_unavailable"));
    const nextLocations = await storage.locations();
    const nextClassic = classicApi ? await classicApi.getSource() : null;
    locations.value = nextLocations;
    draft.mediaDir = nextLocations.mediaDir;
    draft.videosDir = nextLocations.videosDir;
    // No primeiro setup um padrão indisponível pode não ter sido criado.
    // A alternativa escolhida começa sem exigir a cópia dessa origem.
    for (const kind of editableKinds) {
      draft[`${kind}Action`] =
        props.setup && nextLocations.access?.[kind]?.reason === "unavailable" ? "reuse" : "copy";
    }
    if (nextClassic) Object.assign(classic, nextClassic);
    originalClassic.value = classicValue();
  } catch (cause) {
    reportError(cause, "options.storage.locations_unavailable");
  } finally {
    loading.value = false;
  }
}

async function openDir(kind: "media" | "videos" | "profile"): Promise<void> {
  try {
    await storage?.openDir(kind);
  } catch (cause) {
    reportError(cause);
  }
}

async function chooseFolder(kind: "media" | "videos"): Promise<void> {
  try {
    const dir = await storage?.chooseDir();
    if (dir) draft[`${kind}Dir`] = dir;
  } catch (cause) {
    reportError(cause);
  }
}

async function detectClassic(): Promise<void> {
  if (!classicApi) return;
  busy.value = true;
  error.value = "";
  try {
    candidates.value = await classicApi.detect();
    searched.value = true;
  } catch (cause) {
    reportError(cause, "options.storage.classic.detect_failed");
  } finally {
    busy.value = false;
  }
}

function selectClassic(candidate: ClassicCandidate): void {
  Object.assign(classic, {
    dir: candidate.dir,
    lang: candidate.lang,
    enabled: true,
    available: true,
  });
  candidates.value = [];
  searched.value = false;
}

async function chooseClassic(): Promise<void> {
  if (!classicApi) return;
  busy.value = true;
  error.value = "";
  try {
    const dir = await storage?.chooseDir();
    if (!dir) return;
    const result = await classicApi.validate(dir);
    if (!result.ok) throw new Error(classicError(result.error));
    Object.assign(classic, { dir, lang: result.lang || null, enabled: true, available: true });
  } catch (cause) {
    reportError(cause, "options.storage.classic.invalid");
  } finally {
    busy.value = false;
  }
}

function removeClassic(): void {
  Object.assign(classic, { dir: null, lang: null, enabled: false, available: false });
}

async function copyClassic(): Promise<void> {
  if (!classic.dir || !classic.lang || !classicApi) return;
  if (!(await Alert.confirm(t("options.storage.classic.import_confirm")))) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await classicApi.import({ dir: classic.dir, lang: classic.lang, move: false });
    if (!result.ok) throw new Error(classicError(result.error));
    saved.value = true;
    emit("changed");
  } catch (cause) {
    reportError(cause, "options.storage.classic.import_failed");
  } finally {
    busy.value = false;
  }
}

async function save(): Promise<void> {
  if (!storage || !locations.value || busy.value) return;
  busy.value = true;
  error.value = "";
  saved.value = false;
  try {
    if (pathsChanged.value) await storage.configureLocations({ ...draft });
    // Ler novamente antes da próxima operação preserva a indicação de uma
    // alteração já agendada mesmo se a origem Classic falhar na sequência.
    locations.value = await storage.locations();
    draft.mediaDir = locations.value.mediaDir;
    draft.videosDir = locations.value.videosDir;
    if (classicApi && classicValue() !== originalClassic.value) {
      const result = await classicApi.setSource({
        dir: classic.dir,
        lang: classic.lang,
        enabled: classic.enabled,
      });
      if (!result.ok) throw new Error(classicError(result.error));
      originalClassic.value = classicValue();
    }
    if (props.setup) await storage.completeSetup();
    saved.value = true;
    emit("changed");
    if (props.setup && !locations.value.restartRequired && !locations.value.pending)
      emit("complete");
  } catch (cause) {
    reportError(cause);
  } finally {
    busy.value = false;
  }
}

async function restart(): Promise<void> {
  if (!storage || busy.value) return;
  busy.value = true;
  try {
    if (props.setup) await storage.completeSetup();
    await storage.restart();
  } catch (cause) {
    reportError(cause);
  } finally {
    busy.value = false;
  }
}

async function cancelPending(): Promise<void> {
  if (!storage || !locations.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await storage.configureLocations({
      mediaDir: locations.value.mediaDir,
      videosDir: locations.value.videosDir,
      mediaAction: "reuse",
      videosAction: "reuse",
    });
    locations.value = await storage.locations();
    draft.mediaDir = locations.value.mediaDir;
    draft.videosDir = locations.value.videosDir;
    emit("changed");
  } catch (cause) {
    reportError(cause);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await load();
  if (props.setup && locations.value && !classic.dir) await detectClassic();
});
</script>

<style scoped>
.storage-locations {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-5);
}
.storage-locations__section {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-2);
}
.storage-locations__section + .storage-locations__section {
  padding-top: var(--lj-space-4);
  border-top: 1px solid var(--lj-surface-divider);
}
.storage-locations h3 {
  margin: 0;
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-semibold);
}
.storage-locations p {
  margin: 0;
}
.storage-locations__hint {
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  line-height: 1.5;
}
.storage-locations__path {
  display: block;
  max-width: 100%;
  overflow-wrap: anywhere;
  white-space: normal;
  font-size: var(--lj-text-sm);
}
.storage-locations__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-2);
}
.storage-locations__action {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  width: 100%;
  margin-top: var(--lj-space-2);
}
.storage-locations__checkbox {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
}
.storage-locations__candidates {
  width: 100%;
}
.storage-locations__candidate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-3);
  padding-block: var(--lj-space-2);
}
.storage-locations__warning {
  color: var(--lj-warning);
  overflow-wrap: anywhere;
}
.storage-locations__notice {
  padding: var(--lj-space-4);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--lj-space-3);
  background: var(--lj-surface-bg-soft);
  border: 1px solid var(--lj-surface-divider);
  border-radius: var(--lj-radius-md);
  overflow-wrap: anywhere;
}
</style>
