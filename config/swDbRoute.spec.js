import { describe, expect, it } from "vitest";
import { dbCachePattern } from "./swDbRoute.cjs";

const DB = "https://api.louvorja.workers.dev/json_db";

describe("rota do service worker para o banco", () => {
  const pattern = dbCachePattern(DB);

  it("cobre os datasets do catálogo", () => {
    expect(pattern.test(`${DB}/pt_musics`)).toBe(true);
    expect(pattern.test(`${DB}/pt_musics?20261013`)).toBe(true);
    expect(pattern.test(`${DB}/music_123`)).toBe(true);
  });

  it("deixa o config seguir para a rede, com ou sem query", () => {
    expect(pattern.test(`${DB}/config`)).toBe(false);
    expect(pattern.test(`${DB}/config?_=1760000000000`)).toBe(false);
    expect(pattern.test(`${DB}/config#x`)).toBe(false);
  });

  it("não confunde datasets que só começam com a palavra config", () => {
    expect(pattern.test(`${DB}/config_extra`)).toBe(true);
    expect(pattern.test(`${DB}/configuracoes`)).toBe(true);
  });

  it("pedidos explicitamente novos não passam pelo stale-while-revalidate", () => {
    expect(pattern.test(`${DB}/pt_musics?fresh=1&_=123`)).toBe(false);
    expect(pattern.test(`${DB}/pt_musics?_=123&fresh=1`)).toBe(false);
    expect(pattern.test(`${DB}/pt_musics?fresh=10`)).toBe(true);
  });

  it("não casa outras origens", () => {
    expect(pattern.test("https://outra.test/json_db/pt_musics")).toBe(false);
  });
});
