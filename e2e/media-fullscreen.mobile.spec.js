import { devices, expect, test } from "@playwright/test";
import ptMusics from "./fixtures/pt_musics.json";
import music1 from "./fixtures/music_1.json";

test.use({ hasTouch: true, isMobile: true, serviceWorkers: "block", reducedMotion: "reduce" });

async function openSlides(page, desktop = false) {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/db/bible-bundle*", (route) =>
    route.fulfill({ status: 503, body: "offline" })
  );
  await page.route(/(?:pt_musics|\/db\/musics\/pt)/, (route) => route.fulfill({ json: ptMusics }));
  await page.route("**/music_1*", (route) => route.fulfill({ json: music1 }));
  await page.goto("/");
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  await page.locator("#ribbon-tab-collections").click();
  await page.getByTestId("ribbon-btn-musics").click();
  const row = page.getByTestId("music-row-1");
  if (desktop) await row.hover();
  else await row.locator(".mmt button").first().click();
  await page.getByTestId("mmt-btn-no-audio").click();
  await expect(page.locator(".media-preview .lj-slide--ready")).toBeVisible();
  await page
    .locator(".lj-window")
    .evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished))
    );
}

async function expectFullscreenStage(page) {
  const preview = page.locator(".media-preview.fullscreen");
  await expect(preview).toBeVisible();
  // Espera o layout estabilizar, inclusive após rotação/animação do diálogo.
  await expect
    .poll(() =>
      preview.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return Math.max(
          Math.abs(rect.x),
          Math.abs(rect.y),
          Math.abs(rect.width - document.documentElement.clientWidth),
          Math.abs(rect.height - document.documentElement.clientHeight)
        );
      })
    )
    .toBeLessThanOrEqual(1);
  // Tamanho correto sozinho não basta: a lista de slides era pintada POR CIMA.
  const covered = await preview.evaluate((element) => {
    const { clientWidth: width, clientHeight: height } = document.documentElement;
    const controls = element.querySelector(".fsp-overlay");
    const pointerEvents = controls?.style.pointerEvents;
    // A camada transparente de controles poderia mascarar a lista pintada sobre o slide.
    if (controls) controls.style.pointerEvents = "none";
    try {
      return [0.1, 0.5, 0.9].every((x) =>
        [0.1, 0.5, 0.8].every((y) =>
          element.contains(document.elementFromPoint(width * x, height * y))
        )
      );
    } finally {
      if (controls) controls.style.pointerEvents = pointerEvents;
    }
  });
  expect(covered).toBe(true);
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth - root.clientWidth, root.scrollHeight - root.clientHeight);
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

async function exitFullscreen(page, touch = true) {
  const overlay = page.locator(".fsp-overlay");
  if (touch) await overlay.tap({ position: { x: 20, y: 20 } });
  else await overlay.hover({ position: { x: 20, y: 20 } });
  const exit = page.getByRole("button", { name: "Sair da tela cheia", exact: true });
  if (touch) await exit.tap();
  else await exit.click();
  await expect(page.locator(".media-preview.fullscreen")).toHaveCount(0);
  await expect(page.locator(".fsp-overlay")).toHaveCount(0);
}

for (const landscape of [false, true]) {
  test(`Tela cheia de slides sem API nativa em ${landscape ? "paisagem" : "retrato"}`, async ({
    page,
  }, testInfo) => {
    const initial = landscape ? { width: 844, height: 390 } : { width: 390, height: 844 };
    const rotated = { width: initial.height, height: initial.width };
    await page.setViewportSize(initial);
    // O WebKit de automação pode expor API desktop mesmo com perfil iPhone.
    // Exercita explicitamente o fallback real do iPhone, sem simular fullscreenElement.
    await page.addInitScript(() => {
      for (const key of ["fullscreenEnabled", "webkitFullscreenEnabled"]) {
        Object.defineProperty(document, key, { configurable: true, value: false });
      }
    });
    await openSlides(page);
    const dialogBefore = await page.locator(".lj-window").boundingBox();
    await page.getByRole("button", { name: "Tela cheia", exact: true }).tap();
    await expectFullscreenStage(page);
    await expect(page.locator(".fsp-bar")).toBeVisible();
    // Avançar por toque continua funcionando dentro do modal Reka.
    await page.locator(".fsp-bar .player-controls button:visible:enabled").first().tap();
    await expect(page.locator(".media-preview [data-testid='slide-content']")).toContainText(
      "Glória ao Senhor"
    );
    await page.setViewportSize(rotated);
    await expectFullscreenStage(page);
    await page.screenshot({ path: testInfo.outputPath("fullscreen-rotated.png"), scale: "css" });
    await page.setViewportSize(initial);
    await expectFullscreenStage(page);
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await exitFullscreen(page);
    await expect.poll(() => page.locator(".lj-window").boundingBox()).toEqual(dialogBefore);
    if (landscape) {
      await page.locator(".media-slide").first().tap();
      await expect(page.locator(".media-slide").first()).toHaveAttribute("aria-current", "true");
    }
  });
}

test("Tela cheia nativa de slides preserva mobile e desktop", async ({ browser, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "A API nativa é coberta em Chromium; iPhone usa o fallback."
  );
  for (const device of [devices["Pixel 7"], devices["Desktop Chrome"]]) {
    const context = await browser.newContext({
      ...device,
      serviceWorkers: "block",
      bypassCSP: true,
    });
    const page = await context.newPage();
    try {
      await openSlides(page, !device.hasTouch);
      const dialogBefore = await page.locator(".lj-window").boundingBox();
      await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
      await expectFullscreenStage(page);
      await expect(page.locator(".lj-window")).toHaveJSProperty(
        "offsetWidth",
        Math.round(dialogBefore.width)
      );
      await exitFullscreen(page, !!device.hasTouch);
      await expect.poll(() => page.locator(".lj-window").boundingBox()).toEqual(dialogBefore);
    } finally {
      await context.close();
    }
  }
});
