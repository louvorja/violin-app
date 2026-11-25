import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

/*
 * Categoria "Litúrgicos" da Biblioteca de Mídia (vem com o programa) e o fundo
 * musical que entra depois da locução da Oração Intercessória.
 */
async function openLibrary(page) {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.locator("#ribbon-tab-worship").click();
  await page.getByTestId("ribbon-btn-media_library").click();
  await page.locator(".media-root").waitFor({ state: "visible" });
}

const NAMES = [
  "Abertura da Escola Sabatina",
  "5 minutos para a Lição",
  "1 minuto para a Lição",
  "Oração Intercessória",
  "Encerramento do Culto",
];

test("a biblioteca já vem com os Litúrgicos, e o que for apagado não volta", async ({ page }) => {
  await openLibrary(page);
  for (const name of NAMES) {
    await expect(page.locator(".media-grid-item").filter({ hasText: name })).toBeVisible();
  }
  await expect(page.locator(".media-grid-item-category").first()).toHaveText("Litúrgicos");

  // Apaga um e reabre: não é recriado.
  await page.evaluate(async () => {
    const { default: idb } = await import("/src/helpers/IndexedDB.ts");
    const { DB_TABLE } = await import("/src/constants/DbTables.ts");
    await idb.del(DB_TABLE.MEDIA_LIBRARY, "liturgical-closing");
    const mod = await import("/src/helpers/LiturgicalAudios.ts");
    mod._resetLiturgicalAudiosForTests();
    await mod.ensureLiturgicalAudios();
  });
  const closing = await page.evaluate(async () => {
    const { default: idb } = await import("/src/helpers/IndexedDB.ts");
    const { DB_TABLE } = await import("/src/constants/DbTables.ts");
    return (await idb.get(DB_TABLE.MEDIA_LIBRARY, "liturgical-closing")) ?? null;
  });
  expect(closing).toBeNull();
});

test("Oração Intercessória: o fundo escolhido entra quando a locução termina", async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(async () => {
    const { default: idb } = await import("/src/helpers/IndexedDB.ts");
    const { DB_TABLE } = await import("/src/constants/DbTables.ts");
    await idb.put(DB_TABLE.BACKGROUND_SOUND_LIBRARY, {
      id: "piano-suave",
      name: "Piano suave",
      fileName: "Piano suave",
      path: "https://e2e.mock/piano.mp3",
    });
  });

  // Só a Oração Intercessória tem o botão do fundo musical.
  const intercessory = page.locator(".media-grid-item").filter({ hasText: "Oração Intercessória" });
  await expect(page.getByTestId("intercessory-background")).toHaveCount(1);
  await intercessory.hover();
  await intercessory.getByTestId("intercessory-background").click();
  await expect(page.getByTestId("intercessory-current")).toContainText("Nenhum");
  await page.getByTestId("intercessory-pick-bg").click();
  await page.getByText("Piano suave").click();
  await expect(page.getByTestId("intercessory-current")).toContainText("Piano suave");
  await page.keyboard.press("Escape");

  // A locução "toca" e chega ao fim: o player publica áudio, tempo e duração.
  const bgName = () =>
    page.evaluate(async () => {
      const { useBackgroundSound } = await import("/src/composables/useBackgroundSound.ts");
      return useBackgroundSound().currentFile.value?.name ?? null;
    });
  await page.evaluate(async () => {
    const { afterLiturgicalAudio } = await import("/src/helpers/LiturgicalAudios.ts");
    const { default: appdata } = await import("/src/helpers/AppData.ts");
    const { KEYS } = await import("/src/constants/UserDataKeys.ts");
    afterLiturgicalAudio("liturgical-intercessory");
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "blob:locucao");
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, 12.8);
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, 6);
  });
  await page.waitForTimeout(300);
  expect(await bgName()).toBeNull();
  await page.evaluate(async () => {
    const { default: appdata } = await import("/src/helpers/AppData.ts");
    const { KEYS } = await import("/src/constants/UserDataKeys.ts");
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, 12.8);
  });
  await expect.poll(bgName).toBe("Piano suave");
});

test("trocar de áudio antes do fim cancela o fundo", async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(async () => {
    const { default: idb } = await import("/src/helpers/IndexedDB.ts");
    const { DB_TABLE } = await import("/src/constants/DbTables.ts");
    const { setIntercessoryBackground, afterLiturgicalAudio } =
      await import("/src/helpers/LiturgicalAudios.ts");
    const { default: appdata } = await import("/src/helpers/AppData.ts");
    const { KEYS } = await import("/src/constants/UserDataKeys.ts");
    await idb.put(DB_TABLE.BACKGROUND_SOUND_LIBRARY, {
      id: "piano-suave",
      name: "Piano suave",
      path: "https://e2e.mock/piano.mp3",
    });
    setIntercessoryBackground({
      source: "background_sound",
      id: "piano-suave",
      name: "Piano suave",
    });
    afterLiturgicalAudio("liturgical-intercessory");
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "blob:locucao");
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, 12.8);
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, 3);
    // O operador tocou outra coisa.
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.AUDIO, "blob:outra-musica");
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.DURATION, 200);
    appdata.set(KEYS.MODULES.MEDIA.CONFIG.CURRENT_TIME, 200);
  });
  await page.waitForTimeout(500);
  const name = await page.evaluate(async () => {
    const { useBackgroundSound } = await import("/src/composables/useBackgroundSound.ts");
    return useBackgroundSound().currentFile.value?.name ?? null;
  });
  expect(name).toBeNull();
});
