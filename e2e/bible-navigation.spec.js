import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const books = [
  { id_bible_book: 1, name: "Gênesis", abbreviation: "Gn", chapters: 50 },
  { id_bible_book: 43, name: "João", abbreviation: "Jo", chapters: 21 },
];
const versions = [
  { id_bible_version: 1, name: "Versão A", abbreviation: "A" },
  { id_bible_version: 2, name: "Versão B", abbreviation: "B" },
];
const chapter = (version, book, number) =>
  Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [String(i + 1), `${version}: ${book} ${number}:${i + 1}`])
  );

async function start(page, openModule = true) {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/db/bible-bundle*", (route) =>
    route.fulfill({ status: 503, body: "offline" })
  );
  await page.goto("/");
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(
    async ({ books, versions }) => {
      const { default: database } = await import("/src/helpers/Database.ts");
      await database.seed("pt_bible_book", books);
      await database.seed("pt_bible_version", versions);
      for (const version of versions) {
        for (const book of books) {
          for (const number of [1, 2, 12]) {
            await database.seed(
              `bible_${version.id_bible_version}_${book.id_bible_book}_${number}`,
              Object.fromEntries(
                Array.from({ length: 20 }, (_, i) => [
                  String(i + 1),
                  `${version.abbreviation}: ${book.name} ${number}:${i + 1}`,
                ])
              )
            );
          }
        }
      }
    },
    { books, versions }
  );
  if (!openModule) return;
  await page.locator("#ribbon-tab-bible").click();
  await page.locator('[data-testid="ribbon-btn-bible"]').click();
  await expect(page.locator("#listVerse_1")).toContainText(chapter("A", "Gênesis", 1)["1"]);
}

async function selected(page) {
  return page.evaluate(async () => {
    const { default: data } = await import("/src/helpers/AppData.ts");
    const { KEYS } = await import("/src/constants/UserDataKeys.ts");
    return data.get(KEYS.MODULES.BIBLE.DATA.ROOT);
  });
}

async function chooseVersion(page, label) {
  const trigger = page.locator('.bible-header [role="combobox"]');
  await trigger.click();
  await page.getByRole("option", { name: `${label} - Versão ${label}` }).click();
  await expect(page.locator("#listVerse_1")).toContainText(`${label}:`);
  /*
   * A Reka devolve o foco ao gatilho depois de escolher o item. Esperar essa
   * devolução AQUI evita que ela caia depois do próximo `focus()` do teste —
   * com o foco no gatilho, a busca rápida ignora a tecla (é o guard que impede
   * digitar para filtrar a lista de abrir a busca), e o "g" se perdia.
   */
  await expect(trigger).toBeFocused();
}

test("teclado com alvo window/document não quebra a busca da Bíblia", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  for (const target of ["window", "document"]) {
    await page.evaluate((target) => {
      (target === "window" ? window : document).dispatchEvent(
        new KeyboardEvent("keydown", { key: "g", bubbles: true, cancelable: true })
      );
    }, target);
    expect(errors.filter((message) => message.includes("closest"))).toEqual([]);
    await expect(page.locator(".quicknav-step.current")).toContainText("Capítulo");
    await page.keyboard.press("Escape");
    await expect(page.locator(".quicknav-card")).toBeHidden();
  }
  // O mesmo atalho continua respeitando o campo de seleção de versões.
  await page.locator('.bible-header [role="combobox"]').focus();
  await page.keyboard.press("g");
  await expect(page.locator(".quicknav-card")).toBeHidden();
});

test("busca rápida mantém capítulo 12 mesmo com pausa entre os dígitos", async ({ page }) => {
  await start(page);
  await page.locator("#listBook_1").focus();
  await page.keyboard.press("g");
  await expect(page.locator(".quicknav-step.current")).toContainText("Capítulo");
  await page.keyboard.press("1");
  await page.waitForTimeout(800);
  await page.keyboard.press("2");
  await expect(page.locator(".quicknav-step.current")).toContainText("Versículo");
  await expect(page.locator(".quicknav-preview")).toHaveText("Gênesis 12:");
  await page.keyboard.press("3");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => selected(page))
    .toMatchObject({ chapter: 12, verses: [3], text: "A: Gênesis 12:3" });
});

test("trocar a versão preserva o versículo e as setas continuam na nova versão", async ({
  page,
  context,
}) => {
  await start(page);
  await page.locator("#listChapter_12").click();
  await page.locator("#listVerse_3").click();
  const projection = await context.newPage();
  await projection.goto("/projection/bible");
  await expect(projection.locator(".projection-bible-text")).toHaveText("A: Gênesis 12:3");
  await chooseVersion(page, "B");
  await expect(projection.locator(".projection-bible-text")).toHaveText("B: Gênesis 12:3");
  await page.getByTestId("ribbon-btn-bible_next_verse").click();
  await expect(projection.locator(".projection-bible-text")).toHaveText("B: Gênesis 12:4");
  await page.getByTestId("ribbon-btn-bible_prev_verse").click();
  await expect(projection.locator(".projection-bible-text")).toHaveText("B: Gênesis 12:3");
  await expect
    .poll(() => selected(page))
    .toMatchObject({ id_bible_version: 2, chapter: 12, verses: [3] });
});

