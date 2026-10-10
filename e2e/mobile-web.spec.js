import { Buffer } from "node:buffer";
import { devices, expect, test } from "@playwright/test";
import ptMusics from "./fixtures/pt_musics.json";
import music1 from "./fixtures/music_1.json";

test.use({
  ...devices["Pixel 7"],
  serviceWorkers: "block",
  reducedMotion: "reduce",
  colorScheme: "light",
});

async function boot(page) {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/db/bible-bundle*", (route) =>
    route.fulfill({ status: 503, body: "offline" })
  );
  await page.route(/(?:pt_musics|\/db\/musics\/pt)/, (route) => route.fulfill({ json: ptMusics }));
  await page.route("**/music_1*", (route) => route.fulfill({ json: music1 }));
  await page.goto("/");
  await page.getByTestId("modules-ready").waitFor({ state: "attached", timeout: 30_000 });
  await expect(page.locator(".shell-root")).toBeVisible();
}

async function expectNoPageOverflow(page) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.page, `document overflow at ${widths.viewport}px`).toBeLessThanOrEqual(
    widths.viewport + 1
  );
  expect(widths.body, `body overflow at ${widths.viewport}px`).toBeLessThanOrEqual(
    widths.viewport + 1
  );
}

async function expectInsideViewport(locator, page) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(rect.x).toBeGreaterThanOrEqual(-1);
  expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
}

async function expectVisibleVertically(locator, page) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  const height = await page.evaluate(() => document.documentElement.clientHeight);
  expect(rect.y).toBeGreaterThanOrEqual(-1);
  expect(rect.y + rect.height).toBeLessThanOrEqual(height + 1);
}

async function expectTouchTarget(locator) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect.width).toBeGreaterThanOrEqual(40);
  expect(rect.height).toBeGreaterThanOrEqual(40);
}

