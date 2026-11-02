import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Program } from "@/types/Presentation";

const ROOT = "/Users/operador/OneDrive/Igreja";

// Pasta da igreja de mentira: arquivo → { doc, mtime }.
const m = vi.hoisted(() => ({
  files: new Map<string, { doc: unknown; mtime: number }>(),
  copies: new Map<string, unknown>(),
  docs: new Map<string, unknown>(),
  root: "",
  clock: 1000,
  setRoot: (_v: string): unknown => undefined,
}));
const key = (kind: string, name: string) => `${kind}/${name}`;

vi.mock("@/helpers/Platform", () => ({
  default: {
    isDesktop: true,
    computerName: async () => "Notebook da sonoplastia",
    church: async (
      op: string,
      root: string,
      kind: string,
      name: string,
      doc?: unknown,
      opts?: { expectMtime?: number | null }
    ) => {
      if (!root) return { ok: false, error: "invalid" };
      const f = m.files.get(key(kind, name));
      const copies = [...m.copies.keys()]
        .filter((k) => k.startsWith(`${kind}/${name}-`))
        .map((k) => k.split("/")[1]);
      if (op === "stat")
        return { ok: true, exists: !!f, mtimeMs: f?.mtime ?? null, conflicts: copies };
      if (op === "read") return { ok: true, doc: f?.doc ?? null, mtimeMs: f?.mtime ?? null };
      if (op === "write") {
        if (opts && "expectMtime" in opts && (f?.mtime ?? null) !== opts.expectMtime)
          return { ok: false, error: "changed", mtimeMs: f?.mtime ?? null };
        m.files.set(key(kind, name), { doc: JSON.parse(JSON.stringify(doc)), mtime: ++m.clock });
        return { ok: true, mtimeMs: m.clock };
      }
      if (op === "conflicts")
        return {
          ok: true,
          copies: copies.map((c) => ({ file: c, doc: m.copies.get(`${kind}/${c}`), mtimeMs: 1 })),
        };
      if (op === "resolve") {
        const keep = doc as unknown as string;
        if (keep !== "main")
          m.files.set(key(kind, name), { doc: m.copies.get(`${kind}/${keep}`), mtime: ++m.clock });
        copies.forEach((c) => m.copies.delete(`${kind}/${c}`));
        return { ok: true, mtimeMs: m.clock };
      }
      return { ok: false, error: "invalid" };
    },
  },
}));
vi.mock("@/helpers/DocStore", () => ({
  default: {
    get: async (_t: string, id: string) => m.docs.get(id),
    put: async (_t: string, v: { id: string }) =>
      void m.docs.set(v.id, JSON.parse(JSON.stringify(v))),
  },
}));
vi.mock("@/helpers/UserData", async () => {
  const { reactive } = await import("vue");
  const state = reactive({ root: "" });
  m.setRoot = (v: string) => (state.root = v);
  return { default: { get: () => state.root, set: () => {} } };
});
vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn(), captureException: vi.fn() } }));

import {
  checkRemote,
  conflictVersions,
  flushProgram,
  loadProgram,
  resolveConflict,
  saveProgram,
  sync,
} from "../programStore";

const program = (title: string): Program => ({
  id: "2026-10-10",
  date: "2026-10-10",
  plannedStart: "08:55",
  sessions: [
    {
      id: "s",
      label: "Culto",
      items: [
        { id: "a", kind: "folder", title, plannedMinutes: 6, folder: `${ROOT}/Sábado/Anúncios` },
      ],
    },
  ],
  createdAt: "",
  updatedAt: "",
});
const onDisk = () =>
  m.files.get("program/2026-10-10")?.doc as { savedBy: string; program: Program } | undefined;
/** Outro computador grava o arquivo. */
const otherSaves = (title: string) =>
  m.files.set("program/2026-10-10", {
    doc: {
      version: 1,
      savedBy: "PC da igreja",
      savedAt: "2026-10-10T08:00:00Z",
      program: {
        ...program(title),
        sessions: [
          {
            id: "s",
            label: "Culto",
            items: [
              {
                id: "a",
                kind: "folder",
                title,
                plannedMinutes: 6,
                folder: "igreja:Sábado/Anúncios",
              },
            ],
          },
        ],
      },
    },
    mtime: ++m.clock,
  });

