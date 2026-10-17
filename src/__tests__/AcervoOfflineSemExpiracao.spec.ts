import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AUDIO_CACHE, IMAGE_CACHE } from "@/helpers/WebFileStore";

/**
 * "Baixar álbum" grava nos mesmos caches que o service worker consulta, e o
 * fetch do download passa pela rota dele. Com `expiration` nessas rotas o
 * workbox registrava cada arquivo baixado e apagava os mais antigos acima do
 * limite (500 áudios, 200 imagens): o acervo de milhares de arquivos nunca
 * ficava completo, os álbuns voltavam a "não baixado" e o tablet baixava tudo
 * de novo a cada tentativa — sem erro no console, e gastando a cota da API.
 */
const config = readFileSync("vite.config.js", "utf8");

function rota(cacheName: string): string {
  const inicio = config.indexOf(`cacheName: "${cacheName}"`);
  expect(inicio, `rota do cache ${cacheName} em vite.config.js`).toBeGreaterThan(-1);
  // Até a rota seguinte: as opções têm objetos aninhados, e não um fecho único.
  return config.slice(inicio, config.indexOf("urlPattern", inicio));
}

describe("caches do acervo baixado no service worker", () => {
  it.each([AUDIO_CACHE, IMAGE_CACHE])("%s não expira nem tem limite de entradas", (nome) => {
    expect(rota(nome)).not.toMatch(/expiration|maxEntries|maxAgeSeconds/);
  });

  it.each([AUDIO_CACHE, IMAGE_CACHE])("%s não guarda resposta opaca", (nome) => {
    expect(rota(nome)).toMatch(/cacheableResponse:\s*\{\s*statuses:\s*\[200\]\s*\}/);
  });

  it("o áudio em cache continua atendendo Range", () => {
    expect(rota(AUDIO_CACHE)).toMatch(/rangeRequests:\s*true/);
  });
});
