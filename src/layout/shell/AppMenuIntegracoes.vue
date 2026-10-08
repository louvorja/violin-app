<template>
  <div class="opt">
    <section class="opt-section">
      <h3 class="opt-section-title">
        {{ $t("options.integrations.title") }}
      </h3>
      <p class="opt-hint">{{ $t("options.integrations.hint") }}</p>

      <!-- Sem processo main não existe servidor de retorno do OAuth. -->
      <p v-if="!isDesktop" class="opt-hint canva-block">
        {{ $t("options.integrations.canva.desktop_only") }}
      </p>

      <template v-else>
        <!-- Credenciais ------------------------------------------------- -->
        <div class="opt-row opt-row--col canva-block">
          <span class="opt-label" style="margin-bottom: 20px">
            <img class="opt-canva-logo" :src="logoCanva" alt="Canva" width="20" height="20" />
            {{ $t("options.integrations.canva.credentials") }}

            <LjButton
              size="sm"
              variant="subtle"
              style="margin-left: 10px"
              :icon="ICONS.UI.INFORMATION_OUTLINE"
              @click="instrucoes"
            >
              {{ $t("options.integrations.instructions") }}
            </LjButton>
          </span>
          <div v-if="!credenciaisSalvas || editando" class="canva-form">
            <div class="canva-field">
              <label class="opt-hint canva-input-label" for="canva-client-id">
                {{ $t("options.integrations.canva.client_id") }}
              </label>
              <LjInput
                id="canva-client-id"
                v-model="clientId"
                size="sm"
                :disabled="ocupado"
                autocomplete="off"
                :placeholder="$t('options.integrations.canva.client_id_placeholder')"
              />
            </div>

            <div class="canva-field">
              <label class="opt-hint canva-input-label" for="canva-client-secret">
                {{ $t("options.integrations.canva.client_secret") }}
              </label>
              <!--
                Nunca reexibido: depois de salvo o valor sai do estado deste
                componente e não existe caminho de volta — o main só devolve
                `hasCredentials`.
              -->
              <LjInput
                id="canva-client-secret"
                v-model="clientSecret"
                size="sm"
                type="password"
                :disabled="ocupado"
                autocomplete="new-password"
                placeholder="cnvca…"
              />
            </div>

            <div class="canva-actions">
              <LjButton size="sm" variant="primary" :disabled="ocupado" @click="salvarCredenciais">
                {{ $t("options.integrations.canva.save_credentials") }}
              </LjButton>
              <LjButton
                v-if="credenciaisSalvas"
                size="sm"
                variant="ghost"
                :disabled="ocupado"
                @click="editando = false"
              >
                {{ $t("options.integrations.cancel") }}
              </LjButton>
            </div>

            <p class="opt-hint">{{ $t("options.integrations.canva.credentials_hint") }}</p>
          </div>

          <div v-else class="canva-saved">
            <LjIcon :icon="ICONS.UI.CHECK" :size="16" />
            <span>{{ $t("options.integrations.canva.credentials_saved") }}</span>
            <LjButton size="sm" variant="subtle" :disabled="ocupado" @click="editando = true">
              {{ $t("options.integrations.canva.change_credentials") }}
            </LjButton>
          </div>

          <p v-if="erro" class="opt-hint canva-erro" role="alert">{{ erro }}</p>
        </div>

        <!-- Conexão ------------------------------------------------------ -->
        <div class="opt-row canva-block">
          <span class="opt-label">{{ $t("options.integrations.connection") }}</span>
          <div class="canva-actions">
            <span class="canva-status" :class="{ 'canva-status--on': status?.connected }">
              <LjIcon :icon="status?.connected ? ICONS.UI.CHECK : ICONS.ACTIONS.CLOSE" :size="14" />
              {{ statusTexto }}
            </span>
            <LjButton
              v-if="!status?.connected"
              size="sm"
              variant="primary"
              :disabled="ocupado || !credenciaisSalvas"
              @click="conectar"
            >
              {{
                conectando
                  ? $t("options.integrations.connecting")
                  : $t("options.integrations.connect")
              }}
            </LjButton>
            <LjButton v-else size="sm" variant="danger" :disabled="ocupado" @click="desconectar">
              {{ $t("options.integrations.disconnect") }}
            </LjButton>
          </div>
        </div>

        <!--
          Como o design vai para o telão. Duas opções com pros e contras
          visíveis: o operador decide entre "nunca falha" e "fica ao vivo".
        -->
        <div class="opt-row opt-row--col canva-block">
          <span class="opt-label">{{ $t("options.integrations.canva.project_as") }}</span>
          <p class="opt-hint">{{ $t("options.integrations.canva.project_as_hint") }}</p>

          <div
            class="canva-modes"
            role="radiogroup"
            :aria-label="$t('options.integrations.canva.project_as')"
          >
            <label
              class="opt-checkbox canva-mode"
              :class="{ 'canva-mode--active': projectAs === 'pdf' }"
            >
              <input
                type="radio"
                name="canva-project-as"
                value="pdf"
                :checked="projectAs === 'pdf'"
                :disabled="ocupado"
                @change="setProjectAs('pdf')"
              />
              <span class="canva-mode__body">
                <span class="canva-mode__title">
                  {{ $t("options.integrations.canva.project_as_pdf") }}
                </span>
                <span class="opt-hint canva-mode__hint">
                  {{ $t("options.integrations.canva.project_as_pdf_hint") }}
                </span>
                <span class="opt-hint canva-mode__hint" style="margin-top: 10px">
                  {{ $t("components.ui.details") }}
                </span>
                <span class="opt-hint canva-mode__hint">
                  {{ $t("options.integrations.canva.project_as_pdf_details") }}
                </span>
              </span>
            </label>

            <label
              class="opt-checkbox canva-mode"
              :class="{ 'canva-mode--active': projectAs === 'site' }"
            >
              <input
                type="radio"
                name="canva-project-as"
                value="site"
                :checked="projectAs === 'site'"
                :disabled="ocupado"
                @change="setProjectAs('site')"
              />
              <span class="canva-mode__body">
                <span class="canva-mode__title">
                  {{ $t("options.integrations.canva.project_as_site") }}
                </span>
                <span class="opt-hint canva-mode__hint">
                  {{ $t("options.integrations.canva.project_as_site_hint") }}
                </span>
                <span class="opt-hint canva-mode__hint" style="margin-top: 10px">
                  {{ $t("components.ui.details") }}
                </span>
                <span class="opt-hint canva-mode__hint">
                  {{ $t("options.integrations.canva.project_as_site_details") }}
                </span>
              </span>
            </label>
          </div>
        </div>

        <!--
          Aviso ANTES do clique: o token não tem o escopo que o export exige, e
          o escopo só entra numa nova autorização — sem isto o operador só ia
          descobrir no meio da projeção, com o 403 cru do Canva.
        -->
        <p
          v-if="projectAs === 'pdf' && status?.requiresReconnect === true"
          class="opt-hint canva-aviso"
          role="alert"
        >
          {{ $t("options.integrations.canva.scope_missing") }}
        </p>

        <!--
          Qualidade do export — só existe no modo PDF, que é o único que usa a
          API. `regular` é o default: funciona em qualquer conta. `pro` pede a
          saída premium e o Canva pode recusar quando o design tem elemento
          premium não pago; aí o app refaz em `regular` e avisa pelo snackbar,
          em vez de o operador descobrir na hora de projetar.
        -->
        <div v-if="projectAs === 'pdf'" class="opt-row opt-row--col canva-block">
          <span class="opt-label">{{ $t("options.integrations.canva.export_quality") }}</span>
          <p class="opt-hint">{{ $t("options.integrations.canva.export_quality_hint") }}</p>

          <div
            class="canva-modes"
            role="radiogroup"
            :aria-label="$t('options.integrations.canva.export_quality')"
          >
            <label
              class="opt-checkbox canva-mode"
              :class="{ 'canva-mode--active': exportQuality === 'regular' }"
            >
              <input
                type="radio"
                name="canva-export-quality"
                value="regular"
                :checked="exportQuality === 'regular'"
                :disabled="ocupado"
                @change="setExportQuality('regular')"
              />
              <span class="canva-mode__body">
                <span class="canva-mode__title">
                  {{ $t("options.integrations.canva.quality_regular") }}
                </span>
                <span class="opt-hint canva-mode__hint">
                  {{ $t("options.integrations.canva.quality_regular_hint") }}
                </span>
              </span>
            </label>

            <label
              class="opt-checkbox canva-mode"
              :class="{ 'canva-mode--active': exportQuality === 'pro' }"
            >
              <input
                type="radio"
                name="canva-export-quality"
                value="pro"
                :checked="exportQuality === 'pro'"
                :disabled="ocupado"
                @change="setExportQuality('pro')"
              />
              <span class="canva-mode__body">
                <span class="canva-mode__title">
                  {{ $t("options.integrations.canva.quality_pro") }}
                </span>
                <span class="opt-hint canva-mode__hint">
                  {{ $t("options.integrations.canva.quality_pro_hint") }}
                </span>
              </span>
            </label>
          </div>
        </div>

        <!--
          Sessão do SITE — só existe para quem projeta a página do Canva. No
          modo PDF o design vem da API e nenhum cookie é usado.
          O token autentica api.canva.com; o design abre em www.canva.com, que
          pede cookie. É esta sessão que a janela de URL e a tela de retorno
          herdam.
        -->
        <div v-if="projectAs === 'site'" class="opt-row canva-block">
          <span class="opt-label">{{ $t("options.integrations.canva.web_session") }}</span>
          <div class="canva-actions">
            <span class="canva-status" :class="{ 'canva-status--on': status?.webSession }">
              <LjIcon
                :icon="status?.webSession ? ICONS.UI.CHECK : ICONS.ACTIONS.CLOSE"
                :size="14"
              />
              {{ sessaoTexto }}
            </span>
            <LjButton size="sm" variant="primary" :disabled="ocupado" @click="fazerLoginNoCanva">
              {{
                logando
                  ? $t("options.integrations.canva.web_login_waiting")
                  : $t("options.integrations.canva.web_login")
              }}
            </LjButton>
            <!--
              Só a SESSÃO do site sai daqui — o token da API continua valendo e
              continua sendo revogado pelo "Desconectar" da linha de cima.
            -->
            <LjButton
              size="sm"
              variant="danger"
              :disabled="ocupado || !status?.webSession"
              @click="fazerLogoutNoCanva"
            >
              {{ $t("options.integrations.canva.web_logout") }}
            </LjButton>
          </div>
        </div>

        <p v-if="projectAs === 'site'" class="opt-hint">
          {{ $t("options.integrations.canva.web_login_hint") }}
        </p>

        <!-- Redirect URL: é ela que o portal exige registrar ---------------- -->
        <div class="opt-row canva-block">
          <span class="opt-label">{{ $t("options.integrations.canva.redirect_uri") }}</span>
          <!--
            O campo INTEIRO é o botão: clicar na URL já copia. Os dois lugares
            que mostram o endereço (aqui e nas instruções) usam o mesmo valor —
            é ele que o portal exige registrar.
          -->
          <LjCopyButton
            v-if="status?.redirectUri"
            :value="status.redirectUri"
            class="canva-uri"
            :title="$t('options.integrations.copy')"
          >
            <code class="canva-uri-code">{{ status.redirectUri }}</code>
          </LjCopyButton>
          <code v-else class="canva-uri-code">—</code>
        </div>

        <!--
          Instruções num diálogo de verdade, não numa string: o passo do portal
          tem que ser um link clicável e a Redirect URL tem que estar num
          CopyButton — `$alert.message` escapa tudo e só rende <br>.
        -->
        <LjDialog
          v-model="mostrarInstrucoes"
          size="md"
          :title="$t('options.integrations.canva.instructions_title')"
          :icon="ICONS.UI.LINK"
        >
          <ol class="canva-steps">
            <li>
              <span class="canva-step-text">
                {{ $t("options.integrations.canva.step_portal") }}
              </span>
              <a class="canva-link" :href="PORTAL_URL" target="_blank" rel="noopener noreferrer">
                {{ PORTAL_URL }}
                <LjIcon :icon="ICONS.UI.OPEN_IN_NEW" :size="13" />
              </a>
            </li>
            <li>{{ $t("options.integrations.canva.step_create") }}</li>
            <li>{{ $t("options.integrations.canva.step_rest") }}</li>
            <li>{{ $t("options.integrations.canva.step_scopes") }}</li>
            <li>
              <span class="canva-step-text">
                {{ $t("options.integrations.canva.step_redirect") }}
              </span>
              <LjCopyButton
                v-if="status?.redirectUri"
                :value="status.redirectUri"
                class="canva-uri canva-uri--inline"
                :title="$t('options.integrations.copy')"
              >
                <code class="canva-uri-code">{{ status.redirectUri }}</code>
              </LjCopyButton>
            </li>
            <li>{{ $t("options.integrations.canva.step_credentials") }}</li>
            <li>{{ $t("options.integrations.canva.step_save") }}</li>
            <li>{{ $t("options.integrations.canva.step_connect") }}</li>
            <li>{{ $t("options.integrations.canva.step_login") }}</li>
          </ol>
        </LjDialog>

        <p v-if="status && !status.keyOk" class="opt-hint canva-erro" role="alert">
          {{ status.error || $t("options.integrations.canva.key_warning") }}
        </p>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LjButton, LjCopyButton, LjDialog, LjIcon, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import Platform from "@/helpers/Platform";
