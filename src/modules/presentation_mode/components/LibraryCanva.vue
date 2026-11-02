<template>
  <div class="pm-canva" data-testid="pm-library-canva">
    <p v-if="!canva.available()" class="pm-canva__empty">{{ tm("canva.desktop_only") }}</p>

    <p v-else-if="!canva.ready.value" class="pm-canva__empty">{{ tm("library.loading") }}</p>

    <!-- Sem credenciais (ou trocando): o formulário do FreeShow. -->
    <div v-else-if="!canva.hasCredentials.value || editing" class="pm-canva__setup">
      <a class="pm-canva__doc" :href="PORTAL_URL" target="_blank" rel="noopener noreferrer">
        {{ tm("canva.docs") }}
        <LjIcon :icon="ICONS.UI.OPEN_IN_NEW" :size="13" />
      </a>
      <form class="pm-canva__form" autocomplete="off" @submit.prevent="connectWithForm">
        <LjInput
          v-model="clientId"
          size="sm"
          :placeholder="tm('canva.client_id')"
          :disabled="canva.busy.value"
          data-testid="pm-canva-client-id"
        />
        <!-- Nunca reexibido: o main só devolve `hasCredentials`. -->
        <LjInput
          v-model="clientSecret"
          size="sm"
          type="password"
          autocomplete="new-password"
          :placeholder="tm('canva.client_secret')"
          :disabled="canva.busy.value"
          data-testid="pm-canva-client-secret"
        />
        <LjButton
          type="submit"
          size="sm"
          :loading="canva.busy.value"
          :disabled="!clientId.trim() || !clientSecret.trim()"
          data-testid="pm-canva-connect"
        >
          <span class="pm-canva__btn">
            <img class="pm-canva__logo" :src="logoCanva" alt="" width="16" height="16" />
            {{ canva.busy.value ? tm("canva.connecting") : tm("canva.connect") }}
          </span>
        </LjButton>
        <LjButton
          v-if="canva.hasCredentials.value"
          size="sm"
          variant="ghost"
          :disabled="canva.busy.value"
          @click="editing = false"
        >
          {{ $t("actions.cancel") }}
        </LjButton>
      </form>
      <p class="pm-canva__hint">{{ tm("canva.redirect_hint") }}</p>
      <LjCopyButton
        v-if="canva.status.value?.redirectUri"
        :value="canva.status.value.redirectUri"
        class="pm-canva__uri"
        :title="tm('canva.copy')"
      >
        <code>{{ canva.status.value.redirectUri }}</code>
      </LjCopyButton>
      <p v-if="canva.error.value" class="pm-canva__error" role="alert">{{ canva.error.value }}</p>
    </div>

    <!-- Credenciais salvas, conta ainda não autorizada. -->
    <div v-else-if="!canva.connected.value" class="pm-canva__setup">
      <p class="pm-canva__hint">{{ tm("canva.not_connected") }}</p>
      <LjButton size="sm" :loading="canva.busy.value" @click="canva.connect()">
        <span class="pm-canva__btn">
          <img class="pm-canva__logo" :src="logoCanva" alt="" width="16" height="16" />
          {{ canva.busy.value ? tm("canva.connecting") : tm("canva.connect") }}
        </span>
      </LjButton>
      <LjButton size="sm" variant="ghost" :disabled="canva.busy.value" @click="editing = true">
        {{ tm("canva.change_credentials") }}
      </LjButton>
      <p v-if="canva.error.value" class="pm-canva__error" role="alert">{{ canva.error.value }}</p>
    </div>

    <div v-else class="pm-canva__main">
      <header class="pm-canva__head">
        <nav class="pm-canva__crumbs" :aria-label="tm('canva.title')">
          <button type="button" class="pm-canva__crumb" @click="canva.goTo(-1)">
            <img class="pm-canva__logo" :src="logoCanva" alt="" width="16" height="16" />
            {{ tm("canva.title") }}
          </button>
          <template v-for="(crumb, i) in canva.trail.value" :key="crumb.id">
            <LjIcon :icon="ICONS.UI.CHEVRON_RIGHT" :size="12" />
            <button type="button" class="pm-canva__crumb" @click="canva.goTo(i)">
              {{ crumb.name }}
            </button>
          </template>
        </nav>
        <span v-if="canva.status.value?.profile" class="pm-canva__sub">
          {{ canva.status.value.profile }}
        </span>
        <span v-else class="pm-canva__sub" />
        <!-- A mesma escolha de Integrações → "Projetar como". -->
        <div class="pm-canva__modes" role="radiogroup" :aria-label="tm('canva.mode')">
          <LjTooltip v-for="m in MODES" :key="m" :text="tm(`canva.mode_${m}_hint`)">
            <button
              type="button"
              role="radio"
              class="pm-canva__mode"
              :class="{ 'pm-canva__mode--active': canva.mode.value === m }"
              :aria-checked="canva.mode.value === m"
              :data-testid="`pm-canva-mode-${m}`"
              @click="canva.mode.value = m"
            >
              <LjIcon :icon="m === 'pdf' ? ICONS.UI.FILE : ICONS.UI.WEB" :size="13" />
              {{ tm(`canva.mode_${m}`) }}
            </button>
          </LjTooltip>
        </div>
        <LjButton
          size="sm"
          variant="ghost"
          icon-only
          :icon="ICONS.ACTIONS.REFRESH"
          :title="tm('online.refresh')"
          :disabled="canva.loading.value"
          @click="canva.load()"
        />
      </header>

      <!-- O export em PDF exige um escopo que só entra numa nova autorização. -->
      <div v-if="canva.status.value?.requiresReconnect" class="pm-canva__warn" role="alert">
        <span>{{ tm("canva.reconnect_hint") }}</span>
        <LjButton size="sm" :loading="canva.busy.value" @click="canva.connect()">
          {{ tm("canva.reconnect") }}
        </LjButton>
      </div>
      <!-- No navegador o design abre em www.canva.com, que pede a sessão do site. -->
      <div
        v-if="canva.mode.value === 'site' && canva.status.value?.webSession === false"
        class="pm-canva__warn"
        role="alert"
      >
        <span>{{ tm("canva.web_session_hint") }}</span>
        <LjButton size="sm" :loading="canva.loggingIn.value" @click="canva.webLogin()">
          {{ tm("canva.web_login") }}
        </LjButton>
      </div>
      <p v-if="canva.error.value" class="pm-canva__error pm-canva__error--bar" role="alert">
        {{ canva.error.value }}
      </p>

      <p v-if="canva.loading.value" class="pm-canva__empty">{{ tm("library.loading") }}</p>
      <p v-else-if="!canva.items.value.length" class="pm-canva__empty">{{ tm("canva.empty") }}</p>
      <div v-else class="pm-canva__grid" data-testid="pm-canva-grid">
        <template v-for="item in canva.items.value" :key="`${item.type}:${item.id}`">
          <div
            v-if="item.type === 'folder'"
            class="pm-canva__card"
            role="button"
            tabindex="0"
            :title="item.name"
            @click="canva.openFolder(item)"
            @keydown.enter.self="canva.openFolder(item)"
          >
            <span class="pm-canva__thumb pm-canva__thumb--icon">
              <LjIcon :icon="ICONS.UI.FOLDER" :size="28" />
            </span>
            <span class="pm-canva__name">{{ item.name }}</span>
          </div>
          <LjContextMenu v-else v-bind="menuFor(item)">
            <div
              class="pm-canva__card"
              :class="{
                'pm-canva__card--selected': item.id === selectedId,
                'pm-canva__card--live': isLive(item),
              }"
              role="button"
              tabindex="0"
              :title="item.name"
              :data-testid="`pm-canva-design-${item.id}`"
              @click="preview(item)"
              @dblclick="play(item)"
              @keydown.enter.self="play(item)"
            >
              <span class="pm-canva__thumb">
                <img v-if="item.thumb" :src="item.thumb" alt="" loading="lazy" />
                <LjIcon v-else :icon="ICONS.UI.DASHBOARD" :size="26" />
                <span v-if="canva.exportingId.value === item.id" class="pm-canva__exporting">
                  <LjSpinner :size="20" />
                  {{ tm("canva.exporting") }}
                </span>
                <template v-else>
                  <LjTooltip :text="isLive(item) ? tm('library.stop') : tm('library.play')">
                    <button
                      type="button"
                      class="pm-canva__action"
                      :aria-label="isLive(item) ? tm('library.stop') : tm('library.play')"
                      @click.stop="isLive(item) ? emit('stop') : play(item)"
                      @dblclick.stop
                    >
                      <LjIcon
                        :icon="isLive(item) ? ICONS.ACTIONS.CLOSE : ICONS.PLAYER.PLAY"
                        :size="26"
                      />
                    </button>
                  </LjTooltip>
                  <LjTooltip :text="tm('library.add_to_program')">
                    <button
                      type="button"
                      class="pm-canva__add"
                      :aria-label="tm('library.add_to_program')"
                      @click.stop="void add(item)"
                      @dblclick.stop
                    >
                      <LjIcon :icon="ICONS.ACTIONS.ADD" :size="14" />
                    </button>
                  </LjTooltip>
                </template>
                <span v-if="(item.pageCount ?? 0) > 1" class="pm-canva__badge">
                  {{ tm("canva.pages", { n: item.pageCount }) }}
                </span>
              </span>
              <span class="pm-canva__name">{{ item.name }}</span>
            </div>
          </LjContextMenu>
        </template>
        <p v-if="canva.loadingMore.value" class="pm-canva__more">{{ tm("library.loading") }}</p>
        <LjButton
          v-else-if="canva.continuation.value"
          class="pm-canva__more"
          size="sm"
          variant="ghost"
          @click="canva.loadMore()"
        >
          {{ tm("canva.load_more") }}
        </LjButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  LjButton,
  LjContextMenu,
  LjCopyButton,
  LjIcon,
  LjInput,
  LjSpinner,
  LjTooltip,
  type LjMenuItem,
} from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { useModuleI18n } from "@/composables/useModuleI18n";
import logoCanva from "@/assets/img/canva.png";
import type { ProgramItem } from "@/types/Presentation";
import type { LibraryEntry } from "../composables/useFileLibrary";
import { useCanvaLibrary, type CanvaMode } from "../composables/useCanvaLibrary";
import { canvaSiteItem, fileItem } from "../program/items";
import type { Playable } from "../program/playable";