for (const width of [320, 360, 390, 412]) {
  test(`Shell e menu cabem e respondem ao toque em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await boot(page);
    await expectNoPageOverflow(page);
    await expectInsideViewport(page.locator(".ribbon-tabs-row"), page);
    await expectInsideViewport(page.locator(".shell-main"), page);

    const menuTrigger = page.locator(".app-menu-btn");
    await expectInsideViewport(menuTrigger, page);
    await menuTrigger.tap();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expectInsideViewport(menu, page);
    await page.locator('.app-menu-item[title="Opções"]').tap();
    await expect(page.locator("#opt-sec-general")).toBeVisible();
    await expectNoPageOverflow(page);
    await page.locator(".app-menu-back").tap();
    await expect(menu).toBeHidden();

    await page.locator("#ribbon-tab-collections").tap();
    await expect(page.locator("#ribbon-tab-collections")).toHaveAttribute("aria-selected", "true");
    await expectNoPageOverflow(page);
  });
}

for (const target of [
  { name: "tablet", viewport: { width: 768, height: 1024 }, touch: true },
  { name: "paisagem", viewport: { width: 800, height: 360 }, touch: true },
  { name: "desktop", viewport: { width: 1366, height: 768 }, touch: false },
]) {
  test(`Shell, menu e Músicas mantêm geometria em ${target.name} ${target.viewport.width}×${target.viewport.height}`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      ...(target.touch ? devices["Pixel 7"] : devices["Desktop Chrome"]),
      viewport: target.viewport,
      baseURL: testInfo.project.use.baseURL,
      serviceWorkers: "block",
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    try {
      const page = await context.newPage();
      const activate = (locator) => (target.touch ? locator.tap() : locator.click());
      await boot(page);
      await expectNoPageOverflow(page);
      await expectInsideViewport(page.locator(".ribbon-tabs-row"), page);
      await expectInsideViewport(page.locator(".shell-main"), page);
      const menuTrigger = page.locator(".app-menu-btn");
      if (target.touch) await expectTouchTarget(menuTrigger);
      else expect((await menuTrigger.boundingBox()).height).toBeCloseTo(28, 0);
      await activate(menuTrigger);
      await expect(page.getByRole("menu")).toBeVisible();
      await expectInsideViewport(page.getByRole("menu"), page);
      await activate(page.locator('.app-menu-item[title="Opções"]'));
      await expect(page.locator("#opt-sec-general")).toBeVisible();
      await activate(page.locator(".app-menu-back"));
      const ribbonTab = page.locator("#ribbon-tab-collections");
      if (target.touch) await expectTouchTarget(ribbonTab);
      else expect((await ribbonTab.boundingBox()).height).toBeCloseTo(28, 0);
      await activate(ribbonTab);
      const toolButtons = page.locator(".ribbon-tools-web button.shell-tool:visible");
      expect(await toolButtons.count()).toBeGreaterThan(0);
      if (target.touch) {
        for (const tool of await toolButtons.all()) await expectTouchTarget(tool);
      } else {
        expect((await toolButtons.first().boundingBox()).width).toBeCloseTo(34, 0);
      }
      await activate(page.getByTestId("ribbon-btn-musics"));
      const row = page.getByTestId("music-row-1");
      await expect(row).toBeVisible();
      if (target.name === "paisagem") {
        await row.locator(".mmt button").first().tap({ timeout: 8_000 });
        await expect(page.getByTestId("mmt-btn-no-audio")).toBeVisible();
        await page.keyboard.press("Escape");
      }
      await expectInsideViewport(page.locator(".module-embedded"), page);
      const subtab = page.locator(".subtab--active");
      const close = subtab.locator(".subtab-close");
      await expect(subtab).toBeVisible();
      if (target.touch) {
        await expectTouchTarget(subtab);
        await expectTouchTarget(close);
      } else {
        expect((await close.boundingBox()).width).toBeCloseTo(16, 0);
      }
      const sidebar = page.locator(".liturgy-panel");
      if (target.touch) {
        // Em tela de toque o painel da Liturgia começa desligado: o centro fica
        // com a largura toda, e só o operador o liga.
        await expect(sidebar).toHaveCount(0);
        const centerRect = await page.locator(".shell-center").boundingBox();
        expect(centerRect.x + centerRect.width).toBeCloseTo(target.viewport.width, 0);
      } else {
        const sidebarToggle = page.locator(".liturgy-panel-header .liturgy-icon-btn").first();
        expect((await sidebarToggle.boundingBox()).width).toBeCloseTo(22, 0);
        const initiallyCollapsed = await sidebar.evaluate((element) =>
          element.classList.contains("liturgy-panel--collapsed")
        );
        await activate(sidebarToggle);
        await expect
          .poll(() =>
            sidebar.evaluate((element) => element.classList.contains("liturgy-panel--collapsed"))
          )
          .toBe(!initiallyCollapsed);
        await activate(sidebarToggle);
        await expect
          .poll(() =>
            sidebar.evaluate((element) => element.classList.contains("liturgy-panel--collapsed"))
          )
          .toBe(initiallyCollapsed);
      }
      await activate(close);
      await expect(page.locator(".subtabs-wrapper")).toBeHidden();
      await expectNoPageOverflow(page);
    } finally {
      await context.close();
    }
  });
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`Músicas e Playlists respondem ao toque em ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await boot(page);
    await page.locator("#ribbon-tab-collections").tap();
    await page.getByTestId("ribbon-btn-musics").tap();
    const row = page.getByTestId("music-row-1");
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expectInsideViewport(page.locator(".module-embedded"), page);
    await expectNoPageOverflow(page);

    const musicNav = page.locator(".musics-mobile-nav__button");
    await expectTouchTarget(musicNav.nth(1));
    await musicNav.nth(1).tap();
    const playlists = page.locator(".musics-mobile-pane .playlist-panel");
    await expect(playlists).toBeVisible();
    await expectNoPageOverflow(page);
    await expectTouchTarget(playlists.getByRole("button", { name: "Nova playlist" }));
    await playlists.getByRole("button", { name: "Nova playlist" }).tap();
    await playlists.getByPlaceholder("Nome da playlist").fill("Culto mobile");
    await playlists
      .locator(".playlist-panel-input-row")
      .getByRole("button", { name: "Nova playlist" })
      .tap();
    const created = playlists.locator(".playlist-panel-item").filter({ hasText: "Culto mobile" });
    await expect(created).toBeVisible();
    await expectTouchTarget(created.getByRole("button", { name: "Excluir playlist" }));
    await created.locator(".playlist-panel-item-name").tap();
    await expect(page.locator(".musics-mobile-pane .playlist-songs")).toBeVisible();
    await musicNav.first().tap();
    await expect(row).toBeVisible();

    await row.locator(".mmt button").first().tap();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByTestId("mmt-btn-no-audio")).toBeVisible();
    await page.getByTestId("mmt-btn-no-audio").tap();
    await expect(page.getByTitle("Minimizar")).toBeVisible({ timeout: 10_000 });
    await page.getByTitle("Minimizar").tap();
    await expect(page.locator("#footer-bar")).toHaveClass(/footer--active/);
    await expect
      .poll(
        () =>
          page.locator("#footer-bar").evaluate((footer) => {
            return footer.getBoundingClientRect().bottom - document.documentElement.clientHeight;
          }),
        { timeout: 2_500 }
      )
      .toBeLessThanOrEqual(1);
    await expectVisibleVertically(page.locator("#footer-bar"), page);
    await expectTouchTarget(page.locator("#footer-bar .player-controls .player-btn").first());
    await expectNoPageOverflow(page);
  });

  test(`Bíblia e Liturgia mantêm conteúdo e diálogo acessíveis em ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await boot(page);

    await page.locator("#ribbon-tab-bible").tap();
    await page.getByTestId("ribbon-btn-bible").tap();
    await expect(page.locator(".bible-header")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".bible-compact-fields")).toBeVisible();
    await expectTouchTarget(page.locator(".bible-verses-trigger"));
    await expectInsideViewport(page.locator(".module-embedded"), page);
    await expectNoPageOverflow(page);

    await page.locator("#ribbon-tab-worship").tap();
    await page.getByTestId("ribbon-btn-liturgy").tap();
    await expect(page.locator(".liturgy-page")).toBeVisible({ timeout: 15_000 });
    await expectInsideViewport(page.locator(".liturgy-page"), page);
    await expectNoPageOverflow(page);
    await page.getByTestId("liturgy-add-item").last().tap({ timeout: 8_000 });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expectInsideViewport(dialog, page);
    await expectVisibleVertically(dialog, page);
    await expectVisibleVertically(dialog.locator(".lj-dialog__footer"), page);
    await expectTouchTarget(dialog.getByTestId("item-save"));
  });
}

test("Músicas mantém primeira linha tocável em 320×400", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await boot(page);
  await page.locator("#ribbon-tab-collections").tap();
  await page.getByTestId("ribbon-btn-musics").tap();
  const row = page.getByTestId("music-row-1");
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator(".mmt button").first().tap({ timeout: 8_000 });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByTestId("mmt-btn-no-audio")).toBeVisible();
  await expectNoPageOverflow(page);
});

test("Biblioteca de Mídia alterna entre acervo e playlist em 320×568", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await boot(page);
  await page.locator("#ribbon-tab-worship").tap();
  await page.getByTestId("ribbon-btn-media_library").tap();
  await expect(page.locator(".media-root")).toBeVisible({ timeout: 15_000 });
  await expectInsideViewport(page.locator(".media-root"), page);
  const tabs = page.locator(".media-mobile-nav__button");
  await expect(tabs).toHaveCount(2);
  await expectTouchTarget(tabs.first());
  await expectTouchTarget(tabs.last());
  await expect(page.locator(".media-toolbar")).toBeVisible();
  await expectNoPageOverflow(page);
  await tabs.last().tap();
  await expect(page.locator(".media-playlist")).toBeVisible();
  await expectNoPageOverflow(page);
  await tabs.first().tap();
  await expect(page.locator(".media-library")).toBeVisible();
  await expectTouchTarget(page.locator(".media-add-button"));
  await page.locator(".media-add-button").tap();
  const categoryDialog = page.getByRole("dialog");
  await expect(categoryDialog).toBeVisible();
  await expectInsideViewport(categoryDialog, page);
  const chooserPromise = page.waitForEvent("filechooser");
  await categoryDialog.getByRole("button", { name: "Sem categoria" }).tap();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "mobile-e2e.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qvmAAAAAASUVORK5CYII=",
      "base64"
    ),
  });
  const imported = page.locator(".media-grid-item").filter({ hasText: "mobile-e2e.png" });
  await expect(imported).toBeVisible();
  await expectTouchTarget(imported.getByRole("button", { name: "Renomear" }));
  await expectTouchTarget(imported.getByRole("button", { name: "Excluir" }));
  await imported.tap();
  await expect(page.getByRole("dialog", { name: "Renomear" })).toBeHidden();
  await tabs.last().tap();
  await expect(page.locator(".media-playlist-item")).toContainText("mobile-e2e.png");
  await expectNoPageOverflow(page);
});

test("Anúncios permite criar, editar e pré-visualizar em 320×568", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await boot(page);
  await page.locator("#ribbon-tab-worship").tap();
  await page.getByTestId("ribbon-btn-announcements").tap();
  const nav = page.locator(".an-mobile-nav button");
  await expect(nav).toHaveCount(3);
  for (const tab of await nav.all()) await expectTouchTarget(tab);
  await expect(page.locator(".an-list")).toBeVisible();
  await expectNoPageOverflow(page);

  const add = page.locator(".an-list-head button");
  await expectTouchTarget(add);
  await add.tap();
  await expect(page.locator(".an-inputs")).toBeVisible();
  await expectInsideViewport(page.locator(".an-inputs"), page);
  await page.locator(".an-inputs input").first().fill("Aviso mobile");
  await page.locator(".an-textarea textarea").fill("Culto de domingo");
  await nav.nth(1).tap();
  await expect(page.locator(".an-preview-text")).toContainText("Culto de domingo");
  await expectInsideViewport(page.locator(".an-preview-box"), page);
  await nav.first().tap();
  await expect(page.locator(".an-item")).toContainText("Aviso mobile");
  await expectTouchTarget(page.locator(".an-item-delete"));
  await expectNoPageOverflow(page);
});
