// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";

function makeInMemoryOpfs() {
  const files = new Map<string, Uint8Array>();
  const mimes = new Map<string, string>();
  return {
    files,
    mimes,
    async writeStream(rel: string, stream: ReadableStream<Uint8Array>, opts?: { mime?: string }) {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) {
          chunks.push(value);
          total += value.byteLength;
        }
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      files.set(rel, merged);
      if (opts?.mime) mimes.set(rel, opts.mime);
      return { rel, size: merged.byteLength };
    },
    async writeText(rel: string, text: string) {
      files.set(rel, new TextEncoder().encode(text));
    },
    async readText(rel: string) {
      const data = files.get(rel);
      return data ? new TextDecoder().decode(data) : null;
    },
    async readFile(rel: string) {
      const data = files.get(rel);
      if (!data) return null;
      return new File([new Uint8Array(data)], rel.split("/").pop() || "file", {
        type: mimes.get(rel) || "application/octet-stream",
      });
    },
    async copyFile(fromRel: string, toRel: string) {
      const data = files.get(fromRel);
      if (!data) throw new Error(`missing OPFS source: ${fromRel}`);
      files.set(toRel, new Uint8Array(data));
      const m = mimes.get(fromRel);
      if (m) mimes.set(toRel, m);
    },
    async info(rel: string) {
      const data = files.get(rel);
      return data ? { exists: true, size: data.byteLength } : { exists: false, size: 0 };
    },
    async remove(rel: string) {
      return files.delete(rel);
    },
    async removeStaging(token: string) {
      const prefix = `.staging/${token}/`;
      for (const key of Array.from(files.keys())) {
        if (key === `.staging/${token}` || key.startsWith(prefix)) files.delete(key);
      }
    },
    async list(prefix = "") {
      return Array.from(files.keys()).filter((k) => !k.startsWith(".staging/") && (!prefix || k.startsWith(prefix)));
    },
    listStagingTokens() {
      const tokens = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(".staging/")) continue;
        const token = key.slice(".staging/".length).split("/")[0];
        if (token) tokens.add(token);
      }
      return Array.from(tokens);
    },
  };
}

const h = vi.hoisted(() => ({
  rows: new Map<string, Array<{ id: string } & Record<string, unknown>>>(),
  replaceFailOnce: false,
  isDesktop: false,
  opfsSupported: true,
  desktopDisk: new Map<string, Uint8Array>(),
  desktopUnreadable: new Set<string>(),
  desktopJournals: new Map<
    string,
    {
      token: string;
      status: "committing-files" | "committing-db" | "committed";
      files: Array<{ rel: string; existed: boolean }>;
    }
  >(),
  desktopStaged: new Map<string, { restoreToken: string; rel: string; chunks: Uint8Array[]; committed?: boolean }>(),
  desktopReadTokens: new Map<string, { data: Uint8Array; offset: number }>(),
  lockBusy: false,
  exportedFile: null as Blob | null,
  opfs: null as ReturnType<typeof makeInMemoryOpfs> | null,
  nextToken: 1,
}));

