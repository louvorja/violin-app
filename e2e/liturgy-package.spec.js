import fs from "node:fs";
import process from "node:process";
import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const UTF8_LOCALE = /utf-?8/i.test(process.env.LC_ALL || process.env.LANG || "");

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6T8AAAAASUVORK5CYII=",
  "base64"
);

async function openLiturgy(page) {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(page.locator(".liturgy-page")).toBeVisible();
}

async function addFileItem(page, name) {
  await page.getByTestId("liturgy-add-item").last().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".lif-field--type").getByRole("combobox").click();
  await page.getByRole("option", { name: "Arquivo", exact: true }).click();
  await dialog.getByTestId("item-name").fill(name);
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Escolher arquivo", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "foto do culto.png", mimeType: "image/png", buffer: image });
  await dialog.getByTestId("item-save").click();
  await expect(dialog).not.toBeVisible();
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
          resolve(request.result.map((r) => ({ name: r.name, bytes: r.data.byteLength })));
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

async function importFile(page, path) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Importar Liturgia$/ }).click();
  await (await chooser).setFiles(path);
}

test("exportar o que está na tela num computador e importar com o arquivo no outro", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  // Computador A: monta a liturgia, salva, muda depois de salvar e exporta.
  const a = await browser.newContext();
  const pageA = await a.newPage();
  await openLiturgy(pageA);
  await addFileItem(pageA, "Foto de abertura");
  await pageA.getByRole("button", { name: /Salvar Liturgia$/ }).click();
  const save = pageA.getByRole("dialog", { name: "Salvar Liturgia" });
  await save.locator("input").fill("Culto de Sábado — Missão");
  await save.getByRole("button", { name: /Salvar$/ }).click();
  await expect(save).not.toBeVisible();
  // Mudança DEPOIS de salvar: tem que ir no arquivo também.
  await pageA.evaluate(async () => {
    const { default: liturgy } = await import("/src/helpers/Liturgy.ts");
    liturgy.add({ tipo: "anotacao", item: "Aviso de última hora" }, liturgy.getActiveDay());
  });

  const download = pageA.waitForEvent("download");
  await pageA.getByRole("button", { name: /Exportar Liturgia$/ }).click();
  const file = await download;
  // Com locale "C" (sem UTF-8) o Chromium do Linux troca nome não-ASCII por "download".
  if (UTF8_LOCALE) expect(file.suggestedFilename()).toBe("Culto de Sábado — Missão.llja");
  const path = test.info().outputPath("culto.llja");
  await file.saveAs(path);
  expect(fs.readFileSync(path).subarray(0, 2).toString()).toBe("PK");
  await a.close();

  // Computador B: nada salvo, importa o arquivo.
  const b = await browser.newContext();
  const pageB = await b.newPage();
  await openLiturgy(pageB);
  expect(await storedFiles(pageB)).toEqual([]);

  await importFile(pageB, path);
  const ask = pageB.getByRole("alertdialog").or(pageB.getByRole("dialog")).last();
  await expect(ask).toContainText('Abrir "Culto de Sábado — Missão" agora');
  await ask.getByRole("button", { name: "Sim", exact: true }).click();

  const list = pageB.locator(".liturgy-page");
  await expect(list).toContainText("Foto de abertura");
  await expect(list).toContainText("Aviso de última hora");
  // O arquivo veio dentro do pacote e foi guardado neste aparelho.
  expect(await storedFiles(pageB)).toEqual([{ name: "foto do culto.png", bytes: image.length }]);

  const ref = await pageB.evaluate(async () => {
    const { default: liturgy } = await import("/src/helpers/Liturgy.ts");
    const { resolveLiturgyFile } = await import("/src/helpers/LiturgyFiles.ts");
    const item = liturgy.list(liturgy.getActiveDay()).find((i) => i.item === "Foto de abertura");
    const resolved = item?.ref_id ? await resolveLiturgyFile(item.ref_id) : null;
    return resolved && { name: resolved.name, kind: resolved.kind };
  });
  expect(ref).toEqual({ name: "foto do culto.png", kind: "image" });

  // Importar de novo: o nome já existe — três saídas; "como cópia" cria outra.
  await importFile(pageB, path);
  const conflict = pageB.getByRole("alertdialog").or(pageB.getByRole("dialog")).last();
  await expect(conflict).toContainText("Já existe uma liturgia chamada");
  await expect(conflict.getByRole("button", { name: "Substituir" })).toBeVisible();
  await conflict.getByRole("button", { name: "Importar como cópia" }).click();
  const open = pageB.getByRole("alertdialog").or(pageB.getByRole("dialog")).last();
  await expect(open).toContainText("Culto de Sábado — Missão (2)");
  await open.getByRole("button", { name: "Não", exact: true }).click();

  const names = await pageB.evaluate(async () => {
    const { useLiturgyLibrary } =
      await import("/src/modules/liturgy/composables/useLiturgyLibrary.ts");
    return (await useLiturgyLibrary().list()).map((l) => l.name);
  });
  expect(names).toEqual(["Culto de Sábado — Missão", "Culto de Sábado — Missão (2)"]);
  await b.close();
});

test("exportar sem ter salvo usa o nome do dia, e liturgia vazia avisa", async ({ page }) => {
  await openLiturgy(page);
  await page.getByRole("button", { name: /Exportar Liturgia$/ }).click();
  await expect(page.getByText("A liturgia deste dia está vazia.")).toBeVisible();

  await page.evaluate(async () => {
    const { default: liturgy } = await import("/src/helpers/Liturgy.ts");
    liturgy.add({ tipo: "anotacao", item: "Boas-vindas" }, liturgy.getActiveDay());
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exportar Liturgia$/ }).click();
  const day = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][
    new Date().getDay()
  ];
  const name = (await download).suggestedFilename();
  if (UTF8_LOCALE || /^[\x20-\x7e]+$/.test(day)) expect(name).toBe(`${day}.llja`);
});
