/**
 * "Tocar Todas" do hinário: do primeiro ao último hino da lista, pela mesma fila das
 * playlists. Antes parava depois do segundo hino, começava num hino sorteado e seguia
 * para o próximo mesmo quando o operador fechava o hino no meio.
 * Run with: npx playwright test e2e/hymnal-play-all.spec.js
 */
import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";
import music1 from "./fixtures/music_1.json";

function silentWav(seconds, rate = 8000) {
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

const NAMES = { 1: "Castelo Forte", 2: "Grandioso És Tu", 3: "Sublime Graça" };
const song = (id) => ({
  ...music1,
  id_music: id,
  name: NAMES[id],
  url_music: `musics/pt/Teste/${id}.wav`,
  lyric: { 1: { ...music1.lyric[1], lyric: NAMES[id], order: 1, time: "00:00:01" } },
});
const hymnal = [1, 2, 3].map((id) => ({
  id_music: id,
  name: NAMES[id],
  track: id,
  duration: "00:00:03",
  has_instrumental_music: 0,
}));

test.use({ serviceWorkers: "block" });

async function start(page, seconds) {
  const audio = silentWav(seconds);
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (/\/pt_musics(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: [] });
    if (/\/pt_hymnal(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: hymnal });
    const music = url.pathname.match(/\/music_(\d+)(?:\.|$)/);
    if (music) return route.fulfill({ json: song(Number(music[1])) });
    if (url.pathname.endsWith(".wav"))
      return route.fulfill({ body: audio, contentType: "audio/wav" });
    if (url.pathname.includes("/json_db/")) return route.fulfill({ json: [] });
    if (url.hostname === "localhost") return route.continue();
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-hymnal"]').click();
  await expect(page.locator(".lj-music-row")).toHaveCount(3);
  // Cada hino que a janela de Mídia abre, na ordem.
  await page.evaluate(() => {
    window.__opened = [];
    setInterval(() => {
      const title = document
        .querySelector(".lj-window .media-body")
        ?.closest(".lj-window")
        ?.querySelector(".lj-window-title")
        ?.textContent?.trim();
      if (title && window.__opened.at(-1) !== title) window.__opened.push(title);
    }, 100);
  });
}

const opened = (page) => page.evaluate(() => window.__opened);
const mediaWindow = (page) =>
  page.locator(".lj-window").filter({ has: page.locator(".media-body") });

test("Tocar Todas vai do primeiro ao último hino e encerra a fila no fim", async ({ page }) => {
  test.setTimeout(60_000);
  await start(page, 3);
  await page.locator('[data-testid="ribbon-btn-sequence"]').click();
  await expect(page.locator(".playlist-bar")).toContainText("Hinário Adventista");

  await expect.poll(() => opened(page), { timeout: 20_000 }).toEqual(Object.values(NAMES));
  await expect(page.locator(".playlist-bar")).not.toBeVisible({ timeout: 10_000 });
  await expect(mediaWindow(page)).not.toBeVisible();
});

test("fechar o hino no meio pergunta e, com o Sim, encerra a fila", async ({ page }) => {
  test.setTimeout(60_000);
  await start(page, 30);
  await page.locator('[data-testid="ribbon-btn-sequence"]').click();
  await expect(mediaWindow(page)).toBeVisible();
  await page.waitForTimeout(2000);

  await mediaWindow(page).locator(".lj-window-btn--close").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sim" }).click();
  await expect(page.locator(".playlist-bar")).not.toBeVisible();
  await page.waitForTimeout(2000);
  expect(await opened(page)).toEqual([NAMES[1]]);
});

test("tocar outro hino no meio encerra a fila na hora", async ({ page }) => {
  test.setTimeout(60_000);
  await start(page, 30);
  await page.locator('[data-testid="ribbon-btn-sequence"]').click();
  await expect(page.locator(".playlist-bar")).toBeVisible();
  await expect(mediaWindow(page)).toBeVisible();

  await mediaWindow(page).getByTitle("Minimizar").click();
  await page.locator(".lj-music-row").filter({ hasText: NAMES[3] }).click();
  await page.locator('[data-testid="ribbon-btn-sing"]').click();
  await expect(page.locator(".playlist-bar")).not.toBeVisible();
  await expect.poll(() => opened(page)).toEqual([NAMES[1], NAMES[3]]);
});
