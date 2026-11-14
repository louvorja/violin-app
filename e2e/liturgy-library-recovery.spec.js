import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function openLiturgy(page, orphan = false) {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  const id = await page.evaluate(async (orphan) => {
    const { default: liturgy } = await import("/src/helpers/Liturgy.ts");
    const { useLiturgyLibrary } =
      await import("/src/modules/liturgy/composables/useLiturgyLibrary.ts");
    const library = useLiturgyLibrary();
    const items = library.parseImport(
      JSON.stringify({
        name: "Culto salvo",
        items: [{ tipo: "anotacao", item: "Aviso preservado" }],
      })
    ).items;
    const saved = orphan
      ? { id: "registro-excluido" }
      : await library.save({ name: "Culto salvo", items });
    const day = new Date().getDay();
    liturgy.set(items, day);
    liturgy.setDayLiturgyId(day, saved.id);
    liturgy.setDayLiturgyId((day + 2) % 7, saved.id);
    return saved.id;
  }, orphan);
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(page.locator(".liturgy-page")).toBeVisible();
  return id;
}

async function saveAsNew(page, oldId) {
  await page.getByRole("button", { name: /Salvar Liturgia$/ }).click();
  const dialog = page.getByRole("dialog", { name: "Salvar Liturgia" });
  await expect(dialog).toBeVisible();
  await dialog.locator("input").fill("Culto recuperado");
  await dialog.getByRole("button", { name: /Salvar$/ }).click();
  await expect(dialog).not.toBeVisible();
  const stored = await page.evaluate(async () => {
    const { default: liturgy } = await import("/src/helpers/Liturgy.ts");
    const { useLiturgyLibrary } =
      await import("/src/modules/liturgy/composables/useLiturgyLibrary.ts");
    const item = await useLiturgyLibrary().get(liturgy.getCurrentLiturgyId());
    return { item, dayId: liturgy.getDayLiturgyId(new Date().getDay()) };
  });
  expect(stored.item.id).not.toBe(oldId);
  expect(stored.dayId).toBe(stored.item.id);
  expect(stored.item.items).toEqual([expect.objectContaining({ item: "Aviso preservado" })]);
}

test("excluir da biblioteca e trocar de dia permite salvar novamente sem perder a agenda", async ({
  page,
}) => {
  const oldId = await openLiturgy(page);
  await page.getByRole("button", { name: /Carregar Liturgia$/ }).click();
  const dialog = page.getByRole("dialog", { name: "Carregar Liturgia" });
  await dialog
    .locator(".llo-item")
    .filter({ hasText: "Culto salvo" })
    .getByRole("button", { name: "Excluir", exact: true })
    .click();
  await page.getByRole("button", { name: "Sim", exact: true }).click();
  await expect(dialog.locator(".llo-item")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  const active = await page.locator(".lit-daytab.is-active").getAttribute("title");
  await page.locator(".lit-daytab:not(.is-active)").first().click();
  await page.locator(".lit-daytabs").getByTitle(active, { exact: true }).click();
  await expect(page.locator(".liturgy-page [data-item-id]")).toContainText("Aviso preservado");
  await saveAsNew(page, oldId);
});

test("Salvar recupera um vínculo antigo cujo registro já não existe", async ({ page }) => {
  const oldId = await openLiturgy(page, true);
  await saveAsNew(page, oldId);
});
