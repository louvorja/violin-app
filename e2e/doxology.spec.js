import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";

test.use({ serviceWorkers: "block", reducedMotion: "reduce", colorScheme: "light" });

const albums = [
  { id_album: 9876501, name: "Doxologia de Gratidão", color: "#684081" },
  { id_album: 9876502, name: "Celebração e Esperança", color: "#526a8c" },
  { id_album: 9876503, name: "Louvor e Adoração", color: "#718160" },
  { id_album: 9876504, name: "Cantos da Comunidade", color: "#957351" },
];

const albumDetail = {
  id_album: 9876501,
  name: "Doxologia de Gratidão",
  musics: [
    {
      id_music: 9876601,
      name: "Glória ao Pai",
      track: 1,
      duration: "00:03:20",
      has_instrumental_music: 1,
    },
    {
      id_music: 9876602,
      name: "Teu Amor nos Guia",
      track: 2,
      duration: "00:04:10",
      has_instrumental_music: 0,
    },
    {
      id_music: 9876603,
      name: "Louvamos Teu Nome em Toda a Terra",
      track: 3,
      duration: "00:02:55",
      has_instrumental_music: 1,
    },
  ],
};

const musicDetail = {
  id_music: 9876601,
  name: "Glória ao Pai",
  url_image: null,
  url_music: "http://e2e.mock/doxology.wav",
  url_instrumental_music: null,
  has_instrumental_music: 0,
  lyric: {
    1: {
      lyric: "Glória ao Pai",
      show_slide: 1,
      order: 1,
      time: "00:00:00",
      instrumental_time: "00:00:00",
    },
  },
};

const wav = Buffer.alloc(44 + 8_000, 128);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8_000, 24);
wav.writeUInt32LE(8_000, 28);
wav.writeUInt16LE(1, 32);
wav.writeUInt16LE(8, 34);
wav.write("data", 36);
wav.writeUInt32LE(8_000, 40);

async function start(page, { resolveDetail } = {}) {
  // Os dados de outras partes do Shell não interferem na tela sob teste.
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("http://e2e.mock/doxology.wav", (route) =>
    route.fulfill({ contentType: "audio/wav", body: wav })
  );
  await page.route("**/json_db/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/album_${albumDetail.id_album}`)) {
      return route.fulfill({ json: resolveDetail?.(url) ?? albumDetail });
    }
    if (url.pathname.endsWith(`/music_${musicDetail.id_music}`)) {
      return route.fulfill({ json: musicDetail });
    }
    if (/\/(?:pt|es)_doxology_albums$/.test(url.pathname)) {
      return route.fulfill({ json: albums });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-doxology"]').click();
  await expect(page.locator(".dx-album")).toHaveCount(albums.length);
}

async function setTheme(page, theme) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", /.+/);
  const current = await page.locator("html").getAttribute("data-theme");
  if (current !== theme) await page.locator(".shell-tools > button:nth-last-of-type(3)").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => {
    const root = document.querySelector(".dx-page");
    return {
      pageWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      moduleWidth: root.clientWidth,
      moduleScrollWidth: root.scrollWidth,
    };
  });
  expect(dimensions.pageScrollWidth).toBeLessThanOrEqual(dimensions.pageWidth);
  expect(dimensions.moduleScrollWidth).toBeLessThanOrEqual(dimensions.moduleWidth);
}

test("álbuns, voltar e cantar pelo menu podem ser acionados pelo teclado", async ({ page }) => {
  await start(page);

  const album = page.getByRole("button", { name: "Doxologia de Gratidão", exact: true });
  await expect(album).toBeVisible();
  await album.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".dx-tracks tbody tr")).toHaveCount(albumDetail.musics.length);
  await expect(page.locator(".dx-toolbar input")).toBeFocused();
  const back = page.getByRole("button", {
    name: "Voltar aos álbuns: Doxologia de Gratidão",
    exact: true,
  });
  await expect(back).toBeVisible();
  await expect(page.locator(".dx-album-heading button")).toHaveCount(1);
  expect(await back.evaluate((button) => getComputedStyle(button).borderTopStyle)).toBe("solid");
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".dx-album")).toHaveCount(albums.length);
  await expect(album).toBeFocused();

  await page.keyboard.press("Space");
  await expect(page.locator(".dx-tracks tbody tr")).toHaveCount(albumDetail.musics.length);
  await expect(page.locator(".dx-toolbar input")).toBeFocused();

  await back.locator(".lj-btn__label").click();
  await expect(page.locator(".dx-album")).toHaveCount(albums.length);
  await expect(album).toBeFocused();
  await album.click();
  await expect(page.locator(".dx-tracks tbody tr")).toHaveCount(albumDetail.musics.length);

  // A ação pertence ao MusicMenuTable; não há um segundo play na linha.
  const row = page.locator(".dx-tracks tbody tr").first();
  await expect(row.locator(".dx-actions > button")).toHaveCount(0);
  await row.hover();
  const sing = row.getByTestId("mmt-btn-sing");
  await expect(sing).toBeVisible();
  await sing.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Glória ao Pai" })).toBeVisible();
});