test("busca rápida usa a versão escolhida e continua nela ao passar versículos", async ({
  page,
  context,
}) => {
  await start(page);
  await chooseVersion(page, "B");
  await page.locator("#listBook_1").focus();
  await page.keyboard.press("g");
  await expect(page.locator(".quicknav-step.current")).toContainText("Capítulo");
  await page.keyboard.type("12");
  await expect(page.locator(".quicknav-step.current")).toContainText("Versículo");
  await page.keyboard.press("3");
  await page.keyboard.press("Enter");
  await expect(page.locator(".quicknav-card")).toBeHidden();
  const projection = await context.newPage();
  await projection.goto("/projection/bible");
  await expect(projection.locator(".projection-bible-text")).toHaveText("B: Gênesis 12:3");
  await page.getByTestId("ribbon-btn-bible_next_verse").click();
  await expect(projection.locator(".projection-bible-text")).toHaveText("B: Gênesis 12:4");
});

test("busca rápida da Shell carrega ao abrir pela primeira vez", async ({ page }) => {
  await start(page, false);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("louvorja:open-bible-search")));
  await expect(page.locator(".quicknav-hidden-input")).toBeFocused();
  await page.keyboard.press("g");
  await expect(page.locator(".quicknav-step.current")).toContainText("Capítulo");
  await page.keyboard.type("12");
  await expect(page.locator(".quicknav-preview")).toHaveText("Gênesis 12:");
  await page.keyboard.press("3");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => selected(page))
    .toMatchObject({ id_bible_version: 1, chapter: 12, verses: [3], text: "A: Gênesis 12:3" });
  await page.getByTestId("ribbon-btn-bible_next_verse").click();
  await expect
    .poll(() => selected(page))
    .toMatchObject({ chapter: 12, verses: [4], text: "A: Gênesis 12:4" });
});

test("seleção externa sincroniza a versão antes de navegar pelos versículos", async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const { default: broadcast } = await import("/src/helpers/Broadcast.ts");
    broadcast.send("bible_verse_intent", {
      book_id: 43,
      chapter: 12,
      verses: [3],
      version_id: 2,
      text: "B: João 12:3",
      reference: "João 12:3",
      active: true,
    });
  });
  await expect
    .poll(() => selected(page))
    .toMatchObject({
      id_bible_version: 2,
      id_bible_book: 43,
      chapter: 12,
      verses: [3],
      text: "B: João 12:3",
    });
  await page.getByTestId("ribbon-btn-bible_next_verse").click();
  await expect
    .poll(() => selected(page))
    .toMatchObject({ id_bible_version: 2, verses: [4], text: "B: João 12:4" });
});

test("trocar A para B e voltar para A durante a carga preserva o capítulo", async ({ page }) => {
  await start(page);
  await page.locator("#listVerse_3").click();
  await page.evaluate(async () => {
    const { default: database } = await import("/src/helpers/Database.ts");
    const get = database.get.bind(database);
    database.get = (key, ...args) =>
      key === "bible_2_1_1"
        ? new Promise((resolve) => {
            window.__finishBibleVersion = async () => resolve(await get(key, ...args));
          })
        : get(key, ...args);
  });
  await page.locator('.bible-header [role="combobox"]').click();
  await page.getByRole("option", { name: "B - Versão B" }).click();
  await expect.poll(() => page.evaluate(() => typeof window.__finishBibleVersion)).toBe("function");
  await chooseVersion(page, "A");
  await page.evaluate(() => window.__finishBibleVersion());
  await page.getByTestId("ribbon-btn-bible_next_verse").click();
  await expect
    .poll(() => selected(page))
    .toMatchObject({ id_bible_version: 1, chapter: 1, verses: [4], text: "A: Gênesis 1:4" });
});

/** Referências que a Bíblia mandou projetar, na ordem (canal das janelas de projeção). */
async function watchProjected(page) {
  await page.evaluate(() => {
    window.__projected = [];
    const ch = new BroadcastChannel("louvorja");
    ch.onmessage = (e) => {
      if (e.data?.type === "bible_verse_intent" && e.data.payload?.reference) {
        window.__projected.push(e.data.payload.reference);
      }
    };
  });
  return () => page.evaluate(() => window.__projected);
}

async function setGridLayout(page, on) {
  await page.evaluate(async (on) => {
    const { default: userData } = await import("/src/helpers/UserData.ts");
    const { KEYS } = await import("/src/constants/UserDataKeys.ts");
    userData.set(KEYS.MODULES.BIBLE.GRID_LAYOUT, on);
  }, on);
}

test("layout em grade: livro, capítulo e versículo pelos botões; desligado volta às colunas", async ({
  page,
}) => {
  await start(page);
  const projected = await watchProjected(page);
  await expect(page.getByTestId("bible-grid")).toHaveCount(0);
  await setGridLayout(page, true);
  const grid = page.getByTestId("bible-grid");
  await expect(grid).toBeVisible();
  await expect(page.locator(".bible-col--books")).toHaveCount(0);

  // Livro e capítulo pela grade; o texto do capítulo continua à direita.
  await grid.locator("#listBook_43").click();
  await grid.locator("#listChapter_2").click();
  await expect(page.locator("#listVerse_1")).toContainText("A: João 2:1");

  // Versículo pelo número projeta (padrão), e Shift monta intervalo como na lista.
  await page.getByTestId("bible-verse-num-4").click();
  await page.getByTestId("bible-verse-num-6").click({ modifiers: ["Shift"] });
  await expect.poll(async () => (await projected()).at(-1)).toBe("João 2:4-6 (A)");
  await expect(page.locator(".bible-verse--active")).toHaveCount(3);

  // Histórico vira painel por cima e começa fechado.
  await expect(page.locator(".bible-col--history")).toHaveCount(0);
  await page.getByText("Exibir Histórico").click();
  await expect(page.locator(".bible-col--history")).toBeVisible();

  await setGridLayout(page, false);
  await expect(page.getByTestId("bible-grid")).toHaveCount(0);
  await expect(page.locator(".bible-col--books")).toBeVisible();
});
