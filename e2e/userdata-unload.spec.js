import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("preserva a última edição da liturgia ao recarregar antes do debounce", async ({ page }) => {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  const reloaded = page.waitForEvent("load");
  await page.evaluate(async () => {
    const { default: userData } = await import("/src/helpers/UserData.ts");
    const { KEYS } = await import("/src/constants/UserDataKeys.ts");
    userData.set(KEYS.MODULES.LITURGY.DAY_NOTES, { 1: "Última anotação do culto" });
    // A navegação começa no mesmo task; não dá aos 300 ms de debounce uma
    // oportunidade artificial de salvar antes de sair.
    window.location.reload();
  });
  await reloaded;
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("user_data")).modules.liturgy.day_notes
    )
  ).toEqual({ 1: "Última anotação do culto" });
});
