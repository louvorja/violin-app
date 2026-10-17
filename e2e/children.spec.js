import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block", reducedMotion: "reduce", colorScheme: "light" });

const albums = [
  { id_album: 9876701, name: "Canções para a Família" },
  {
    id_album: 9876702,
    name: "A Grande Jornada das Crianças Extraordinariamente Curiosas pelo Mundo da Música",
  },
  { id_album: 9876703, name: "Brincando e Cantando" },
];

const albumDetail = {
  id_album: albums[0].id_album,
  name: albums[0].name,
  musics: [
    { id_music: 9876801, name: "Luz de Cada Manhã", track: 1, duration: "00:03:20" },
    { id_music: 9876802, name: "Meu Pequeno Mundo", duration: "00:04:10" },
    {
      id_music: 9876803,
      name: "Uma Canção ExtraordinariamenteCompridaParaCriançasCantaremJuntas",
      track: 3,
      duration: "00:02:55",
    },
  ],
};

const details = {
  [albums[0].id_album]: albumDetail,
  [albums[1].id_album]: {
    id_album: albums[1].id_album,
    name: albums[1].name,
    musics: [{ id_music: 9876804, name: "A Viagem", track: 1, duration: "00:02:30" }],
  },
  [albums[2].id_album]: { id_album: albums[2].id_album, name: albums[2].name, musics: [] },
};

const lyricDetail = {
  id_music: 9876801,
  name: "Luz de Cada Manhã",
  albums: [
    { id_album: albums[1].id_album, name: albums[1].name, track: 5, order: 1 },
    { id_album: albums[0].id_album, name: albums[0].name, track: 1, order: 2 },
  ],
  lyric: [{ id_lyric: 1, order: 1, lyric: "A luz chegou para cantar", show_slide: 1 }],
};