beforeEach(() => {
  m.files.clear();
  m.copies.clear();
  m.docs.clear();
  m.root = ROOT;
  m.setRoot(ROOT);
});
afterEach(() => vi.useRealTimers());

describe("programStore", () => {
  it("sem pasta da igreja, fica só neste computador", async () => {
    m.root = "";
    m.setRoot("");
    m.docs.set("2026-10-10", program("Local"));
    expect((await loadProgram("2026-10-10"))?.sessions[0].items[0].title).toBe("Local");
    expect(sync.state).toBe("local");
    saveProgram(program("Outro"));
    await flushProgram();
    expect(m.files.size).toBe(0);
  });

  it("o programa que já existia neste computador vai para a pasta, com caminhos portáveis", async () => {
    m.docs.set("2026-10-10", program("Anúncios"));
    await loadProgram("2026-10-10");
    expect(onDisk()?.program.sessions[0].items[0].folder).toBe("igreja:Sábado/Anúncios");
    expect(onDisk()?.savedBy).toBe("Notebook da sonoplastia");
    expect(sync.state).toBe("saved");
  });

  it("lê da pasta e devolve os caminhos deste computador", async () => {
    otherSaves("Da igreja");
    const p = await loadProgram("2026-10-10");
    expect(p?.sessions[0].items[0].folder).toBe(`${ROOT}/Sábado/Anúncios`);
    expect(sync.savedBy).toBe("PC da igreja");
  });

  it("grava as edições juntas, depois que assentam", async () => {
    vi.useFakeTimers();
    otherSaves("v1");
    await loadProgram("2026-10-10");
    saveProgram(program("v2"));
    saveProgram(program("v3"));
    expect(sync.state).toBe("saving");
    await vi.advanceTimersByTimeAsync(600);
    expect(onDisk()?.program.sessions[0].items[0].title).toBe("v3");
    expect(sync.state).toBe("saved");
  });

  it("versão nova de outro computador chega sozinha quando não há edição daqui", async () => {
    otherSaves("v1");
    await loadProgram("2026-10-10");
    expect(await checkRemote()).toBeNull();
    otherSaves("v2 da igreja");
    const remote = await checkRemote();
    expect(remote?.sessions[0].items[0].title).toBe("v2 da igreja");
    expect(sync.externalAt).toBeGreaterThan(0);
  });

  it("não sobrescreve o que o outro computador salvou no meio de uma edição daqui", async () => {
    otherSaves("v1");
    await loadProgram("2026-10-10");
    otherSaves("da igreja");
    saveProgram(program("daqui"));
    await flushProgram();
    expect(onDisk()?.program.sessions[0].items[0].title).toBe("da igreja");
    expect(sync.state).toBe("conflict");
    const versions = await conflictVersions(program("daqui"));
    expect(versions.map((v) => v.key)).toEqual(["local", "main"]);
    // O operador fica com a daqui.
    await resolveConflict("local", program("daqui"));
    expect(onDisk()?.program.sessions[0].items[0].title).toBe("daqui");
    expect(sync.state).toBe("saved");
  });

  it("cópias em conflito do OneDrive: escolher uma delas a torna o arquivo", async () => {
    otherSaves("principal");
    m.copies.set("program/2026-10-10-PC.json", {
      version: 1,
      savedBy: "PC",
      savedAt: "x",
      program: program("cópia"),
    });
    await loadProgram("2026-10-10");
    expect(sync.state).toBe("conflict");
    expect(sync.conflicts).toEqual(["2026-10-10-PC.json"]);
    const chosen = await resolveConflict("2026-10-10-PC.json", program("qualquer"));
    expect(chosen?.sessions[0].items[0].title).toBe("cópia");
    expect(m.copies.size).toBe(0);
    expect(sync.state).toBe("saved");
  });
});
