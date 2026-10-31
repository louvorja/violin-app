/**
 * Enter na busca toca o primeiro resultado, como no clássico — sem rede de verdade.
 * Run with: npx playwright test e2e/music-search-enter.spec.js
 */
import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";
import music1 from "./fixtures/music_1.json";

const song = (id, name, text) => ({
  ...music1,
  id_music: id,
  name,
  url_music: `musics/pt/Teste/${id}.wav`,
  lyric: { 1: { ...music1.lyric[1], lyric: text } },
});

/** O cantado só abre o slide com a faixa: 30 s de silêncio cobrem o teste inteiro. */
function silentWav(seconds = 30, rate = 8000) {
  const size = seconds * rate * 2;
  const wav = Buffer.alloc(44 + size);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + size, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(size, 40);
  return wav;
}
const audio = silentWav();
const songs = {
  1: song(1, "Castelo Forte", "Castelo forte é nosso Deus"),
  2: song(2, "Castelo de Glória", "Primeira linha da glória"),
  3: song(3, "Grandioso És Tu", "Senhor meu Deus"),
  // Primeira do acervo e da lista sem filtro: é ela que tocaria se a busca curta valesse.
  4: song(4, "Aleluia ao Rei", "Aleluia"),
};
const catalog = Object.values(songs).map(({ id_music, name }) => ({
  id_music,
  name,
  duration: 120,
  has_instrumental_music: 0,
  albums: [{ id_album: 10, name: "Coletânea", type: "collection", pivot: { track: id_music } }],
}));
const hymnal = Object.values(songs).map(({ id_music, name }) => ({
  id_music,
  name,
  track: id_music * 10,
  duration: 120,
  has_instrumental_music: 0,
}));

async function start(page) {
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (/\/pt_musics(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: catalog });
    if (/\/pt_hymnal(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: hymnal });
    const music = url.pathname.match(/\/music_(\d+)(?:\.|$)/);
    if (music) return route.fulfill({ json: songs[music[1]] });
    if (url.pathname.endsWith(".wav")) {
      return route.fulfill({ body: audio, contentType: "audio/wav" });
    }
    if (url.pathname.includes("/json_db/")) return route.fulfill({ json: [] });
    if (url.hostname === "localhost") return route.continue();
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
}

const slide = (page) => page.locator('[data-testid="slide-content"]').first();
const question = (page) => page.locator('[role="alertdialog"]');

/** O que não deve tocar só se confirma depois de dar tempo para tocar. */
async function expectNothingPlays(page) {
  await page.waitForTimeout(1500);
  await expect(slide(page)).toHaveCount(0);
}

test.use({ serviceWorkers: "block" });

test("Músicas: Enter toca o primeiro; Esc e Enter fecham o slide", async ({ page }) => {
  await start(page);
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-musics"]').click();
  await expect(page.locator('[data-testid^="music-row-"]')).toHaveCount(4);
  const search = page.getByPlaceholder("Buscar por...");

  // Abaixo do mínimo de letras a lista é o acervo inteiro: nada toca.
  await search.fill("ca");
  await search.press("Enter");
  await expectNothingPlays(page);

  // Sem esperar a pausa da digitação: vale o que está escrito.
  await search.pressSequentially("stelo", { delay: 0 });
  await search.press("Enter");
  await expect(slide(page)).toContainText("Castelo de Glória");

  // A pergunta de fechar o slide abre com o Sim marcado: Esc e Enter fecham.
  await page.keyboard.press("Escape");
  await expect(question(page)).toContainText("Deseja fechar este slide?");
  await expect(question(page).locator(".alert-btn--picked")).toHaveText("Sim");
  await page.keyboard.press("Enter");
  await expect(question(page)).toHaveCount(0);
  await expect(slide(page)).toHaveCount(0);
});

test("Músicas: Shift+Enter sem playback avisa e não toca", async ({ page }) => {
  await start(page);
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-musics"]').click();
  const search = page.getByPlaceholder("Buscar por...");
  await search.fill("grandioso");
  await search.press("Shift+Enter");
  await expect(page.getByText("não tem playback")).toBeVisible();
  await expectNothingPlays(page);
});

test("Hinário: número do hino e Enter; duas letras não tocam o hino 1", async ({ page }) => {
  await start(page);
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-hymnal"]').click();
  const search = page.locator(".hymnal-form-group input");
  await search.fill("ca");
  await search.press("Enter");
  await expectNothingPlays(page);
  await search.fill("30");
  await search.press("Enter");
  await expect(slide(page)).toContainText("Grandioso És Tu");
});

test("busca rápida: Enter toca o primeiro e fecha a busca", async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("louvorja:open-music-search")));
  const input = page.locator(".music-search__bar input");
  await input.fill("grandioso");
  await input.press("Enter");
  await expect(page.locator(".music-search__bar")).toHaveCount(0);
  await expect(slide(page)).toContainText("Grandioso És Tu");
});

test("confirmação de excluir não abre armada: Enter não exclui", async ({ page }) => {
  await start(page);
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-musics"]').click();
  await page.getByRole("button", { name: "Nova playlist" }).first().click();
  await page.getByPlaceholder("Nome da playlist").fill("Culto");
  await page.getByPlaceholder("Nome da playlist").press("Enter");
  const item = page.locator(".playlist-panel-item").filter({ hasText: "Culto" });
  await expect(item).toHaveCount(1);

  await item.getByRole("button", { name: "Excluir playlist" }).click();
  await expect(question(page)).toBeVisible();
  await expect(question(page).locator(".alert-btn--picked")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(question(page)).toBeVisible();
  await expect(item).toHaveCount(1);

  // Só a escolha deliberada pelas setas arma o Sim.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(question(page)).toHaveCount(0);
  await expect(item).toHaveCount(0);
});