/**
 * A grade do Canva na aba Mídia (a entrada fica no OnlineSources). Sem
 * credenciais, o formulário de Client ID e secret, como no FreeShow; conectado,
 * os designs por pasta. Um clique leva à prévia, ▶ ou duplo clique projeta, +
 * põe no programa — como PDF exportado ou como a página ao vivo no navegador,
 * conforme o modo do cabeçalho; o menu de contexto oferece os dois.
 */

const props = defineProps<{ livePath: string | null }>();
const emit = defineEmits<{
  preview: [playable: Playable];
  play: [playable: Playable];
  add: [item: ProgramItem];
  stop: [];
}>();

/** Onde se cria o app de integração e se pegam Client ID e secret. */
const PORTAL_URL = "https://www.canva.com/developers/apps";
const MODES: CanvaMode[] = ["pdf", "site"];

const { tm } = useModuleI18n(ModuleEnum.PRESENTATION_MODE);
const canva = useCanvaLibrary();

const clientId = ref("");
const clientSecret = ref("");
const editing = ref(false);
const selectedId = ref<string | null>(null);

async function connectWithForm(): Promise<void> {
  const result = await canva.connect({
    clientId: clientId.value,
    clientSecret: clientSecret.value,
  });
  // Fora do estado assim que gravado: o segredo não fica na tela nem na memória.
  if (canva.hasCredentials.value) clientSecret.value = "";
  if (result === "connected") editing.value = false;
}

