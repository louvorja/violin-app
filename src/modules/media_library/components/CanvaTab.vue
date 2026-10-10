<template>
  <div class="canva">
    <!-- Sem processo main não existe servidor de retorno do OAuth. -->
    <LjEmpty v-if="!isDesktop" :icon="ICONS.UI.LINK" :title="tm('canva.desktop')" />

    <!-- Status ainda não chegou: sem isso o CTA de "conecte" pisca 1 frame. -->
    <div v-else-if="!pronto" class="canva-state">
      <LjSpinner :size="20" />
      <span>{{ tm("canva.checking") }}</span>
    </div>

    <!-- Desconectado: o CTA leva direto para a tela que resolve. -->
    <LjEmpty
      v-else-if="desconectado"
      :icon="ICONS.UI.LINK"
      :title="tm('canva.connect_title')"
      :description="tm('canva.connect_hint')"
    >
      <LjButton size="sm" variant="primary" @click="abrirIntegracoes">
        {{ tm("canva.connect") }}
      </LjButton>
    </LjEmpty>

    <div v-else class="canva-body">
      <div class="canva-bar">
        <LjButton
          v-if="pastaAberta"
          size="sm"
          variant="subtle"
          :icon="ICONS.UI.BACK"
          @click="voltar"
        >
          {{ tm("canva.back") }}
        </LjButton>

        <nav class="canva-crumbs" :aria-label="tm('canva.projects')">
          <button type="button" class="canva-crumb" @click="irParaRaiz">
            {{ tm("canva.projects") }}
          </button>
          <template v-for="(pasta, i) in trilha" :key="pasta.id">
            <LjIcon :icon="ICONS.UI.CHEVRON_RIGHT" :size="12" />
            <button type="button" class="canva-crumb" @click="irPara(i)">
              {{ pasta.name }}
            </button>
          </template>
        </nav>

        <span class="lj-u-spacer" />

        <div class="canva-views" role="group" :aria-label="tm('canva.title')">
          <button
            v-for="opcao in vistas"
            :key="opcao.value"
            type="button"
            class="canva-view"
            :class="{ 'canva-view--active': vista === opcao.value }"
            :aria-pressed="vista === opcao.value"
            @click="trocarVista(opcao.value)"
          >
            {{ opcao.label }}
          </button>
        </div>
      </div>

      <!--
        Só no modo "Projeção do Canva": o token da API não autentica o SITE, e
        sem cookies na partição o `view_url` cai na tela de login do Canva.
        No modo PDF nenhum cookie entra em cena — avisar ali seria mentira.
      -->
      <p
        v-if="modoSite && status?.connected && status.webSession === false"
        class="canva-state canva-aviso"
      >
        {{ tm("canva.web_session_hint") }}
      </p>

      <!-- Export em curso: o invoke do main fica pendente até o job terminar. -->
      <div v-if="exportando" class="canva-state">
        <LjSpinner :size="20" />
        <span>{{ tm("canva.exporting") }}</span>
      </div>

      <!--
        O erro fica FORTE do bloco de conteúdo: ele aparece sozinho ou acima da
        grade. Um "Carregar mais" que falha não pode esconder o que já foi
        carregado — antes, `erro` vinha antes de `itens.length` e a grade sumia.
      -->
      <p v-if="erro" class="canva-state canva-state--erro" role="alert">{{ erro }}</p>

      <div v-if="carregando" class="canva-state">
        <LjSpinner :size="20" />
        <span>{{ tm("canva.loading") }}</span>
      </div>

      <div v-else-if="itens.length" class="canva-grid">
        <div v-for="item in itens" :key="`${item.type}:${item.id}`" class="canva-cell">
          <button type="button" class="canva-item" :title="item.name" @click="abrir(item)">
            <img
              v-if="item.thumb && !thumbsQuebradas.has(item.id)"
              :src="item.thumb"
              class="canva-thumb"
              alt=""
              loading="lazy"
              @error="quebrarThumb(item)"
            />
            <span v-else class="canva-thumb canva-thumb--icon">
              <LjIcon :icon="iconeDe(item)" :size="26" />
            </span>
            <span class="canva-name">{{ item.name }}</span>
            <span class="canva-type">{{ tipoDe(item) }}</span>
          </button>

          <!--
            Selo de cache: IRMÃO do card, não filho — `<button>` dentro de
            `<button>` é HTML inválido, e como irmãos clicar aqui não dispara
            `abrir`. Só no modo PDF, que é o único que consome o cache.
          -->
          <button
            v-if="!modoSite && emCache(item)"
            type="button"
            class="canva-cache"
            :disabled="exportando"
            :title="tm('canva.cached')"
            :aria-label="tm('canva.cached')"
            @click="excluirCache(item)"
          >
            <LjIcon :icon="ICONS.UI.DATABASE" :size="14" />
          </button>
        </div>
      </div>

      <!-- Vazio só quando não há erro: senão seriam as duas mensagens juntas. -->
      <LjEmpty v-else-if="!erro" :icon="ICONS.UI.FOLDER" :title="tm('canva.empty')" />

      <div v-if="continuacao && !carregando" class="canva-more">
        <LjButton size="sm" variant="subtle" :disabled="carregandoMais" @click="carregarMais">
          {{ tm("canva.load_more") }}
        </LjButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton, LjEmpty, LjIcon, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import Platform from "@/helpers/Platform";
