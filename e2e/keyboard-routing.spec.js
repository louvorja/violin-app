/**
 * Para onde vão as teclas: abas (Ctrl+Tab, Ctrl+W) e o slide (setas só com o
 * player). Relatos #43–#47 do beta.19 — sem rede de verdade.
 * Run with: npx playwright test e2e/keyboard-routing.spec.js
 */
import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";
import music1 from "./fixtures/music_1.json";

// A capa ocupa o começo da faixa; cada verso entra bem depois.
const SLIDE_SECONDS = [30, 60, 90, 110];
const lyric = Object.fromEntries(
  ["Primeiro verso", "Segundo verso", "Terceiro verso", "Quarto verso"].map((text, i) => [
    i + 1,
    {
      ...music1.lyric[1],
      lyric: text,
      order: i + 1,
      time: `00:${String(Math.floor(SLIDE_SECONDS[i] / 60)).padStart(2, "0")}:${String(
        SLIDE_SECONDS[i] % 60
      ).padStart(2, "0")}`,
    },
  ])
);
const song = (id, name) => ({
  ...music1,
  id_music: id,
  name,
  url_music: `musics/pt/Teste/${id}.wav`,
  lyric,
});

/** Silêncio longo o bastante para nenhum slide passar sozinho durante o teste. */
function silentWav(seconds = 120, rate = 8000) {
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
const songs = { 1: song(1, "Castelo Forte"), 2: song(2, "Grandioso És Tu") };
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
}

async function openModule(page, id) {
  await page.locator("#ribbon-tab-collections").click();
  await page.locator(`[data-testid="ribbon-btn-${id}"]`).click();
}

const tabs = (page) => page.locator(".subtab");
const tabLabels = (page) => page.locator(".subtab .subtab-label").allTextContents();
const activeTab = (page) => page.locator(".subtab--active .subtab-label");

test.use({ serviceWorkers: "block" });

test("abas: Ctrl+Tab segue a barra arrastada, passa pela busca, e Ctrl+W fecha a aba à vista", async ({
  page,
}) => {
  await start(page);
  // Ordem de registro (alfabética): children, hymnal, musics.
  await openModule(page, "children");
  await openModule(page, "hymnal");
  await openModule(page, "musics");
  await expect(tabs(page)).toHaveCount(3);
  const [infantil, hinario, musicas] = await tabLabels(page);

  // Músicas vai para o começo: a barra fica Músicas, Infantil, Hinário.
  await tabs(page).nth(2).dragTo(tabs(page).nth(0));
  await expect.poll(() => tabLabels(page)).toEqual([musicas, infantil, hinario]);

  // Com o cursor na busca de Músicas o Ctrl+Tab não pode parar ali (#45).
  const search = page.getByPlaceholder("Buscar por...");
  await search.click();
  await expect(search).toBeFocused();
  await page.keyboard.press("Control+Tab");
  await expect(activeTab(page)).toHaveText(infantil);
  await page.keyboard.press("Control+Tab");
  await expect(activeTab(page)).toHaveText(hinario);
  await page.keyboard.press("Control+Tab");
  await expect(activeTab(page)).toHaveText(musicas);
  await expect(search).toBeFocused();
  await page.keyboard.press("Control+Tab");
  await expect(activeTab(page)).toHaveText(infantil);
  await page.keyboard.press("Control+Shift+Tab");
  await expect(activeTab(page)).toHaveText(musicas);

  // Ctrl+W fecha a aba à vista — não a última registrada (Músicas) — e passa
  // para a da direita, como no Chrome (#46). Vale com o cursor no campo (#43).
  await tabs(page).filter({ hasText: infantil }).click();
  await page.keyboard.press("Control+w");
  await expect.poll(() => tabLabels(page)).toEqual([musicas, hinario]);
  await expect(activeTab(page)).toHaveText(hinario);

  await tabs(page).filter({ hasText: musicas }).click();
  await search.click();
  await page.keyboard.press("Control+w");
  await expect.poll(() => tabLabels(page)).toEqual([hinario]);
});

test("setas: passam o slide só com o player; fora dele são da tela, e no campo, do cursor", async ({
  page,
}) => {
  await start(page);
  await openModule(page, "musics");
  const search = page.getByPlaceholder("Buscar por...");
  // Sem áudio: o slide não volta pela sincronia com a faixa, que aqui não aceita salto.
  const row = page.locator('[data-testid="music-row-1"]');
  await row.hover();
  await row.locator('[data-testid="mmt-btn-no-audio"]').click();

  const slide = page.locator('[data-testid="slide-content"]').first();
  await expect(slide).toBeVisible();
  const first = (await slide.textContent()).trim();

  // Janela do player na tela: ela é modal, as setas são dela.
  await page.keyboard.press("ArrowRight");
  await expect(slide).not.toHaveText(first);

  // Minimizar tira o player da frente: as setas voltam a ser da tela (e o
  // cursor volta à busca).
  await page.locator(".lj-window-btn:not(.lj-window-btn--close)").click();
  const counter = page.locator("#footer-bar .player-counter");
  await expect(counter).toBeVisible();
  const minimized = (await counter.textContent()).trim();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  await expect(counter).toHaveText(minimized);

  // Um clique no player do rodapé dá o teclado ao slide.
  await counter.click();
  await page.keyboard.press("ArrowRight");
  await expect(counter).not.toHaveText(minimized);

  // Clique em outra parte do programa: as setas e o espaço voltam a ser da tela (#47).
  const beforeScreen = (await counter.textContent()).trim();
  await page
    .locator(".module-embedded")
    .first()
    .click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  await expect(counter).toHaveText(beforeScreen);

  // Com o player de volta ao teclado, o campo de texto ainda é do cursor.
  await counter.click();
  await search.click();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(400);
  await expect(counter).toHaveText(beforeScreen);

  await counter.click();
  await page.keyboard.press("ArrowLeft");
  await expect(counter).not.toHaveText(beforeScreen);
});

test("Adicionar à playlist aparece no Hinário, mesmo sem abrir o Músicas (#41)", async ({
  page,
}) => {
  await start(page);
  await openModule(page, "musics");
  await page.locator(".playlist-panel-btn--primary").click();
  await page.getByPlaceholder("Nome da playlist").fill("Culto de sábado");
  await page.getByPlaceholder("Nome da playlist").press("Enter");
  await expect(page.locator(".playlist-panel-item")).toContainText("Culto de sábado");

  await page.reload();
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  await openModule(page, "hymnal");
  await page
    .getByRole("button", { name: /Grandioso És Tu$/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Adicionar à Playlist" }).click();
  await page.getByRole("menuitem", { name: "Culto de sábado" }).click();
  // A tradução do Músicas só carrega quando ele abre: a frase é do menu, global.
  await expect(page.locator(".lj-toast__text")).toHaveText("Música adicionada à playlist");

  await page
    .getByRole("button", { name: /Grandioso És Tu$/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Adicionar à Playlist" }).click();
  await expect(page.getByRole("menuitem", { name: "Culto de sábado" })).toHaveAttribute(
    "aria-disabled",
    "true"
  );
});
