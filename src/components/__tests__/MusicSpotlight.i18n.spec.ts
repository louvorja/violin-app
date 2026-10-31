import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * O `t` do MusicSpotlight prefixa `components.music_search.`: uma chave que
 * falta não dá erro, a tela mostra o caminho. Foi o que aconteceu com os botões
 * de versão (cantado, playback, só áudio) na busca do "Adicionar item" do Modo
 * apresentação — o leitor de tela e a dica liam `components.music_search.audio`.
 */

const fonte = readFileSync("src/components/MusicSpotlight.vue", "utf8");
const usadas = [...new Set([...fonte.matchAll(/(?<![\w.])t\(\s*["']([\w.]+)["']/g)].map((m) => m[1]))];

describe("MusicSpotlight — traduções", () => {
  it("acha as chaves usadas no componente", () => {
    expect(usadas).toEqual(expect.arrayContaining(["audio", "playback", "audio_only", "playback_only"]));
  });

  it.each(["pt", "es"])("toda chave existe em %s", (idioma) => {
    const lang = JSON.parse(readFileSync(`src/lang/${idioma}.json`, "utf8"));
    const bloco = lang.components.music_search as Record<string, unknown>;
    expect(usadas.filter((k) => typeof bloco[k] !== "string")).toEqual([]);
  });
});