import $alert from "@/helpers/Alert";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import logoCanva from "@/assets/img/canva.png";

const { t } = useI18n();

/** Portal do Canva — o link dos passos abre no navegador do sistema. */
const PORTAL_URL = "https://www.canva.com/developers/apps";

/** Modos de projeção de um design. `pdf` é o default: não depende de gesto de terceiro. */
const MODO_PDF = "pdf";
const MODO_SITE = "site";

/** Qualidade do export. `regular` é o default e o único que roda em qualquer conta. */
const QUALIDADE_REGULAR = "regular";
const QUALIDADE_PRO = "pro";

/*
 * Motivo para a telemetria: só CÓDIGO. A `message` do Canva pode carregar URL
 * ou HTML da página, e o evento tem que ser opaco — ver "Telemetria do
 * Site/Canva" em docs/architecture.md.
 */
function motivoDe(resultado: { code?: unknown } | null | undefined): string {
  return typeof resultado?.code === "string" && resultado.code ? resultado.code : "unknown";
}

const MOTIVO_EXCECAO = "exception";

function setProjectAs(valor: string): void {
  const de = projectAs.value;
  projectAs.value = valor;
  $userdata.set(KEYS.OPTIONS.INTEGRATIONS.CANVA.PROJECT_AS, valor);
  if (de !== valor) Telemetry.track("canva_project_as_changed", { from: de, to: valor });
}