import $path from "@/helpers/Path";
import $snackbar from "@/helpers/Snackbar";
import $alert from "@/helpers/Alert";
import Telemetry from "@/helpers/Telemetry";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import $media from "@/composables/useMedia";
import { openSiteWindow } from "@/helpers/ProjectionWindows";

const { t } = useI18n();
/** Mesma ponte do ModuleContainer: tm("x") → modules.media_library.x */
const tm = (key: string, named?: Record<string, unknown>): string =>
  named ? t(`modules.media_library.${key}`, named) : t(`modules.media_library.${key}`);

const isDesktop = Platform.isDesktop;
const api = window.louvorjaApi?.canva;

type Vista = "folder" | "all" | "shared";
interface Trilha {
  id: string;
  name: string;
}

const status = ref<CanvaStatus | null>(null);
/** O status chegou? Sem isto o primeiro frame diz "conecte sua conta". */
const pronto = ref(false);
const vista = ref<Vista>("folder");
const trilha = ref<Trilha[]>([]);
const itens = ref<CanvaItem[]>([]);
const continuacao = ref<string | null>(null);
const carregando = ref(false);
const carregandoMais = ref(false);
/** Export em PDF em andamento no main — trava os cliques até terminar. */
const exportando = ref(false);
const erro = ref("");
/** Miniatura que não carregou: fica o ícone no lugar, com a mesma altura. */
const thumbsQuebradas = ref<Set<string>>(new Set());
/** PDFs guardados no disco: designId → `updated_at` do meta do cache. */
const cache = ref(new Map<string, number>());
/*
 * Geração da listagem atual. Navegar rápido (pasta → voltar → outra vista)
 * pode deixar a resposta antiga chegar por último e sobrescrever a nova.
 */
let geracao = 0;

const vistas = computed(() => [
  { value: "folder" as Vista, label: tm("canva.projects") },
  { value: "all" as Vista, label: tm("canva.all") },
  { value: "shared" as Vista, label: tm("canva.shared") },
]);

const desconectado = computed(() => !status.value?.connected);
const pastaAberta = computed(() => trilha.value.length > 0);
/**
 * Como o design é projetado (Opções → Integrações). Reativo: o `$userdata.get`
 * lê o store do Pinia, então trocar de modo na outra tela reflete sem reabrir
 * a aba.
 */
const modoSite = computed(
  () => $userdata.get<string>(KEYS.OPTIONS.INTEGRATIONS.CANVA.PROJECT_AS, "pdf") === "site"
);

function abrirIntegracoes(): void {
  window.dispatchEvent(new CustomEvent("louvorja:open-integrations"));
}

