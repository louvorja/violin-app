import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function openStopwatch(page) {
  await page.clock.install();
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.locator("#ribbon-tab-utilities").click();
  await page.locator('[data-testid="ribbon-btn-stopwatch"]').click();
  await expect(page.getByTestId("stopwatch-display")).toBeVisible();
}

test("regressivo mostra a meta, avisa em amarelo e passa do zero em vermelho", async ({
  page,
  context,
}) => {
  await openStopwatch(page);
  const display = page.getByTestId("stopwatch-display");
  const stage = page.getByTestId("stopwatch-stage");

  // Trocar o modo já mostra a meta — antes ficava 00:00 até apertar Iniciar.
  await page.getByRole("tab", { name: "Regressivo" }).click();
  await expect(display).toHaveText("10:00");
  await page.getByTestId("stopwatch-preset-5").click();
  await expect(display).toHaveText("05:00");

  const projection = await context.newPage();
  await projection.goto("/projection/module?module=stopwatch");
  await expect(projection.locator(".module-projection__text")).toHaveText("05:00");

  // Com o telão já de pé, o relógio da página para: daqui em diante o tempo só
  // anda com runFor. Solto, ele seguia correndo entre um passo e outro, e numa
  // máquina lenta (a esteira) a tela mostrava segundos a mais ou a menos.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

  await page.bringToFront();
  await page.getByTestId("ribbon-btn-stopwatch_toggle").click();
  await page.clock.runFor(5 * 60_000 - 30_000);
  await expect(display).toHaveText("00:30");
  await expect(stage).toHaveAttribute("data-alert", "warning");
  await expect(page.getByTestId("stopwatch-frame")).toBeVisible();
  await expect(projection.getByTestId("module-projection-alert-warning")).toBeAttached();

  await page.clock.runFor(42_000);
  await expect(display).toHaveText("-00:12");
  await expect(stage).toHaveAttribute("data-alert", "danger");
  await expect(projection.locator(".module-projection__text")).toHaveText("-00:12");
  await expect(projection.getByTestId("module-projection-alert-danger")).toBeAttached();

  // +1 min tira do vermelho sem recomeçar a contagem.
  await page.getByTestId("stopwatch-add-minute").click();
  await expect(display).toHaveText("00:48");
  await expect(stage).toHaveAttribute("data-alert", "warning");

  // O resto não depende de segundos; solto, o clique não espera a animação parar.
  await page.clock.resume();
  await page.getByTestId("ribbon-btn-stopwatch_reset").click();
  await expect(display).toHaveText("06:00");
  await expect(stage).toHaveAttribute("data-alert", "none");
  await expect(projection.locator(".module-projection__alert")).toHaveCount(0);
});

test("contagem continua certa quando o relógio pula (janela minimizada)", async ({ page }) => {
  await openStopwatch(page);
  await page.getByTestId("ribbon-btn-stopwatch_toggle").click();
  // Um único salto de 90 s, como um timer espaçado pelo Chromium em segundo plano.
  await page.clock.fastForward(90_000);
  await expect(page.getByTestId("stopwatch-display")).toHaveText("01:30");
});

test("pausar e +1 min estende sem perder o tempo contado", async ({ page }) => {
  await openStopwatch(page);
  const display = page.getByTestId("stopwatch-display");
  await page.getByRole("tab", { name: "Regressivo" }).click();
  await page.getByTestId("stopwatch-preset-5").click();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

  await page.getByTestId("ribbon-btn-stopwatch_toggle").click();
  await page.clock.runFor(60_000);
  await expect(display).toHaveText("04:00");

  await page.getByTestId("ribbon-btn-stopwatch_toggle").click();
  await page.getByTestId("stopwatch-add-minute").click();
  await expect(display).toHaveText("05:00");
});

test("preset durante a contagem recomeça do zero", async ({ page }) => {
  await openStopwatch(page);
  const display = page.getByTestId("stopwatch-display");
  await page.getByRole("tab", { name: "Regressivo" }).click();
  await page.getByTestId("stopwatch-preset-5").click();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

  await page.getByTestId("ribbon-btn-stopwatch_toggle").click();
  await page.clock.runFor(60_000);
  await expect(display).toHaveText("04:00");

  await page.getByTestId("stopwatch-preset-30").click();
  await expect(display).toHaveText("30:00");
  await expect(page.getByTestId("ribbon-btn-stopwatch_toggle")).toContainText("Iniciar");
});

