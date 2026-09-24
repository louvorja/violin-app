import { describe, expect, it, vi } from "vitest";
import { createVideoTitleEnrichment } from "../VideoTitleEnrichment";

type Video = { id: string; name: string; url: string };
const original: Video = { id: "item-1", name: "abcdefghijk", url: "https://youtu.be/abcdefghijk" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(fetchTitle: (id: string) => Promise<string | null>) {
  const item = { ...original };
  const items = new Map<string, Video>([[item.id, item]]);
  const stored = new Map<string, Video>();
  const persist = vi.fn(async (video: Video) => { stored.set(video.id, { ...video }); });
  const titles = createVideoTitleEnrichment({ find: (id) => items.get(id), fetchTitle, persist });
  return { item, items, stored, persist, titles };
}

describe("título opcional de vídeo recém-adicionado", () => {
  it("a consulta remota não segura o vídeo e atualiza UI e storage ao chegar", async () => {
    const remote = deferred<string>();
    const h = setup(() => remote.promise);
    h.titles.enrich({ id: h.item.id, videoId: "abcdefghijk", url: h.item.url, temporaryName: h.item.name });
    expect(h.item.name).toBe("abcdefghijk");
    expect(h.persist).not.toHaveBeenCalled();

    remote.resolve("  Louvor novo  ");
    await vi.waitFor(() => expect(h.item.name).toBe("Louvor novo"));
    expect(h.stored.get(h.item.id)?.name).toBe("Louvor novo");
  });

  it("edição ou troca do link invalida resposta atrasada", async () => {
    const remote = deferred<string>();
    const h = setup(() => remote.promise);
    h.titles.enrich({ id: h.item.id, videoId: "abcdefghijk", url: h.item.url, temporaryName: h.item.name });
    h.titles.invalidate(h.item.id);
    h.item.name = "Nome escolhido";
    h.item.url = "https://youtu.be/jNQXAC9IVRw";
    await h.titles.write(h.item.id, () => h.persist({ ...h.item }));
    remote.resolve("Título antigo");
    await vi.waitFor(() => expect(h.stored.get(h.item.id)?.name).toBe("Nome escolhido"));
    expect(h.item.name).toBe("Nome escolhido");
    expect(h.persist).toHaveBeenCalledTimes(1);
  });

  it("exclusão espera gravação já iniciada e não ressuscita o item", async () => {
    const remote = deferred<string>();
    const titleWrite = deferred<void>();
    const h = setup(() => remote.promise);
    h.persist.mockImplementationOnce(async (video) => {
      await titleWrite.promise;
      h.stored.set(video.id, { ...video });
    });
    h.titles.enrich({ id: h.item.id, videoId: "abcdefghijk", url: h.item.url, temporaryName: h.item.name });
    remote.resolve("Título remoto");
    await vi.waitFor(() => expect(h.persist).toHaveBeenCalledTimes(1));

    h.titles.invalidate(h.item.id);
    const remove = h.titles.write(h.item.id, async () => {
      h.stored.delete(h.item.id);
      h.items.delete(h.item.id);
    });
    titleWrite.resolve();
    await remove;
    expect(h.stored.has(h.item.id)).toBe(false);
    expect(h.item.name).toBe("abcdefghijk");
  });

  it("resposta vazia ou falha deixa o ID como nome sem gravar", async () => {
    const empty = setup(async () => "  ");
    empty.titles.enrich({ id: empty.item.id, videoId: "abcdefghijk", url: empty.item.url, temporaryName: empty.item.name });
    const failed = setup(async () => { throw new Error("offline"); });
    failed.titles.enrich({ id: failed.item.id, videoId: "abcdefghijk", url: failed.item.url, temporaryName: failed.item.name });
    await Promise.resolve();
    await Promise.resolve();
    expect(empty.persist).not.toHaveBeenCalled();
    expect(failed.persist).not.toHaveBeenCalled();
  });
});
