import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

/*
 * Temporizador e Temporizador de Culto contam até um horário. O relógio da
 * página começa às 10:58 e o horário é 11:00: dois minutos de contagem.
 */
const START = new Date(2026, 10, 5, 10, 58, 0);

/**
 * A carga da página pode levar dezenas de segundos numa máquina lenta, e o
 * relógio instalado segue andando: volta para 10:58 com o módulo já na tela.
 */
async function backToStart(page) {
  await page.clock.setSystemTime(START);
}

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
  await backToStart(page);
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
    await expect(display).toContainText(/-00:00:1\d/);
    await expect(stage).toHaveAttribute("data-alert", "danger");
    await expect(projection.getByTestId("module-projection-alert-danger")).toBeAttached();
    await expect(projection.locator(".module-projection__text")).toContainText(/-00:00:1\d/);

    // Pausar e retomar no excedido continua do horário de hoje, não de amanhã.
    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
    await page.clock.runFor(5_000);
    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
    await page.clock.runFor(1_000);
    await expect(display).toContainText(/-00:00:[12]\d/);
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
    await expect(page.getByTestId(mod.display)).not.toContainText("-");
    await expect(page.getByTestId(mod.stage)).toHaveAttribute("data-alert", "danger");
  });

  test(`${mod.id}: não colore o aviso antes de iniciar`, async ({ page }) => {
    await openModule(page, mod);
    const time = page.locator('input[type="time"]').first();
    await time.fill("10:59");
    await time.dispatchEvent("change");

    const display = page.getByTestId(mod.display);
    await expect(display).toContainText(/00:0[01]:\d\d/);
    await expect(page.getByTestId(mod.stage)).toHaveAttribute("data-alert", "none");
    expect(await display.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
  });

  test(`${mod.id}: desligar tempo excedido no excedido pausa`, async ({ page }) => {
    await openModule(page, mod);
    const display = page.getByTestId(mod.display);
    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
    await page.clock.runFor(130_000);
    await expect(display).toContainText(/-00:00:/);

    await page.getByText("Contar tempo excedido").click();
    await expect(display).toContainText("00:00:00");
    await expect(display).not.toContainText("-");
    await expect(page.getByTestId(`ribbon-btn-${mod.id}_toggle`)).toContainText("Iniciar");
  });

  test(`${mod.id}: start com horário passado e sem excedido não mostra negativo`, async ({
    page,
  }) => {
    await openModule(page, mod);
    const time = page.locator('input[type="time"]').first();
    await time.fill("10:57");
    await time.dispatchEvent("change");
    await page.getByText("Contar tempo excedido").click();

    const display = page.getByTestId(mod.display);
    const toggle = page.getByTestId(`ribbon-btn-${mod.id}_toggle`);
    await toggle.click();
    await expect(display).not.toContainText("-");
    await page.clock.runFor(2_000);
    await expect(display).toContainText("00:00:00");
    await expect(toggle).toContainText("Iniciar");
  });

  test(`${mod.id}: fechar no X encerra só a projeção do módulo`, async ({ page, context }) => {
    await openModule(page, mod);
    const projection = await context.newPage();
    await projection.goto(`/projection/module?module=${mod.id}`);
    await page.bringToFront();
    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
    await page.clock.runFor(5_000);
    await expect(projection.locator(".module-projection__text")).toContainText(/\d/);

    await page.locator(".subtab-close").first().click();
    await expect(projection.locator(".module-projection__text")).toHaveCount(0);
    await expect(projection.locator(".module-projection__alert")).toHaveCount(0);

    await page.locator(`#ribbon-tab-${mod.tab}`).click();
    await page.locator(`[data-testid="ribbon-btn-${mod.id}"]`).click();
    await expect(projection.locator(".module-projection__text")).toContainText(/\d/);
  });

  test(`${mod.id}: cor do aviso e do alerta atualiza com o timer pausado`, async ({
    page,
    context,
  }) => {
    await openModule(page, mod);
    const display = page.getByTestId(mod.display);
    const projection = await context.newPage();
    await projection.goto(`/projection/module?module=${mod.id}`);
    await page.bringToFront();

    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
    await page.clock.runFor(70_000);
    await expect(page.getByTestId(mod.stage)).toHaveAttribute("data-alert", "warning");
    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();

    await page.evaluate(async (id) => {
      const { default: userdata } = await import("/src/helpers/UserData.ts");
      userdata.set(`modules.${id}.warning_color`, "#22C55E");
      userdata.set(`modules.${id}.alert_color`, "#8E44AD");
    }, mod.id);

    const color = (locator) => locator.evaluate((el) => getComputedStyle(el).color);
    const frame = (locator) =>
      locator.evaluate((el) => getComputedStyle(el).getPropertyValue("--frame-color").trim());

    await expect.poll(() => color(display)).toBe("rgb(34, 197, 94)");
    await expect.poll(() => frame(page.getByTestId("module-alert-frame-warning"))).toBe("#22C55E");
    await expect
      .poll(() => color(projection.locator(".module-projection__text")))
      .toBe("rgb(34, 197, 94)");
    await expect
      .poll(() => frame(projection.getByTestId("module-projection-alert-warning")))
      .toBe("#22C55E");

    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
    await page.clock.runFor(70_000);
    await expect(page.getByTestId(mod.stage)).toHaveAttribute("data-alert", "danger");
    await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();

    await expect.poll(() => color(display)).toBe("rgb(142, 68, 173)");
    await expect.poll(() => frame(page.getByTestId("module-alert-frame-danger"))).toBe("#8E44AD");
    await expect
      .poll(() => color(projection.locator(".module-projection__text")))
      .toBe("rgb(142, 68, 173)");
    await expect
      .poll(() => frame(projection.getByTestId("module-projection-alert-danger")))
      .toBe("#8E44AD");
  });
}

