// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";

const records = new Map<string, unknown>();
const put = vi.fn(async (_table: string, record: { id: string }) => {
  records.set(record.id, structuredClone(record));
});
const get = vi.fn(async (_table: string, id: string) => records.get(id));
vi.mock("@/helpers/IndexedDB", () => ({ default: { put, get, del: vi.fn() } }));
const convert = vi.fn(async (name: string, blob: Blob) => ({ name, blob }));
vi.mock("@/helpers/ImageConvert", () => ({ ensureRenderableImage: convert }));

beforeEach(() => {
  vi.resetModules();
  records.clear();
  put.mockClear();
  get.mockClear();
  convert.mockReset().mockImplementation(async (name, blob) => ({ name, blob }));
  vi.stubGlobal("navigator", { storage: { estimate: async () => ({ quota: 1000, usage: 0 }) } });
  vi.spyOn(URL, "createObjectURL").mockClear().mockReturnValue("blob:local-file");
  vi.spyOn(URL, "revokeObjectURL")
    .mockClear()
    .mockImplementation(() => {});
});

describe("conversão e ciclo de vida de arquivos da liturgia", () => {
  it("converte HEIC antes de guardar, para projeção e retorno lerem JPEG", async () => {
    convert.mockResolvedValueOnce({
      name: "foto.jpg",
      blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    });
    const files = await import("../LiturgyFiles");
    const saved = await files.importLiturgyFile(
      new File(["heic"], "foto.heic", { type: "image/heic" })
    );
    expect(saved.dir).toBe("foto.jpg");
    expect(records.get(saved.ref_id)).toMatchObject({ name: "foto.jpg", mime: "image/jpeg" });
  });

  it("libera URLs substituídas, mantendo somente áudio e projeção atuais", async () => {
    const files = await import("../LiturgyFiles");
    files.retainLiturgyFileUrl("blob:video", "audio");
    files.retainLiturgyFileUrl("blob:video", "projection");
    files.retainLiturgyFileUrl("blob:image", "projection");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    files.retainLiturgyFileUrl("blob:audio", "audio");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:video");
    files.retainLiturgyFileUrl("blob:new-image", "projection");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image");
    files.releaseLiturgyFileUrl("blob:failed");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:failed");
    files.releaseLiturgyFileUrl("blob:audio");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:audio");
  });
});

describe("arquivos locais da liturgia", () => {
  it("guarda bytes fora do item e recria a URL após uma nova sessão", async () => {
    const first = await import("../LiturgyFiles");
    const file = new File(["conteúdo"], "aviso.png", { type: "image/png" });
    const saved = await first.importLiturgyFile(file);
    expect(saved).toEqual({ dir: "aviso.png", ref_id: expect.any(String) });
    expect(put).toHaveBeenCalledWith(
      DB_TABLE.LITURGY_FILES,
      expect.objectContaining({
        id: saved.ref_id,
        name: "aviso.png",
        mime: "image/png",
        data: expect.any(ArrayBuffer),
      })
    );
    expect(await first.resolveLiturgyFile(saved.ref_id)).toEqual({
      url: "blob:local-file",
      name: "aviso.png",
      kind: "image",
    });
    vi.resetModules();
    const next = await import("../LiturgyFiles");
    expect(await next.resolveLiturgyFile(saved.ref_id)).toMatchObject({ kind: "image" });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(
      new TextDecoder().decode((records.get(saved.ref_id) as { data: ArrayBuffer }).data)
    ).toBe("conteúdo");
  });

  it.each(["hino.mp3", "video.mp4", "leitura.pdf", "apresentacao.slja"])(
    "preserva arquivo suportado %s sem depender do MIME do seletor",
    async (name) => {
      const files = await import("../LiturgyFiles");
      const saved = await files.importLiturgyFile(new File(["bytes"], name));
      expect(await files.resolveLiturgyFile(saved.ref_id)).not.toBeNull();
    }
  );

  it.each([
    new File([], "vazio.png"),
    new File(["bytes"], "pagina.html", { type: "text/html" }),
    new File(["bytes"], "../aviso.png"),
    new File(["bytes"], `${"a".repeat(256)}.png`),
  ])("recusa arquivo inválido sem gravar", async (file) => {
    const files = await import("../LiturgyFiles");
    await expect(files.importLiturgyFile(file)).rejects.toThrow("unsupported_file");
    expect(put).not.toHaveBeenCalled();
  });

  it("verifica espaço antes de ler os bytes e propaga falha de armazenamento", async () => {
    const files = await import("../LiturgyFiles");
    vi.stubGlobal("navigator", { storage: { estimate: async () => ({ quota: 5, usage: 4 }) } });
    const file = new File(["bytes"], "aviso.png");
    const read = vi.spyOn(file, "arrayBuffer");
    await expect(files.importLiturgyFile(file)).rejects.toThrow("storage_full");
    expect(read).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", {});
    put.mockRejectedValueOnce(new Error("quota"));
    await expect(files.importLiturgyFile(file)).rejects.toThrow("quota");
  });

  it("recusa referência ausente ou registro malformado sem gerar URL", async () => {
    const files = await import("../LiturgyFiles");
    expect(await files.resolveLiturgyFile("http://externo/arquivo.png")).toBeNull();
    const id = crypto.randomUUID();
    expect(await files.resolveLiturgyFile(id)).toBeNull();
    records.set(id, { id, name: "aviso.png", mime: "image/png", data: "bytes" });
    expect(await files.resolveLiturgyFile(id)).toBeNull();
    records.set(id, { id, name: "pagina.html", mime: "text/html", data: new ArrayBuffer(1) });
    expect(await files.resolveLiturgyFile(id)).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