function setExportQuality(valor: string): void {
  if (ocupado.value) return;
  const limpo = valor === QUALIDADE_PRO ? QUALIDADE_PRO : QUALIDADE_REGULAR;
  const de = exportQuality.value;
  exportQuality.value = limpo;
  $userdata.set(KEYS.OPTIONS.INTEGRATIONS.CANVA.EXPORT_QUALITY, limpo);
  if (de !== limpo) Telemetry.track("canva_export_quality_changed", { from: de, to: limpo });
}

const isDesktop = Platform.isDesktop;
const api = window.louvorjaApi?.canva;

const status = ref<CanvaStatus | null>(null);
const clientId = ref("");
const clientSecret = ref("");
const editando = ref(false);
/** Gravação de credenciais / desconexão: trava campos e botões. */
const gravando = ref(false);
/** Só o fluxo OAuth — é o único que muda o texto da linha de status. */
const conectando = ref(false);
/** Login no SITE (cookies da partição da projeção), em janela própria. */
const logando = ref(false);
/** Saída do SITE (apagar os cookies) — mesma família do login, botão distinto. */
const saindo = ref(false);
/** Diálogo de instruções do portal. */
const mostrarInstrucoes = ref(false);
/** Como um design é projetado: PDF exportado ou a página do Canva ao vivo. */
const projectAs = ref<string>(MODO_PDF);
/** Qualidade pedida ao export em PDF. */
const exportQuality = ref<string>(QUALIDADE_REGULAR);
const ocupado = computed(() => gravando.value || conectando.value || logando.value || saindo.value);
const erro = ref("");