async function start(page, options = {}) {
  const listedAlbums = options.albums ?? albums;
  if (options.disabledAlbums?.length) {
    await page.addInitScript((disabled) => {
      localStorage.setItem("user_data", JSON.stringify({ options: { disabled_albums: disabled } }));
    }, options.disabledAlbums);
  }
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => {
    const url = new URL(route.request().url());
    const albumMatch = url.pathname.match(/\/album_(\d+)$/);
    if (albumMatch) {
      const id = Number(albumMatch[1]);
      const detail = options.resolveDetail?.(id, url) ?? details[id] ?? null;
      return route.fulfill({ json: detail });
    }
    const musicMatch = url.pathname.match(/\/music_(\d+)$/);
    if (musicMatch && Number(musicMatch[1]) === lyricDetail.id_music) {
      return route.fulfill({ json: lyricDetail });
    }
    if (/\/(?:pt|es)_children_albums$/.test(url.pathname)) {
      return route.fulfill({ json: listedAlbums });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.locator("#ribbon-tab-collections").click();
  await page.getByTestId("ribbon-btn-children").click();
  await expect(page.locator(".ch-root")).toBeVisible();
}

async function setTheme(page, theme) {
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", /.+/);
  const isDark = (await html.getAttribute("data-theme")) === "dark";
  if (isDark !== (theme === "dark")) {
    await page.getByRole("button", { name: "Alternar tema" }).click();
  }
  await expect(html).toHaveAttribute("data-theme", theme === "dark" ? "dark" : /^(?!dark$).+/);
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => {
    const root = document.querySelector(".ch-root");
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

test("cartão acionado pelo teclado foca a busca e voltar restaura o foco", async ({ page }) => {
  await start(page);
  await expect(page.locator(".ch-album")).toHaveCount(albums.length);

  const album = page.getByRole("button", { name: albums[0].name, exact: true });
  await album.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ch-table tbody tr")).toHaveCount(albumDetail.musics.length);
  await expect(page.locator(".ch-table tbody tr").nth(1).locator(".ch-track")).toHaveText("2");
  await expect(page.locator(".ch-search input")).toBeFocused();

  const back = page.getByRole("button", {
    name: `Voltar aos álbuns: ${albums[0].name}`,
    exact: true,
  });
  await expect(back).toHaveCount(1);
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ch-album")).toHaveCount(albums.length);
  await expect(album).toBeFocused();

  await album.press(" ");
  await expect(page.locator(".ch-table tbody tr")).toHaveCount(albumDetail.musics.length);
  await page.locator(".ch-album-back .lj-btn__label").click();
  await expect(page.locator(".ch-album")).toHaveCount(albums.length);
  await expect(album).toBeFocused();
});

for (const { label, options } of [
  { label: "um único álbum", options: { albums: albums.slice(0, 1) } },
  {
    label: "um único álbum habilitado",
    options: { albums: albums.slice(0, 2), disabledAlbums: [albums[1].id_album] },
  },
]) {
  test(`${label} abre as músicas sem navegação de volta`, async ({ page }) => {
    await start(page, options);

    await expect(page.locator(".ch-root h2")).toHaveText(albums[0].name);
    await expect(page.locator(".ch-album-back")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Voltar aos álbuns/ })).toHaveCount(0);
    await expect(page.locator(".ch-album")).toHaveCount(0);
    await expect(page.locator(".ch-table tbody tr")).toHaveCount(albumDetail.musics.length);
    const search = page.locator(".ch-search input");
    await expect(search).toHaveAttribute("placeholder", "Buscar músicas");
    await search.fill("pequeno");
    await expect(page.locator(".ch-table tbody tr")).toHaveCount(1);
  });
}

test("busca e estados vazios funcionam em álbuns e músicas", async ({ page }) => {
  await start(page);
  const search = page.locator(".ch-search input");

  await search.fill("jornada");
  await expect(page.locator(".ch-album")).toHaveCount(1);
  await expect(page.locator(".ch-album")).toContainText(albums[1].name);
  await search.fill("sem resultado");
  await expect(page.locator(".ch-album")).toHaveCount(0);
  await expect(page.locator(".ch-root .lj-empty")).toContainText(/nenhum álbum encontrado/i);

  await page.locator(".ch-search").getByRole("button", { name: "Limpar" }).click();
  await expect(search).toHaveValue("");
  await page.getByRole("button", { name: albums[2].name, exact: true }).click();
  await expect(page.locator(".ch-root .lj-empty")).toContainText(/nenhuma música neste álbum/i);

  await page
    .getByRole("button", { name: `Voltar aos álbuns: ${albums[2].name}`, exact: true })
    .click();
  await page.getByRole("button", { name: albums[0].name, exact: true }).click();
  await search.fill("pequeno");
  await expect(page.locator(".ch-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".ch-table tbody tr")).toContainText("Meu Pequeno Mundo");
  await search.fill("sem resultado");
  await expect(page.locator(".ch-table tbody tr")).toHaveCount(0);
  await expect(page.locator(".ch-root .lj-empty")).toContainText(/nenhuma música encontrada/i);
  await page
    .getByRole("button", { name: `Voltar aos álbuns: ${albums[0].name}`, exact: true })
    .click();
  await expect(search).toHaveValue("");
});

test("erro no detalhe recupera ao tentar novamente com requisição fresh", async ({ page }) => {
  const requestUrls = [];
  await start(page, {
    resolveDetail(id, url) {
      if (id !== albums[0].id_album) return details[id];
      requestUrls.push(url.href);
      return requestUrls.length === 1 ? { id_album: id, musics: "formato inválido" } : albumDetail;
    },
  });

  await page.getByRole("button", { name: albums[0].name, exact: true }).click();
  await expect(page.locator(".ch-root")).toContainText(
    "Não foi possível carregar as músicas deste álbum."
  );
  await expect(page.locator(".ch-table tbody tr")).toHaveCount(0);
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.locator(".ch-table tbody tr")).toHaveCount(albumDetail.musics.length);
  expect(requestUrls).toHaveLength(2);
  expect(new URL(requestUrls[1]).searchParams.has("_")).toBe(true);
});

test("letra pelo menu carrega a música e abre a janela real", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: albums[0].name, exact: true }).click();
  const row = page.locator(".ch-table tbody tr").first();
  await expect(row.locator(".ch-actions > button")).toHaveCount(0);
  await row.hover();
  await row.getByTestId("mmt-btn-lyric").click();

  const dialog = page.getByRole("dialog", { name: "Luz de Cada Manhã" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Canções para a Família");
  await expect(dialog).toContainText("A luz chegou para cantar");
});

test("cartões e tabela respeitam os temas e a largura de 390 px", async ({ page }) => {
  await start(page);
  const colors = () =>
    page
      .locator(".ch-album")
      .first()
      .evaluate((card) => ({
        card: getComputedStyle(card).backgroundColor,
        cover: getComputedStyle(card.querySelector(".ch-album-cover")).backgroundColor,
        text: getComputedStyle(card.querySelector(".ch-album-name")).color,
      }));

  await setTheme(page, "light");
  const light = await colors();
  await setTheme(page, "dark");
  await expect.poll(async () => (await colors()).card).not.toBe(light.card);
  const dark = await colors();
  expect(dark.cover).not.toBe(light.cover);
  expect(dark.text).not.toBe(light.text);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".liturgy-panel")).toHaveClass(/liturgy-panel--compact-web/);
  await expect(page.locator(".liturgy-panel")).toHaveClass(/liturgy-panel--collapsed/);
  await assertNoHorizontalOverflow(page);
  const longAlbum = page.getByRole("button", { name: albums[1].name, exact: true });
  await expect(longAlbum).toBeVisible();
  await longAlbum.click();
  await expect(page.locator(".ch-album-heading")).toHaveText(albums[1].name);
  await assertNoHorizontalOverflow(page);

  await page
    .getByRole("button", { name: `Voltar aos álbuns: ${albums[1].name}`, exact: true })
    .click();
  await page.getByRole("button", { name: albums[0].name, exact: true }).click();
  await expect(page.locator(".ch-table tbody tr")).toHaveCount(albumDetail.musics.length);
  await assertNoHorizontalOverflow(page);
  for (const row of await page.locator(".ch-table tbody tr").all()) {
    await expect(row.locator(".mmt button").first()).toBeVisible();
    await expect(row.locator(".ch-actions > button")).toHaveCount(0);
  }

  // No celular, o atalho da letra migra para o menu da música.
  await page.locator(".ch-table tbody tr").first().locator(".mmt button").first().click();
  await page.getByTestId("mmt-btn-lyric").click();
  const dialog = page.getByRole("dialog", { name: "Luz de Cada Manhã" });
  await expect(dialog).toContainText("Canções para a Família");
  await expect(dialog).toContainText("A luz chegou para cantar");
});