vi.mock("@/helpers/Platform", () => ({
  default: {
    get isDesktop() {
      return h.isDesktop;
    },
    get api() {
      if (!h.isDesktop) return null;
      return {
        libraryFiles: {
          openRead: vi.fn(async (rel: string) => {
            if (h.desktopUnreadable.has(rel)) {
              throw new Error(`EACCES: permissão negada ao ler ${rel}`);
            }
            const data = h.desktopDisk.get(rel);
            if (!data) return null;
            const token = `read-${h.nextToken++}`;
            h.desktopReadTokens.set(token, { data, offset: 0 });
            return { token, size: data.byteLength, mtimeMs: 1 };
          }),
          readChunk: vi.fn(async (token: string, length: number) => {
            const state = h.desktopReadTokens.get(token);
            if (!state || state.offset >= state.data.byteLength) return null;
            const slice = state.data.subarray(state.offset, state.offset + length);
            state.offset += slice.byteLength;
            return slice;
          }),
          closeRead: vi.fn(async (token: string) => {
            h.desktopReadTokens.delete(token);
            return { ok: true };
          }),
          stageBegin: vi.fn(async ({ restoreToken, rel }: { restoreToken: string; rel: string }) => {
            const token = `stage-${h.nextToken++}`;
            h.desktopStaged.set(token, { restoreToken, rel, chunks: [] });
            return { token };
          }),
          write: vi.fn(async (token: string, chunk: Uint8Array) => {
            h.desktopStaged.get(token)?.chunks.push(new Uint8Array(chunk));
          }),
          end: vi.fn(async (token: string) => {
            const item = h.desktopStaged.get(token);
            if (!item) throw new Error("missing token");
            item.committed = true;
            return { path: item.rel, size: item.chunks.reduce((n, c) => n + c.byteLength, 0), sha256: "x" };
          }),
          abort: vi.fn(async (token: string) => {
            h.desktopStaged.delete(token);
          }),
          commitRestore: vi.fn(async (restoreToken: string, rels: string[]) => {
            const committed: Array<{ rel: string; existed: boolean }> = [];
            const planned = rels.map((rel) => ({ rel, existed: h.desktopDisk.has(rel) }));
            if (planned.length) {
              h.desktopJournals.set(restoreToken, {
                token: restoreToken,
                status: "committing-files",
                files: planned,
              });
            }
            for (const rel of rels) {
              const staged = Array.from(h.desktopStaged.values()).find(
                (entry) => entry.restoreToken === restoreToken && entry.rel === rel && entry.committed
              );
              if (!staged) throw new Error(`missing staged ${rel}`);
              const existed = h.desktopDisk.has(rel);
              const size = staged.chunks.reduce((n, c) => n + c.byteLength, 0);
              const out = new Uint8Array(size);
              let offset = 0;
              for (const c of staged.chunks) {
                out.set(c, offset);
                offset += c.byteLength;
              }
              if (existed) {
                h.desktopDisk.set(`__rb__/${restoreToken}/${rel}`, new Uint8Array(h.desktopDisk.get(rel)!));
              }
              h.desktopDisk.set(rel, out);
              committed.push({ rel, existed });
            }
            if (planned.length) {
              h.desktopJournals.set(restoreToken, {
                token: restoreToken,
                status: "committing-db",
                files: planned,
              });
            }
            return { committed };
          }),
          rollbackRestore: vi.fn(
            async (restoreToken: string, committed?: Array<{ rel: string; existed: boolean }>) => {
              const list =
                committed && committed.length
                  ? committed
                  : h.desktopJournals.get(restoreToken)?.files ?? [];
              for (const item of [...list].reverse()) {
                if (item.existed) {
                  const prev = h.desktopDisk.get(`__rb__/${restoreToken}/${item.rel}`);
                  if (prev) h.desktopDisk.set(item.rel, prev);
                } else {
                  h.desktopDisk.delete(item.rel);
                }
              }
              for (const key of Array.from(h.desktopDisk.keys())) {
                if (key.startsWith(`__rb__/${restoreToken}/`)) h.desktopDisk.delete(key);
              }
              h.desktopJournals.delete(restoreToken);
              return { ok: true };
            }
          ),
          markRestoreCommitted: vi.fn(async (restoreToken: string) => {
            const j = h.desktopJournals.get(restoreToken);
            if (!j) return { ok: false };
            h.desktopJournals.set(restoreToken, { ...j, status: "committed" });
            return { ok: true };
          }),
          listPendingRestores: vi.fn(async () =>
            Array.from(h.desktopJournals.entries()).map(([token, journal]) => ({
              token,
              journal,
            }))
          ),
          cleanupRestore: vi.fn(async (restoreToken: string) => {
            for (const key of Array.from(h.desktopDisk.keys())) {
              if (key.startsWith(`__rb__/${restoreToken}/`)) h.desktopDisk.delete(key);
            }
            for (const [k, v] of h.desktopStaged) {
              if (v.restoreToken === restoreToken) h.desktopStaged.delete(k);
            }
            h.desktopJournals.delete(restoreToken);
            return { ok: true };
          }),
        },
      };
    },
  },
}));

