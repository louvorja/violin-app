import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function mockNetwork(context) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/json_db/") || url.origin === "http://e2e.mock") {
      return route.fulfill({ json: [] });
    }
    if (url.origin === "http://localhost:5002") return route.continue();
    if (url.hostname.includes("youtube.com") || url.hostname.includes("ytimg.com")) {
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ status: 204, body: "" });
  });
}

async function seedCustomVideos(page, countPerCat = 8) {
  await page.evaluate(async (perCat) => {
    const { default: $idb } = await import("/src/helpers/IndexedDB.ts");
    const { DB_TABLE } = await import("/src/constants/DbTables.ts");
    const cat1 = {
      id: "cat-louvores",
      name: "Louvores",
      icon: "mdi-music",
      iconType: "icon",
      color: "#1e88e5",
    };
    const cat2 = {
      id: "cat-adoracao",
      name: "Adoração",
      icon: "mdi-heart",
      iconType: "icon",
      color: "#8e24aa",
    };
    await $idb.put(DB_TABLE.CUSTOM_ONLINE_VIDEOS_CATEGORIES, cat1);
    await $idb.put(DB_TABLE.CUSTOM_ONLINE_VIDEOS_CATEGORIES, cat2);

    const sampleIds = [
      "dQw4w9WgXcQ",
      "M7lc1UVf-VE",
      "ysz5S6PUM-U",
      "aqz-KE-bpKQ",
      "jNQXAC9IVRw",
      "LXb3EKWsInQ",
      "9bZkp7q19f0",
      "3JZ_D3ELwOQ",
    ];
    for (let i = 0; i < perCat; i++) {
      const ytId = sampleIds[i % sampleIds.length];
      await $idb.put(DB_TABLE.CUSTOM_ONLINE_VIDEOS, {
        id: `v-l-${i + 1}`,
        name: `Louvor ${i + 1}`,
        url: `https://www.youtube.com/watch?v=${ytId}`,
        categoryId: cat1.id,
        createdAt: new Date().toISOString(),
      });
    }
    await $idb.put(DB_TABLE.CUSTOM_ONLINE_VIDEOS, {
      id: "v-a-1",
      name: "Adoração Inicial",
      url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
      categoryId: cat2.id,
      createdAt: new Date().toISOString(),
    });
  }, countPerCat);
}

async function openCustomVideos(page) {
  const tipDialog = page.getByRole("dialog", { name: "Dica do LouvorJA" });
  if (await tipDialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await tipDialog.getByRole("button", { name: "Fechar" }).first().click();
  }
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-custom_online_videos"]').click();
  await expect(page.locator(".cv-chips")).toBeVisible({ timeout: 15_000 });
}

test.describe("Meus Vídeos Online: categorias fixas (#51) e Tocar Todas (#67)", () => {
  test("mantém barra de categorias visível ao rolar e move vídeo pelo menu (#51)", async ({
    page,
    context,
  }) => {
    await mockNetwork(context);
    await page.goto("/");
    await page
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 30_000 });
    await seedCustomVideos(page, 12);
    await openCustomVideos(page);

    // Muda para lista para garantir bastante rolagem vertical.
    await page.setViewportSize({ width: 1024, height: 640 });
    const chips = page.locator(".cv-chips");
    const scroll = page.locator(".cv-scroll");
    await expect(page.locator(".cv-grid-card, .cv-list-item").first()).toBeVisible();

    await scroll.evaluate((el) => {
      el.scrollTop = 500;
    });

    const [chipsBox, scrollBox] = await Promise.all([chips.boundingBox(), scroll.boundingBox()]);
    expect(chipsBox).toBeTruthy();
    expect(scrollBox).toBeTruthy();
    expect(chipsBox.y).toBeGreaterThanOrEqual(0);
    expect(chipsBox.y + chipsBox.height).toBeLessThanOrEqual(scrollBox.y + 4);

    // Move o primeiro vídeo para a categoria Adoração pelo menu ⋮.
    await page.locator('[aria-label="Mais opções"]').first().click();
    await expect(page.getByText("Mover para categoria")).toBeVisible();
    await page
      .locator('[role="menuitemcheckbox"], [role="menuitem"]')
      .filter({ hasText: "Adoração" })
      .first()
      .click();

    await chips.locator(".lj-category-chip", { hasText: "Adoração" }).click();
    await expect(page.locator(".cv-body")).toContainText("Louvor 1");
  });

  test("Tocar Todas inicia fila da categoria e oculta 00:00 / 00:00 no rodapé (#67)", async ({
    page,
    context,
  }) => {
    await mockNetwork(context);
    await page.goto("/");
    await page
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 30_000 });
    await seedCustomVideos(page, 2);
    await openCustomVideos(page);

    // Todos os chips começam ativos: desmarca Adoração para filtrar apenas Louvores.
    await page.locator(".cv-chips .lj-category-chip", { hasText: "Adoração" }).click();
    await expect(page.locator(".cv-chips-play-all")).toContainText("(2)");
    await page.locator(".cv-chips-play-all").click();

    const playlistBar = page.locator(".playlist-bar");
    await expect(playlistBar).toBeVisible({ timeout: 10_000 });
    await expect(playlistBar).toContainText("Louvores");
    await expect(playlistBar).toContainText("1/2");

    // Vídeos online sem duração conhecida não devem exibir "00:00 / 00:00" no rodapé.
    await expect(page.locator(".footer")).not.toContainText("00:00 / 00:00");

    // Encerra a fila pelo botão de parar na barra da playlist.
    const mediaWindow = page.locator(".lj-window").filter({ has: page.locator(".media-body") });
    await expect(mediaWindow).toBeVisible({ timeout: 10_000 });
  });
});
