/**
 * Fechar a música de uma playlist (#54): os dois botões do rodapé perguntam antes
 * e só encerram depois do "Sim"; fechar pela janela de Mídia também encerra a playlist.
 * Run with: npx playwright test e2e/playlist-close.spec.js
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

const SONGS = [
  { id_music: 42, name: "Confiei no Meu Senhor" },
  { id_music: 43, name: "Grandioso És Tu" },
];
const songJson = Object.fromEntries(
  SONGS.map(({ id_music, name }) => [
    id_music,
    {
      ...music1,
      id_music,
      name,
      url_music: `musics/pt/Teste/${id_music}.wav`,
      url_instrumental_music: `musics/pt/Teste/${id_music}-pb.wav`,
      has_instrumental_music: 1,
    },
  ])
);
const catalog = SONGS.map(({ id_music, name }) => ({
  id_music,
  name,
  duration: "00:04:03",
  has_instrumental_music: 1,
  albums: [{ id_album: 10, name: "Está Escrito", type: "collection", pivot: { track: 1 } }],
}));

test.use({ serviceWorkers: "block" });

async function start(page) {
  await page.context().route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (/\/pt_musics(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: catalog });
    const song = url.pathname.match(/\/music_(\d+)(?:\.|$)/);
    if (song && songJson[song[1]]) return route.fulfill({ json: songJson[song[1]] });
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
  await page.locator('[data-testid="ribbon-btn-musics"]').click();
  await expect(page.locator('[data-testid="music-row-42"]')).toBeVisible();

  await page.getByRole("button", { name: "Nova playlist" }).first().click();
  await page.getByPlaceholder("Nome da playlist").fill("Culto");
  await page.getByPlaceholder("Nome da playlist").press("Enter");
  for (const { name } of SONGS) {
    await page.getByRole("button", { name: new RegExp(`${name}$`) }).click();
    await page.getByRole("menuitem", { name: "Adicionar à Playlist" }).hover();
    await page.getByRole("menuitem", { name: "Culto" }).click();
  }
}

test("fechar a música de uma playlist pergunta antes e só encerra depois do Sim (#54)", async ({
  page,
}) => {
  await start(page);
  // Pelo menu ⋮, as músicas entravam com 0:00 e o painel dizia "2 música".
  await expect(page.locator(".playlist-panel-item").filter({ hasText: "Culto" })).toContainText(
    "2 músicas · 8:06"
  );

  const playlistBar = page.locator(".playlist-bar");
  const player = page.locator("#footer-bar .player");
  const confirm = page.getByRole("alertdialog");
  const mediaWindow = page.locator(".lj-window").filter({ has: page.locator(".media-body") });
  const startPlaylist = async () => {
    await page.locator(".playlist-panel-item").filter({ hasText: "Culto" }).click();
    await page.locator(".playlist-songs-play-btn").click();
    await expect(mediaWindow).toBeVisible();
    await expect(playlistBar).toBeVisible();
  };

  // Como no relato: a música segue tocando com o player minimizado no rodapé.
  await startPlaylist();
  await mediaWindow.getByTitle("Minimizar").click();
  await expect(page.getByText(`Reproduzindo: ${SONGS[0].name}`)).toBeVisible();

  // Player: antes da correção, a música fechava enquanto a pergunta ainda estava na tela.
  await player.getByRole("button", { name: "Fechar música" }).click();
  await expect(confirm).toBeVisible();
  await expect(playlistBar).toBeVisible();
  await expect(page.getByText(`Reproduzindo: ${SONGS[0].name}`)).toBeVisible();
  await confirm.getByRole("button", { name: "Não" }).click();
  await expect(confirm).not.toBeVisible();
  await expect(playlistBar).toBeVisible();
  await expect(page.getByText(`Reproduzindo: ${SONGS[0].name}`)).toBeVisible();

  // Barra da playlist: antes, encerrava direto, sem perguntar.
  await playlistBar.getByRole("button", { name: "Fechar música" }).click();
  await expect(confirm).toBeVisible();
  await expect(playlistBar).toBeVisible();
  await confirm.getByRole("button", { name: "Sim" }).click();
  await expect(playlistBar).not.toBeVisible();
  await expect(player).not.toBeVisible();

  // Janela de Mídia: antes, a música fechava e a barra da playlist ficava presa.
  await startPlaylist();
  await mediaWindow.locator(".lj-window-btn--close").click();
  await confirm.getByRole("button", { name: "Sim" }).click();
  await expect(mediaWindow).not.toBeVisible();
  await expect(playlistBar).not.toBeVisible();
});

test("tocar outra música no meio da playlist encerra a playlist na hora", async ({ page }) => {
  await start(page);
  const playlistBar = page.locator(".playlist-bar");
  const mediaWindow = page.locator(".lj-window").filter({ has: page.locator(".media-body") });
  await page.locator(".playlist-panel-item").filter({ hasText: "Culto" }).click();
  await page.locator(".playlist-songs-play-btn").click();
  await expect(playlistBar).toBeVisible();
  await expect(mediaWindow.locator(".lj-window-title")).toHaveText(SONGS[0].name);
  await mediaWindow.getByTitle("Minimizar").click();

  // Antes, a barra continuava na tela e, quando essa música acabava, a playlist voltava sozinha.
  await page.getByRole("button", { name: new RegExp(`${SONGS[1].name}$`) }).click();
  await page.getByRole("menuitem", { name: "Executar" }).hover();
  await page.getByRole("menuitem", { name: /disc-filled Cantado/ }).click();
  await expect(mediaWindow.locator(".lj-window-title")).toHaveText(SONGS[1].name);
  await expect(playlistBar).not.toBeVisible();
});
