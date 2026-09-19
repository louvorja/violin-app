/**
 * O gravador de replay do PostHog descarta mutações de style/class acima de 10 por
 * segundo em um mesmo elemento (balde de 100, reposição de 10/s): a barra parece
 * congelada no replay. O gauge do Footer recebia o progresso a cada quadro (~60/s).
 * https://posthog.com/docs/session-replay/troubleshooting#element-looks-frozen-because-of-rapid-dom-changes
 */
import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";
import ptMusics from "./fixtures/pt_musics.json";
import music1 from "./fixtures/music_1.json";

const LIMITE_POSTHOG_POR_SEGUNDO = 10;
const JANELA_MS = 3000;

function wavSilencioso(segundos, taxa = 8000) {
  const amostras = segundos * taxa;
  const buf = Buffer.alloc(44 + amostras, 128);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + amostras, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(taxa, 24);
  buf.writeUInt32LE(taxa, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(amostras, 40);
  return buf;
}

test("barra de progresso do Footer respeita o limite de mutações do replay", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const context = await browser.newContext();
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/pt_musics*", (route) => route.fulfill({ json: ptMusics }));
  await context.route("**/music_1*", (route) =>
    route.fulfill({ json: { ...music1, url_music: "musics/pt/Teste/001.wav" } })
  );
  await context.route("**/001.wav", (route) =>
    route.fulfill({ body: wavSilencioso(20), contentType: "audio/wav" })
  );

  const page = await context.newPage();
  await page.goto("/");
  await page.locator("#ribbon-tab-collections").waitFor({ state: "visible", timeout: 20_000 });
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-musics"]').click();

  const linha = page.locator('[data-testid="music-row-1"]');
  await expect(linha).toBeVisible({ timeout: 10_000 });
  await linha.hover();
  await linha.locator('[data-testid="mmt-btn-sing"]').click();

  // O operador toca com o player minimizado no Footer; é ali que o gauge aparece.
  await page.getByTitle("Minimizar").click();
  const preenchimento = page.locator(".player-gauge-fill");
  await expect(preenchimento).toBeAttached({ timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => document.querySelector(".player-gauge-fill")?.style.width), {
      timeout: 15_000,
    })
    .not.toBe("0%");

  // Mesma regra do gravador: contagem por elemento, uma vez por lote de mutações.
  const medicao = await page.evaluate(
    (janelaMs) =>
      new Promise((resolve) => {
        const porElemento = new Map();
        const observer = new MutationObserver((registros) => {
          const noLote = new Set();
          for (const r of registros) {
            if (r.attributeName === "style" || r.attributeName === "class") noLote.add(r.target);
          }
          for (const alvo of noLote) porElemento.set(alvo, (porElemento.get(alvo) ?? 0) + 1);
        });
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ["style", "class"],
          subtree: true,
        });
        const inicio = performance.now();
        setTimeout(() => {
          observer.disconnect();
          const segundos = (performance.now() - inicio) / 1000;
          let pior = { mutacoes: 0, elemento: "" };
          for (const [alvo, mutacoes] of porElemento) {
            if (mutacoes > pior.mutacoes) {
              pior = {
                mutacoes,
                elemento: `${alvo.tagName}.${String(alvo.className).slice(0, 60)}`,
              };
            }
          }
          resolve({ ...pior, segundos });
        }, janelaMs);
      }),
    JANELA_MS
  );

  const porSegundo = medicao.mutacoes / medicao.segundos;
  console.log(`elemento mais mutado: ${medicao.elemento} — ${porSegundo.toFixed(1)}/s`);

  expect(medicao.mutacoes).toBeGreaterThan(0);
  expect(porSegundo, `elemento: ${medicao.elemento}`).toBeLessThanOrEqual(
    LIMITE_POSTHOG_POR_SEGUNDO
  );

  await context.close();
});
