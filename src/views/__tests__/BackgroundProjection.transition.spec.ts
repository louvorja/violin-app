import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { useUserDataStore } from "@/stores/userDataStore";

/*
 * A Projeção de Fundo desenha o conteúdo que, sem ela, iria em janelas
 * separadas. Aqui ela entra e sai com fade — antes, só a IMAGEM DE FUNDO tinha
 * transição, e música/bíblia/vídeo apareciam e sumiam na frente da congregação.
 */
vi.mock("@/composables/useProjectionCloseNotice", () => ({
  useProjectionCloseNotice: vi.fn(),
}));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: vi.fn(), histogram: vi.fn() },
}));
/* O runtime de PDF e a API do YouTube são o motor do arquivo; aqui só a
   imagem e o slide importam, e puxar o player real só custaria tempo. */
vi.mock("@/helpers/PdfRuntime", () => ({
  loadPdfDocument: vi.fn(async () => null),
}));
vi.mock("@/composables/useYouTubeApi", () => ({
  loadYtApi: vi.fn(async () => null),
}));
vi.mock("@/helpers/SettingsStorage", () => ({
  getSetting: vi.fn(async () => null),
}));
/*
 * A camada de Libras lê o `localStorage` já na importação, antes de o teste
 * instalar o seu stub. Ela não tem relação com a transição: entra um componente
 * vazio no lugar.
 */
vi.mock("@/views/LibrasOverlay.vue", () => ({
  default: { name: "LibrasOverlay", template: "<div class='libras-overlay' />" },
}));

import {
  AnnouncementsPresentationAuthority,
  beginAnnouncementIntent,
} from "@/presentation/AnnouncementsPresentationState";
import { ModulePresentationAuthority } from "@/presentation/ModulePresentationState";
import BackgroundProjection from "@/views/BackgroundProjection.vue";
import BackgroundProjectionReturn from "@/views/BackgroundProjectionReturn.vue";
/* O `?raw` devolve o SFC inteiro — é o que permite conferir a fiação das
   transições, que o jsdom não executa. */
import FONTE from "@/views/BackgroundProjection.vue?raw";
import FONTE_RETORNO from "@/views/BackgroundProjectionReturn.vue?raw";

/*
 * O caminho do ajuste: é o mesmo que o manifest do módulo publica como
 * `optionKey`, e o mesmo que o main lê para saber quanto tempo o loader precisa
 * ficar na tela.
 */
const FADE_MS = "modules.background_projection.fade_duration";

const i18n = createI18n({
  legacy: false,
  locale: "pt",
  messages: {
    pt: {
      projection: {
        video_unavailable: "Vídeo indisponível",
        video_unavailable_hint: "Tente novamente",
      },
    },
  },
});

let epoch = 0;

/** Ativa um arquivo — o gate exige `stage_epoch` crescente. */
function projetarArquivo(tipo: "image" | "video" | "pdf" | "youtube" = "image"): void {
  Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, {
    stage_epoch: ++epoch,
    title: "midia",
    type: tipo,
    url: `https://a.test/${epoch}.jpg`,
  });
}

/** Encerra a projeção de arquivo. */
function encerrarArquivo(): void {
  Broadcast.send(BROADCAST_TYPE.FILE_PROJECTION, { action: "clear" });
}

/** Um slide de música no ar. */
function projetarMusica(): void {
  Broadcast.send(BROADCAST_TYPE.SLIDE_CHANGE, {
    slide_index: 1,
    slide: { lyric: "Santo é o Senhor", cover: false, id_music: 7 },
    next_slide: { lyric: "Amai uns aos outros", cover: false, id_music: 8 },
    title: "Hino 7",
    progress: 0,
    total_slides: 2,
  });
}

/** Encerra a projeção de slides — o mesmo aviso que o player manda ao parar. */
function encerrarMusica(): void {
  Broadcast.send(BROADCAST_TYPE.MEDIA_CLOSE, {});
}

