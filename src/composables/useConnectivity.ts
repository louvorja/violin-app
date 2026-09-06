import { computed, ref } from "vue";
import Platform from "@/helpers/Platform";
import $appdata from "@/helpers/AppData";
import $snackbar from "@/helpers/Snackbar";
import { KEYS } from "@/constants/UserDataKeys";
import { i18nAtual } from "@/i18n";
import { API_URL } from "@/config/Api";
import { setNetworkReporter, fetchWithTimeout, NET_TIMEOUT } from "@/helpers/Http";

/**
 * `navigator.onLine` mente: no wifi de igreja com portal cativo ele diz `true`
 * enquanto nada sai da máquina. Por isso o sinal do navegador só é aceito no
 * sentido negativo, e a verdade vem do resultado do tráfego que já acontece.
 */

interface NetStatus {
  online: boolean;
  since: number | null;
}

/** Falhas seguidas antes de declarar que caiu. Uma só pode ser um arquivo grande. */
const FALHAS_PARA_OFFLINE = 2;

/** Espera entre sondagens enquanto offline; a última se repete. */
const BACKOFF_MS = [5000, 10000, 30000, 60000];

let _falhas = 0;
let _tentativa = 0;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _sondando = false;
let _instalado = false;
// `ref`, não variável solta: o `computed` que a interface consome precisa de
// uma dependência reativa para reavaliar.
const _desdeQuando = ref<number | null>(null);

function _lerEstado(): boolean {
  return $appdata.get<boolean>(KEYS.SHELL.IS_ONLINE, true) !== false;
}

function _definirEstado(online: boolean): void {
  if (_lerEstado() === online) return;
  $appdata.set(KEYS.SHELL.IS_ONLINE, online);
  _desdeQuando.value = online ? null : Date.now();
  if (online) {
    _pararSondagem();
  } else {
    _agendarSondagem();
  }
}

function _pararSondagem(): void {
  if (_timer) clearTimeout(_timer);
  _timer = null;
  _tentativa = 0;
}

function _agendarSondagem(): void {
  if (_timer) return;
  const espera = BACKOFF_MS[Math.min(_tentativa, BACKOFF_MS.length - 1)];
  _tentativa += 1;
  _timer = setTimeout(() => {
    _timer = null;
    void sondar();
  }, espera);
}

/**
 * Uma ida à rede só para descobrir se ela voltou. Enquanto online ninguém
 * sonda — o tráfego normal já responde essa pergunta de graça.
 */
async function sondar(): Promise<boolean> {
  if (_sondando) return _lerEstado();
  _sondando = true;
  try {
    if (Platform.download?.checkConnection) {
      const r = await Platform.download.checkConnection();
      reportNetworkResult(!!r?.ok, "probe");
      return !!r?.ok;
    }
    await fetchWithTimeout(API_URL, {
      method: "HEAD",
      timeout: NET_TIMEOUT.QUICK,
      source: "probe",
    });
    return true;
  } catch {
    return false;
  } finally {
    _sondando = false;
    if (!_lerEstado()) _agendarSondagem();
  }
}

/**
 * Alimentado por cada chamada de rede que termina. Qualquer resposta HTTP,
 * inclusive 500, conta como online: o servidor foi alcançado.
 */
export function reportNetworkResult(ok: boolean, _source = "fetch"): void {
  if (ok) {
    _falhas = 0;
    _definirEstado(true);
    return;
  }
  _falhas += 1;
  if (_falhas >= FALHAS_PARA_OFFLINE) _definirEstado(false);
}

/** Só para os testes: devolve o módulo ao estado inicial. */
export function _resetConnectivity(): void {
  _falhas = 0;
  _tentativa = 0;
  if (_timer) clearTimeout(_timer);
  _timer = null;
  _sondando = false;
  _desdeQuando.value = null;
}

function _instalar(): void {
  if (_instalado || typeof window === "undefined") return;
  _instalado = true;

  setNetworkReporter(reportNetworkResult);

  // Só o negativo é confiável. O positivo apenas autoriza uma sondagem.
  window.addEventListener("offline", () => {
    _falhas = FALHAS_PARA_OFFLINE;
    _definirEstado(false);
  });
  window.addEventListener("online", () => void sondar());
  window.addEventListener("focus", () => {
    if (!_lerEstado()) void sondar();
  });

  if (navigator.onLine === false) _definirEstado(false);

  // O main enxerga melhor: é ele quem busca catálogo e mídia o tempo todo. Quando
  // existe, a palavra dele vale sobre a nossa contagem local.
  if (Platform.net) {
    Platform.net.onStatus((estado: NetStatus) => {
      _falhas = estado.online ? 0 : FALHAS_PARA_OFFLINE;
      _definirEstado(estado.online);
    });
    void Platform.net
      .getStatus()
      .then((estado: NetStatus | null) => {
        if (estado && estado.online === false) {
          _falhas = FALHAS_PARA_OFFLINE;
          _definirEstado(false);
        }
      })
      .catch(() => {
        /* main ainda subindo */
      });
  }
}

export function useConnectivity() {
  _instalar();

  return {
    isOnline: computed(() => _lerEstado()),
    /** Desde quando está sem conexão, para a interface explicar o estado. */
    offlineSince: computed(() => _desdeQuando.value),
    recheck: sondar,
    reportNetworkResult,
    /**
     * Portão para ações que não funcionam sem rede. Devolve `false` e avisa,
     * em vez de deixar a ação falhar em silêncio ou num diálogo modal.
     */
    guardNetwork(mensagem?: string): boolean {
      if (_lerEstado()) return true;
      const t = i18nAtual()?.global?.t;
      $snackbar.warning(mensagem || (t ? t("shell.offline_action") : "Esta ação precisa de internet."), {
        key: "offline-action",
      });
      void sondar();
      return false;
    },
  };
}