function iconeDe(item: CanvaItem): string {
  if (item.type === "folder") return ICONS.UI.FOLDER;
  if (item.type === "image") return ICONS.UI.IMAGE_OUTLINE;
  return ICONS.UI.DASHBOARD;
}

function tipoDe(item: CanvaItem): string {
  if (item.type === "folder") return tm("canva.type_folder");
  if (item.type === "image") return tm("canva.type_image");
  return (item.pageCount || 0) > 1
    ? tm("canva.type_design_pages", { n: item.pageCount })
    : tm("canva.type_design");
}

/** Thumbnail quebrada vira o ícone do tipo — esconder a img encolheria o card. */
function quebrarThumb(item: CanvaItem): void {
  const proximo = new Set(thumbsQuebradas.value);
  proximo.add(item.id);
  thumbsQuebradas.value = proximo;
}

/**
 * PDFs já guardados no disco, uma chamada por atualização da grade.
 *
 * Nunca rejeita: um IPC de leitura que falha não pode esconder a lista — o selo
 * é cortesia, não conteúdo.
 */
async function carregarCache(): Promise<void> {
  if (!api) return;
  try {
    const mapa = await api.cachedPdfs();
    cache.value = new Map(Object.entries(mapa || {}));
  } catch {
    cache.value = new Map();
  }
}

/**
 * O PDF deste design está guardado E ainda vale?
 *
 * "Vale" é o que o `exportarPdf` checa antes de servir do disco: o `updated_at`
 * do meta tem que bater com o do design. Editou no Canva → o selo some sozinho
 * no próximo carregamento da lista. Sem `updated_at` no item não dá para
 * validar — aí confia no arquivo, porque esconder o selo por um payload antigo
 * seria pior.
 */
function emCache(item: CanvaItem): boolean {
  if (item.type !== "design") return false;
  const guardado = cache.value.get(item.id);
  if (guardado === undefined) return false;
  if (item.updatedAt != null && guardado !== item.updatedAt) return false;
  return true;
}

/**
 * Pergunta antes de apagar: o próximo clique no design reexporta — e isso
 * gasta um export da cota do Canva.
 */
function excluirCache(item: CanvaItem): void {
  if (!api) return;
  $alert.yesno(
    {
      title: tm("canva.cache_clear_title"),
      text: tm("canva.cache_clear_text", { name: item.name }),
    },
    (async (btn: string) => {
      if (btn !== "yes") return;
      try {
        const r = await api.clearCachedPdf(item.id);
        if (!r.ok) {
          $snackbar.warning(r.message || tm("canva.cache_clear_failed"));
          return;
        }
        cache.value.delete(item.id);
        $snackbar.success(tm("canva.cache_cleared"));
      } catch (e) {
        $snackbar.warning((e as Error).message || tm("canva.cache_clear_failed"));
      }
      /* `Alert.yesno` infere `() => void` do default — o cast é do padrão do app. */
    }) as unknown as (..._args: unknown[]) => unknown
  );
}

async function recarregar(): Promise<void> {
  if (!api) return;
  const minhaGeracao = ++geracao;
  const iniciadoEm = Date.now();
  const ondeEstamos = () => (vista.value === "folder" ? "folder" : "designs");
  carregando.value = true;
  erro.value = "";
  try {
    const payload =
      vista.value === "folder"
        ? { folderId: trilha.value.at(-1)?.id || "root", continuation: null }
        : {
            view: "designs",
            ownership: vista.value === "shared" ? "shared" : "any",
            continuation: null,
          };

    const [resultado] = await Promise.all([api.items(payload), carregarCache()]);
    if (minhaGeracao !== geracao) return;
    if (!resultado.ok) {
      erro.value = resultado.message || tm("canva.error");
      itens.value = [];
      continuacao.value = null;
      Telemetry.track("canva_designs_load_failed", {
        view: payload.view ?? "folder",
        reason: resultado.code || "unknown",
      });
      return;
    }
    itens.value = resultado.items || [];
    continuacao.value = resultado.continuation || null;
    /*
     * Só a lista inicial e a navegação por pasta — o "Carregar mais" é paginação
     * do MESMO pedido e contaria duas vezes quem já estava vendo a grade.
     * Nada de id/título: só contagem e códigos.
     */
    Telemetry.track("canva_designs_loaded", {
      view: payload.view ?? "folder",
      count: (resultado.items || []).length,
      continuation: Boolean(resultado.continuation),
      duration_ms: Date.now() - iniciadoEm,
    });
  } catch (e) {
    if (minhaGeracao === geracao) erro.value = (e as Error).message || tm("canva.error");
    Telemetry.track("canva_designs_load_failed", { view: ondeEstamos(), reason: "exception" });
  } finally {
    if (minhaGeracao === geracao) carregando.value = false;
  }
}

