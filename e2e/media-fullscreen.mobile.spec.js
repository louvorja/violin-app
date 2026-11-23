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

test("Tela cheia nativa faz um único pedido por clique e desfaz o pedido recusado", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "A API nativa é coberta em Chromium.");
  // Um gesto vale por 5 s; o caso recusado espera ele vencer, por aparelho.
  test.setTimeout(60_000);
  for (const device of [devices["Pixel 7"], devices["Desktop Chrome"]]) {
    const context = await browser.newContext({
      ...device,
      serviceWorkers: "block",
      bypassCSP: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.__fullscreenRequests = [];
      const request = Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen = function (...args) {
        const entry = { result: "pending" };
        window.__fullscreenRequests.push(entry);
        const promise = request.apply(this, args);
        promise.then(
          () => (entry.result = "entered"),
          () => (entry.result = "refused")
        );
        return promise;
      };
    });
    const requests = () => page.evaluate(() => window.__fullscreenRequests.map((r) => r.result));
    const reset = () => page.evaluate(() => (window.__fullscreenRequests.length = 0));
    const enter = page.getByRole("button", { name: "Tela cheia", exact: true });
    try {
      await openSlides(page, !device.hasTouch);

      // Janela aberta: o helper pedia de novo logo depois do componente, e o
      // navegador recusava o segundo pedido ("Permissions check failed").
      await enter.click();
      await expectFullscreenStage(page);
      await expect.poll(requests).toEqual(["entered"]);
      await exitFullscreen(page, !!device.hasTouch);

      // Player minimizado: o `<Fullscreen>` monta já com a tela cheia pedida.
      await reset();
      await page.locator(".lj-window [title='Minimizar']").first().click();
      await expect(page.locator(".media-preview")).toHaveCount(0);
      await enter.click();
      await expectFullscreenStage(page);
      await expect.poll(requests).toEqual(["entered"]);
      await exitFullscreen(page, !!device.hasTouch);
      expect(errors).toEqual([]);

      // Fora de um gesto o navegador recusa. Se o flag ficasse ligado, o clique
      // seguinte não mudaria nada e a tela cheia não entraria mais.
      await reset();
      // Cada `evaluate` do Playwright conta como gesto: o clique sai de dentro da página,
      // depois de esse gesto vencer.
      const gesture = await enter.evaluate(
        (button) =>
          new Promise((resolve) =>
            setTimeout(() => {
              resolve(navigator.userActivation.isActive);
              button.click();
            }, 5500)
          )
      );
      expect(gesture).toBe(false);
      await expect.poll(requests).toEqual(["refused"]);
      await expect(page.locator(".media-preview.fullscreen")).toHaveCount(0);
      await reset();
      await enter.click();
      await expectFullscreenStage(page);
      await expect.poll(requests).toEqual(["entered"]);
    } finally {
      await context.close();
    }
  }
});
