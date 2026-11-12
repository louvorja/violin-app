import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import music1 from "./fixtures/music_1.json";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

async function start(page) {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
}

async function openAlbum(page, id, musics) {
  await page.evaluate(
    async ({ id, musics }) => {
      const database = (await import("/src/helpers/Database.ts")).default;
      await database.seed(`album_${id}`, {
        id_album: id,
        name: "Meu Lugar no Mundo",
        color: "#181818",
        categories: [],
        musics,
      });
      const media = (await import("/src/composables/useMedia.ts")).default;
      await media.openAlbum(id);
    },
    { id, musics }
  );
  const dialog = page.getByRole("dialog", { name: "Meu Lugar no Mundo" });
  await expect(dialog).toBeVisible();
  return dialog;
}

const music = (id, track) => ({
  id_music: id,
  track,
  name: `Música ${track}`,
  duration: "00:03:39",
  has_instrumental_music: 1,
});

test("álbum curto segue o tema, compartilha ações por hover e cabe no celular", async ({
  page,
}) => {
  await start(page);
  const dialog = await openAlbum(page, 9876501, [
    music(991001, 1),
    music(991002, 2),
    music(991003, 3),
  ]);
  await expect(dialog).toHaveClass(/lj-dialog--module/);
  await expect(dialog.locator(".album-summary__name")).toHaveText("Meu Lugar no Mundo");
  await expect(dialog.locator("tbody tr")).toHaveCount(3);

  const bounds = await dialog.boundingBox();
  expect(bounds.width).toBeLessThan(900);
  expect(bounds.height).toBeLessThan(500);

  const firstRow = dialog.locator("tbody tr").first();
  await expect(firstRow.locator(".mmt-reserve")).toHaveCount(1);
  await firstRow.hover();
  await expect(firstRow.locator('[data-testid^="mmt-btn-"]')).toHaveCount(7);
  await expect(firstRow.getByTestId("mmt-btn-sing")).toBeVisible();
  const desktopFits = await dialog
    .locator(".album-tracks")
    .evaluate((table) => table.scrollWidth <= table.clientWidth);
  expect(desktopFits).toBe(true);

  const homeColors = [];
  for (const theme of ["light", "blue", "darkblue", "dark"]) {
    await page.evaluate(async (value) => {
      const { useAppTheme } = await import("/src/composables/useAppTheme.ts");
      useAppTheme().setTheme(value);
    }, theme);
    const sameSurface = await dialog.evaluate((element) => {
      const table = element.querySelector(".album-tracks");
      return getComputedStyle(element).backgroundColor === getComputedStyle(table).backgroundColor;
    });
    expect(sameSurface).toBe(true);
    if (theme !== "dark") {
      const colors = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        return [
          root.getPropertyValue("--lj-home-bg").trim(),
          root.getPropertyValue("--lj-shell-chrome-bg").trim(),
        ];
      });
      expect(colors[0]).toBe(colors[1]);
      homeColors.push(colors[0]);
    }
  }
  expect(new Set(homeColors).size).toBe(3);

  await page.setViewportSize({ width: 390, height: 844 });
  const fits = await dialog
    .locator(".album-tracks")
    .evaluate((table) => table.scrollWidth <= table.clientWidth);
  expect(fits).toBe(true);
  await dialog.locator(".album-actions .mmt button").first().click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByTestId("mmt-btn-sing")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.locator(".lj-dialog__close").click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(async () => {
      const appData = (await import("/src/helpers/AppData.ts")).default;
      return appData.get("modules.album.show", false);
    })
  ).toBe(false);
});