test("timer: sem mexer no modo, conta regressivo como a tela mostra", async ({ page }) => {
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
  await backToStart(page);
  // O modo fica na barra de baixo: sem mexer, já vem em Regressivo.
  await expect(page.getByRole("tab", { name: "Regressivo" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const time = page.locator('input[type="time"]').first();
  await time.fill("11:00");
  await time.dispatchEvent("change");
  // Antes ficava 00:00:00: o módulo estava em progressivo e a ribbon dizia regressivo.
  await expect(display).toContainText(/00:0(2:00|1:5\d)/);
  await page.getByTestId("ribbon-btn-timer_toggle").click();
  await page.clock.runFor(10_000);
  await expect(display).toContainText(/00:01:[45]\d/);
});

test("timer: horário de madrugada vira o de amanhã; horário que acabou de passar, não", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 10, 5, 23, 0, 0) });
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.locator("#ribbon-tab-utilities").click();
  await page.locator('[data-testid="ribbon-btn-timer"]').click();
  const display = page.getByTestId("timer-display");
  const time = page.locator('input[type="time"]').first();

  // O módulo acabou de montar: repete até o ouvinte da ribbon estar de pé.
  await expect(async () => {
    await time.fill("01:00");
    await time.dispatchEvent("change");
    await expect(display).toContainText(/0[12]:5?\d:\d\d/, { timeout: 500 });
  }).toPass();

  // 22:30 passou há meia hora: é o de hoje, não o de amanhã (23h30 restantes).
  await time.fill("22:30");
  await time.dispatchEvent("change");
  await expect(display).toContainText("00:00:00");
  await page.getByTestId("ribbon-btn-timer_toggle").click();
  await page.clock.runFor(2_000);
  await expect(display).toContainText(/-00:3\d:\d\d/);
});

test("timer: horário da manhã definido à tarde é o de amanhã", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 5, 14, 0, 0) });
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
  await page.clock.setSystemTime(new Date(2026, 10, 5, 14, 0, 0));

  const time = page.locator('input[type="time"]').first();
  await time.fill("05:00");
  await time.dispatchEvent("change");
  // 14:00 -> 05:00 é 15h à frente; antes a regra de 12h mostrava -09:00:00.
  await expect(display).toContainText(/1[45]:\d\d:\d\d/);
});

for (const mod of MODULES) {
  test(`${mod.id}: ribbon cabe em 1366 px com qualquer ação ao final`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
    await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
    await page.goto("/");
    await page
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 30_000 });
    await page.locator(`#ribbon-tab-${mod.tab}`).click();
    await page.locator(`[data-testid="ribbon-btn-${mod.id}"]`).click();
    await expect(page.getByTestId(mod.display)).toBeVisible();
    const action = page.locator(`[data-testid="ribbon-btn-${mod.id}_end_action"] select`);
    const overflow = () =>
      page.locator(".ribbon-body--ctx").evaluate((el) => el.scrollWidth - el.clientWidth);
    for (const value of ["none", "audio", "video", "online_video", "music"]) {
      await action.selectOption(value);
      // Antes a ribbon passava da tela e ganhava barra de rolagem.
      await expect.poll(overflow).toBeLessThanOrEqual(1);
    }
  });
}

test('timer: com o aviso em "Não", passar do horário ainda fica vermelho', async ({ page }) => {
  await openModule(page, MODULES[0]);
  await page.getByRole("tab", { name: "Não" }).click();
  await page.getByTestId("ribbon-btn-timer_toggle").click();
  await page.clock.runFor(70_000);
  const display = page.getByTestId("timer-display");
  const color = () => display.evaluate((el) => getComputedStyle(el).color);
  await expect(page.getByTestId("timer-stage")).toHaveAttribute("data-alert", "none");
  await expect.poll(color).toBe("rgb(255, 255, 255)");
  await page.clock.runFor(60_000);
  await expect(page.getByTestId("timer-stage")).toHaveAttribute("data-alert", "danger");
  await expect.poll(color).toBe("rgb(231, 76, 60)");
});
