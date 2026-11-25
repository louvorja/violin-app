import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

/*
 * Item "Utilitário" da liturgia: abre o módulo já configurado e, com
 * "Iniciar automaticamente ao clicar", já começa a contar.
 */
const START = new Date(2026, 10, 28, 9, 0, 0);

async function openLiturgy(page) {
  await page.clock.install({ time: START });
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.clock.setSystemTime(START);
  // Sem áudio no teste: os avisos do Temporizador de Culto ficam desligados.
  await page.evaluate(async () => {
    const { default: userdata } = await import("/src/helpers/UserData.ts");
    for (const key of ["sound_start", "sound_five_min", "sound_one_min"])
      userdata.set(`modules.timer_worship.${key}`, false);
  });
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(page.locator(".liturgy-page")).toBeVisible();
}

async function chooseOption(dialog, page, label, option) {
  await dialog.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function addUtility(page, setup) {
  await page.getByTestId("liturgy-add-item").last().click();
  const dialog = page.getByRole("dialog");
  await chooseOption(dialog, page, "Tipo", "Utilitário");
  await setup(dialog);
  await dialog.getByTestId("item-save").click();
  await expect(dialog).not.toBeVisible();
}

test("Temporizador de Culto até 9:45, iniciando sozinho ao clicar", async ({ page }) => {
  await openLiturgy(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Temporizador de Culto");
    // O nome do item acompanha o módulo escolhido.
    await expect(dialog.getByTestId("item-name")).toHaveValue("Temporizador de Culto");
    await dialog.getByTestId("utility-target").fill("09:45");
    await dialog.getByTestId("utility-autostart").click();
  });

  const card = page.locator("[data-item-id]").filter({ hasText: "Temporizador de Culto" });
  await expect(card).toContainText("até 09:45 · inicia sozinho");
  await card.getByRole("button", { name: "Temporizador de Culto" }).click();

  const display = page.getByTestId("timer-worship-display");
  await expect(display).toBeVisible();
  await expect(page.getByTestId("ribbon-btn-timer_worship_toggle")).toContainText("Pausar");
  await page.clock.runFor(3_000);
  await expect(display).toContainText(/00:44:5\d/);
  await expect(page.getByTestId("timer-worship-extra")).toHaveText("09:45");
});

test("por duração e sem iniciar sozinho: abre pronto, esperando o Iniciar", async ({ page }) => {
  await openLiturgy(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Temporizador de Culto");
    await dialog.getByTestId("item-name").fill("Sermão");
    await chooseOption(dialog, page, "Definir por", "Duração");
    await expect(dialog.getByTestId("utility-target")).toHaveCount(0);
    await dialog.getByTestId("utility-minutes").fill("25");
  });

  const card = page.locator("[data-item-id]").filter({ hasText: "Sermão" });
  await expect(card).toContainText("25 min");
  await expect(card).not.toContainText("inicia sozinho");
  await card.getByRole("button", { name: "Sermão" }).click();

  const display = page.getByTestId("timer-worship-display");
  await expect(display).toContainText("00:25:00");
  await expect(page.getByTestId("ribbon-btn-timer_worship_toggle")).toContainText("Iniciar");
  await page.clock.runFor(3_000);
  await expect(display).toContainText("00:25:00");
});

test("Cronômetro regressivo de 5 min, iniciando sozinho", async ({ page }) => {
  await openLiturgy(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Cronômetro");
    await dialog.getByTestId("utility-minutes").fill("5");
    await dialog.getByTestId("utility-autostart").click();
  });
  await page
    .locator("[data-item-id]")
    .filter({ hasText: "Cronômetro" })
    .getByRole("button", { name: "Cronômetro" })
    .click();
  await page.clock.runFor(3_000);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const state = await import("/src/modules/stopwatch/state.ts");
        return {
          running: state.running.value,
          mode: state.mode.value,
          target: state.targetSeconds.value,
        };
      })
    )
    .toEqual({ running: true, mode: "down", target: 300 });
});

test("Relógio só abre, sem opção de iniciar", async ({ page }) => {
  await openLiturgy(page);
  await page.getByTestId("liturgy-add-item").last().click();
  const dialog = page.getByRole("dialog");
  await chooseOption(dialog, page, "Tipo", "Utilitário");
  await chooseOption(dialog, page, "Utilitário", "Relógio");
  await expect(dialog.getByTestId("utility-autostart")).toHaveCount(0);
  await expect(dialog.getByTestId("utility-mode")).toHaveCount(0);
  await dialog.getByTestId("item-save").click();
  await page
    .locator("[data-item-id]")
    .filter({ hasText: "Relógio" })
    .getByRole("button", { name: "Relógio" })
    .click();
  await expect(page.locator(".subtab").filter({ hasText: "Relógio" })).toBeVisible();
});