const credenciaisSalvas = computed(() => Boolean(status.value?.hasCredentials));

const statusTexto = computed(() => {
  if (conectando.value) return t("options.integrations.connecting");
  if (status.value?.connected) {
    const nome = status.value.profile?.trim();
    return nome
      ? t("options.integrations.connected_as", { name: nome })
      : t("options.integrations.connected");
  }
  return t("options.integrations.not_connected");
});

/**
 * Selo da sessão do SITE, com o nome de quem logou.
 *
 * O nome vem do perfil do OAuth (gravado ao conectar): é a mesma conta que a
 * projeção usa, então "ativa como {nome}" é literal — se faltar, cai no texto
 * sem nome em vez de renderizar "como ".
 */
const sessaoTexto = computed(() => {
  if (!status.value?.webSession) return t("options.integrations.canva.web_session_off");
  const nome = status.value.profile?.trim();
  return nome
    ? t("options.integrations.canva.web_session_on", { name: nome })
    : t("options.integrations.canva.web_session_active");
});

async function refresh(): Promise<void> {
  if (!api) return;
  try {
    status.value = await api.status();
    erro.value = status.value?.error || "";
  } catch (e) {
    erro.value = (e as Error)?.message || t("options.integrations.canva.error_generic");
  }
}

/*
 * Nenhuma rotina deixa rejeição escapar: um `invoke` que falha (janela em
 * transição, main reiniciando) viraria um unhandled rejection sem nada na
 * tela — e o operador não saberia por que o botão não fez nada.
 */