async function carregarMais(): Promise<void> {
  if (!api || !continuacao.value || carregandoMais.value) return;
  const minhaGeracao = geracao;
  carregandoMais.value = true;
  try {
    const payload =
      vista.value === "folder"
        ? { folderId: trilha.value.at(-1)?.id || "root", continuation: continuacao.value }
        : {
            view: "designs",
            ownership: vista.value === "shared" ? "shared" : "any",
            continuation: continuacao.value,
          };
    const resultado = await api.items(payload);
    if (minhaGeracao !== geracao) return;
    if (!resultado.ok) {
      erro.value = resultado.message || tm("canva.error");
      return;
    }
    itens.value = [...itens.value, ...(resultado.items || [])];
    continuacao.value = resultado.continuation || null;
  } catch (e) {
    /* Sem isto, IPC que falha aqui virava botão morto, sem nenhum aviso. */
    if (minhaGeracao === geracao) erro.value = (e as Error).message || tm("canva.error");
  } finally {
    carregandoMais.value = false;
  }
}

function trocarVista(proxima: Vista): void {
  /*
   * Clicar na vista já ativa também recarrega. Sem isso, uma falha na raiz
   * deixava o operador sem saída: nenhuma das opções da barra respondia e a
   * mensagem ficava grudada até trocar de aba.
   */
  vista.value = proxima;
  trilha.value = [];
  void recarregar();
}

function irParaRaiz(): void {
  /* Mesma lógica: o item de trilha da raiz é o "tentar de novo" da tela. */
  trilha.value = [];
  void recarregar();
}

function irPara(indice: number): void {
  trilha.value = trilha.value.slice(0, indice + 1);
  void recarregar();
}

function voltar(): void {
  trilha.value = trilha.value.slice(0, -1);
  void recarregar();
}

/**
 * Exclusão mútua: só um item no telão.
 *
 * `close(true)` faz o trabalho síncrono mas só ENFILEIRA o fechamento das
 * janelas; a espera tem que ser da MESMA fila (`closeProjectionStage`), senão
 * a ação enfileirada roda depois da URL abrir e fecha a janela que acabou de
 * entrar. Mesmo caminho da liturgia.
 */
async function projeta(url: string): Promise<void> {
  if (!url) return;
  await $media.close(true);
  await $media.closeProjectionStage();
  await openSiteWindow(url, "canva");
}

async function abrir(item: CanvaItem): Promise<void> {
  if (item.type === "folder") {
    trilha.value = [...trilha.value, { id: item.id, name: item.name }];
    void recarregar();
    return;
  }
  /* Um export por vez: dois jobs simultâneos gastam o limite do Canva. */
  if (exportando.value) return;
  /* Erro anterior não pode sobreviver a um clique que deu certo. */
  erro.value = "";

  try {
    if (item.type === "design") {
      /*
       * Sem API não há como exportar nem buscar o link. Sair em silêncio faria
       * o clique parecer quebrado — diz o que falta.
       */
      if (!api) {
        erro.value = tm("canva.desktop");
        return;
      }
      /*
       * O modo vem da tela de Integrações e é lido NO CLIQUE, não guardado
       * aqui — trocar de modo na outra tela tem que valer sem fechar a aba.
       */
      const modo = $userdata.get<string>(KEYS.OPTIONS.INTEGRATIONS.CANVA.PROJECT_AS, "pdf");
      const mode = modo === "site" ? "site" : "pdf";
      Telemetry.track("canva_project_requested", { mode });
      if (mode === "site") await projetarAoVivo(item);
      else await projetarComoPdf(item);
      return;
    }
    /* Imagem: não tem view_url própria — quem abre é o thumbnail. */
    await projeta(item.url || item.thumb || "");
  } catch (e) {
    erro.value = (e as Error).message || tm("canva.error");
  }
}