test("álbum pelo teclado: abre na primeira faixa, ↓ escolhe e Esc fecha", async ({ page }) => {
  await start(page);
  const dialog = await openAlbum(page, 9876503, [
    music(993001, 1),
    music(993002, 2),
    music(993003, 3),
  ]);
  const active = dialog.locator("tr.lj-music-row--active");
  await expect(dialog.locator(".album-tracks")).toBeFocused();
  await expect(active).toContainText("Música 1");
  await page.keyboard.press("ArrowDown");
  await expect(active).toContainText("Música 2");

  // O Esc é da camada de cima: fecha o álbum.
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(async () => {
      const appData = (await import("/src/helpers/AppData.ts")).default;
      return appData.get("modules.album.show", false);
    })
  ).toBe(false);
});

test("álbum longo rola com cabeçalho fixo e álbum vazio mostra orientação", async ({ page }) => {
  await start(page);
  const dialog = await openAlbum(
    page,
    9876502,
    Array.from({ length: 32 }, (_, index) => music(992000 + index, index + 1))
  );
  const table = dialog.locator(".album-tracks");
  await expect(table).toHaveAttribute("tabindex", "0");
  const before = await table.locator("thead th").first().boundingBox();
  const sizes = await table.evaluate((element) => {
    const clientHeight = element.clientHeight;
    const scrollHeight = element.scrollHeight;
    element.scrollTop = scrollHeight;
    return { clientHeight, scrollHeight };
  });
  expect(sizes.scrollHeight).toBeGreaterThan(sizes.clientHeight);
  const after = await table.locator("thead th").first().boundingBox();
  expect(Math.abs(after.y - before.y)).toBeLessThan(5);

  await dialog.locator(".lj-dialog__close").click();
  const empty = await openAlbum(page, 9876503, []);
  await expect(empty).toContainText("Nenhuma música neste álbum.");
});

test("iniciar uma faixa pelo atalho ou menu fecha o álbum antes de abrir o player", async ({
  page,
}) => {
  await start(page);

  const desktop = await openAlbum(page, 9876504, [music(993001, 1)]);
  await desktop.locator("tbody tr").first().hover();
  await desktop.getByTestId("mmt-btn-sing").click();
  await expect(desktop).not.toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await openAlbum(page, 9876505, [music(993002, 1)]);
  await mobile.locator(".album-actions .mmt button").first().click();
  await page.getByTestId("mmt-btn-sing").click();
  await expect(mobile).not.toBeVisible();

  const submenu = await openAlbum(page, 9876506, [music(993003, 1)]);
  await submenu.locator(".album-actions .mmt button").first().click();
  await page.getByRole("menuitem", { name: "Executar" }).hover();
  await page.getByRole("menuitem", { name: "Cantado" }).click();
  await expect(submenu).not.toBeVisible();

  const external = await openAlbum(page, 9876507, [music(993004, 1)]);
  await page.evaluate(async () => {
    const media = (await import("/src/composables/useMedia.ts")).default;
    media.open(993004);
  });
  await expect(external).not.toBeVisible();
});

test("Tocar Todas toca o CD inteiro, na ordem das faixas (#50)", async ({ page }) => {
  await start(page);
  const rate = 8000;
  const size = 30 * rate * 2;
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
  await page.route(/\/music_\d+/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.match(/music_(\d+)/)[1]);
    return route.fulfill({
      json: { ...music1, id_music: id, name: `Música ${id - 991010}`, url_music: `t/${id}.wav` },
    });
  });
  await page.route(/\.wav/, (route) => route.fulfill({ body: wav, contentType: "audio/wav" }));

  const dialog = await openAlbum(page, 9876502, [
    music(991011, 1),
    music(991012, 2),
    music(991013, 3),
  ]);
  await dialog.getByRole("button", { name: /Tocar Todas/ }).click();

  await expect(dialog).not.toBeVisible();
  const bar = page.locator(".playlist-bar");
  await expect(bar).toContainText("Meu Lugar no Mundo");
  await expect(bar).toContainText("/3");
  const media = page.locator(".lj-window").filter({ has: page.locator(".media-body") });
  await expect(media.locator(".lj-window-title")).toHaveText("Música 1");
});
