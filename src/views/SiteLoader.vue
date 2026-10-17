<!--
  SiteLoader — o que o telão mostra ENQUANTO a projeção de Site carrega.

  Existe porque a janela de Site é externa: ela só aparece no `did-finish-load`,
  e no Canva ainda falta o gesto de apresentação + a espera de os controles
  sumirem. Sem esta tela o operador via a página "chegando" — tela branca,
  barra de ferramentas, botão de apresentação — no meio da congregação.

  A mesma rota atende o monitor de retorno (`site_loader_return`): são duas
  janelas, um fundo cada, e as duas recebem o MESMO aviso do main para darem
  fade juntas.

  Só a marca: a tela vive por poucos segundos no telão e texto aqui seria ruído
  visual — quem olha precisa saber que está carregando, não ler sobre isso.

  O fade é CSS (`transition: opacity`), não `win.setOpacity()`: essa API não
  existe no Linux. Quem fecha a janela é o main, um pouco depois do aviso —
  o componente só some da tela.

  A duração é a mesma da Projeção de Fundo (`fade_duration`): o loader é a
  camada de transição da projeção de Site, e site, música e vídeo entram e saem
  com o mesmo tempo. Ele nasce transparente e só acende depois que o navegador
  pintou o primeiro quadro — sem isso o fade de entrada não teria de onde
  partir. Como a janela de loader é reaproveitada entre ciclos, o `pronto:
  false` de cada ciclo novo é o que religa a entrada.
-->
<template>
  <div
    class="site-loader"
    :class="{ 'site-loader--entrando': entrou, 'site-loader--saindo': saindo }"
    :style="{ ...fundo, '--site-loader-fade': fadeMs + 'ms' }"
  >
    <div class="site-loader__marca">
      <img class="site-loader__logo" :src="logoUrl" alt="" />
      <!--
        O anel sai da borda da marca pela folga + a própria grossura, então o
        furo da máscara cai EXATAMENTE no desenho: o loader "abrace" o ícone
        sem cobri-lo.
      -->
      <span class="site-loader__anel" aria-hidden="true" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getSetting } from "@/helpers/SettingsStorage";
import Telemetry from "@/helpers/Telemetry";
import { estiloDeFundo } from "@/helpers/BackgroundStyle";
import { DEFAULT_BACKGROUND_COLOR, MAIN_BACKGROUND_ID, type Settings } from "@/types/Settings";
import $modules from "@/helpers/Modules";
import $userdata from "@/helpers/UserData";
import { ModuleEnum } from "@/enums/ModuleEnum";

/**
 * `public/logo.png` não passa pelo bundler, então o caminho é resolvido contra
 * o DOCUMENTO: um `/logo.png` absoluto apontaria para a raiz errada no
 * desktop, onde a página é `louvorja://app/index.html` e a raiz é
 * `louvorja://` (o handler do protocolo só serve o host `app`).
 */
const logoUrl = new URL("/logo.png", document.baseURI).href;

/** Mesmo fundo da aba Opções → Geral → Imagem de Fundo e do módulo de fundo. */
const fundo = ref<Record<string, string>>({ background: DEFAULT_BACKGROUND_COLOR });
const saindo = ref(false);
const entrou = ref(false);

/**
 * O mesmo tempo de fade da Projeção de Fundo: o loader é a camada de transição
 * da projeção de Site, e as duas coisas entram e saem com o mesmo relógio.
 */
const MODULE_PATH = $modules.getPath(ModuleEnum.BACKGROUND_PROJECTION);
const fadeMs = computed(() => $userdata.get<number>(`${MODULE_PATH}.fade_duration`, 500) ?? 500);

/** Quanto tempo o telão ficou coberto — custo real do carregamento + apresentação. */
const montadoEm = Date.now();
/** Um `pronto: true` por ciclo: avisar duas vezes duplicaria o evento. */
let reportado = false;
/** Houve um `pronto: true` desde o último `pronto: false` — ou seja, um ciclo anterior. */
let saindoAnterior = false;

let blobUrl: string | null = null;
let cancelar: (() => void) | null = null;

/**
 * Acende o fade de entrada só depois que o navegador pintou o quadro
 * transparente. Um `requestAnimationFrame` não basta: sem um estilo
 * intermediário commitado, o navegador pula do valor antigo direto para o novo
 * e a transição não sai.
 *
 * O prazo é a rede de segurança: o Chromium PAUSA o `requestAnimationFrame` de
 * janela oculta ou encoberta, e o loader passa boa parte do ciclo encoberto pela
 * janela de Site. Um loader que nunca acende é pior do que um loader que acende
 * sem animar — é a tela branca da página chegando que ele existe para esconder.
 */
let entradaTimer: ReturnType<typeof setTimeout> | null = null;

function acenderEntrada(): void {
  entrou.value = false;
  if (entradaTimer) clearTimeout(entradaTimer);
  entradaTimer = setTimeout(() => {
    entradaTimer = null;
    entrou.value = true;
  }, 120);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (entradaTimer) {
        clearTimeout(entradaTimer);
        entradaTimer = null;
      }
      entrou.value = true;
    });
  });
}

