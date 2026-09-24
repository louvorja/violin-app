import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  platform: { isDesktop: true, onlineVideo: null as any },
  prefs: {} as Record<string, unknown>,
  warning: vi.fn(),
}));

vi.mock("@/helpers/Platform", () => ({ default: h.platform }));
vi.mock("@/helpers/UserData", () => ({
  default: { get: (key: string, fallback?: unknown) => (key in h.prefs ? h.prefs[key] : fallback) },
}));
vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn() } }));
vi.mock("@/helpers/Snackbar", () => ({ default: { warning: h.warning } }));
vi.mock("@/i18n", () => ({ i18nAtual: () => ({ global: { t: (key: string) => key } }) }));

const ID = "T8YHfGrk3ok";
const OTHER = "jNQXAC9IVRw";

type FileRow = { id: string; size: number; usedAt: number; kept: boolean };

/** Ponte falsa do main: `disk` é o que a listagem devolve; `ensure` decide o desfecho. */
function fakeApi(disk: FileRow[] = [], ensure?: (id: string, opts: any) => Promise<any>) {
  const listeners = new Set<(p: any) => void>();
  const api = {
    disk,
    listeners,
    ensure: vi.fn(
      ensure ??
        (async (id: string) => {
          api.disk.push({ id, size: 50 * 1024 ** 2, usedAt: 1, kept: true });
          return { ok: true, id, url: `louvorja://onlinevideo/${id}.mp4`, size: 1, cached: false };
        })
    ),
    cancel: vi.fn(async () => true),
    list: vi.fn(async () => api.disk.map((f) => ({ ...f }))),
    keep: vi.fn(async (id: string) => {
      const f = api.disk.find((x) => x.id === id);
      if (f) f.kept = true;
      return !!f;
    }),
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

/** Estado do composable é de módulo: cada teste parte de um módulo novo. */
async function load() {
  vi.resetModules();
  const downloads = (await import("@/composables/useOnlineVideoDownloads")).useOnlineVideoDownloads();
  const tasks = (await import("@/composables/useBackgroundTasks")).useBackgroundTasks();
  return { downloads, tasks };
}

const taskOf = (tasks: { tasks: { value: any[] } }, id: string) =>
  tasks.tasks.value.find((t) => t.id === `online-video:${id}`);

beforeEach(() => {
  h.platform.isDesktop = true;
  h.platform.onlineVideo = fakeApi();
  h.prefs = {};
  h.warning.mockClear();
});

describe("disponibilidade", () => {
  it("existe no desktop com o bridge", async () => {
    expect((await load()).downloads.available).toBe(true);
  });

  it("não existe no navegador: nada de botão de baixar", async () => {
    h.platform.isDesktop = false;
    expect((await load()).downloads.available).toBe(false);
  });

  it("baixar fora do desktop não faz nada", async () => {
    h.platform.isDesktop = false;
    const { downloads } = await load();
    expect(await downloads.download(ID, "Vídeo")).toBe(false);
    expect(h.platform.onlineVideo.ensure).not.toHaveBeenCalled();
  });
});

describe("link novo na lista: o download já começa", () => {
  it("prepara link adicionado pelo operador com prioridade foreground e guarda", async () => {
    const { downloads } = await load();
    const started = downloads.startForNewLink(ID, "Louvor 1");
    expect(downloads.stateOf(ID)).toBe("downloading"); // o cartão já mostra o andamento
    expect(await started).toBe(true);
    expect(h.platform.onlineVideo.ensure).toHaveBeenCalledWith(ID, {
      maxHeight: 1080,
      priority: "foreground",
      keep: true,
    });
    expect(downloads.stateOf(ID)).toBe("downloaded");
  });

  it("com o download desligado nas opções, não baixa nada", async () => {
    h.prefs["options.online_video_projection.download"] = false;
    const { downloads } = await load();
    expect(await downloads.startForNewLink(ID, "Louvor 1")).toBe(false);
    expect(h.platform.onlineVideo.ensure).not.toHaveBeenCalled();
  });

  it("no navegador não existe: nada para baixar", async () => {
    h.platform.isDesktop = false;
    const { downloads } = await load();
    expect(await downloads.startForNewLink(ID, "Louvor 1")).toBe(false);
    expect(h.platform.onlineVideo.ensure).not.toHaveBeenCalled();
  });

  it("o mesmo link duas vezes seguidas baixa uma vez só", async () => {
    const { downloads } = await load();
    const first = downloads.startForNewLink(ID, "Louvor 1");
    expect(await downloads.startForNewLink(ID, "Louvor 1")).toBe(false);
    await first;
    expect(h.platform.onlineVideo.ensure).toHaveBeenCalledTimes(1);
  });
});

describe("refresh e estado", () => {
  it("reflete o que está no disco e esquece o que sumiu", async () => {
    const api = fakeApi([{ id: ID, size: 10, usedAt: 1, kept: true }]);
    h.platform.onlineVideo = api;
    const { downloads } = await load();
    await downloads.refresh();
    expect(downloads.stateOf(ID)).toBe("downloaded");
    expect(downloads.stateOf(OTHER)).toBe("none");

    api.disk = [];
    await downloads.refresh();
    expect(downloads.stateOf(ID)).toBe("none");
  });
});

describe("download antecipado", () => {
  it("pedido explícito usa foreground, mantém o vídeo e o mostra como baixado", async () => {
    const { downloads } = await load();
    expect(await downloads.download(ID, "Louvor 1")).toBe(true);
    expect(h.platform.onlineVideo.ensure).toHaveBeenCalledWith(ID, {
      maxHeight: 1080,
      priority: "foreground",
      keep: true,
    });
    expect(downloads.stateOf(ID)).toBe("downloaded");
    expect(downloads.pending[ID]).toBeUndefined();
  });

  it("cache oportunista continua background somente quando solicitado explicitamente", async () => {
    const { downloads } = await load();
    expect(await downloads.download(ID, "Cache", { keep: false, quiet: true, background: true })).toBe(true);
    expect(h.platform.onlineVideo.ensure).toHaveBeenCalledWith(ID, {
      maxHeight: 1080, priority: "background", keep: false,
    });
    // Avisos e retenção não determinam a prioridade do pedido.
    expect(await downloads.download(OTHER, "Próximo", { keep: false, quiet: true })).toBe(true);
    expect(h.platform.onlineVideo.ensure).toHaveBeenLastCalledWith(OTHER, {
      maxHeight: 1080, priority: "foreground", keep: false,
    });
  });

  it("pedido do operador promove cache pendente sem cancelar nem duplicar tarefa", async () => {
    type Result = { ok: true; id: string; url: string; size: number; cached: boolean };
    let finish!: (_value: Result) => void;
    const shared = new Promise<Result>((resolve) => { finish = resolve; });
    const api = fakeApi([], () => shared);
    h.platform.onlineVideo = api;
    const { downloads, tasks } = await load();
    const automatic = downloads.download(ID, "Cache", { keep: false, quiet: true, background: true });
    const manual = downloads.download(ID, "Próximo");
    expect(api.ensure).toHaveBeenNthCalledWith(1, ID, {
      maxHeight: 1080, priority: "background", keep: false,
    });
    expect(api.ensure).toHaveBeenNthCalledWith(2, ID, {
      maxHeight: 1080, priority: "foreground", keep: true,
    });
    expect(api.cancel).not.toHaveBeenCalled();
    expect(tasks.tasks.value.filter((task) => task.id === `online-video:${ID}`)).toHaveLength(1);
    api.disk.push({ id: ID, size: 1, usedAt: 1, kept: true });
    finish({ ok: true, id: ID, url: "u", size: 1, cached: false });
    expect(await automatic).toBe(true);
    expect(await manual).toBe(true);
    expect(downloads.stateOf(ID)).toBe("downloaded");
  });

  it("entra na lista de processos na hora, já na fila, e termina como concluída", async () => {
    let finish!: () => void;
    const api = fakeApi([], (id) => new Promise((resolve) => {
      finish = () => {
        api.disk.push({ id, size: 1, usedAt: 1, kept: true });
        resolve({ ok: true, id, url: "u", size: 1, cached: false });
      };
    }));
    h.platform.onlineVideo = api;
    const { downloads, tasks } = await load();

    const done = downloads.download(ID, "Louvor 1");
    expect(downloads.stateOf(ID)).toBe("downloading");
    expect(downloads.pending[ID]).toMatchObject({ percent: 0, phase: "queued" });
    expect(taskOf(tasks, ID)).toMatchObject({ label: "Louvor 1", status: "running" });

    finish();
    await done;
    expect(taskOf(tasks, ID)).toMatchObject({ status: "completed", progress: 100 });
  });

  it("acompanha o progresso no cartão e na lista de processos", async () => {
    let finish!: () => void;
    const api = fakeApi([], (id) => new Promise((resolve) => {
      finish = () => {
        api.disk.push({ id, size: 1, usedAt: 1, kept: true });
        resolve({ ok: true, id, url: "u", size: 1, cached: false });
      };
    }));
    h.platform.onlineVideo = api;
    const { downloads, tasks } = await load();

    const done = downloads.download(ID, "Louvor 1");
    api.emit({ id: OTHER, phase: "downloading", percent: 99 }); // outro vídeo: não é este
    api.emit({ id: ID, phase: "downloading", percent: 42, phasePercent: 42 });
    expect(downloads.pending[ID]).toMatchObject({ percent: 42, phase: "downloading" });
    expect(taskOf(tasks, ID)).toMatchObject({ progress: 42, detail: "online_video.phase.downloading 42%" });
    finish();
    await done;
  });

  it("um segundo clique enquanto baixa não dispara outro download", async () => {
    let finish!: () => void;
    const api = fakeApi([], (id) => new Promise((resolve) => {
      finish = () => {
        api.disk.push({ id, size: 1, usedAt: 1, kept: true });
        resolve({ ok: true, id, url: "u", size: 1, cached: false });
      };
    }));
    h.platform.onlineVideo = api;
    const { downloads } = await load();
    const first = downloads.download(ID, "V");
    expect(await downloads.download(ID, "V")).toBe(false);
    expect(api.ensure).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });

  it("não pisca 'não baixado' entre o fim do download e a listagem", async () => {
    const { downloads } = await load();
    const seen: string[] = [];
    const api = h.platform.onlineVideo;
    const originalList = api.list;
    api.list = vi.fn(async () => {
      seen.push(downloads.stateOf(ID)); // no instante da listagem o cartão ainda mostra "baixando"
      return originalList();
    });
    await downloads.download(ID, "V");
    expect(seen).toContain("downloading");
    expect(downloads.stateOf(ID)).toBe("downloaded");
  });

  it("vídeo que já estava em cache (projetado antes) só é guardado, sem baixar de novo", async () => {
    const api = fakeApi([{ id: ID, size: 10, usedAt: 1, kept: false }]);
    h.platform.onlineVideo = api;
    const { downloads } = await load();
    await downloads.refresh();
    expect(await downloads.download(ID, "V")).toBe(true);
    expect(api.ensure).not.toHaveBeenCalled();
    expect(api.keep).toHaveBeenCalledWith(ID);
    expect(downloads.files[ID].kept).toBe(true);
  });

  it("cancelar tira o cartão do 'baixando', limpa a lista de processos e não avisa nada", async () => {
    const api = fakeApi([], async () => ({ ok: false, error: { kind: "cancelled", message: "Download cancelado" } }));
    h.platform.onlineVideo = api;
    const { downloads, tasks } = await load();
    expect(await downloads.download(ID, "V")).toBe(false);
    expect(downloads.stateOf(ID)).toBe("none");
    expect(taskOf(tasks, ID)).toBeUndefined();
    expect(h.warning).not.toHaveBeenCalled();
  });

  it("o botão de cancelar do cartão manda o main cancelar aquele vídeo", async () => {
    const { downloads } = await load();
    downloads.cancel(ID);
    expect(h.platform.onlineVideo.cancel).toHaveBeenCalledWith(ID);
  });

  it("falha avisa o operador sem prometer o player do YouTube e marca o processo com erro", async () => {
    const api = fakeApi([], async () => ({ ok: false, error: { kind: "network", message: "sem rede" } }));
    h.platform.onlineVideo = api;
    const { downloads, tasks } = await load();
    expect(await downloads.download(ID, "V")).toBe(false);
    expect(downloads.stateOf(ID)).toBe("none");
    expect(taskOf(tasks, ID)).toMatchObject({ status: "error", error: "sem rede" });
    expect(h.warning).toHaveBeenCalledWith("online_video.errors.download", expect.objectContaining({ timeout: 8000 }));
  });

  it("vídeo privado explica que o problema é o vídeo", async () => {
    const api = fakeApi([], async () => ({ ok: false, error: { kind: "private", message: "x" } }));
    h.platform.onlineVideo = api;
    const { downloads } = await load();
    await downloads.download(ID, "V");
    expect(h.warning).toHaveBeenCalledWith("online_video.errors.private", expect.anything());
  });

  it("depois de falhar dá para tentar de novo", async () => {
    let calls = 0;
    const api = fakeApi([], async (id) => {
      if (++calls === 1) return { ok: false, error: { kind: "network", message: "x" } };
      api.disk.push({ id, size: 1, usedAt: 1, kept: true });
      return { ok: true, id, url: "u", size: 1, cached: false };
    });
    h.platform.onlineVideo = api;
    const { downloads } = await load();
    expect(await downloads.download(ID, "V")).toBe(false);
    expect(await downloads.download(ID, "V")).toBe(true);
    expect(downloads.stateOf(ID)).toBe("downloaded");
  });
});

describe("cancelar e baixar de novo", () => {
  it("o cartão volta a oferecer o download na hora, e o download antigo não atrapalha o novo", async () => {
    const gates: ((r: unknown) => void)[] = [];
    const api = fakeApi([], () => new Promise((resolve) => gates.push(resolve)));
    h.platform.onlineVideo = api;
    const { downloads, tasks } = await load();

    const first = downloads.download(ID, "V");
    expect(downloads.stateOf(ID)).toBe("downloading");
    downloads.cancel(ID);
    expect(api.cancel).toHaveBeenCalledWith(ID);
    expect(downloads.stateOf(ID)).toBe("none"); // sem esperar o yt-dlp sair
    expect(taskOf(tasks, ID)).toBeUndefined();

    const second = downloads.download(ID, "V"); // clicou de novo logo em seguida
    expect(api.ensure).toHaveBeenCalledTimes(2);
    expect(downloads.stateOf(ID)).toBe("downloading");
    expect(taskOf(tasks, ID)).toMatchObject({ status: "running" });

    // O antigo termina "cancelado", atrasado: não pode apagar o "baixando" do novo.
    gates[0]({ ok: false, error: { kind: "cancelled", message: "Download cancelado" } });
    await first;
    expect(downloads.stateOf(ID)).toBe("downloading");
    expect(taskOf(tasks, ID)).toMatchObject({ status: "running" });
    expect(h.warning).not.toHaveBeenCalled();

    // O andamento é do novo download.
    api.emit({ id: ID, phase: "downloading", percent: 55, phasePercent: 55 });
    expect(downloads.pending[ID]).toMatchObject({ percent: 55 });
    expect(taskOf(tasks, ID)).toMatchObject({ progress: 55 });

    api.disk.push({ id: ID, size: 1, usedAt: 1, kept: true });
    gates[1]({ ok: true, id: ID, url: "u", size: 1, cached: false });
    expect(await second).toBe(true);
    expect(downloads.stateOf(ID)).toBe("downloaded");
    expect(taskOf(tasks, ID)).toMatchObject({ status: "completed" });
  });

  it("uma falha do download antigo, depois de cancelado, não avisa nem suja o novo", async () => {
    const gates: ((r: unknown) => void)[] = [];
    const api = fakeApi([], () => new Promise((resolve) => gates.push(resolve)));
    h.platform.onlineVideo = api;
    const { downloads, tasks } = await load();
    const first = downloads.download(ID, "V");
    downloads.cancel(ID);
    const second = downloads.download(ID, "V");
    gates[0]({ ok: false, error: { kind: "network", message: "caiu" } });
    expect(await first).toBe(false);
    expect(h.warning).not.toHaveBeenCalled();
    expect(taskOf(tasks, ID)).toMatchObject({ status: "running" });
    gates[1]({ ok: false, error: { kind: "cancelled", message: "x" } });
    await second;
  });
});

describe("download iniciado ao projetar (mark/unmark)", () => {
  it("o cartão mostra o andamento e volta ao normal quando termina", async () => {
    const { downloads } = await load();
    downloads.mark(ID, { id: ID, phase: "downloading", percent: 30, phasePercent: 30 });
    expect(downloads.stateOf(ID)).toBe("downloading");
    expect(downloads.pending[ID]).toMatchObject({ percent: 30, phase: "downloading" });
    downloads.unmark(ID);
    expect(downloads.stateOf(ID)).toBe("none");
  });

  it("sem progresso ainda, entra 'na fila'", async () => {
    const { downloads } = await load();
    downloads.mark(ID);
    expect(downloads.pending[ID]).toMatchObject({ percent: 0, phase: "queued" });
  });
});

describe("remover", () => {
  it("apaga o arquivo e o cartão volta a oferecer o download", async () => {
    const api = fakeApi([{ id: ID, size: 10, usedAt: 1, kept: true }]);
    h.platform.onlineVideo = api;
    const { downloads } = await load();
    await downloads.refresh();
    await downloads.remove(ID);
    expect(api.remove).toHaveBeenCalledWith(ID);
    expect(downloads.stateOf(ID)).toBe("none");
  });
});

describe("adopt (o que está na lista do operador fica guardado)", () => {
  it("guarda só o que está em cache sem ser mantido, e só os IDs pedidos", async () => {
    const api = fakeApi([
      { id: ID, size: 10, usedAt: 1, kept: false },
      { id: OTHER, size: 10, usedAt: 1, kept: false },
      { id: "kkkkkkkkkkk", size: 10, usedAt: 1, kept: true },
    ]);
    h.platform.onlineVideo = api;
    const { downloads } = await load();
    await downloads.adopt([ID, "kkkkkkkkkkk", "naoBaixado1"]);
    expect(api.keep).toHaveBeenCalledTimes(1);
    expect(api.keep).toHaveBeenCalledWith(ID);
    expect(downloads.files[ID].kept).toBe(true);
    expect(downloads.files[OTHER].kept).toBe(false);
  });

  it("vídeo ainda baixando (tocar já): pede ao main para guardar quando terminar", async () => {
    const api = fakeApi([]);
    h.platform.onlineVideo = api;
    const { downloads } = await load();
    downloads.mark(ID); // o cartão mostra o andamento
    await downloads.adopt([ID, OTHER]);
    expect(api.keep).toHaveBeenCalledTimes(1); // só o que está baixando; OTHER não existe
    expect(api.keep).toHaveBeenCalledWith(ID);
    downloads.unmark(ID);
  });

  it("também mostra no cartão o que já estava no disco", async () => {
    h.platform.onlineVideo = fakeApi([{ id: ID, size: 10, usedAt: 1, kept: true }]);
    const { downloads } = await load();
    await downloads.adopt([ID]);
    expect(downloads.stateOf(ID)).toBe("downloaded");
  });
});

describe("formatBytes", () => {
  it("MB para vídeos, GB para o total, e zero sem inventar 1 MB", async () => {
    vi.resetModules();
    const { formatBytes } = await import("@/composables/useOnlineVideoDownloads");
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(NaN)).toBe("0 MB");
    expect(formatBytes(10 * 1024 ** 2)).toBe("10 MB");
    expect(formatBytes(1024)).toBe("1 MB");
    expect(formatBytes(2.5 * 1024 ** 3)).toBe("2.5 GB");
  });
});