test("desligar tempo excedido no excedido para e mostra 00:00", async ({ page }) => {
  await openStopwatch(page);
  const display = page.getByTestId("stopwatch-display");
  await page.getByRole("tab", { name: "Regressivo" }).click();
  await page.getByTestId("stopwatch-preset-5").click();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

  await page.getByTestId("ribbon-btn-stopwatch_toggle").click();
  await page.clock.runFor(5 * 60_000 + 5_000);
  await expect(display).toHaveText("-00:05");

  await page.getByText("Contar tempo excedido").click();
  await expect(display).toHaveText("00:00");
  await expect(page.getByTestId("ribbon-btn-stopwatch_toggle")).toContainText("Iniciar");
});

test("fechar a aba no X para a contagem e tira a borda do telão", async ({ page, context }) => {
  await openStopwatch(page);
  await page.getByRole("tab", { name: "Regressivo" }).click();
  await page.getByTestId("stopwatch-preset-5").click();
  const projection = await context.newPage();
  await projection.goto("/projection/module?module=stopwatch");
  await page.bringToFront();
  await page.getByTestId("ribbon-btn-stopwatch_toggle").click();
  await page.clock.runFor(5 * 60_000 + 5_000);
  await expect(projection.getByTestId("module-projection-alert-danger")).toBeAttached();

  await page.locator(".subtab-close").first().click();
  await expect(projection.locator(".module-projection__alert")).toHaveCount(0);
  await expect(projection.locator(".module-projection__text")).toHaveCount(0);

  await page.locator("#ribbon-tab-utilities").click();
  await page.locator('[data-testid="ribbon-btn-stopwatch"]').click();
  await expect(page.getByTestId("stopwatch-display")).toHaveText("05:00");
  await expect(page.getByTestId("ribbon-btn-stopwatch_toggle")).toContainText("Iniciar");
  await expect(projection.locator(".module-projection__text")).toHaveText("05:00");
});

test("cores do aviso e do alerta da Formatação valem no número e na moldura, na tela e no telão", async ({
  page,
  context,
}) => {
  await openStopwatch(page);
  await page.evaluate(async () => {
    const { default: userdata } = await import("/src/helpers/UserData.ts");
    userdata.set("modules.stopwatch.warning_color", "#22C55E");
    userdata.set("modules.stopwatch.alert_color", "#8E44AD");
  });
  await page.getByRole("tab", { name: "Regressivo" }).click();
  await page.getByTestId("stopwatch-preset-5").click();
  const projection = await context.newPage();
  await projection.goto("/projection/module?module=stopwatch");
  await page.bringToFront();
  await page.getByTestId("ribbon-btn-stopwatch_toggle").click();

  const color = (locator) => locator.evaluate((el) => getComputedStyle(el).color);
  const frame = (locator) =>
    locator.evaluate((el) => getComputedStyle(el).getPropertyValue("--frame-color").trim());

  await page.clock.runFor(5 * 60_000 - 30_000);
  await expect.poll(() => color(page.getByTestId("stopwatch-display"))).toBe("rgb(34, 197, 94)");
  await expect.poll(() => frame(page.getByTestId("stopwatch-frame"))).toBe("#22C55E");
  const projectionWarning = projection.getByTestId("module-projection-alert-warning");
  await expect.poll(() => frame(projectionWarning)).toBe("#22C55E");
  await expect
    .poll(() => color(projection.locator(".module-projection__text")))
    .toBe("rgb(34, 197, 94)");

  await page.clock.runFor(40_000);
  await expect.poll(() => color(page.getByTestId("stopwatch-display"))).toBe("rgb(142, 68, 173)");
  await expect.poll(() => frame(page.getByTestId("stopwatch-frame"))).toBe("#8E44AD");
  await expect
    .poll(() => frame(projection.getByTestId("module-projection-alert-danger")))
    .toBe("#8E44AD");
});