vi.mock("@/helpers/OpfsStore", () => ({
  isOpfsSupported: () => h.opfsSupported,
  isOpfsRel: (rel: string) =>
    /^(media-library|background-projection|background-sound|liturgy-files)\//.test(rel),
  opfsUrl: (val: string) => `/__opfs/${val.startsWith("opfs:") ? val.slice("opfs:".length) : val}`,
  opfsPathOf: (rel: string) => `opfs:${rel}`,
  relOf: (val: string) => {
    if (val.startsWith("opfs:")) return val.slice("opfs:".length);
    if (val.startsWith("/__opfs/")) return val.slice("/__opfs/".length);
    return val;
  },
  stagingRel: (token: string, kind: "restore" | "rollback", rel: string) => `.staging/${token}/${kind}/${rel}`,
  stagingJournalRel: (token: string) => `.staging/${token}/journal.json`,
  writeOpfsStream: (...args: Parameters<ReturnType<typeof makeInMemoryOpfs>["writeStream"]>) =>
    h.opfs!.writeStream(...args),
  writeOpfsText: (...args: Parameters<ReturnType<typeof makeInMemoryOpfs>["writeText"]>) =>
    h.opfs!.writeText(...args),
  readOpfsText: (...args: Parameters<ReturnType<typeof makeInMemoryOpfs>["readText"]>) =>
    h.opfs!.readText(...args),
  readOpfsFile: (...args: Parameters<ReturnType<typeof makeInMemoryOpfs>["readFile"]>) =>
    h.opfs!.readFile(...args),
  copyOpfsFile: (...args: Parameters<ReturnType<typeof makeInMemoryOpfs>["copyFile"]>) =>
    h.opfs!.copyFile(...args),
  opfsInfo: (...args: Parameters<ReturnType<typeof makeInMemoryOpfs>["info"]>) =>
    h.opfs!.info(...args),
  removeOpfs: (...args: Parameters<ReturnType<typeof makeInMemoryOpfs>["remove"]>) =>
    h.opfs!.remove(...args),
  removeStaging: (...args: Parameters<ReturnType<typeof makeInMemoryOpfs>["removeStaging"]>) =>
    h.opfs!.removeStaging(...args),
  listOpfs: (...args: Parameters<ReturnType<typeof makeInMemoryOpfs>["list"]>) =>
    h.opfs!.list(...args),
  listOpfsStagingTokens: () => h.opfs!.listStagingTokens(),
  pruneOpfsStaging: vi.fn(async () => false),
}));

vi.mock("@/helpers/StorageLimits", () => ({
  assertWebQuota: vi.fn(async () => {}),
}));

vi.mock("@/helpers/ExportSink", () => ({
  createExportSink: vi.fn(async () => {
    const chunks: Uint8Array[] = [];
    return {
      stream: new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(new Uint8Array(chunk));
        },
        close() {
          const total = chunks.reduce((n, c) => n + c.byteLength, 0);
          const merged = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            merged.set(c, off);
            off += c.byteLength;
          }
          h.exportedFile = new Blob([merged], { type: "application/zip" });
        },
      }),
      commit: async () => {},
      abort: async () => {},
    };
  }),
}));

