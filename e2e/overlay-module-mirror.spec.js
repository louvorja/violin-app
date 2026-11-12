/**
 * Espelho de módulo numa sobreposição (#58): mostra a hora e o Temporizador de Culto
 * sem que o operador tenha aberto esses módulos, e a hora continua andando.
 * Run with: npx playwright test e2e/overlay-module-mirror.spec.js
 */
import { test, expect } from "@playwright/test";

test("espelho de módulo mostra os dados sem abrir o módulo de origem (#58)", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ serviceWorkers: "block" });
  const operator = await context.newPage();
  try {
    await operator.goto("/");
    await operator
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 30_000 });
    await operator.locator("#ribbon-tab-worship").click();
    await operator.locator('[data-testid="ribbon-btn-overlay"]').click();

    for (const source of ["Relógio", "Temporizador de Culto"]) {
      await operator
        .locator(".overlay-header-controls")
        .getByRole("button", { name: "Adicionar sobreposição" })
        .click();
      await operator.getByRole("combobox", { name: "Tipo" }).click();
      await operator.getByRole("option", { name: "Espelho de módulo" }).click();
      await operator.getByRole("combobox", { name: "Módulo de origem" }).click();
      await operator.getByRole("option", { name: source, exact: true }).click();
    }
    // Ligar logo depois de escolher apagava a escolha, ainda não gravada.
    await operator.locator('[data-testid="ribbon-btn-overlay_toggle"]').click();
    await expect(operator.getByRole("combobox", { name: "Módulo de origem" })).toHaveText(
      /Temporizador de Culto/
    );

    const projection = await context.newPage();
    await projection.goto("/projection");
    const mirrors = projection.locator(".overlay-slot__text");
    await expect(mirrors).toHaveCount(2);
    await expect(mirrors.nth(0)).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    await expect(mirrors.nth(1)).toHaveText(/^00:00:00\s*\d{2}:\d{2}$/);

    const shown = await mirrors.nth(0).textContent();
    await expect.poll(() => mirrors.nth(0).textContent(), { timeout: 3_000 }).not.toBe(shown);

    // A prévia do módulo Sobreposições mostra o mesmo, não o nome do módulo.
    const preview = operator.locator(".overlay-preview-text");
    await expect(preview.nth(0)).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    await expect(preview.nth(1)).toHaveText(/^00:00:00\s*\d{2}:\d{2}$/);
  } finally {
    await context.close();
  }
});