async function salvarCredenciais(): Promise<void> {
  if (!api) return;
  erro.value = "";
  gravando.value = true;
  try {
    const resultado = await api.setCredentials(clientId.value, clientSecret.value);
    if (!resultado.ok) {
      erro.value = resultado.message || t("options.integrations.canva.error_generic");
      Telemetry.track("canva_credentials_failed", { reason: motivoDe(resultado) });
      return;
    }
    /* Fora do estado assim que gravado: o segredo não fica na tela nem na memória. */
    clientSecret.value = "";
    editando.value = false;
    Telemetry.track("canva_credentials_saved");
    $snackbar.success(t("options.integrations.canva.saved_ok"));
    await refresh();
  } catch (e) {
    erro.value = (e as Error)?.message || t("options.integrations.canva.error_generic");
    Telemetry.track("canva_credentials_failed", { reason: MOTIVO_EXCECAO });
  } finally {
    gravando.value = false;
  }
}

async function conectar(): Promise<void> {
  if (!api) return;
  erro.value = "";
  conectando.value = true;
  try {
    const resultado = await api.connect();
    if (!resultado.ok) {
      erro.value = resultado.message || t("options.integrations.canva.error_generic");
      Telemetry.track("canva_connect_failed", { reason: motivoDe(resultado) });
      $alert.message(erro.value);
      return;
    }
    Telemetry.track("canva_connected");
    $snackbar.success(t("options.integrations.canva.connected_ok"));
    await refresh();
  } catch (e) {
    erro.value = (e as Error)?.message || t("options.integrations.canva.error_generic");
    Telemetry.track("canva_connect_failed", { reason: MOTIVO_EXCECAO });
    $alert.message(erro.value);
  } finally {
    conectando.value = false;
  }
}

/*
 * Login no SITE do Canva, numa janela normal (não na de projeção), na MESMA
 * sessão que a janela de URL e a tela de retorno usam. O token da API não
 * serve aqui: www.canva.com autentica por cookie, e o OAuth aconteceu no
 * navegador do sistema.
 */