vi.mock("@/helpers/IndexedDB", () => ({
  default: {
    getAll: async (table: string) => (h.rows.get(table) ?? []).map((r) => ({ ...r })),
    get: async (table: string, id: string) =>
      (h.rows.get(table) ?? []).find((r) => r.id === id),
    del: async (table: string, id: string) => {
      h.rows.set(
        table,
        (h.rows.get(table) ?? []).filter((r) => r.id !== id)
      );
    },
    clear: async (table: string) => {
      h.rows.delete(table);
    },
    put: async (table: string, row: { id: string }) => {
      const list = h.rows.get(table) ?? [];
      const idx = list.findIndex((item) => item.id === row.id);
      const copy = { ...row };
      if (idx >= 0) list[idx] = copy;
      else list.push(copy);
      h.rows.set(table, list);
    },
    replaceAllTables: async (
      data: ReadonlyMap<string, ReadonlyArray<{ id: string }>>,
      clearTables: readonly string[],
      commitMarker?: { table: string; row: { id: string } }
    ) => {
      if (h.replaceFailOnce) {
        h.replaceFailOnce = false;
        throw new Error("falha atômica IDB");
      }
      for (const table of clearTables) {
        h.rows.delete(table);
      }
      for (const [table, rows] of data) {
        h.rows.set(table, rows.map((r) => ({ ...r })));
      }
      if (commitMarker) {
        const list = h.rows.get(commitMarker.table) ?? [];
        const idx = list.findIndex((r) => r.id === commitMarker.row.id);
        if (idx >= 0) list[idx] = { ...commitMarker.row };
        else list.push({ ...commitMarker.row });
        h.rows.set(commitMarker.table, list);
      }
    },
  },
}));

import DatabaseBackup, { recoverPendingBackupRestore } from "@/helpers/DatabaseBackup";
import { loadZipJs } from "@/helpers/Zip";

const encBytes = (s: string) => new TextEncoder().encode(s);
const decBytes = (b?: Uint8Array) => (b ? new TextDecoder().decode(b) : "");

