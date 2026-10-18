import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_TABLE } from "@/constants/DbTables";
import {
  migratePrivateStorageReferences,
  rewritePrivateFileReferences,
  validatePrivatePathMappings,
} from "../PrivateStorageMigration";

const mocks = vi.hoisted(() => ({ rewriteRecords: vi.fn() }));
vi.mock("@/helpers/IndexedDB", () => ({ default: mocks }));
const mappings = validatePrivatePathMappings([
  { from: "/old/files/library/media", to: "/profile/attachments/media" },
]);
beforeEach(() => vi.resetAllMocks());

describe("referências pessoais na migração de armazenamento", () => {
  it("reescreve somente referências dentro do diretório copiado; mantém texto, URLs remotas e prefixos parecidos", () => {
    const original = {
      id: "personal-1",
      path: "/old/files/library/media/slides.pdf",
      title: "/old/files/library/media/slides.pdf",
      neighbors: [
        { path: "/old/files/library/media-other/no.pdf" },
        { path: "/outside/no.pdf" },
        { url: "https://example.org/old/files/library/media/no.pdf" },
      ],
      traversal: { path: "/old/files/library/media/../outside.pdf" },
    };
    const next = rewritePrivateFileReferences(original, mappings);
    expect(next.path).toBe("/profile/attachments/media/slides.pdf");
    expect(next.title).toBe(original.title);
    expect(next.neighbors).toEqual(original.neighbors);
    expect(next.traversal).toEqual(original.traversal);
    expect(original.path).toBe("/old/files/library/media/slides.pdf");
    expect(rewritePrivateFileReferences(next, mappings)).toBe(next);
  });

  it("preserva Blob, ArrayBuffer, views, datas, valores nulos e ciclos sem serializar os dados", () => {
    const bytes = new Uint8Array([0, 255, 7, 128]);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const date = new Date("2026-10-18T00:00:00Z");
    const original: Record<string, unknown> = {
      id: "1",
      path: "/old/files/library/media/a.pdf",
      blob,
      data: bytes.buffer,
      bytes,
      date,
      empty: null,
    };
    original.self = original;
    const next = rewritePrivateFileReferences(original, mappings);
    expect(next.blob).toBe(blob);
    expect(next.data).toBe(bytes.buffer);
    expect(next.bytes).toBe(bytes);
    expect([...new Uint8Array(next.data as ArrayBuffer)]).toEqual([0, 255, 7, 128]);
    expect(next.date).toBe(date);
    expect(next.empty).toBeNull();
    expect(next.self).toBe(next);
  });

  it("preserva espaços, caracteres reservados e URLs locais do Electron", () => {
    const original = {
      url: "louvorja://local/old/files/library/media/M%C3%BAsica%20%231.pdf",
      nested: { uri: "file:///old/files/library/media/a%3Fb.pdf" },
    };
    expect(rewritePrivateFileReferences(original, mappings)).toEqual({
      url: "louvorja://local/profile/attachments/media/M%C3%BAsica%20%231.pdf",
      nested: { uri: "file:///profile/attachments/media/a%3Fb.pdf" },
    });
  });

  it("compara caminhos Windows sem diferenciar caixa e preserva o formato da referência", () => {
    const win = validatePrivatePathMappings([
      {
        from: "D:\\Old\\files\\library\\media",
        to: "C:\\Users\\Ana\\AppData\\Roaming\\LouvorJA Violin\\attachments\\media",
      },
    ]);
    const next = rewritePrivateFileReferences(
      {
        path: "d:\\old\\files\\library\\media\\Slide.pdf",
        src: "file:///D:/Old/files/library/media/Slide.pdf",
      },
      win
    );
    expect(next.path).toBe(
      "C:\\Users\\Ana\\AppData\\Roaming\\LouvorJA Violin\\attachments\\media\\Slide.pdf"
    );
    expect(next.src).toBe(
      "file:///C:/Users/Ana/AppData/Roaming/LouvorJA%20Violin/attachments/media/Slide.pdf"
    );
  });

  it("rejeita mapas inválidos e diretórios amplos antes de abrir qualquer tabela", async () => {
    for (const value of [
      null,
      {},
      [{ from: "/", to: "/profile" }],
      [{ from: "C:\\", to: "D:\\profile" }],
      [{ from: "relative", to: "/profile" }],
      [{ from: "/old/../private", to: "/profile" }],
    ]) {
      await expect(migratePrivateStorageReferences(value)).rejects.toThrow();
    }
    expect(mocks.rewriteRecords).not.toHaveBeenCalled();
  });

  it("migra só tabelas pessoais e deixa catálogo, Bíblia, caches, dispositivos e chat intactos", async () => {
    await migratePrivateStorageReferences(mappings);
    const tables = mocks.rewriteRecords.mock.calls.map(([table]) => table);
    expect(tables).toContain(DB_TABLE.MEDIA_LIBRARY);
    expect(tables).toContain(DB_TABLE.LITURGY_LIBRARY);
    for (const table of [
      DB_TABLE.MUSICS,
      DB_TABLE.ALBUMS,
      DB_TABLE.BIBLE_CHAPTERS,
      DB_TABLE.CACHE,
      DB_TABLE.DEVICES,
      DB_TABLE.CHAT_MESSAGES,
    ])
      expect(tables).not.toContain(table);
  });

  it("propaga falha de persistência e permite tentar novamente sem marcador prematuro", async () => {
    mocks.rewriteRecords.mockRejectedValueOnce(new Error("disk full"));
    await expect(migratePrivateStorageReferences(mappings)).rejects.toThrow("disk full");
    expect(mocks.rewriteRecords).toHaveBeenCalledOnce();
    mocks.rewriteRecords.mockResolvedValue(0);
    await expect(migratePrivateStorageReferences(mappings)).resolves.toBeUndefined();
  });
});