async function fazerLoginNoCanva(): Promise<void> {
  if (!api) return;
  erro.value = "";
  logando.value = true;
  try {
    const resultado = await api.webLogin();
    if (resultado.ok) {
      Telemetry.track("canva_web_login_succeeded");
      /* Popup pedida pelo operador: diz que deu certo e que a janela fechou. */
      $alert.message(t("options.integrations.canva.web_login_ok"));
      await refresh();
      return;
    }
    Telemetry.track("canva_web_login_failed", { reason: motivoDe(resultado) });
    const motivo =
      (
        {
          web_login_failed: t("options.integrations.canva.web_login_failed"),
          web_login_network: t("options.integrations.canva.web_login_network"),
          web_login_unavailable: t("options.integrations.canva.web_login_unavailable"),
        } as Record<string, string>
      )[resultado.code ?? ""] ||
      resultado.message ||
      t("options.integrations.canva.error_generic");
    erro.value = motivo;
    $alert.message(motivo);
  } catch (e) {
    erro.value = (e as Error)?.message || t("options.integrations.canva.error_generic");
    Telemetry.track("canva_web_login_failed", { reason: MOTIVO_EXCECAO });
    $alert.message(erro.value);
  } finally {
    logando.value = false;
  }
}

/*
 * Sai do SITE do Canva: apaga os cookies da partição da projeção. O token da
 * API continua valendo — trocar de conta no Canva é o "Desconectar" de cima.
 * Só canva.com é atingido: a partição é compartilhada com os Sites da liturgia.
 */
function fazerLogoutNoCanva(): void {
  $alert.yesno(
    {
      title: t("options.integrations.canva.web_logout"),
      text: t("options.integrations.canva.web_logout_confirm"),
    },
    (async (btn: string) => {
      if (btn !== "yes" || !api) return;
      saindo.value = true;
      try {
        const resultado = await api.webLogout();
        if (!resultado.ok) {
          erro.value = resultado.message || t("options.integrations.canva.web_logout_failed");
          Telemetry.track("canva_web_logout_failed", { reason: motivoDe(resultado) });
          $alert.message(erro.value);
          return;
        }
        Telemetry.track("canva_web_logged_out");
        $alert.message(t("options.integrations.canva.web_logout_ok"));
        await refresh();
      } catch (e) {
        erro.value = (e as Error)?.message || t("options.integrations.canva.web_logout_failed");
        $alert.message(erro.value);
      } finally {
        saindo.value = false;
      }
    }) as (..._args: unknown[]) => unknown
  );
}

function desconectar(): void {
  $alert.yesno(
    {
      title: t("options.integrations.disconnect"),
      text: t("options.integrations.canva.disconnect_confirm"),
    },
    (async (btn: string) => {
      if (btn !== "yes" || !api) return;
      gravando.value = true;
      try {
        const resultado = await api.disconnect();
        if (!resultado.ok) {
          erro.value = resultado.message || t("options.integrations.canva.error_generic");
          Telemetry.track("canva_disconnect_failed", { reason: motivoDe(resultado) });
          return;
        }
        Telemetry.track("canva_disconnected");
        $snackbar.success(t("options.integrations.canva.disconnected_ok"));
        await refresh();
      } catch (e) {
        erro.value = (e as Error)?.message || t("options.integrations.canva.error_generic");
      } finally {
        gravando.value = false;
      }
    }) as (..._args: unknown[]) => unknown
  );
}

function instrucoes(): void {
  mostrarInstrucoes.value = true;
}

/*
 * O token sem `design:content:read` é o único atrito que o operador não vê
 * até clicar em Projetar. Registra a TRANSIÇÃO (e não cada `refresh`, que roda
 * no montagem e após cada ação): um evento por episódio, não por tela.
 */
watch(
  () => status.value?.requiresReconnect === true,
  (agora, antes) => {
    if (agora && !antes) Telemetry.track("canva_scope_missing");
  }
);

function carregarPreferencias(): void {
  const salvo = $userdata.get<string>(KEYS.OPTIONS.INTEGRATIONS.CANVA.PROJECT_AS, MODO_PDF);
  projectAs.value = salvo === MODO_SITE ? MODO_SITE : MODO_PDF;

  const qualidade = $userdata.get<string>(
    KEYS.OPTIONS.INTEGRATIONS.CANVA.EXPORT_QUALITY,
    QUALIDADE_REGULAR
  );
  exportQuality.value = qualidade === QUALIDADE_PRO ? QUALIDADE_PRO : QUALIDADE_REGULAR;
}