function isLive(item: CanvaItem): boolean {
  const path = canva.exportedPath(item);
  return !!path && path === props.livePath;
}

async function withEntry(item: CanvaItem, use: (_entry: LibraryEntry) => void): Promise<void> {
  const entry = await canva.exportDesign(item);
  if (entry) use(entry);
}

function sitePlayable(item: CanvaItem): Playable {
  return { type: "canva", designId: item.id, title: item.name, thumb: item.thumb };
}

/** No navegador a prévia é a miniatura: exportar só para olhar gastaria a cota. */
function preview(item: CanvaItem, mode: CanvaMode = canva.mode.value): void {
  selectedId.value = item.id;
  if (mode === "site") emit("preview", sitePlayable(item));
  else void withEntry(item, (entry) => emit("preview", { type: "file", entry }));
}

function play(item: CanvaItem, mode: CanvaMode = canva.mode.value): void {
  selectedId.value = item.id;
  if (mode === "site") emit("play", sitePlayable(item));
  else void withEntry(item, (entry) => emit("play", { type: "file", entry }));
}

async function add(item: CanvaItem, mode: CanvaMode = canva.mode.value): Promise<void> {
  if (mode === "site") {
    emit("add", canvaSiteItem({ id: item.id, title: item.name, url: await canva.siteUrl(item) }));
    return;
  }
  await withEntry(item, (entry) => emit("add", fileItem(entry, null)));
}

/** Menu do design: o modo escolhido em cima; as duas formas, explícitas, embaixo. */
function menuFor(item: CanvaItem): { quick: LjMenuItem[]; items: LjMenuItem[] } {
  return {
    quick: [
      { label: tm("library.play"), icon: ICONS.PLAYER.PLAY, action: () => play(item) },
      { label: tm("library.preview"), icon: ICONS.UI.EYE, action: () => preview(item) },
    ],
    items: [
      { label: tm("canva.play_pdf"), icon: ICONS.UI.FILE, action: () => play(item, "pdf") },
      { label: tm("canva.play_site"), icon: ICONS.UI.WEB, action: () => play(item, "site") },
      { separator: true },
      { label: tm("canva.add_pdf"), icon: ICONS.ACTIONS.ADD, action: () => void add(item, "pdf") },
      {
        label: tm("canva.add_site"),
        icon: ICONS.ACTIONS.ADD,
        action: () => void add(item, "site"),
      },
    ],
  };
}

onMounted(() => void canva.ensureLoaded());
</script>

