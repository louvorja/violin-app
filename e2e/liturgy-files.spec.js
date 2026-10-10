import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6T8AAAAASUVORK5CYII=",
  "base64"
);

async function choose(page, name) {
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Escolher arquivo", exact: true })
    .click();
  await (await chooser).setFiles({ name, mimeType: "image/png", buffer: image });
}
async function savedFile(page) {
  return page.evaluate(() => {
    const days =
      JSON.parse(localStorage.getItem("user_data") || "{}")?.modules?.liturgy?.days || {};
    return Object.values(days)
      .flat()
      .find((item) => item.item === "Arquivo local da liturgia");
  });
}
async function storedFiles(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("louvorja-violin");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("liturgy.files").objectStore("liturgy.files").getAll();
        request.onsuccess = () =>
          resolve(
            request.result.map((record) => ({
              id: record.id,
              name: record.name,
              bytes: record.data.byteLength,
            }))
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

test("arquivo escolhido na liturgia persiste após reload e projeta offline", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await page.getByTestId("liturgy-add-item").last().click();
  let dialog = page.getByRole("dialog");
  await dialog.locator(".lif-field--type").getByRole("combobox").click();
  await page.getByRole("option", { name: "Arquivo", exact: true }).click();
  await dialog.getByTestId("item-name").fill("Arquivo local da liturgia");
  await choose(page, "cancelado.png");
  expect(await storedFiles(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(await storedFiles(page)).toEqual([]);

  await page.getByTestId("liturgy-add-item").last().click();
  dialog = page.getByRole("dialog");
  await dialog.locator(".lif-field--type").getByRole("combobox").click();
  await page.getByRole("option", { name: "Arquivo", exact: true }).click();
  await dialog.getByTestId("item-name").fill("Arquivo local da liturgia");
  await choose(page, "substituido.png");
  await choose(page, "aviso.png");
  await dialog.getByTestId("item-save").click();
  await expect(dialog).not.toBeVisible();
  const file = await savedFile(page);
  expect(file).toMatchObject({ dir: "aviso.png", ref_id: expect.any(String) });
  expect(JSON.stringify(file)).not.toContain("blob:");
  expect(await storedFiles(page)).toEqual([
    { id: file.ref_id, name: "aviso.png", bytes: image.length },
  ]);

  const card = page
    .locator(".liturgy-page [data-item-id]")
    .filter({ hasText: "Arquivo local da liturgia" });
  // O navegador de teste não tem monitor de projeção configurado; abra a
  // rota real antes do clique, como um telão já conectado ao operador.
  const projection = await context.newPage();
  await projection.goto("/projection/file");
  await card.locator(".lit-card-text").click();
  await expect(projection.locator("img.file-projection__media")).toBeVisible();
  await expect
    .poll(() =>
      projection.locator("img.file-projection__media").evaluate((img) => img.naturalWidth)
    )
    .toBe(1);
  const oldPlayback = await page.evaluate(
    () => JSON.parse(localStorage.getItem("lj_file_projection")).playback_id
  );
  const oldImageSrc = await projection.locator("img.file-projection__media").getAttribute("src");
  await page.reload();
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await card.locator(".lit-card-action").first().click();
  await expect(
    page.getByRole("dialog").getByPlaceholder("C:\\caminho\\para\\arquivo.ext")
  ).toHaveValue("aviso.png");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click();
  expect((await savedFile(page)).ref_id).toBe(file.ref_id);
  await context.setOffline(true);
  await card.locator(".lit-card-text").click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("lj_file_projection")).playback_id)
    )
    .not.toBe(oldPlayback);
  // A transição mantém a imagem anterior e a nova durante o fade.
  await expect(projection.locator("img.file-projection__media").last()).not.toHaveAttribute(
    "src",
    oldImageSrc
  );
  await expect(projection.locator("img.file-projection__media")).toHaveCount(1);
  await expect
    .poll(() =>
      projection.locator("img.file-projection__media").evaluate((img) => img.naturalWidth)
    )
    .toBe(1);
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
});