describe("DatabaseBackup portability, atomic restore & crash recovery", () => {
  beforeEach(() => {
    h.rows.clear();
    h.desktopDisk.clear();
    h.desktopUnreadable.clear();
    h.desktopJournals.clear();
    h.desktopStaged.clear();
    h.desktopReadTokens.clear();
    h.replaceFailOnce = false;
    h.isDesktop = false;
    h.opfsSupported = true;
    h.lockBusy = false;
    h.exportedFile = null;
    h.opfs = makeInMemoryOpfs();
    vi.stubGlobal("navigator", {
      locks: {
        request: vi.fn(async (_name: string, _opts: unknown, cb: (_lock: unknown) => Promise<unknown>) => {
          return cb(h.lockBusy ? null : { name: _name });
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("desktop: exporta arquivos físicos do acervo (incluindo path relativo e louvorja://files/) e restaura em perfil limpo + faz rollback em falha", async () => {
    h.isDesktop = true;
    const videoBytes = new TextEncoder().encode("DESKTOP-MP4-CONTENT");
    const bgBytes = new TextEncoder().encode("BG-LOOP-VIDEO");
    const soundBytes = new TextEncoder().encode("AMBIENT-AUDIO");
    const liturgyBytes = new TextEncoder().encode("SLIDE-ATTACH");
    h.desktopDisk.set("media-library/v1/culto%201.mp4", videoBytes);
    h.desktopDisk.set("background-projection/bg1/ceu.mp4", bgBytes);
    h.desktopDisk.set("background-sound/bs1/chuva.mp3", soundBytes);
    h.desktopDisk.set("liturgy-files/lf1/anexo.png", liturgyBytes);

    h.rows.set(DB_TABLE.MEDIA_LIBRARY, [
      {
        id: "v1",
        type: "video",
        path: "media-library/v1/culto%201.mp4",
        url: "louvorja://files/media-library/v1/culto%25201.mp4",
        remoteUrl: "https://cdn.example.com/ignore.mp4",
      },
    ]);
    h.rows.set(DB_TABLE.BACKGROUND_PROJECTION_LIBRARY, [
      { id: "bg1", path: "louvorja://files/background-projection/bg1/ceu.mp4" },
    ]);
    h.rows.set(DB_TABLE.BACKGROUND_SOUND_LIBRARY, [
      { id: "bs1", path: "background-sound/bs1/chuva.mp3" },
    ]);
    h.rows.set(DB_TABLE.LITURGY_FILES, [
      { id: "lf1", path: "liturgy-files/lf1/anexo.png" },
    ]);

    await DatabaseBackup.exportAll();
    expect(h.exportedFile).not.toBeNull();

    const { ZipReader, BlobReader, TextWriter } = await loadZipJs();
    const zr = new ZipReader(new BlobReader(h.exportedFile!));
    const entries = await zr.getEntries();
    const manifestEntry = entries.find((e) => e.filename === "manifest.json") as import("@zip.js/zip.js").FileEntry;
    const manifest = JSON.parse(String(await manifestEntry.getData(new TextWriter())));
    await zr.close();

    expect(manifest.platform).toBe("desktop");
    expect(manifest.library.map((x: { path: string }) => x.path).sort()).toEqual([
      "background-projection/bg1/ceu.mp4",
      "background-sound/bs1/chuva.mp3",
      "liturgy-files/lf1/anexo.png",
      "media-library/v1/culto%201.mp4",
    ]);

    // Perfil limpo sem acervo: restaura tudo e recria os arquivos físicos
    h.rows.clear();
    h.desktopDisk.clear();

    const backupFile = new File([await h.exportedFile!.arrayBuffer()], "desktop.ljdb");
    const result = await DatabaseBackup.importAll(backupFile);
    expect(result.rows).toBe(4);
    expect(new TextDecoder().decode(h.desktopDisk.get("media-library/v1/culto%201.mp4"))).toBe(
      "DESKTOP-MP4-CONTENT"
    );
    expect(new TextDecoder().decode(h.desktopDisk.get("liturgy-files/lf1/anexo.png"))).toBe(
      "SLIDE-ATTACH"
    );

    // Se commit do IDB falhar no desktop, rollbackRestore devolve arquivo prévio e apaga arquivo novo
    h.desktopDisk.clear();
    const oldBytes = new TextEncoder().encode("OLD-BG");
    h.desktopDisk.set("background-projection/bg1/ceu.mp4", oldBytes);
    h.replaceFailOnce = true;

    await expect(DatabaseBackup.importAll(backupFile)).rejects.toThrow("falha atômica IDB");
    expect(new TextDecoder().decode(h.desktopDisk.get("background-projection/bg1/ceu.mp4"))).toBe("OLD-BG");
    expect(h.desktopDisk.has("media-library/v1/culto%201.mp4")).toBe(false);
  });

  it("migração bidirecional Web OPFS <-> Desktop adapta path/url/thumb corretamente", async () => {
    // 1) Cria backup no Web OPFS
    h.isDesktop = false;
    const payload = new TextEncoder().encode("WEB-IMAGE");
    const thumb = new TextEncoder().encode("WEB-THUMB");
    await h.opfs!.writeStream(
      "media-library/img1/foto.jpg",
      new ReadableStream({
        start(c) {
          c.enqueue(payload);
          c.close();
        },
      })
    );
    await h.opfs!.writeStream(
      "media-library/img1/thumb.webp",
      new ReadableStream({
        start(c) {
          c.enqueue(thumb);
          c.close();
        },
      })
    );
    h.rows.set(DB_TABLE.MEDIA_LIBRARY, [
      {
        id: "img1",
        type: "image",
        path: "opfs:media-library/img1/foto.jpg",
        url: "/__opfs/media-library/img1/foto.jpg",
        thumbUrl: "/__opfs/media-library/img1/thumb.webp",
      },
    ]);

    await DatabaseBackup.exportAll();
    const webZipFile = new File([await h.exportedFile!.arrayBuffer()], "web.ljdb");

    // 2) Importa no Desktop -> deve converter opfs: e /__opfs/ para relativo e louvorja://files/...
    h.isDesktop = true;
    h.rows.clear();
    h.desktopDisk.clear();
    await DatabaseBackup.importAll(webZipFile);

    const desktopRow = h.rows.get(DB_TABLE.MEDIA_LIBRARY)?.[0];
    expect(desktopRow?.path).toBe("media-library/img1/foto.jpg");
    expect(desktopRow?.url).toBe("louvorja://files/media-library/img1/foto.jpg");
    expect(desktopRow?.thumbUrl).toBe("louvorja://files/media-library/img1/thumb.webp");
    expect(new TextDecoder().decode(h.desktopDisk.get("media-library/img1/foto.jpg"))).toBe("WEB-IMAGE");

    // 3) Exporta do Desktop e reimporta no Web OPFS -> converte de volta para opfs: e /__opfs/...
    h.exportedFile = null;
    await DatabaseBackup.exportAll();
    const desktopZipFile = new File([await h.exportedFile!.arrayBuffer()], "desktop.ljdb");

    h.isDesktop = false;
    h.rows.clear();
    h.opfs = makeInMemoryOpfs();
    await DatabaseBackup.importAll(desktopZipFile);

    const webRow = h.rows.get(DB_TABLE.MEDIA_LIBRARY)?.[0];
    expect(webRow?.path).toBe("opfs:media-library/img1/foto.jpg");
    expect(webRow?.url).toBe("/__opfs/media-library/img1/foto.jpg");
    expect(webRow?.thumbUrl).toBe("/__opfs/media-library/img1/thumb.webp");
    expect(await h.opfs!.readText("media-library/img1/foto.jpg")).toBe("WEB-IMAGE");
  });

  it("recoverPendingBackupRestore: antes do commit do banco restaura rollback OPFS; depois do commit mantém novos arquivos e limpa marcador", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const dec = (u?: Uint8Array) => (u ? new TextDecoder().decode(u) : null);

    // Cenário A: crash ANTES do commit atômico do IndexedDB (journal committing-db sem marcador no CACHE)
    const tokenBefore = "tok-before";
    h.opfs!.files.set("media-library/a/keep.jpg", enc("CORRUPTED-OR-NEW"));
    h.opfs!.files.set("media-library/b/added.jpg", enc("ONLY-NEW"));
    h.opfs!.files.set(`.staging/${tokenBefore}/rollback/media-library/a/keep.jpg`, enc("ORIGINAL"));
    await h.opfs!.writeText(
      `.staging/${tokenBefore}/journal.json`,
      JSON.stringify({
        token: tokenBefore,
        status: "committing-db",
        hasLibraryFiles: true,
        files: [
          { rel: "media-library/a/keep.jpg", existed: true },
          { rel: "media-library/b/added.jpg", existed: false },
        ],
      })
    );

    await recoverPendingBackupRestore();

    expect(dec(h.opfs!.files.get("media-library/a/keep.jpg"))).toBe("ORIGINAL");
    expect(h.opfs!.files.has("media-library/b/added.jpg")).toBe(false);
    expect(h.opfs!.listStagingTokens()).toEqual([]);

    // Cenário B: crash APÓS o commit atômico do IndexedDB (__backup_commit__ presente com token correspondente)
    const tokenAfter = "tok-after";
    h.opfs!.files.set("media-library/a/keep.jpg", enc("RESTORED-FINAL"));
    h.opfs!.files.set(`.staging/${tokenAfter}/rollback/media-library/a/keep.jpg`, enc("OLD-BACKUP"));
    await h.opfs!.writeText(
      `.staging/${tokenAfter}/journal.json`,
      JSON.stringify({
        token: tokenAfter,
        status: "committing-db",
        hasLibraryFiles: true,
        files: [{ rel: "media-library/a/keep.jpg", existed: true }],
      })
    );
    h.rows.set(DB_TABLE.CACHE, [{ id: "__backup_commit__", token: tokenAfter }]);

    await recoverPendingBackupRestore();

    expect(dec(h.opfs!.files.get("media-library/a/keep.jpg"))).toBe("RESTORED-FINAL");
    expect(h.opfs!.listStagingTokens()).toEqual([]);
    expect((h.rows.get(DB_TABLE.CACHE) ?? []).find((r) => r.id === "__backup_commit__")).toBeUndefined();
  });

  it("lock entre abas: impede restauração simultânea e impede boot cleanup de apagar staging ativo", async () => {
    h.lockBusy = true;
    const token = "active-other-tab";
    await h.opfs!.writeText(`.staging/${token}/journal.json`, "{}");

    await recoverPendingBackupRestore();
    // Como a trava estava ocupada, o boot da outra aba NÃO deve tocar em .staging
    expect(h.opfs!.listStagingTokens()).toEqual([token]);

    await expect(
      DatabaseBackup.importAll(new File([new Uint8Array([1, 2, 3])], "x.ljdb"))
    ).rejects.toThrow("outra aba");
  });

  it("desktop: falha claramente quando arquivo físico não pode ser lido e lista ausentes em omittedFiles", async () => {
    h.isDesktop = true;
    h.rows.set(DB_TABLE.MEDIA_LIBRARY, [
      { id: "m1", name: "bloqueado.mp4", path: "media-library/m1/bloqueado.mp4" },
    ]);
    h.desktopDisk.set("media-library/m1/bloqueado.mp4", encBytes("VID"));
    h.desktopUnreadable.add("media-library/m1/bloqueado.mp4");

    // 1) Erro real de leitura (permissão / EIO) deve falhar a exportação, nunca omitir em silêncio.
    await expect(DatabaseBackup.exportAll()).rejects.toThrow("EACCES");

    // 2) Arquivo ausente (ENOENT) é registrado no manifest e devolvido em omittedFiles (não silencioso).
    h.desktopUnreadable.clear();
    h.desktopDisk.clear();
    h.rows.set(DB_TABLE.MEDIA_LIBRARY, [
      { id: "m2", name: "sumiu.jpg", path: "media-library/m2/sumiu.jpg" },
    ]);
    await expect(
      DatabaseBackup.exportAll(undefined, { failOnMissingFiles: true })
    ).rejects.toThrow("media-library/m2/sumiu.jpg");

    const partial = await DatabaseBackup.exportAll();
    expect(partial.omittedFiles).toEqual(["media-library/m2/sumiu.jpg"]);
    const imported = await DatabaseBackup.importAll(new File([h.exportedFile!], partial.fileName));
    expect(imported.omittedFiles).toEqual(["media-library/m2/sumiu.jpg"]);
  });

  it("desktop: recoverPendingBackupRestore reverte arquivos se cair após commitRestore e antes do IDB", async () => {
    h.isDesktop = true;
    const token = "desk-crash-before-idb";
    h.desktopDisk.set("media-library/k1/keep.jpg", encBytes("CORRUPT-NEW"));
    h.desktopDisk.set(`__rb__/${token}/media-library/k1/keep.jpg`, encBytes("ORIGINAL-SAFE"));
    h.desktopDisk.set("media-library/k2/added.jpg", encBytes("ADDED-NEW"));
    h.desktopJournals.set(token, {
      token,
      status: "committing-db",
      files: [
        { rel: "media-library/k1/keep.jpg", existed: true },
        { rel: "media-library/k2/added.jpg", existed: false },
      ],
    });

    await recoverPendingBackupRestore();

    expect(decBytes(h.desktopDisk.get("media-library/k1/keep.jpg"))).toBe("ORIGINAL-SAFE");
    expect(h.desktopDisk.has("media-library/k2/added.jpg")).toBe(false);
    expect(h.desktopJournals.size).toBe(0);

    // Após commit do IDB (__backup_commit__ presente), mantém novos arquivos e limpa marcador/journal.
    const tokenDone = "desk-crash-after-idb";
    h.desktopDisk.set("media-library/k1/keep.jpg", encBytes("RESTORED-FINAL"));
    h.desktopDisk.set(`__rb__/${tokenDone}/media-library/k1/keep.jpg`, encBytes("OLD"));
    h.desktopJournals.set(tokenDone, {
      token: tokenDone,
      status: "committing-db",
      files: [{ rel: "media-library/k1/keep.jpg", existed: true }],
    });
    h.rows.set(DB_TABLE.CACHE, [{ id: "__backup_commit__", token: tokenDone }]);

    await recoverPendingBackupRestore();

    expect(decBytes(h.desktopDisk.get("media-library/k1/keep.jpg"))).toBe("RESTORED-FINAL");
    expect(h.desktopJournals.size).toBe(0);
    expect((h.rows.get(DB_TABLE.CACHE) ?? []).find((r) => r.id === "__backup_commit__")).toBeUndefined();
  });
});
