import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import RemoteMediaLibrary from "../RemoteMediaLibrary.vue";

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });

const LIBRARY = {
  status: "ok",
  items: [
    {
      id: "file_1",
      name: "Culto.jpg",
      type: "image",
      thumb: "/api/media-library/image?url=louvorja%3A%2F%2Flocal%2Fculto.jpg",
      categoryId: null,
      addedAt: 1,
    },
    {
      id: "file_2",
      name: "ensaio.mp4",
      type: "video",
      thumb: null,
      categoryId: "cat-1",
      addedAt: 2,
    },
  ],
  categories: [{ id: "cat-1", name: "Vídeos", color: null }],
};

const CANVA = {
  status: "ok",
  available: true,
  items: [
    { type: "folder", id: "root", name: "Minhas pastas", thumb: null, url: null, pageCount: null, updatedAt: null },
    { type: "design", id: "d1", name: "Cartaz", thumb: "https://x/c.jpg", url: null, pageCount: 3, updatedAt: 9 },
    // Design SEM cache: é o que tem o botão de exportar (d1 virou selo).
    { type: "design", id: "d2", name: "Sem cache", thumb: null, url: null, pageCount: 2, updatedAt: 10 },
  ],
  continuation: null,
  cached: { d1: 9 },
};

const fetchMock = vi.fn();
const calls: { url: string; init?: RequestInit }[] = [];

function fetchOk(payload: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response);
}

const PLAYLIST = {
  status: "ok",
  items: [
    { id: "file_1", name: "Culto.jpg", type: "image", thumb: null, categoryId: null, addedAt: 1 },
    { id: "file_2", name: "ensaio.mp4", type: "video", thumb: null, categoryId: null, addedAt: 2 },
  ],
};

beforeEach(() => {
  calls.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const alvo = String(url);
    if (alvo.includes("action=playlist")) return fetchOk(PLAYLIST);
    if (alvo.includes("action=canva")) return fetchOk(CANVA);
    return fetchOk(LIBRARY);
  });
  vi.stubGlobal("fetch", fetchMock);
});

/**
 * Os componentes de UI do app (reka-ui) exigem TooltipProvider, que mora no
 * App.vue — fora de lá o mount estoura. Stub mínimo: o que os testes usam são
 * as classes próprias (`rm-*`) e os `<button>`/`<img>` que sobraram.
 */
function abrir() {
  return mount(RemoteMediaLibrary, {
    props: { token: "tk" },
    global: {
      plugins: [i18n],
      stubs: {
        LjButton: { template: '<button class="lj-btn"><slot /></button>' },
        LjIcon: true,
        LjInput: true,
        LjSpinner: true,
        LjDivider: true,
      },
    },
  });
}

describe("RemoteMediaLibrary — biblioteca", () => {
  it("lista os itens da biblioteca na montagem", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));

    expect(calls[0].url).toContain("action=library");
    const cards = wrapper.findAll(".rm-item");
    expect(cards).toHaveLength(2);
    // Categorias primeiro, "sem categoria" por último (ordem do acervo):
    // cards[0] = ensaio.mp4 (Vídeos), cards[1] = Culto.jpg (sem categoria).
    expect(cards[0].text()).toContain("ensaio.mp4");
    expect(cards[1].text()).toContain("Culto.jpg");
    expect(wrapper.findAll(".rm-group")[0].text()).toBe("Vídeos");
    wrapper.unmount();
  });

  it("miniatura louvorja:// vira rota de imagem com o token", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));

    const thumb = wrapper.find<HTMLImageElement>(".rm-item__thumb");
    expect(thumb.element.src).toContain("/api/media-library/image?url=louvorja");
    expect(thumb.element.src).toContain("token=tk");
    wrapper.unmount();
  });

  it("clicar no item projeta pelo id", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));

    await wrapper.findAll(".rm-item")[1].trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    const post = calls.find((call) => call.init?.method === "POST");
    expect(post?.url).toContain("/api/media-library");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ action: "project", id: "file_1" });
    wrapper.unmount();
  });
});

describe("RemoteMediaLibrary — canva", () => {
  it("troca para a aba Canva e carrega pastas/designs", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));

    await wrapper.findAll(".rm-tabs__btn")[1].trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.at(-1)?.url).toContain("action=canva");
    const cards = wrapper.findAll(".rm-item");
    expect(cards).toHaveLength(3);
    // Design com PDF em cache leva o selo.
    expect(cards[1].find(".rm-item__badge").text()).toBeTruthy();
    wrapper.unmount();
  });

  it("clicar na pasta entra nela (folderId)", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));

    await wrapper.findAll(".rm-tabs__btn")[1].trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    calls.length = 0;

    await wrapper.findAll(".rm-item")[0].trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.find(".rm-back").exists()).toBe(true);
    expect(calls.at(-1)?.url).toContain("folderId=root");
    wrapper.unmount();
  });
});