onMounted(() => {
  carregarPreferencias();
  void refresh();
});
</script>

<style scoped>
.canva-block {
  margin-top: var(--lj-space-4);
}

.canva-form {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  max-width: 520px;
}

.canva-field {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
}

.canva-input-label {
  margin: 10px 0 0 0;
}

.canva-field :deep(.lj-input) {
  width: 100%;
  max-width: 360px;
}

.canva-actions {
  display: flex;
  align-items: center;
  gap: var(--lj-space-4);
  flex-wrap: wrap;
  margin-top: var(--lj-space-3);
  margin-bottom: var(--lj-space-3);
}

/* "Projetar como" — duas opções com o pros e o contras à mostra. */
.canva-modes {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  max-width: 620px;
}

.canva-mode {
  align-items: flex-start;
  gap: var(--lj-space-3);
  padding: var(--lj-space-3) var(--lj-space-4);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-md);
  background: var(--lj-surface-bg);
}

.canva-mode--active {
  border-color: var(--lj-ui-accent);
  background: var(--lj-surface-bg-soft);
}

.canva-mode__body {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
}

.canva-mode__title {
  font-weight: var(--lj-weight-medium);
}

.canva-mode__hint {
  margin: 0;
}

.canva-saved {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
  color: var(--lj-text-muted);
  flex-wrap: wrap;
}

.canva-status {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  color: var(--lj-text-muted);
}

.canva-status--on {
  color: var(--lj-success, #3fae6a);
}

.canva-erro {
  color: var(--lj-danger, #d7503f);
}

.canva-aviso {
  color: var(--lj-warning, #c98a1b);
}

/*
 * A logo ocupa o mesmo slot que o ícone das outras telas do menu. A arte é
 * 1920×1080 com o quadrado do Canva centrado: `cover` corta a sobra lateral e
 * sobra o selo preenchendo a caixa.
 */
.opt-canva-logo {
  flex: 0 0 var(--lj-opt-section-icon-slot);
  width: var(--lj-opt-section-icon-slot);
  height: var(--lj-opt-section-icon-slot);
  border-radius: 6px;
  object-fit: cover;
  object-position: center;
  /* O rótulo é inline: sem isto a imagem senta na linha de base e abre folga. */
  vertical-align: middle;
}

/*
 * A Redirect URL INTEIRA é o botão de copiar: o valor vai no `value` do
 * LjCopyButton e o chip é o que o cursor aponta. Os dois lugares que mostram o
 * endereço (a linha da tela e o passo das instruções) usam esta mesma classe.
 */
.canva-uri {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-3);
  min-width: 0;
  max-width: 100%;
  text-align: left;
}

.canva-uri-code {
  font-family: var(--lj-font-mono, monospace);
  font-size: var(--lj-text-sm);
  background: var(--lj-surface-bg-soft);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-sm);
  padding: 2px var(--lj-space-3);
  overflow-wrap: anywhere;
  min-width: 0;
}

.canva-uri:hover .canva-uri-code,
.canva-uri:focus-visible .canva-uri-code {
  border-color: var(--lj-ui-accent);
}

.canva-uri-copy {
  font-size: var(--lj-text-sm);
  color: var(--lj-ui-accent);
  white-space: nowrap;
}

.canva-uri--inline {
  margin-top: var(--lj-space-2);
}

/* Instruções do portal -------------------------------------------------- */

.canva-steps {
  margin: 0;
  padding-left: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-4);
  font-size: var(--lj-text-base);
  line-height: 1.5;
}

.canva-steps li::marker {
  color: var(--lj-text-muted);
}

.canva-step-text {
  display: block;
}

.canva-link {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  margin-top: var(--lj-space-2);
  color: var(--lj-ui-accent);
  font-family: var(--lj-font-mono, monospace);
  font-size: var(--lj-text-sm);
  overflow-wrap: anywhere;
  text-decoration: underline;
}

.canva-link:hover {
  color: var(--lj-text);
}
</style>