test("busca, limpeza e estados vazios funcionam nos dois níveis", async ({ page }) => {
  await start(page);

  const search = page.locator(".dx-toolbar input");
  await search.fill("esperança");
  await expect(page.locator(".dx-album")).toHaveCount(1);
  await expect(page.locator(".dx-album")).toContainText("Celebração e Esperança");

  await search.fill("sem resultado");
  await expect(page.locator(".dx-album")).toHaveCount(0);
  await expect(page.locator(".dx-page .lj-empty")).toContainText(/nenhum álbum/i);

  const clear = page.locator(".dx-toolbar").getByRole("button", { name: /limpar/i });
  await expect(clear).toBeVisible();
  await clear.focus();
  await page.keyboard.press("Enter");
  await expect(search).toHaveValue("");
  await expect(page.locator(".dx-album")).toHaveCount(albums.length);

  await page.locator(".dx-album").first().click();
  await expect(page.locator(".dx-tracks tbody tr")).toHaveCount(albumDetail.musics.length);
  await search.fill("amor");
  await expect(page.locator(".dx-tracks tbody tr")).toHaveCount(1);
  await expect(page.locator(".dx-tracks tbody tr")).toContainText("Teu Amor nos Guia");
  await search.fill("sem resultado");
  await expect(page.locator(".dx-tracks tbody tr")).toHaveCount(0);
  await expect(page.locator(".dx-page .lj-empty")).toContainText(/nenhuma música/i);

  await page
    .getByRole("button", { name: "Voltar aos álbuns: Doxologia de Gratidão", exact: true })
    .click();
  await expect(search).toHaveValue("");
  await expect(page.locator(".dx-album")).toHaveCount(albums.length);
});

test("erro no detalhe do álbum oferece nova tentativa e recupera as faixas", async ({ page }) => {
  let attempts = 0;
  const requestUrls = [];
  await start(page, {
    resolveDetail(url) {
      attempts += 1;
      requestUrls.push(url.href);
      return attempts === 1
        ? { id_album: albumDetail.id_album, musics: "formato inválido" }
        : albumDetail;
    },
  });

  await page.locator(".dx-album").first().click();
  await expect(page.locator(".dx-page")).toContainText(
    "Não foi possível carregar as músicas deste álbum."
  );
  await expect(page.locator(".dx-tracks tbody tr")).toHaveCount(0);

  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.locator(".dx-tracks tbody tr")).toHaveCount(albumDetail.musics.length);
  expect(attempts).toBe(2);
  expect(new URL(requestUrls[1]).searchParams.has("_")).toBe(true);
});

test("capa sem imagem e cartões acompanham os temas claro e escuro", async ({ page }) => {
  await start(page);

  const colors = async () =>
    page
      .locator(".dx-album")
      .first()
      .evaluate((card) => ({
        cover: getComputedStyle(card.querySelector(".dx-cover")).backgroundColor,
        card: getComputedStyle(card).backgroundColor,
        text: getComputedStyle(card.querySelector(".dx-album__name")).color,
      }));
  const lightTheme = await page.locator("html").getAttribute("data-theme");
  expect(lightTheme).not.toBe("dark");
  const light = await colors();
  await setTheme(page, "dark");
  await expect.poll(async () => (await colors()).card).not.toBe(light.card);
  const dark = await colors();

  expect(light.card).not.toBe(dark.card);
  expect(light.text).not.toBe(dark.text);
  expect(light.cover).not.toBe(dark.cover);

  await setTheme(page, lightTheme);
  await expect.poll(async () => (await colors()).card).toBe(light.card);
});

test("álbuns e ações cabem em desktop e celular", async ({ page }) => {
  await start(page);

  const first = await page.locator(".dx-album").first().boundingBox();
  const second = await page.locator(".dx-album").nth(1).boundingBox();
  expect(second.x >= first.x + first.width || second.y >= first.y + first.height).toBe(true);
  await assertNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".liturgy-panel")).toHaveClass(/liturgy-panel--compact-web/);
  await expect(page.locator(".liturgy-panel")).toHaveClass(/liturgy-panel--collapsed/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const [first, second] = document.querySelectorAll(".dx-album");
        if (!first || !second) return false;
        const a = first.getBoundingClientRect();
        const b = second.getBoundingClientRect();
        return b.left >= a.right || b.top >= a.bottom;
      })
    )
    .toBe(true);
  await assertNoHorizontalOverflow(page);

  await page.locator(".dx-album").first().click();
  await expect(page.locator(".dx-tracks tbody tr")).toHaveCount(albumDetail.musics.length);
  await assertNoHorizontalOverflow(page);
  for (const row of await page.locator(".dx-tracks tbody tr").all()) {
    const menu = row.locator(".mmt button").first();
    await expect(menu).toBeVisible();
    await expect(row.locator(".dx-actions > button")).toHaveCount(0);
  }

  // Em tela estreita, Cantar fica dentro do menu e continua abrindo o player real.
  await page.locator(".dx-tracks tbody tr").first().locator(".mmt button").first().click();
  await page.getByTestId("mmt-btn-sing").click();
  await expect(page.getByRole("dialog", { name: "Glória ao Pai" })).toBeVisible();
});