describe("Projeção de Fundo — as camadas entram e saem com fade", () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
    epoch = 0;
    const guardado = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => guardado.get(k) ?? null,
      setItem: (k: string, v: string) => void guardado.set(k, v),
      removeItem: (k: string) => void guardado.delete(k),
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  function montar(componente = BackgroundProjection): VueWrapper {
    wrapper = mount(componente as never, {
      attachTo: document.body,
      global: {
        plugins: [i18n],
        /* `Transition: false` renderiza o de verdade — é dele que saem as
           classes `fade-enter-*` que este teste confere. */
        stubs: { OverlayRenderer: true, LibrasOverlay: true, Transition: false },
      },
    });
    return wrapper;
  }

  function estiloDe(seletor: string): string {
    return wrapper!.find(seletor).attributes("style") ?? "";
  }

  it("o arquivo entra com o fade do módulo, e não seco", async () => {
    const w = montar();

    projetarArquivo();
    await nextTick();

    expect(w.find(".file-projection").exists()).toBe(true);
    expect(w.find(".fade-enter-active").exists()).toBe(true);
    expect(estiloDe(".file-projection")).toContain("--fade-ms: 500ms");
  });

  it("o tempo é o fade_duration configurado, e não um valor fixo", async () => {
    useUserDataStore().SET_PATH({ path: FADE_MS, value: 1200 });
    const w = montar();

    projetarArquivo();
    await nextTick();

    expect(estiloDe(".file-projection")).toContain("--fade-ms: 1200ms");
  });

  it("o arquivo sai com fade — a camada continua na tela, agora apagando", async () => {
    const w = montar();
    projetarArquivo();
    await nextTick();

    encerrarArquivo();
    await nextTick();

    /*
     * A camada tem que CONTINuar no DOM, agora com `fade-leave-active`: sumir
     * no mesmo quadro é o que a projeção de fundo fazia com vídeo e música, e
     * é o que deixa o conteúdo de baixo aparecer de uma vez.
     */
    expect(w.find(".fade-leave-active").exists()).toBe(true);
    expect(w.find(".file-projection").exists()).toBe(true);
    expect(w.find(".bg-stack").exists()).toBe(true);
  });

  it("a camada de música entra com fade", async () => {
    const w = montar();

    projetarMusica();
    await nextTick();

    expect(w.find(".layer-projection").exists()).toBe(true);
    expect(w.find(".fade-enter-active").exists()).toBe(true);
    expect(estiloDe(".layer-projection")).toContain("--fade-ms: 500ms");

    encerrarMusica();
    await nextTick();
    expect(w.find(".fade-leave-active").exists()).toBe(true);
  });

  it("trocar música por bíblia cruza as duas camadas", async () => {
    const w = montar();
    projetarMusica();
    await nextTick();

    Broadcast.send(BROADCAST_TYPE.SLIDE_CHANGE, {
      slide_index: 1,
      slide: { is_bible: true, text: "No princípio", reference: "Gn 1.1" },
      next_slide: null,
      title: "Bíblia",
      progress: 0,
      total_slides: 1,
    });
    await nextTick();

    /* Musical e Bíblia são o mesmo slot: sem a chave, uma engoliria a outra. */
    expect(w.find(".fade-enter-active").exists()).toBe(true);
    expect(w.find(".fade-leave-active").exists()).toBe(true);
  });

  it("o conjunto do fundo dá lugar ao arquivo sem virar um clarão", async () => {
    const w = montar();
    projetarMusica();
    await nextTick();

    projetarArquivo();
    await nextTick();

    /*
     * Cruzamento: o arquivo entra por cima enquanto o conjunto do fundo ainda
     * está na tela, apagando. Sem isso, o fundo sumiria primeiro e o vídeo
     * apareceria sobre uma tela vazia — um flash na frente da congregação.
     */
    expect(w.find(".file-projection").exists()).toBe(true);
    expect(w.find(".bg-stack").exists()).toBe(true);
    /* O arquivo entra E o fundo sai no mesmo quadro. */
    expect(w.find(".fade-enter-active").exists()).toBe(true);
    expect(w.find(".fade-leave-active").exists()).toBe(true);
  });

  it("a tela de retorno dá o mesmo fade — as duas andam juntas", async () => {
    const w = montar(BackgroundProjectionReturn);

    projetarArquivo();
    await nextTick();
    expect(w.find(".file-projection").exists()).toBe(true);
    expect(w.find(".fade-enter-active").exists()).toBe(true);
    expect(estiloDe(".file-projection")).toContain("--fade-ms: 500ms");

    encerrarArquivo();
    await nextTick();
    expect(w.find(".fade-leave-active").exists()).toBe(true);
  });

  /*
   * Utilitários (timer, contador, relógio, cronômetro, quadro, painel): entravam
   * por `/projection/module`, uma JANELA FULLSCREEN própria — aparecia por
   * cima do telão como um retângulo preto, sem fade nenhum.
   */
  describe("utilitários dentro da janela de fundo", () => {
    let authority: ModulePresentationAuthority;

    /*
     * `MODULE_PROJECTION_VALUE` passa por um gate: sem o pacote completo
     * (session/epoch/revision) a mensagem é descartada e não chega a ninguém.
     * O teste publica pela MESMA autoridade que a janela principal usa.
     */
    function valorDoModulo(id: string, texto = "10:00"): void {
      const packet = authority.publish({ module: id, active: true, text: texto });
      if (packet) Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_VALUE, packet);
    }

    /** O clique em "Projetar" — é o que liga a camada. */
    function projetoModulo(id: string): void {
      Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_OPEN, { module: id });
      valorDoModulo(id);
    }

    function fechaModulo(id: string): void {
      Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_CLOSE, { module: id });
    }

    beforeEach(() => {
      authority = new ModulePresentationAuthority();
    });

    it("o utilitário entra como camada com fade", async () => {
      const w = montar();

      projetoModulo("timer");
      await nextTick();

      expect(w.find(".layer-utilitario").exists()).toBe(true);
      expect(w.find(".fade-enter-active").exists()).toBe(true);
      /* A camada é o MESMO componente que a janela de módulo usa. */
      expect(w.find(".module-projection").exists()).toBe(true);
      expect(w.find(".module-projection__text--timer").exists()).toBe(true);
      expect(estiloDe(".layer-utilitario")).toContain("--fade-ms: 500ms");
    });

    it("o utilitário sai com fade", async () => {
      const w = montar();
      projetoModulo("timer");
      await nextTick();

      Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_CLOSE, { module: "timer" });
      await nextTick();

      expect(w.find(".fade-leave-active").exists()).toBe(true);
      expect(w.find(".layer-utilitario").exists()).toBe(true);
    });

    it("fechar desliga o utilitário, e ele sai com fade", async () => {
      const w = montar();
      projetoModulo("timer");
      await nextTick();

      fechaModulo("timer");
      await nextTick();

      /*
       * O evento de fechar NÃO traz `active`; lido como "no ar" ele manteria o
       * utilitário preso na tela depois do ESC. Fechar é desligar.
       */
      expect(w.find(".fade-leave-active").exists()).toBe(true);

      await new Promise((r) => setTimeout(r, 700));
      await nextTick();
      expect(w.find(".layer-utilitario").exists()).toBe(false);
    });

    it("dois utilitários no ar: quem fala por último fica na tela", async () => {
      const w = montar();
      projetoModulo("clock");
      await nextTick();
      projetoModulo("counter");
      await nextTick();

      /* Durante o cruzamento as duas camadas coexistem: o que sai continua na
         tela até o fade terminar, que é o que evita o piscar. */
      expect(w.find(".module-projection__text--counter").exists()).toBe(true);
      expect(w.findAll(".layer-utilitario")).toHaveLength(2);

      /* Desligar o da frente devolve o de baixo, em vez de apagar o telão. */
      fechaModulo("counter");
      await nextTick();
      expect(w.find(".module-projection__text--clock").exists()).toBe(true);
    });

    it("valor emitido sozinho NÃO projeta — só o clique em Projetar liga", async () => {
      /*
       * Este é o defeito: contador, relógio e timer emitem `active:true` desde
       * que o módulo abre (o watch é immediate). Sem janela para onde ir, o
       * telão passava a pintar o módulo sozinho, sem ninguém pedir.
       */
      const w = montar();

      valorDoModulo("timer");
      await nextTick();
      expect(w.find(".layer-utilitario").exists()).toBe(false);

      Broadcast.send(BROADCAST_TYPE.MODULE_PROJECTION_OPEN, { module: "timer" });
      await nextTick();
      expect(w.find(".layer-utilitario").exists()).toBe(true);
    });

    it("trocar de utilitário faz um cruzar, sem piscar", async () => {
      const w = montar();
      projetoModulo("clock");
      await nextTick();

      projetoModulo("stopwatch");
      await nextTick();

      expect(w.find(".fade-enter-active").exists()).toBe(true);
      expect(w.find(".fade-leave-active").exists()).toBe(true);
    });
  });

  /*
   * Avisos: com a Projeção de Fundo aberta, o aviso renderiza aqui dentro em vez
   * de numa janela opaca por cima do telão.
   */
  describe("avisos dentro da janela de fundo", () => {
    let authority: AnnouncementsPresentationAuthority;

    /** O módulo publica a intenção; a autoridade responde no STATE. */
    function iniciarAviso(texto = "Aviso no ar"): void {
      authority.publish({
        ...beginAnnouncementIntent(),
        slides: [{ id: "a", nome: "Aviso", ordem: 1, texto }],
        index: 0,
      });
      const packet = authority.current()!;
      Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, packet);
    }

    function pararAviso(): void {
      const packet = authority.control({
        action: "stop",
        announcement_session: authority.current()!.announcement_session,
      });
      if (packet) Broadcast.send(BROADCAST_TYPE.ANNOUNCEMENTS_STATE, packet);
    }

    beforeEach(() => {
      authority = new AnnouncementsPresentationAuthority();
    });

    it("o aviso entra como mais uma camada com fade", async () => {
      const w = montar();

      iniciarAviso();
      await nextTick();

      expect(w.find(".layer-avisos").exists()).toBe(true);
      expect(w.find(".fade-enter-active").exists()).toBe(true);
      /* O aviso é o MESMO componente da janela própria, não uma recriação. */
      expect(w.find(".ann-text").text()).toContain("Aviso no ar");
      expect(estiloDe(".layer-avisos")).toContain("--fade-ms: 500ms");
    });

    it("o aviso sai com fade, e some com o conteúdo — não com um retângulo preto", async () => {
      const w = montar();
      iniciarAviso();
      await nextTick();

      pararAviso();
      await nextTick();

      expect(w.find(".fade-leave-active").exists()).toBe(true);
      /*
       * O `active: false` não pode apagar o slide antes do fade: ele ficaria
       * no lugar um retângulo preto sumindo, que é o pior dos dois.
       */
      expect(w.find(".layer-avisos").exists()).toBe(true);
      expect(w.find(".ann-text").text()).toContain("Aviso no ar");
    });

    it("o aviso fica por cima do conteúdo que estava no telão", async () => {
      const w = montar();
      projetarMusica();
      await nextTick();
      iniciarAviso();
      await nextTick();

      /* Na janela própria o aviso cobria o telão inteiro; aqui a ordem do DOM
         é a que garante isso. */
      const html = w.html();
      expect(html.indexOf("layer-avisos")).toBeGreaterThan(html.indexOf("layer-projection"));
      /* E com folga de z-index sobre as outras camadas (o slide é 1). */
      expect(FONTE).toMatch(/\.layer-avisos \{[\s\S]*?z-index: 3;/);
    });
  });

  it("a camada de retorno da tela de retorno também entra com fade", async () => {
    const w = montar(BackgroundProjectionReturn);

    projetarMusica();
    await nextTick();

    expect(w.find(".return-projection").exists()).toBe(true);
    expect(w.find(".fade-enter-active").exists()).toBe(true);
  });

  /*
   * A SAÍDA depende de duas coisas que os testes acima travam: a camada estar
   * dentro de uma `Transition` com a DURAÇÃO do módulo (senão o Vue a remove no
   * mesmo quadro em que ela some) e a tela ter UMA raiz — um `Transition` que é
   * filho direto de um template com vários irmãos não recebe os ganchos de
   * saída, e a camada desapareceria na frente da congregação sem animar.
   */
  describe("a saída tem o mesmo relógio da entrada", () => {
    it("cada camada que entra com fade sai com fade", () => {
      for (const fonte of [FONTE, FONTE_RETORNO]) {
        const camadas = fonte.match(/<Transition name="fade" :duration="fadeDurationMs">/g);
        /*
         * Quatro na projeção (arquivo, conjunto do fundo, camada de slides,
         * avisos) mais uma na camada de utilitários — cinco camadas que entram
         * e saem pelo mesmo relógio. As outras `Transition` do arquivo são as do
         * PRÓPRIO fundo, que já existiam e não dependem deste ajuste.
         *
         * O espelho não tem avisos nem utilitários: nenhuma das duas projeções
         * tem tela de retorno.
         */
        expect(camadas?.length).toBe(fonte === FONTE ? 5 : 3);
      }
    });

    it("o tempo vem da configuração, e não de um valor preso no CSS", () => {
      for (const fonte of [FONTE, FONTE_RETORNO]) {
        /* O CSS do fade lê a variável que cada camada escreve no elemento. */
        expect(fonte).toMatch(/transition: opacity var\(--fade-ms, 500ms\) linear;/);
        expect(fonte).toContain("const fadeDurationMs = computed(");
        expect(fonte).toContain("fade_duration");
      }
    });

    it("as duas telas têm UMA raiz — sem isso a saída não anima", () => {
      for (const fonte of [FONTE, FONTE_RETORNO]) {
        /*
         * Este é o motivo de a tela ter ganhado um elemento raiz: com vários
         * irmãos na raiz do template, o Vue não pendura os ganchos de saída no
         * `Transition` — e o teste "o arquivo sai com fade" falha.
         */
        expect(fonte).toMatch(/<template>\s*<!--[\s\S]*?-->\s*<div class="projection-root">/);
      }
    });
  });
});