/**
 * Modo "PDF" — o caminho do FreeShow adaptado: exporta no main e projeta com o
 * leitor do app. Tela cheia, setas, operador e tela de retorno vêm de graça,
 * sem sessão web do Canva e sem depender do atalho dele.
 */
async function projetarComoPdf(item: CanvaItem): Promise<void> {
  if (!api) return;
  exportando.value = true;
  erro.value = "";
  const iniciadoEm = Date.now();
  try {
    const r = await api.exportPdf(item.id);
    const decorrido = () => Date.now() - iniciadoEm;
    if (!r.ok) {
      erro.value = r.message || tm("canva.export_error");
      Telemetry.track("canva_export_completed", {
        ok: false,
        reason: r.code || "export_failed",
        duration_ms: decorrido(),
      });
      return;
    }
    if (!r.path) {
      erro.value = tm("canva.export_error");
      Telemetry.track("canva_export_completed", {
        ok: false,
        reason: "no_path",
        duration_ms: decorrido(),
      });
      return;
    }
    /*
     * Cache é uso, não ruído: mede quantos exports o Canva fez de verdade.
     * Só códigos e números — nada de id nem título do design.
     */
    Telemetry.track("canva_export_completed", {
      ok: true,
      cached: r.cached === true,
      quality_fallback: r.qualityFallback === true,
      ...(r.quality ? { quality: r.quality } : {}),
      ...(typeof r.pageCount === "number" ? { page_count: r.pageCount } : {}),
      duration_ms: decorrido(),
    });
    /* O meta acabou de nascer/atualizar: o selo acende sem trocar de aba. */
    void carregarCache();
    /*
     * O Canva recusou o `pro` e refez em `regular`: o PDF é bom, mas não é o
     * que o operador pediu — dizer aqui vale mais do que ele só perceber a
     * qualidade na hora de projetar.
     */
    if (r.qualityFallback) {
      $snackbar.warning(t("options.integrations.canva.quality_fallback"), {
        key: "canva-quality-fallback",
        timeout: 8000,
      });
    }
    /*
     * `pageCount` vai junto: é a declaração do Canva sobre o tamanho do
     * design, e a janela de projeção compara com o que o pdf.js realmente
     * abriu — é a prova de que o export veio inteiro.
     */
    await $media.projectFile({
      url: $path.local(r.path),
      type: "pdf",
      title: item.name,
      pageCount: r.pageCount,
    });
  } catch (e) {
    /* O `abrir` mostra o erro na tela; aqui só garantimos que o evento sai. */
    Telemetry.track("canva_export_completed", {
      ok: false,
      reason: "exception",
      duration_ms: Date.now() - iniciadoEm,
    });
    throw e;
  } finally {
    exportando.value = false;
  }
}

/** Modo "Projeção do Canva" — a página ao vivo, na janela de URL. */
async function projetarAoVivo(item: CanvaItem): Promise<void> {
  if (!api) return;
  /*
   * O `view_url` do Canva é temporário (JWT com expiração): o da lista já
   * pode estar vencido quando o operador clica. O main busca um novo.
   * Sem API não há link nenhum — projetar o thumbnail aqui seria enganoso.
   */
  const resultado = await api.designUrl(item.id);
  if (!resultado.ok) {
    erro.value = resultado.message || tm("canva.error");
    /*
     * O ÚNICO caso de modo site que nunca chega ao `openSiteWindow` — e
     * portanto sem `site_projected`. Sem isto o clique falharia em silêncio.
     */
    Telemetry.track("canva_site_link_failed", { reason: resultado.code || "unknown" });
    return;
  }
  await projeta(resultado.url || "");
}

