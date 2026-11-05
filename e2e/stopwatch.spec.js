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
  await page.getByTestId("stopwatch-mode-down").click();
  await expect(display).toHaveText("10:00");
  await page.getByTestId("stopwatch-preset-5").click();
  await expect(display).toHaveText("05:00");

  const projection = await context.newPage();
  await projection.goto("/projection/module?module=stopwatch");
  await expect(projection.locator(".module-projection__text")).toHaveText("05:00");

  await page.bringToFront();
  await page.getByTestId("stopwatch-toggle").click();
  await page.clock.runFor(5 * 60_000 - 30_000);
  await expect(display).toHaveText("00:30");
  await expect(stage).toHaveAttribute("data-alert", "warning");
  await expect(page.getByTestId("stopwatch-frame")).toBeVisible();
  await expect(projection.getByTestId("module-projection-alert-warning")).toBeAttached();

  await page.clock.runFor(42_000);
  await expect(display).toHaveText("+00:12");
  await expect(stage).toHaveAttribute("data-alert", "danger");
  await expect(projection.locator(".module-projection__text")).toHaveText("+00:12");
  await expect(projection.getByTestId("module-projection-alert-danger")).toBeAttached();

  // +1 min tira do vermelho sem recomeçar a contagem.
  await page.getByTestId("stopwatch-add-minute").click();
  await expect(display).toHaveText("00:48");
  await expect(stage).toHaveAttribute("data-alert", "warning");

  await page.getByTestId("stopwatch-reset").click();
  await expect(display).toHaveText("06:00");
  await expect(stage).toHaveAttribute("data-alert", "none");
  await expect(projection.locator(".module-projection__alert")).toHaveCount(0);
});

test("contagem continua certa quando o relógio pula (janela minimizada)", async ({ page }) => {
  await openStopwatch(page);
  await page.getByTestId("stopwatch-toggle").click();
  // Um único salto de 90 s, como um timer espaçado pelo Chromium em segundo plano.
  await page.clock.fastForward(90_000);
  await expect(page.getByTestId("stopwatch-display")).toHaveText("01:30");
});
