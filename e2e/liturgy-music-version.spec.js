/**
 * Música adicionada à liturgia pelo menu ⋮ (#49): entra com a duração e, na hora
 * de tocar, a versão escolhida no cartão é a que abre — sem rede de verdade.
 * Run with: npx playwright test e2e/liturgy-music-version.spec.js
 */
import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";
import music1 from "./fixtures/music_1.json";

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

const NAME = "Confiei no Meu Senhor";
const lyric = Object.fromEntries(
  ["Confiei no meu Senhor", "E Ele me ouviu", "Do pecado me livrou"].map((text, i) => [
    i + 1,
    { ...music1.lyric[1], lyric: text, order: i + 1, time: `00:00:0${i + 1}` },
  ])
);
const song = {
  ...music1,
  id_music: 42,
  name: NAME,
  url_music: "musics/pt/Teste/42.wav",
  url_instrumental_music: "musics/pt/Teste/42-pb.wav",
  has_instrumental_music: 1,
  lyric,
};
// O catálogo real traz a duração como "HH:MM:SS".
const catalog = [
  {
    id_music: 42,
    name: NAME,
    duration: "00:04:03",
    instrumental_duration: "00:04:10",
    has_instrumental_music: 1,
    albums: [{ id_album: 10, name: "Está Escrito", type: "collection", pivot: { track: 3 } }],
  },
];

test.use({ serviceWorkers: "block" });

async function start(page) {
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (/\/pt_musics(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: catalog });
    if (/\/music_42(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: song });
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

test("música do menu ⋮ entra com a duração e toca a versão escolhida no cartão (#49)", async ({
  page,
}) => {
  await start(page);
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-musics"]').click();
  await expect(page.locator('[data-testid="music-row-42"]')).toBeVisible();

  await page.getByRole("button", { name: new RegExp(`${NAME}$`) }).click();
  await page.getByRole("menuitem", { name: "Adicionar em" }).hover();
  await page.getByRole("menuitem", { name: "Adicionar à Liturgia" }).click();

  await page.getByRole("button", { name: "Editar liturgia" }).click();
  const card = page.locator(".liturgy-page [data-item-id]").filter({ hasText: NAME });
  await expect(card.locator(".lit-card-duration")).toHaveText("5 min");

  const mediaWindow = page.locator(".lj-window").filter({ has: page.locator(".media-body") });
  const slides = mediaWindow.locator(".media-slide");
  const playVersion = async (label) => {
    await card.locator(".lit-card-text").click();
    await page
      .getByRole("dialog", { name: NAME })
      .locator(".lit-version")
      .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })
      .click();
  };
  const closeMedia = async () => {
    await mediaWindow.locator(".lj-window-btn--close").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sim" }).click();
    await expect(mediaWindow).not.toBeVisible();
  };

  // Antes da correção, "Cantada" abria só o áudio: sem slides da letra.
  await playVersion("Cantada");
  await expect(mediaWindow).toBeVisible();
  await expect(slides.filter({ hasText: "Do pecado me livrou" })).toHaveCount(1);
  await closeMedia();

  // E "Somente áudio" abria a cantada com os slides; agora só o player toca.
  await playVersion("Somente áudio");
  await expect(page.getByText(`Reproduzindo: ${NAME}`)).toBeVisible();
  await expect(page.locator(".media-slide").filter({ hasText: "Do pecado me livrou" })).toHaveCount(
    0
  );
});