async function carregarFundo(): Promise<void> {
  const s = await getSetting<Settings>(MAIN_BACKGROUND_ID).catch(() => null);
  const cor = s?.color || DEFAULT_BACKGROUND_COLOR;
  let imagem: string | null = null;

  if (s?.image) {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([s.image], { type: s.mime || "image/png" }));
    imagem = blobUrl;
  }

  fundo.value = estiloDeFundo({
    color: cor,
    imageUrl: imagem,
    position: s?.position || "cover",
  });
  document.body.style.background = cor;
}

onMounted(() => {
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = DEFAULT_BACKGROUND_COLOR;

  /*
   * Dois avisos pelo MESMO canal: `pronto: false` quando o main abre o ciclo
   * (a janela pode ter sido reutilizada de uma projeção anterior, ainda com o
   * fade aplicado) e `pronto: true` quando as janelas de Site estão prontas.
   */
  cancelar =
    window.louvorjaApi?.siteLoader?.onPronto?.(
      (dados?: { pronto?: boolean; apresentou?: boolean | null }) => {
        const pronto = dados?.pronto === true;
        saindo.value = pronto;
        if (!pronto) {
          reportado = false;
          /*
           * A janela de loader é reaproveitada entre ciclos e o componente
           * continua montado depois de um `pronto: true` — sem esta volta ao
           * zero, o segundo ciclo mostraria o loader já aceso, sem fade de
           * entrada, e a sair sem animá-lo de novo.
           */
          if (saindoAnterior) acenderEntrada();
          return;
        }
        saindoAnterior = true;
        if (reportado) return;
        reportado = true;
        /*
         * Só quando há gesto a fazer: `apresentou: null` é um Site de liturgia,
         * onde não existe "entrar em tela cheia" — aí não é Canva e não entra
         * no evento. É o único número que diz se o modo Site FUNCIONOU: abrir a
         * janela não garante nada.
         */
        const apresentou = typeof dados?.apresentou === "boolean" ? dados.apresentou : null;
        if (apresentou === null) return;
        Telemetry.track("canva_site_presented", {
          presented: apresentou,
          loader_ms: Date.now() - montadoEm,
        });
      }
    ) || null;

  void carregarFundo();
  acenderEntrada();
});

onBeforeUnmount(() => {
  cancelar?.();
  cancelar = null;
  if (entradaTimer) clearTimeout(entradaTimer);
  entradaTimer = null;
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null;
});
</script>

<style scoped>
.site-loader {
  /*
   * As três cores são as da própria marca — os `fill` de
   * `src/assets/img/logo.svg` (`amarelo` #FBCF02, o azul claro #00B8FD e o
   * preto #060605). Aqui ficam como variáveis para o anel e a marca falarem a
   * mesma língua.
   */
  --site-loader-amarelo: #fbcf02;
  --site-loader-azul: #00b8fd;
  --site-loader-preto: #060605;

  /* Tamanho do desenho; a folga e a grossura do anel saem daqui. */
  --site-loader-marca: clamp(50px, 28vmin, 50px);
  --site-loader-folga: 0px;
  --site-loader-grossura: 3px;

  position: fixed;
  inset: 0;
  display: flex;
  align-items: end;
  justify-content: center;
  /*
   * Nasce transparente e só acende com `.site-loader--entrando`, depois de um
   * quadro pintado (ver `acenderEntrada`). A saída usa o MESMO tempo — a
   * variável vem do `fade_duration` da Projeção de Fundo, o mesmo que a música
   * e o vídeo usam dentro da janela de fundo.
   */
  opacity: 0;
  transition: opacity var(--site-loader-fade, 500ms) ease;
  margin-bottom: 30px;
}

.site-loader--entrando {
  opacity: 1;
}

.site-loader--saindo {
  opacity: 0;
  pointer-events: none;
}

.site-loader__marca {
  position: relative;
  width: var(--site-loader-marca);
  height: var(--site-loader-marca);
}

.site-loader__logo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.site-loader__anel {
  position: absolute;
  /* Folga + grossura para FORA da marca: o raio interno do anel fica na
     borda do ícone + a folga, que é o "casamento" com o layout pedido. */
  inset: calc((var(--site-loader-folga) + var(--site-loader-grossura)) * -1);
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    var(--site-loader-amarelo) 0deg 120deg,
    var(--site-loader-azul) 120deg 240deg,
    var(--site-loader-preto) 240deg 360deg
  );
  /*
   * Vira anel: `100% - grossura` é exatamente o raio até a folga, então o
   * buraco abre sobre o desenho em vez de cobri-lo, e o que sobra é a faixa
   * colorida girando.
   */
  -webkit-mask: radial-gradient(
    closest-side,
    transparent calc(100% - var(--site-loader-grossura)),
    #000 calc(100% - var(--site-loader-grossura))
  );
  mask: radial-gradient(
    closest-side,
    transparent calc(100% - var(--site-loader-grossura)),
    #000 calc(100% - var(--site-loader-grossura))
  );
  animation: site-loader-girar 1200ms linear infinite;
}

@keyframes site-loader-girar {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .site-loader__anel {
    animation-duration: 3600ms;
  }
}
</style>