describe("RemoteMediaLibrary — playlist", () => {
  it("aba Playlist busca a playlist do desktop", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));

    await wrapper.findAll(".rm-tabs__btn")[2].trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.some((call) => call.url.includes("action=playlist"))).toBe(true);
    const itens = wrapper.findAll(".rm-item");
    expect(itens).toHaveLength(2);
    expect(itens[0].text()).toContain("Culto.jpg");
    wrapper.unmount();
  });

  it("tocar num item manda goto com o índice", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.findAll(".rm-tabs__btn")[2].trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    calls.length = 0;

    await wrapper.findAll(".rm-item")[1].trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    const post = calls.find((call) => call.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      action: "playlist",
      command: "goto",
      index: 1,
    });
    wrapper.unmount();
  });

  it("remover manda remove com o índice", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.findAll(".rm-tabs__btn")[2].trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    calls.length = 0;

    await wrapper.findAll(".rm-item")[0].find("button").trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    const post = calls.find((call) => call.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      action: "playlist",
      command: "remove",
      index: 0,
    });
    // Removeu: a playlist é recarregada (GET action=playlist depois do POST).
    const recargas = calls.filter(
      (call) => call.url.includes("action=playlist") && call.init?.method !== "POST"
    );
    expect(recargas.length).toBe(1);
    wrapper.unmount();
  });

  it("botão + do card adiciona à playlist", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));
    calls.length = 0;

    // Cada card da biblioteca tem play (+) e adicionar (2 botões).
    const botoes = wrapper.findAll(".rm-item")[1].findAll("button");
    await botoes[botoes.length - 1].trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    const post = calls.find((call) => call.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      action: "playlist",
      command: "add",
      id: "file_1",
    });
    wrapper.unmount();
  });
});

describe("RemoteMediaLibrary — ações do Canva", () => {
  it("botão de exportar chama canva-export (design)", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.findAll(".rm-tabs__btn")[1].trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    calls.length = 0;

    // O card do design SEM cache (3º da lista) tem export + play + add.
    const botoes = wrapper.findAll(".rm-item")[2].findAll("button");
    await botoes[0].trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    const post = calls.find((call) => call.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      action: "canva-export",
      designId: "d2",
      format: "pdf",
    });
    wrapper.unmount();
  });

  it("botão + chama add-canva com o nome e o tipo do item", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.findAll(".rm-tabs__btn")[1].trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    calls.length = 0;

    const botoes = wrapper.findAll(".rm-item")[2].findAll("button");
    await botoes[botoes.length - 1].trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    const post = calls.find((call) => call.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      action: "playlist",
      command: "add-canva",
      designId: "d2",
      name: "Sem cache",
      kind: "design",
    });
    wrapper.unmount();
  });
});

describe("RemoteMediaLibrary — playlist e upload", () => {
  it("botões da playlist mandam o comando", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));
    calls.length = 0;

    // Ordem do rodapé: anterior, tocar, próximo, parar.
    await wrapper.findAll(".rm-footer__nav button")[1].trigger("click");
    await new Promise((r) => setTimeout(r, 0));

    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({
      action: "playlist",
      command: "play",
    });
    wrapper.unmount();
  });

  it("upload manda os bytes crus com X-File-Name", async () => {
    const wrapper = abrir();
    await new Promise((r) => setTimeout(r, 0));
    calls.length = 0;

    const file = new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" });
    const input = wrapper.find<HTMLInputElement>("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    await input.trigger("change");
    await new Promise((r) => setTimeout(r, 0));

    const post = calls.find((call) => call.url.includes("/upload"));
    expect(post?.init?.method).toBe("POST");
    const headers = post?.init?.headers as Record<string, string>;
    expect(headers["X-File-Name"]).toBe(encodeURIComponent("foto.png"));
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(post?.init?.body).toBeInstanceOf(ArrayBuffer);
    // Depois de enviar, a biblioteca é recarregada.
    expect(calls.filter((call) => String(call.url).includes("action=library")).length).toBe(1);
    wrapper.unmount();
  });
});