<style scoped>
.pm-canva {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.pm-canva__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: var(--lj-space-4);
  color: var(--lj-text-subtle);
  text-align: center;
}

/* Formulário centrado, como o do FreeShow. */
.pm-canva__setup {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-4);
  padding: var(--lj-space-4);
  text-align: center;
}

.pm-canva__form {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  width: 100%;
  max-width: 260px;
}

.pm-canva__doc {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  color: var(--lj-text);
  text-decoration: underline;
}

.pm-canva__doc:hover {
  color: var(--lj-ui-accent);
}

/* Logo e texto alinhados pelo centro: solta no rótulo, a imagem senta na linha de base. */
.pm-canva__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
}

.pm-canva__logo {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
}

.pm-canva__hint {
  margin: 0;
  max-width: 360px;
  font-size: 11.5px;
  color: var(--lj-text-subtle);
}

.pm-canva__uri code {
  font-family: var(--lj-font-mono);
  font-size: 11px;
  padding: 2px var(--lj-space-3);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-sm);
  background: var(--lj-surface-bg-soft);
  overflow-wrap: anywhere;
}

.pm-canva__error {
  margin: 0;
  max-width: 420px;
  color: var(--lj-danger);
}

.pm-canva__error--bar {
  padding: 4px 8px;
  font-size: 12px;
}

.pm-canva__warn {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  padding: 4px 8px;
  font-size: 12px;
  color: var(--lj-warning);
}

.pm-canva__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.pm-canva__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 39px;
  padding: 4px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--lj-surface-border);
}

.pm-canva__crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}

.pm-canva__crumb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 2px 4px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--lj-text);
  font-weight: var(--lj-weight-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.pm-canva__crumb:hover {
  background: var(--lj-hover-bg);
}

.pm-canva__sub {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--lj-text-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}

.pm-canva__modes {
  display: inline-flex;
  flex-shrink: 0;
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  overflow: hidden;
}

.pm-canva__mode {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--lj-text-muted);
  font-size: 11.5px;
  cursor: pointer;
}

.pm-canva__mode + .pm-canva__mode {
  border-left: var(--lj-ui-border);
}

.pm-canva__mode:hover {
  background: var(--lj-hover-bg);
}

.pm-canva__mode--active {
  background: var(--lj-live-active-bg);
  color: var(--lj-text);
}

.pm-canva__mode:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-canva__grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px 8px;
  align-content: start;
}

.pm-canva__more {
  grid-column: 1 / -1;
  justify-self: center;
  margin: 4px 0;
  color: var(--lj-text-subtle);
}

.pm-canva__card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  color: var(--lj-text);
  cursor: pointer;
}

.pm-canva__card:focus-visible {
  outline: none;
}

.pm-canva__card:focus-visible .pm-canva__thumb {
  box-shadow: var(--lj-ui-focus);
}

.pm-canva__thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border: 1px solid var(--lj-surface-border);
  border-radius: 3px;
  background: var(--lj-live-stage-bg);
  color: var(--lj-text-subtle);
  transition: box-shadow 120ms var(--lj-ease);
}

.pm-canva__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.pm-canva__thumb--icon {
  color: var(--lj-orange);
}

.pm-canva__card:hover .pm-canva__thumb {
  border-color: var(--lj-live-select);
}

.pm-canva__card--live .pm-canva__thumb {
  border-color: var(--lj-orange);
  box-shadow: 0 0 0 2px var(--lj-orange);
}

.pm-canva__card--selected:not(.pm-canva__card--live) .pm-canva__thumb {
  border-color: var(--lj-live-select);
  box-shadow: inset 0 0 0 2px var(--lj-live-select);
}

.pm-canva__exporting {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
  font-size: 11px;
}

.pm-canva__badge {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 0 4px;
  border-radius: 2px;
  background: var(--lj-black-alpha-75);
  color: var(--lj-white);
  font-size: 10px;
}

.pm-canva__action,
.pm-canva__add {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  color: var(--lj-white);
  background: var(--lj-black-alpha-40);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 120ms var(--lj-ease),
    background 120ms var(--lj-ease);
}

.pm-canva__action {
  top: 50%;
  left: 50%;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.pm-canva__add {
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
}

.pm-canva__card:hover .pm-canva__action,
.pm-canva__card:hover .pm-canva__add,
.pm-canva__card:focus-within .pm-canva__action,
.pm-canva__card:focus-within .pm-canva__add {
  opacity: 1;
}

.pm-canva__action:hover,
.pm-canva__add:hover {
  background: var(--lj-black-alpha-75);
}

.pm-canva__action:focus-visible,
.pm-canva__add:focus-visible {
  outline: none;
  box-shadow: var(--lj-ui-focus);
}

.pm-canva__name {
  display: -webkit-box;
  overflow: hidden;
  font-size: 11.5px;
  line-height: 1.3;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
