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

/** Registros de uma tabela do IndexedDB do app, sem os bytes. */
async function rows(page, table) {
  return page.evaluate(async (table) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("louvorja-violin");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains(table)) return [];
      return await new Promise((resolve, reject) => {
        const request = db.transaction(table).objectStore(table).getAll();
        request.onsuccess = () =>
          resolve(
            request.result.map((r) => ({
              id: r.id,
              name: r.name,
              type: r.type,
              categoryId: r.categoryId,
              bytes: r.data ? r.data.byteLength : 0,
            }))
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, table);
}

/** Exportar: abre a janela de opções e confirma com o que vem marcado. */
async function exportNow(page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Exportar Liturgia$/ }).click();
  const dialog = page.getByTestId("liturgy-export-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("liturgy-export-confirm").click();
  return download;
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
  const pageErrors = [];
  const a = await browser.newContext();
  const pageA = await a.newPage();
  pageA.on("pageerror", (e) => pageErrors.push(e.message));
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

  // Um item da Biblioteca de Mídia também: vai junto (opção marcada por padrão).
  await pageA.evaluate(
    async (bytes) => {
      const { default: idb } = await import("/src/helpers/IndexedDB.ts");
      const { default: liturgy } = await import("/src/helpers/Liturgy.ts");
      await idb.put("media_library", {
        id: "file_origem",
        name: "logo da igreja.png",
        path: "blob:sessao-antiga",
        type: "image",
        addedAt: 1,
        data: new Uint8Array(bytes).buffer,
        mime: "image/png",
      });
      liturgy.add(
        { tipo: "biblioteca-midia", item: "Logo", ref_id: "file_origem", subtipo: "image" },
        liturgy.getActiveDay()
      );
    },
    [...image]
  );

  const file = await exportNow(pageA);
  // Com locale "C" (sem UTF-8) o Chromium do Linux troca nome não-ASCII por "download".
  if (UTF8_LOCALE) expect(file.suggestedFilename()).toBe("Culto de Sábado — Missão.llja");
  const path = test.info().outputPath("culto.llja");
  await file.saveAs(path);
  expect(fs.readFileSync(path).subarray(0, 2).toString()).toBe("PK");
  await a.close();

  // Computador B: nada salvo, importa o arquivo.
  const b = await browser.newContext();
  const pageB = await b.newPage();
  pageB.on("pageerror", (e) => pageErrors.push(e.message));
  await openLiturgy(pageB);
  expect(await rows(pageB, "media_library")).toEqual([]);

  await importFile(pageB, path);
  const ask = pageB.getByRole("alertdialog").or(pageB.getByRole("dialog")).last();
  await expect(ask).toContainText('Abrir "Culto de Sábado — Missão" agora');
  await ask.getByRole("button", { name: "Sim", exact: true }).click();

  const list = pageB.locator(".liturgy-page");
  await expect(list).toContainText("Foto de abertura");
  await expect(list).toContainText("Aviso de última hora");
  await expect(list).toContainText("Logo");
  // Os arquivos vieram no pacote e entraram na Biblioteca de Mídia, em "Importados";
  // a foto do item de arquivo virou item da biblioteca.
  const media = await rows(pageB, "media_library");
  expect(media.map((m) => [m.name, m.type, m.categoryId, m.bytes]).sort()).toEqual([
    ["foto do culto.png", "image", "importados", image.length],
    ["logo da igreja.png", "image", "importados", image.length],
  ]);
  expect(await rows(pageB, "liturgy.files")).toEqual([]);
  expect((await rows(pageB, "media_library.category")).map((c) => c.name)).toEqual(["Importados"]);

  const refs = await pageB.evaluate(async () => {
    const { default: liturgy } = await import("/src/helpers/Liturgy.ts");
    return liturgy
      .list(liturgy.getActiveDay())
      .filter((i) => i.ref_id)
      .map((i) => ({ item: i.item, tipo: i.tipo, ref_id: i.ref_id }));
  });
  const idOf = (name) => media.find((m) => m.name === name).id;
  expect(refs).toEqual([
    { item: "Foto de abertura", tipo: "biblioteca-midia", ref_id: idOf("foto do culto.png") },
    { item: "Logo", tipo: "biblioteca-midia", ref_id: idOf("logo da igreja.png") },
  ]);

  // Importar de novo, agora pelo caminho do duplo clique / arrastar (fila da
  // Liturgia): o nome já existe — três saídas; "como cópia" cria outra.
  await pageB.evaluate(
    async (bytes) => {
      const { requestLiturgyImport } = await import("/src/modules/liturgy/openRequests.ts");
      requestLiturgyImport(new File([new Uint8Array(bytes)], "culto.llja"));
    },
    [...fs.readFileSync(path)]
  );
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
  // Importar de novo não duplicou nada na biblioteca. E os dois aparecem com imagem (a URL é recriada a partir dos bytes).
  expect(await rows(pageB, "media_library")).toHaveLength(2);
  await pageB.locator("#ribbon-tab-worship").click();
  await pageB.getByTestId("ribbon-btn-media_library").click();
  const grid = pageB.locator(".media-root");
  await expect(grid).toBeVisible({ timeout: 15_000 });
  await expect(grid).toContainText("foto do culto.png");
  await expect(grid).toContainText("Importados");
  await expect
    .poll(() =>
      grid
        .locator("img.media-grid-item-thumb")
        .evaluateAll((imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length)
    )
    .toBe(2);

  // Nenhum erro na página (um laço de reatividade já passou despercebido aqui).
  expect(pageErrors).toEqual([]);
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
  const download = exportNow(page);
  const day = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][
    new Date().getDay()
  ];
  const name = (await download).suggestedFilename();
  if (UTF8_LOCALE || /^[\x20-\x7e]+$/.test(day)) expect(name).toBe(`${day}.llja`);
});
