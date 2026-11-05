import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

/*
 * Temporizador e Temporizador de Culto contam até um horário. O relógio da
 * página começa às 10:58 e o horário é 11:00: dois minutos de contagem.
 */
const MODULES = [
  { id: "timer", tab: "utilities", stage: "timer-stage", display: "timer-display" },
  {
    id: "timer_worship",
    tab: "worship",
    stage: "timer-worship-stage",
    display: "timer-worship-display",
  },
];

async function openModule(page, mod) {
  await page.clock.install({ time: new Date(2026, 10, 5, 10, 58, 0) });
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.locator(`#ribbon-tab-${mod.tab}`).click();
  await page.locator(`[data-testid="ribbon-btn-${mod.id}"]`).click();
  await expect(page.getByTestId(mod.display)).toBeVisible();
  // Regressivo, sem os sons do Temporizador de Culto (no teste não há áudio).
  await page.evaluate(async (id) => {
    const { default: userdata } = await import("/src/helpers/UserData.ts");
    userdata.set(`modules.${id}.mode`, "down");
    for (const key of ["sound_start", "sound_five_min", "sound_one_min"])
      userdata.set(`modules.${id}.${key}`, false);
  }, mod.id);
  const time = page
    .locator(`[data-testid="ribbon-btn-${mod.id}_set_time"] input, input[type="time"]`)
    .first();
  await time.fill("11:00");
  await time.dispatchEvent("change");
}

for (const mod of MODULES) {
  test(`${mod.id}: avisa em amarelo, passa do zero em vermelho e borda no telão`, async ({
    page,
    context,
  }) => {
    await openModule(page, mod);
    const display = page.getByTestId(mod.display);
    const stage = page.getByTestId(mod.stage);
    // O relógio da página anda sozinho durante a carga: aceita 1:5x a 2:00.
    await expect(display).toContainText(/00:0(2:00|1:5\d)/);
    // Parado, mesmo dentro do destaque, nada pisca.
    await expect(stage).toHaveAttribute("data-alert", "none");

    const projection = await context.newPage();
    await projection.goto(`/projection/module?module=${mod.id}`);
    await page.bringToFront();

    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
    await page.clock.runFor(70_000);
    await expect(display).toContainText(/00:00:[45]\d/);
    await expect(stage).toHaveAttribute("data-alert", "warning");
    await expect(page.getByTestId("module-alert-frame-warning")).toBeVisible();
    await expect(projection.getByTestId("module-projection-alert-warning")).toBeAttached();

    await page.clock.runFor(62_000);
    await expect(display).toContainText(/\+00:00:1\d/);
    await expect(stage).toHaveAttribute("data-alert", "danger");
    await expect(projection.getByTestId("module-projection-alert-danger")).toBeAttached();
    await expect(projection.locator(".module-projection__text")).toContainText(/\+00:00:1\d/);

    // Pausar e retomar no excedido continua do horário de hoje, não de amanhã.
    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
    await page.clock.runFor(5_000);
    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
    await page.clock.runFor(1_000);
    await expect(display).toContainText(/\+00:00:[12]\d/);
    await expect(stage).toHaveAttribute("data-alert", "danger");

    // Sem "Piscar bordas" o vermelho continua no número, mas a moldura some.
    await page.getByText("Piscar bordas").click();
    await expect(page.locator(".module-alert-frame")).toHaveCount(0);
    await expect(projection.locator(".module-projection__alert")).toHaveCount(0);
  });

  test(`${mod.id}: sem tempo excedido para no zero`, async ({ page }) => {
    await openModule(page, mod);
    await page.getByText("Contar tempo excedido").click();
    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
    await page.clock.runFor(130_000);
    await expect(page.getByTestId(mod.display)).toContainText("00:00:00");
    await expect(page.getByTestId(mod.display)).not.toContainText("+");
    await expect(page.getByTestId(mod.stage)).toHaveAttribute("data-alert", "danger");
  });
}

test("timer: sem mexer no modo, conta regressivo como a ribbon mostra", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 5, 10, 58, 0) });
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.locator("#ribbon-tab-utilities").click();
  await page.locator('[data-testid="ribbon-btn-timer"]').click();
  const display = page.getByTestId("timer-display");
  await expect(display).toBeVisible();
  await expect(
    page.locator('[data-testid="ribbon-btn-timer_mode"] select, select').first()
  ).toHaveValue("down");
  const time = page.locator('input[type="time"]').first();
  await time.fill("11:00");
  await time.dispatchEvent("change");
  // Antes ficava 00:00:00: o módulo estava em progressivo e a ribbon dizia regressivo.
  await expect(display).toContainText(/00:0(2:00|1:5\d)/);
  await page.getByTestId("ribbon-btn-timer_toggle").click();
  await page.clock.runFor(10_000);
  await expect(display).toContainText(/00:01:[45]\d/);
});