async function carregarStatus(): Promise<void> {
  if (!api) {
    pronto.value = true;
    return;
  }
  try {
    status.value = await api.status();
    if (status.value?.connected) await recarregar();
  } catch (e) {
    erro.value = (e as Error).message || tm("canva.error");
  } finally {
    pronto.value = true;
  }
}

onMounted(() => {
  /*
   * O `<CanvaTab v-if="libraryFilter === 'canva'">` monta só quando o operador
   * escolhe a aba — este é o sinal de "alguém foi usar o Canva".
   */
  Telemetry.track("canva_tab_opened");
  void carregarStatus();
});
</script>

<style scoped>
.canva {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  min-width: 0;
}

.canva-body {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  min-width: 0;
}

.canva-bar {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  flex-wrap: wrap;
}

.canva-crumbs {
  display: flex;
  align-items: center;
  gap: var(--lj-space-2);
  min-width: 0;
  flex-wrap: wrap;
  color: var(--lj-text-muted);
}

.canva-crumb {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  max-width: 18ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canva-crumb:hover {
  color: var(--lj-text);
  text-decoration: underline;
}

.canva-views {
  display: flex;
  gap: var(--lj-space-2);
}

.canva-view {
  border: var(--lj-ui-border);
  background: var(--lj-surface-bg);
  color: var(--lj-text-muted);
  border-radius: var(--lj-ui-radius);
  padding: 0 var(--lj-space-4);
  height: var(--lj-ui-h-md);
  font: inherit;
  font-size: var(--lj-text-sm);
  cursor: pointer;
}

.canva-view--active {
  background: var(--lj-appmenu-sidebar-active-bg, var(--lj-surface-bg-soft));
  color: var(--lj-text);
  border-color: var(--lj-ui-accent);
}

.canva-state {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  color: var(--lj-text-muted);
  padding: var(--lj-space-6) 0;
}

.canva-state--erro {
  color: var(--lj-danger, #d7503f);
}

.canva-aviso {
  color: var(--lj-warning, #c98a1b);
}

.canva-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--lj-space-5);
}

/*
 * A célula é o item do grid; o card e o selo de cache são IRMÃOS dentro dela.
 * `<button>` dentro de `<button>` é HTML inválido, e como irmãos clicar no
 * selo não dispara `abrir` — que é o que o operador espera ao apagar o cache.
 */
.canva-cell {
  position: relative;
  display: grid;
}

/* Canto de cima da thumb, legível sobre qualquer miniatura. */
.canva-cache {
  position: absolute;
  top: calc(var(--lj-space-3) + 6px);
  right: calc(var(--lj-space-3) + 6px);
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--lj-radius-sm);
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  cursor: pointer;
}

.canva-cache:hover {
  background: rgba(0, 0, 0, 0.82);
}

.canva-cache:disabled {
  opacity: 0.55;
  cursor: default;
}

.canva-cache:focus-visible {
  outline: 2px solid var(--lj-ui-accent);
  outline-offset: 2px;
}

.canva-item {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-2);
  padding: var(--lj-space-3);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg);
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--lj-text);
  min-width: 0;
  transition:
    border-color var(--lj-transition-fast),
    background var(--lj-transition-fast);
}

.canva-item:hover {
  border-color: var(--lj-ui-accent);
  background: var(--lj-surface-bg-soft);
}

.canva-thumb {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--lj-radius-sm);
  background: var(--lj-surface-bg-soft);
}

.canva-thumb--icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lj-text-subtle);
}

.canva-name {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.canva-type {
  font-size: var(--lj-text-xs, 0.75rem);
  color: var(--lj-text-subtle);
}

.canva-more {
  display: flex;
  justify-content: center;
}
</style>
