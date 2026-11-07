import { describe, expect, it } from "vitest";
import { dbCachePattern, mediaCachePattern } from "./swDbRoute.cjs";
import { DOMAINS } from "./cspDomains.cjs";

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

describe("rotas do service worker para a mídia baixada", () => {
  const FILES = "https://api.louvorja.workers.dev/file";
  const images = mediaCachePattern([FILES, ...DOMAINS.FILES], ["jpg", "jpeg", "png"]);
  const audio = mediaCachePattern([FILES, ...DOMAINS.FILES], ["mp3", "opus"]);

  it("cobre o armazenamento para onde o catálogo aponta capas, imagens e áudio", () => {
    expect(images.test("https://files.louvorja.com.br/covers/2004.jpg")).toBe(true);
    expect(images.test("https://files.louvorja.com.br/images/hasd_128A.JPG")).toBe(true);
    expect(
      audio.test("https://files.louvorja.com.br/musics/pt/Diversas/Vou%20Testemunhar.mp3")
    ).toBe(true);
  });

  it("continua cobrindo o endereço antigo pela API", () => {
    expect(images.test(`${FILES}/covers/2004.jpg?v=2`)).toBe(true);
    expect(audio.test(`${FILES}/musics/pt/a.opus`)).toBe(true);
  });

  it("o curinga vale para subdomínios, não para hosts que só contêm o domínio", () => {
    expect(images.test("https://louvorja.com.br/covers/a.jpg")).toBe(false);
    expect(images.test("https://files.louvorja.com.br.outro.test/a.jpg")).toBe(false);
    expect(images.test("https://outro.test/files.louvorja.com.br/a.jpg")).toBe(false);
  });

  it("cada rota só casa as extensões dela", () => {
    expect(images.test("https://files.louvorja.com.br/musics/pt/a.mp3")).toBe(false);
    expect(audio.test("https://files.louvorja.com.br/covers/a.jpg")).toBe(false);
  });

  it("sem origem configurada, casa pela extensão", () => {
    const anyHost = mediaCachePattern([], ["jpg"]);
    expect(anyHost.test("https://qualquer.test/a.jpg")).toBe(true);
    expect(anyHost.test("https://qualquer.test/a.png")).toBe(false);
  });
});
