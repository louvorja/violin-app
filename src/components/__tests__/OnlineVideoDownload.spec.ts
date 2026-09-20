import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { h as vh } from "vue";
import { TooltipProvider } from "reka-ui";
import { mountUi } from "@/components/ui/__tests__/mountUi";

const h = vi.hoisted(() => ({
  platform: { isDesktop: true, onlineVideo: null as any },
  yesno: vi.fn(),
}));

vi.mock("@/helpers/Platform", () => ({ default: h.platform }));
vi.mock("@/helpers/UserData", () => ({ default: { get: (_k: string, fallback?: unknown) => fallback } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn() } }));
vi.mock("@/helpers/Snackbar", () => ({ default: { warning: vi.fn() } }));
vi.mock("@/helpers/Alert", () => ({ default: { yesno: h.yesno } }));
vi.mock("@/i18n", () => ({ i18nAtual: () => ({ global: { t: (key: string) => key } }) }));

const ID = "T8YHfGrk3ok";
const OTHER = "jNQXAC9IVRw";
const MB = 1024 ** 2;

type Row = { id: string; size: number; usedAt: number; kept: boolean };

function fakeApi(disk: Row[] = []) {
  const listeners = new Set<(p: any) => void>();
  const api = {
    disk,
    ensure: vi.fn(async (id: string) => {
      api.disk.push({ id, size: 5 * MB, usedAt: 1, kept: true });
      return { ok: true, id, url: "u", size: 1, cached: false };
    }),
    cancel: vi.fn(async () => true),
    list: vi.fn(async () => api.disk.map((f) => ({ ...f }))),
    keep: vi.fn(async () => true),
    remove: vi.fn(async (id: string) => {
      api.disk = api.disk.filter((f) => f.id !== id);
      return true;
    }),
    onProgress: vi.fn((cb: (p: any) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    emit: (p: any) => listeners.forEach((cb) => cb(p)),
  };
  return api;
}

async function load(disk: Row[] = []) {
  vi.resetModules();
  h.platform.onlineVideo = fakeApi(disk);
  const { useOnlineVideoDownloads } = await import("@/composables/useOnlineVideoDownloads");
  const downloads = useOnlineVideoDownloads();
  await downloads.refresh();
  return {
    downloads,
    api: h.platform.onlineVideo,
    Control: (await import("@/components/OnlineVideoDownload.vue")).default,
    Badge: (await import("@/components/OnlineVideoDownloadBadge.vue")).default,
    Bar: (await import("@/components/OnlineVideoDownloadsBar.vue")).default,
  };
}

// Botões só-ícone ganham tooltip, que só funciona sob o TooltipProvider do App.vue.
function mountIn(component: any, props: Record<string, unknown>, locale: "pt" | "es" = "pt") {
  return mountUi(
    { render: () => vh(TooltipProvider, { delayDuration: 0 }, () => vh(component, props)) },
    {},
    locale
  );
}

const button = (wrapper: any, label: string) => wrapper.find(`button[aria-label="${label}"]`);

beforeEach(() => {
  h.platform.isDesktop = true;
  h.yesno.mockReset();
});

describe("OnlineVideoDownload — o controle de cada vídeo", () => {
  it("não baixado: oferece baixar e nada mais", async () => {
    const { Control } = await load();
    const w = mountIn(Control, { videoId: ID, name: "Louvor" });
    expect(button(w, "Baixar para usar sem internet").exists()).toBe(true);
    expect(button(w, "Remover download").exists()).toBe(false);
    expect(w.text()).toBe("");
  });

  it("clicar em baixar pede o download, sem acionar o cartão que o contém", async () => {
    const { Control, api } = await load();
    const parentClick = vi.fn();
    const Parent = {
      render: () =>
        vh(TooltipProvider, { delayDuration: 0 }, () =>
          vh("div", { onClick: parentClick }, [vh(Control, { videoId: ID, name: "Louvor" })])
        ),
    };
    const w = mountUi(Parent);
    await button(w, "Baixar para usar sem internet").trigger("click");
    await flushPromises();
    expect(api.ensure).toHaveBeenCalledWith(ID, expect.objectContaining({ priority: "background", keep: true }));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("baixando: mostra o andamento e o botão vira cancelar", async () => {
    const { Control, api, downloads } = await load();
    api.ensure = vi.fn(() => new Promise(() => {})); // nunca termina
    const w = mountIn(Control, { videoId: ID, name: "Louvor" });
    void downloads.download(ID, "Louvor");
    api.emit({ id: ID, phase: "downloading", percent: 37, phasePercent: 37 });
    await flushPromises();
    expect(w.text()).toContain("37%");
    expect(w.find('[role="progressbar"]').attributes("aria-valuenow")).toBe("37");
    expect(button(w, "Baixar para usar sem internet").exists()).toBe(false);
    await button(w, "Cancelar download").trigger("click");
    expect(api.cancel).toHaveBeenCalledWith(ID);
  });

  it("na fila: mostra 'Na fila' em vez de 0%", async () => {
    const { Control, api, downloads } = await load();
    api.ensure = vi.fn(() => new Promise(() => {}));
    const w = mountIn(Control, { videoId: ID, name: "Louvor" });
    void downloads.download(ID, "Louvor");
    await flushPromises();
    expect(w.text()).toContain("online_video.phase.queued"); // o dublê de i18n devolve a chave
  });

  it("baixado: mostra o tamanho e oferece remover, com confirmação", async () => {
    const { Control, api } = await load([{ id: ID, size: 132 * MB, usedAt: 1, kept: true }]);
    const w = mountIn(Control, { videoId: ID, name: "Louvor" });
    expect(w.text()).toContain("Baixado");
    expect(w.text()).toContain("132 MB");
    expect(button(w, "Baixar para usar sem internet").exists()).toBe(false);

    await button(w, "Remover download").trigger("click");
    expect(api.remove).not.toHaveBeenCalled(); // pergunta antes
    expect(h.yesno).toHaveBeenCalledTimes(1);
    const [dialog, answer] = h.yesno.mock.calls[0];
    expect(dialog.title).toBe("online_video.download.confirm_remove");

    await answer("no");
    expect(api.remove).not.toHaveBeenCalled();
    await answer("yes");
    await flushPromises();
    expect(api.remove).toHaveBeenCalledWith(ID);
    expect(w.text()).toBe("");
    expect(button(w, "Baixar para usar sem internet").exists()).toBe(true);
  });

  it("sem selo quando o cartão o mostra em outro lugar", async () => {
    const { Control } = await load([{ id: ID, size: 132 * MB, usedAt: 1, kept: true }]);
    const w = mountIn(Control, { videoId: ID, name: "Louvor", showStatus: false });
    expect(w.text()).toBe("");
    expect(button(w, "Remover download").exists()).toBe(true);
  });

  it("não aparece sem ID (link inválido) nem fora do desktop", async () => {
    const { Control } = await load();
    expect(mountIn(Control, { videoId: null, name: "x" }).find("button").exists()).toBe(false);
    h.platform.isDesktop = false;
    const off = await load();
    expect(mountIn(off.Control, { videoId: ID, name: "x" }).find("button").exists()).toBe(false);
  });

  it("os rótulos existem em espanhol também", async () => {
    const { Control } = await load([{ id: ID, size: 132 * MB, usedAt: 1, kept: true }]);
    const w = mountIn(Control, { videoId: ID, name: "x" }, "es");
    expect(w.text()).toContain("Descargado");
    expect(button(w, "Quitar descarga").exists()).toBe(true);
  });
});

describe("OnlineVideoDownloadBadge — o selo de estado", () => {
  it("compacto mostra só o tamanho (cabe sobre a miniatura)", async () => {
    const { Badge } = await load([{ id: ID, size: 132 * MB, usedAt: 1, kept: true }]);
    const w = mountUi(Badge, { props: { videoId: ID, compact: true } });
    expect(w.text()).toBe("132 MB");
  });

  it("não renderiza nada quando não há o que mostrar", async () => {
    const { Badge } = await load();
    expect(mountUi(Badge, { props: { videoId: ID } }).text()).toBe("");
    expect(mountUi(Badge, { props: { videoId: null } }).find(".ovd-badge").exists()).toBe(false);
  });
});

describe("OnlineVideoDownloadsBar — o resumo da lista", () => {
  const items = [
    { id: ID, name: "A" },
    { id: OTHER, name: "B" },
    { id: null, name: "link inválido" },
  ];

  it("conta o baixado, o total e o espaço; link inválido e duplicata não entram", async () => {
    const { Bar } = await load([{ id: ID, size: 132 * MB, usedAt: 1, kept: true }]);
    const w = mountUi(Bar, { props: { items: [...items, { id: ID, name: "A de novo" }] } });
    expect(w.find(".ovd-bar__summary").text()).toBe("Baixados: 1 de 2 (132 MB)");
  });

  it("'Baixar todos' baixa só o que falta, cada vídeo uma vez", async () => {
    const { Bar, api } = await load([{ id: ID, size: 1 * MB, usedAt: 1, kept: true }]);
    const w = mountUi(Bar, { props: { items: [...items, { id: OTHER, name: "B de novo" }] } });
    const all = w.findAll("button").find((b) => b.text() === "Baixar todos");
    await all!.trigger("click");
    await flushPromises();
    expect(api.ensure).toHaveBeenCalledTimes(1);
    expect(api.ensure).toHaveBeenCalledWith(OTHER, expect.objectContaining({ priority: "background" }));
  });

  it("com tudo baixado some o 'Baixar todos'; sem nada baixado some o 'Remover'", async () => {
    const all = await load([
      { id: ID, size: MB, usedAt: 1, kept: true },
      { id: OTHER, size: MB, usedAt: 1, kept: true },
    ]);
    const full = mountUi(all.Bar, { props: { items } });
    expect(full.findAll("button").map((b) => b.text())).toEqual(["Remover downloads"]);

    const none = await load();
    const empty = mountUi(none.Bar, { props: { items } });
    expect(empty.findAll("button").map((b) => b.text())).toEqual(["Baixar todos"]);
  });

  it("'Remover downloads' confirma com a contagem e só então apaga os da lista", async () => {
    const { Bar, api } = await load([
      { id: ID, size: MB, usedAt: 1, kept: true },
      { id: OTHER, size: MB, usedAt: 1, kept: true },
      { id: "foraDaLista1", size: MB, usedAt: 1, kept: true }, // baixado por outro caminho
    ]);
    const w = mountUi(Bar, { props: { items } });
    await w.findAll("button").find((b) => b.text() === "Remover downloads")!.trigger("click");
    expect(api.remove).not.toHaveBeenCalled();
    const [dialog, answer] = h.yesno.mock.calls[0];
    expect(dialog.translate).toBe(false);
    expect(dialog.title).toBe("Remover os 2 vídeos baixados desta lista? Eles continuam na lista.");
    await answer("yes");
    await flushPromises();
    expect(api.remove.mock.calls.map((c: any[]) => c[0]).sort()).toEqual([ID, OTHER].sort());
    expect(api.disk.map((f: Row) => f.id)).toEqual(["foraDaLista1"]);
  });

  it("some fora do desktop e com a lista vazia", async () => {
    const { Bar } = await load();
    expect(mountUi(Bar, { props: { items: [] } }).find(".ovd-bar").exists()).toBe(false);
    h.platform.isDesktop = false;
    const off = await load();
    expect(mountUi(off.Bar, { props: { items } }).find(".ovd-bar").exists()).toBe(false);
  });
});
