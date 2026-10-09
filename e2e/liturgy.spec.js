/**
 * Smoke E2E: abrir liturgia → adicionar item → item aparece na lista
 */
import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

/** Dois segundos de silêncio: áudio válido para o player abrir sem alerta de erro. */
function silentWav(seconds = 2, rate = 8000) {
  const samples = seconds * rate;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples, 40);
  return wav;
}

async function openLiturgy(page) {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(page.locator(".liturgy-page")).toBeVisible();
}

test("preenche Hora ao editar o título de um item existente sem horário", async ({ page }) => {
  await openLiturgy(page);
  await page.getByTestId("liturgy-add-item").last().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByTestId("item-name").fill("Item existente para horário");
  await dialog.getByTestId("item-save").click();
  const card = page
    .locator(".liturgy-page [data-item-id]")
    .filter({ hasText: "Item existente para horário" });
  await expect(card.locator(".tl-time")).toHaveCount(0);
  await card.locator(".lit-card-action").first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByTestId("item-name").fill("08:30 Item existente para horário");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("08:30");
  await dialog.getByTestId("item-save").click();
  await expect(card.locator(".tl-time")).toHaveText("08:30");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const days =
          JSON.parse(localStorage.getItem("user_data") || "{}")?.modules?.liturgy?.days || {};
        return Object.values(days)
          .flat()
          .find((item) => item.item === "08:30 Item existente para horário")?.time;
      })
    )
    .toBe("08:30");
  await page.reload();
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(card.locator(".tl-time")).toHaveText("08:30");
});

test("preenche Hora pelo título e preserva ajuste ou limpeza depois de salvar e recarregar", async ({
  page,
}) => {
  await openLiturgy(page);
  await page.getByTestId("liturgy-add-item").last().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByTestId("item-name").fill("08:30 Louvor do título");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("08:30");
  await dialog.getByTestId("item-name").fill("Louvor do título às 9h");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("09:00");
  await dialog.getByTestId("item-name").fill("08:30 Louvor do título / 09:00 Sermão");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("");
  await dialog.getByTestId("item-name").fill("8h30 Louvor do título");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("08:30");
  await dialog.getByTestId("item-save").click();
  const card = page.locator(".liturgy-page [data-item-id]").filter({ hasText: "Louvor do título" });
  await expect(card.locator(".tl-time")).toHaveText("08:30");
  const savedTime = () =>
    page.evaluate(() => {
      const days =
        JSON.parse(localStorage.getItem("user_data") || "{}")?.modules?.liturgy?.days || {};
      const entry = Object.values(days)
        .flat()
        .find((item) => item.item.includes("Louvor do título"));
      return entry && { time: entry.time, mode: entry.time_mode };
    });
  await expect.poll(savedTime).toEqual({ time: "08:30", mode: "manual" });
  await page.reload();
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await card.locator(".lit-card-action").first().click();
  dialog = page.getByRole("dialog");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("08:30");
  await dialog.getByTestId("item-name").fill("9h30 Louvor do título");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("08:30");
  await dialog.locator('input[type="time"]').fill("10:15");
  await dialog.getByTestId("item-name").fill("11h30 Louvor do título");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("10:15");
  await dialog.locator('input[type="time"]').fill("");
  await dialog.getByTestId("item-name").fill("12h30 Louvor do título");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("");
  await dialog.getByTestId("item-save").click();
  await expect.poll(savedTime).toEqual({ time: "", mode: "auto" });
  await page.reload();
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await card.locator(".lit-card-action").first().click();
  await expect(page.getByRole("dialog").locator('input[type="time"]')).toHaveValue("");
});

test("salva a hora manual ao criar e editar um item, inclusive depois de recarregar", async ({
  page,
}) => {
  await openLiturgy(page);
  await page.getByTestId("liturgy-add-item").last().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByTestId("item-name").fill("Item com hora manual");
  await dialog.locator('input[type="time"]').fill("19:30");
  await dialog.locator('input[type="number"]').fill("5");
  await dialog.getByTestId("item-save").click();

  const card = page
    .locator(".liturgy-page [data-item-id]")
    .filter({ hasText: "Item com hora manual" });
  await expect(card.locator(".tl-time")).toHaveText("19:30");
  await page.evaluate(async () => {
    const { default: Modules } = await import("/src/helpers/Modules.js");
    Modules.close("liturgy");
  });
  await expect(page.locator(".liturgy-panel")).toBeVisible();
  await expect(
    page.locator(".liturgy-item").filter({ hasText: "Item com hora manual" })
  ).toContainText("19:30");
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await card.locator(".lit-card-action").first().click();
  dialog = page.getByRole("dialog");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("19:30");
  await dialog.locator('input[type="time"]').fill("20:15");
  await dialog.getByTestId("item-save").click();
  await expect(card.locator(".tl-time")).toHaveText("20:15");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const days =
          JSON.parse(localStorage.getItem("user_data") || "{}")?.modules?.liturgy?.days || {};
        return Object.values(days)
          .flat()
          .find((item) => item.item === "Item com hora manual")?.time;
      })
    )
    .toBe("20:15");
  await page.reload();
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  await expect(
    page.locator(".liturgy-item").filter({ hasText: "Item com hora manual" })
  ).toContainText("20:15");
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(card.locator(".tl-time")).toHaveText("20:15");
  await card.locator(".lit-card-action").first().click();
  dialog = page.getByRole("dialog");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("20:15");
  await dialog.locator('input[type="time"]').fill("");
  await dialog.getByTestId("item-save").click();
  await expect(card.locator(".tl-time")).toHaveCount(0);
  await card.locator(".lit-card-action").first().click();
  await expect(page.getByRole("dialog").locator('input[type="time"]')).toHaveValue("");
});

test("recalcula horários automáticos depois de editar duração e mantém a hora vinculada ao bloco", async ({
  page,
}) => {
  await openLiturgy(page);
  await page.getByTestId("ribbon-btn-add_item").click();
  let dialog = page.getByRole("dialog");
  await dialog.locator(".lif-field--type").getByRole("combobox").click();
  await page.getByRole("option", { name: "Bloco", exact: true }).click();
  await dialog.getByTestId("item-name").fill("8h Bloco com horário");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("08:00");
  await dialog.getByTestId("item-save").click();

  await page.getByTestId("ribbon-btn-add_item").click();
  dialog = page.getByRole("dialog");
  await dialog.getByTestId("item-name").fill("09:30 Item do bloco");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("09:30");
  await dialog.locator('input[type="number"]').fill("5");
  await dialog.getByRole("combobox").last().click();
  await page.getByRole("option", { name: "8h Bloco com horário — 08:00", exact: true }).click();
  await expect(dialog.locator('input[type="time"]')).toBeDisabled();
  await dialog.getByTestId("item-save").click();

  await page.getByTestId("ribbon-btn-add_item").click();
  dialog = page.getByRole("dialog");
  await dialog.getByTestId("item-name").fill("Continuação automática");
  await dialog.getByTestId("item-save").click();
  const child = page.locator(".liturgy-page [data-item-id]").filter({ hasText: "Item do bloco" });
  const continuation = page
    .locator(".liturgy-page [data-item-id]")
    .filter({ hasText: "Continuação automática" });
  await expect(child.locator(".tl-time")).toHaveText("08:00");
  await expect(continuation.locator(".tl-time")).toHaveText("08:05");
  await child.locator(".lit-card-action").first().click();
  dialog = page.getByRole("dialog");
  await expect(dialog.locator('input[type="time"]')).toBeDisabled();
  await expect(dialog.locator('input[type="time"]')).toHaveValue("08:00");
  await dialog.getByTestId("item-name").fill("10h30 Item do bloco");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("08:00");
  await dialog.locator('input[type="number"]').fill("15");
  await dialog.getByTestId("item-save").click();
  await expect(continuation.locator(".tl-time")).toHaveText("08:15");
  await continuation.locator(".lit-card-action").first().click();
  dialog = page.getByRole("dialog");
  await expect(dialog.locator('input[type="time"]')).toHaveValue("");
  await dialog.getByTestId("item-save").click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const days =
          JSON.parse(localStorage.getItem("user_data") || "{}")?.modules?.liturgy?.days || {};
        return Object.values(days)
          .flat()
          .filter((item) => ["10h30 Item do bloco", "Continuação automática"].includes(item.item))
          .map((item) => ({ time: item.time, mode: item.time_mode }));
      })
    )
    .toEqual([
      { time: "", mode: "auto" },
      { time: "", mode: "auto" },
    ]);
  await page.reload();
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  await expect(
    page.locator(".liturgy-item").filter({ hasText: "Continuação automática" })
  ).toContainText("08:15");
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(continuation.locator(".tl-time")).toHaveText("08:15");
});

test("adicionar item à liturgia", async ({ page }) => {
  // Intercepta todas as requisições ao banco de dados mock para evitar alertas de erro
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));

  await page.goto("/");

  // Aguardar ribbon aparecer (indica que o Vue montou e a inicialização concluiu)
  await page.locator("#ribbon-tab-collections").waitFor({ state: "visible", timeout: 20000 });

  // Aguardar ModuleManager registrar todos os módulos (import_modules = true)
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 15000 });

  // Aguardar rede ficar idle: async components (Index.vue) são carregados do Vite
  // na primeira renderização de Modules.vue — networkidle sinaliza que todos terminaram
  await page.waitForLoadState("networkidle", { timeout: 30000 });

  // A liturgia fica no painel lateral; o botão de edição abre o módulo completo.
  await page.getByRole("button", { name: "Editar liturgia" }).click();

  // Aguardar o módulo liturgia renderizar
  await expect(page.locator(".liturgy-page")).toBeVisible({ timeout: 10000 });

  // Clicar no botão "Adicionar"
  await page.locator('[data-testid="liturgy-add-item"]').last().click();
  await expect(page.locator(".lj-dialog")).toBeVisible({ timeout: 3000 });
  await page.locator('[data-testid="item-name"]').fill("Item de Teste E2E");
  await page.locator('[data-testid="item-save"]').click();
  await expect(page.locator(".liturgy-body")).toContainText("Item de Teste E2E", { timeout: 3000 });
});

test("só marca o item ao acessar quando a opção está ligada e preserva a escolha", async ({
  page,
}) => {
  await openLiturgy(page);

  const markOnAccess = page.getByTestId("ribbon-btn-mark_done").getByRole("switch");
  await expect(markOnAccess).not.toBeChecked();

  await page.getByTestId("liturgy-add-item").last().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("item-name").fill("Anotação para marcar");
  await dialog.getByTestId("item-save").click();

  const card = page.locator("[data-item-id]").filter({ hasText: "Anotação para marcar" });
  const itemCheckbox = card.locator(".lit-card-check").getByRole("checkbox");
  const itemTitle = card.getByRole("button", { name: "Anotação para marcar" });
  await expect(card).toBeVisible();
  await expect(itemCheckbox).not.toBeChecked();

  await itemTitle.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(itemCheckbox).not.toBeChecked();
  await page.getByRole("alertdialog").getByRole("button", { name: "Fechar" }).click();

  const manualCheckbox = card.locator(".lit-card-check label");
  await manualCheckbox.click();
  await expect(itemCheckbox).toBeChecked();
  await manualCheckbox.click();
  await expect(itemCheckbox).not.toBeChecked();

  await page.getByTestId("ribbon-btn-mark_done").locator("label").click();
  await expect(markOnAccess).toBeChecked();
  await itemTitle.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(itemCheckbox).toBeChecked();
  await page.getByRole("alertdialog").getByRole("button", { name: "Fechar" }).click();

  const savedPreference = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("user_data") || "{}")?.modules?.liturgy?.mark_on_access
    );
  await expect.poll(savedPreference).toBe(true);
  await page.reload();
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Editar liturgia" }).click();

  await expect(page.getByTestId("ribbon-btn-mark_done").getByRole("switch")).toBeChecked();
  await expect(
    page
      .locator("[data-item-id]")
      .filter({ hasText: "Anotação para marcar" })
      .locator(".lit-card-check")
      .getByRole("checkbox")
  ).toBeChecked();
});

test("ao tocar uma música, marca somente com a opção ligada e não desmarca no segundo toque", async ({
  page,
}) => {
  await openLiturgy(page);
  // Sem a música (e o caminho do áudio) no banco fictício o Mídia fecha em
  // silêncio: o teste só passava contra a API real, e por isso falhava no CI.
  await page.route(/\/music_42(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        id_music: 42,
        name: "Música para marcar",
        albums: [],
        url_music: "/musics/pt/teste/musica.mp3",
        lyric: [{ id_lyric: 1, order: 1, lyric: "Letra de teste", show_slide: 1 }],
      },
    })
  );

  await page.route(/\/musics\/pt\/teste\/musica\.mp3(\?.*)?$/, (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav() })
  );

  await page.evaluate(async () => {
    const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
    Liturgy.add({
      tipo: "musica",
      item: "Música para marcar",
      id_music: 42,
      musica: 42,
      subtipo: "sung",
      escolha: false,
    });
  });

  const card = page.locator("[data-item-id]").filter({ hasText: "Música para marcar" });
  const checkbox = card.locator(".lit-card-check").getByRole("checkbox");
  const title = card.locator(".lit-card-text");
  const markOnAccess = page.getByTestId("ribbon-btn-mark_done").getByRole("switch");
  const mediaWindow = page.locator(".lj-window").filter({ has: page.locator(".media-body") });
  const closeMedia = async () => {
    await expect(mediaWindow).toBeVisible();
    await mediaWindow.locator(".lj-window-btn--close").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sim" }).click();
    await expect(mediaWindow).not.toBeVisible();
  };
  await expect(card).toBeVisible();
  await expect(markOnAccess).not.toBeChecked();

  await title.click();
  await closeMedia();
  await expect(checkbox).not.toBeChecked();

  await page.getByTestId("ribbon-btn-mark_done").locator("label").click();
  await expect(markOnAccess).toBeChecked();
  await title.click();
  await closeMedia();
  await expect(checkbox).toBeChecked();

  await title.click();
  await closeMedia();
  await expect(checkbox).toBeChecked();
});

test("não oferece vínculo de sobreposição quando não há slots", async ({ page }) => {
  await openLiturgy(page);
  await page.evaluate(async () => {
    const { clearAllSlots } = await import("/src/helpers/Overlay.ts");
    await clearAllSlots();
  });

  await page.locator('[data-testid="liturgy-add-item"]').last().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "Vincular sobreposição" })).toHaveCount(0);
  await expect(dialog).not.toContainText("Nenhuma sobreposição disponível");
});

test("permite remover um vínculo depois que o slot é excluído", async ({ page }) => {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { clearAllSlots, writeSlot } = await import("/src/helpers/Overlay.ts");
    const { createOverlaySlot } = await import("/src/types/Overlay.ts");
    await clearAllSlots();
    await writeSlot(createOverlaySlot({ id: "liturgy-link-test", name: "Letreiro de teste" }));
  });

  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await page.locator('[data-testid="liturgy-add-item"]').last().click();
  let dialog = page.getByRole("dialog");
  await dialog.locator(".lif-field--type").getByRole("combobox").click();
  await page.getByRole("option", { name: "Arquivo" }).click();
  await dialog.getByRole("textbox", { name: "Arquivo ou Pasta" }).fill("/tmp/aviso.png");
  const link = dialog.getByRole("checkbox", { name: "Vincular sobreposição" });
  await expect(link).toBeEnabled();
  await dialog.getByText("Vincular sobreposição", { exact: true }).click();
  await expect(link).toBeChecked();
  await dialog.locator('[data-testid="item-name"]').fill("Item com sobreposição");
  await dialog.locator('[data-testid="item-save"]').click();
  const card = page.locator("[data-item-id]").filter({ hasText: "Item com sobreposição" });
  await expect(card).toBeVisible();

  await page.evaluate(async () => {
    const { deleteSlot } = await import("/src/helpers/Overlay.ts");
    const { default: Broadcast } = await import("/src/helpers/Broadcast.ts");
    const { BROADCAST_TYPE } = await import("/src/helpers/BroadcastTypes.ts");
    await deleteSlot("liturgy-link-test");
    Broadcast.send(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, {});
  });
  await card.locator(".lit-card-action").first().click();
  dialog = page.getByRole("dialog");
  const orphanLink = dialog.getByRole("checkbox", { name: "Vincular sobreposição" });
  await expect(orphanLink).toBeChecked();
  await expect(orphanLink).toBeEnabled();
  await dialog.getByText("Vincular sobreposição", { exact: true }).click();
  await expect(orphanLink).toHaveCount(0);
  await dialog.locator('[data-testid="item-save"]').click();

  await card.locator(".lit-card-action").first().click();
  await expect(
    page.getByRole("dialog").getByRole("checkbox", { name: "Vincular sobreposição" })
  ).toHaveCount(0);
});

test("não oferece vínculo em um item de anúncios com slot cadastrado", async ({ page }) => {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { writeSlot } = await import("/src/helpers/Overlay.ts");
    const { createOverlaySlot } = await import("/src/types/Overlay.ts");
    await writeSlot(
      createOverlaySlot({ id: "liturgy-announcements-test", name: "Sobreposição 1" })
    );
  });

  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await page.locator('[data-testid="liturgy-add-item"]').last().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "Vincular sobreposição" })).toHaveCount(0);
  await dialog.locator(".lif-field--type").getByRole("combobox").click();
  await page.getByRole("option", { name: "Anúncios" }).click();
  await expect(dialog).toContainText("Selecione os anúncios a projetar");
  await expect(dialog.getByRole("checkbox", { name: "Vincular sobreposição" })).toHaveCount(0);
});

test("oferece vínculo apenas enquanto há anúncio selecionado para projeção", async ({ page }) => {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { default: idb } = await import("/src/helpers/IndexedDB.ts");
    const { DB_TABLE } = await import("/src/constants/DbTables.ts");
    const { writeSlot } = await import("/src/helpers/Overlay.ts");
    const { createOverlaySlot } = await import("/src/types/Overlay.ts");
    await idb.put(DB_TABLE.ANNOUNCEMENTS, {
      id: "liturgy-announcement-choice",
      nome: "Aviso com slide",
      ordem: 1,
      texto: "Conteúdo do aviso",
    });
    await writeSlot(createOverlaySlot({ id: "liturgy-announcement-slot", name: "Letreiro" }));
  });

  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await page.locator('[data-testid="liturgy-add-item"]').last().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".lif-field--type").getByRole("combobox").click();
  await page.getByRole("option", { name: "Anúncios" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Aviso com slide" })).toBeChecked();
  const link = dialog.getByRole("checkbox", { name: "Vincular sobreposição" });
  await expect(link).toHaveCount(1);
  await expect(dialog.getByText("Vincular sobreposição", { exact: true })).toBeVisible();
  await dialog.getByText("Todos", { exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "Aviso com slide" })).not.toBeChecked();
  await expect(link).toHaveCount(0);
  await dialog.getByText("Aviso com slide", { exact: true }).click();
  await expect(link).toHaveCount(1);
});

test("oculta vínculo antigo de anúncios sem apagar os dados do item", async ({ page }) => {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { writeSlot } = await import("/src/helpers/Overlay.ts");
    const { createOverlaySlot } = await import("/src/types/Overlay.ts");
    const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
    await writeSlot(createOverlaySlot({ id: "liturgy-legacy-test", name: "Sobreposição 1" }));
    Liturgy.add({
      tipo: "anuncios",
      item: "Anúncio legado",
      linked_overlay_id: "liturgy-legacy-test",
    });
  });

  await page.getByRole("button", { name: "Editar liturgia" }).click();
  const card = page.locator("[data-item-id]").filter({ hasText: "Anúncio legado" });
  await card.locator(".lit-card-action").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "Vincular sobreposição" })).toHaveCount(0);
  await dialog.locator('[data-testid="item-name"]').fill("Anúncio legado editado");
  await dialog.locator('[data-testid="item-save"]').click();
  await expect(card).not.toContainText("Sobreposição 1");

  const saved = await page.evaluate(async () => {
    const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
    return Liturgy.list().find((item) => item.item === "Anúncio legado editado");
  });
  expect(saved?.linked_overlay_id).toBe("liturgy-legacy-test");
});

test("trocar o bloco de um item na edição leva ele para o fim do bloco escolhido", async ({
  page,
}) => {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
    Liturgy.set([
      { id: "bloco-alfa", tipo: "bloco", item: "Bloco Alfa" },
      { id: "item-alfa", tipo: "anotacao", item: "Item do Alfa", blocoId: "bloco-alfa" },
      { id: "bloco-beta", tipo: "bloco", item: "Bloco Beta" },
      { id: "item-beta", tipo: "anotacao", item: "Item do Beta", blocoId: "bloco-beta" },
    ]);
  });

  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(page.locator(".liturgy-page")).toBeVisible();

  const card = page.locator(".liturgy-page [data-item-id]").filter({ hasText: "Item do Alfa" });
  await card.locator(".lit-card-action").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Bloco" }).click();
  await page.getByRole("option", { name: /Bloco Beta/ }).click();
  await dialog.getByTestId("item-save").click();

  const ordem = async () =>
    (await page.locator(".liturgy-page [data-item-id]").allInnerTexts()).map((text) => {
      const t = text.replace(/\s+/g, " ").toUpperCase();
      if (t.includes("BLOCO ALFA")) return "blocoAlfa";
      if (t.includes("BLOCO BETA")) return "blocoBeta";
      if (t.includes("ITEM DO ALFA")) return "itemAlfa";
      if (t.includes("ITEM DO BETA")) return "itemBeta";
      return t;
    });

  await expect.poll(ordem).toEqual(["blocoAlfa", "blocoBeta", "itemBeta", "itemAlfa"]);
});

test("item sem bloco que entra num bloco vai logo abaixo do cabeçalho, acima dos soltos", async ({
  page,
}) => {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
    Liturgy.set([
      { id: "bloco-1", tipo: "bloco", item: "Bloco 1" },
      { id: "solto-2", tipo: "anotacao", item: "Item sem bloco 2" },
      { id: "solto-3", tipo: "anotacao", item: "Item sem bloco 3" },
      { id: "solto-4", tipo: "anotacao", item: "Item sem bloco 4" },
      { id: "solto-5", tipo: "anotacao", item: "Item sem bloco 5" },
      { id: "solto-6", tipo: "anotacao", item: "Item sem bloco 6" },
      { id: "bloco-2", tipo: "bloco", item: "Bloco 2" },
    ]);
  });

  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(page.locator(".liturgy-page")).toBeVisible();

  const card = page.locator(".liturgy-page [data-item-id]").filter({ hasText: "Item sem bloco 4" });
  await card.locator(".lit-card-action").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Bloco" }).click();
  await page.getByRole("option", { name: /Bloco 1/ }).click();
  await dialog.getByTestId("item-save").click();

  const ordem = async () =>
    (await page.locator(".liturgy-page [data-item-id]").allInnerTexts()).map((text) => {
      const t = text.replace(/\s+/g, " ").toUpperCase();
      if (t.includes("ITEM SEM BLOCO 2")) return "solto2";
      if (t.includes("ITEM SEM BLOCO 3")) return "solto3";
      if (t.includes("ITEM SEM BLOCO 4")) return "solto4";
      if (t.includes("ITEM SEM BLOCO 5")) return "solto5";
      if (t.includes("ITEM SEM BLOCO 6")) return "solto6";
      if (t.includes("BLOCO 1")) return "bloco1";
      if (t.includes("BLOCO 2")) return "bloco2";
      return t;
    });

  await expect
    .poll(ordem)
    .toEqual(["bloco1", "solto4", "solto2", "solto3", "solto5", "solto6", "bloco2"]);
});

test("marca como concluído pelo checkbox e ao executar com a opção ligada", async ({ page }) => {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
    Liturgy.set([
      { id: "bloco-1", tipo: "bloco", item: "Bloco 1" },
      { id: "item-a", tipo: "anotacao", item: "Item dentro do bloco", blocoId: "bloco-1" },
      { id: "item-b", tipo: "anotacao", item: "Item fora do bloco" },
    ]);
  });

  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(page.locator(".liturgy-page")).toBeVisible();

  const dentro = page
    .locator(".liturgy-page [data-item-id]")
    .filter({ hasText: "Item dentro do bloco" });
  const fora = page
    .locator(".liturgy-page [data-item-id]")
    .filter({ hasText: "Item fora do bloco" });

  await dentro.locator(".lit-card-check label").click();
  await expect(dentro.locator(".lit-card-check").getByRole("checkbox")).toBeChecked();

  await page.getByTestId("ribbon-btn-mark_done").locator("label").click();
  await expect(page.getByTestId("ribbon-btn-mark_done").getByRole("switch")).toBeChecked();

  await fora.getByRole("button", { name: "Item fora do bloco" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Fechar" }).click();
  await expect(fora.locator(".lit-card-check").getByRole("checkbox")).toBeChecked();

  const marcados = () =>
    page.evaluate(async () => {
      const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
      return Liturgy.list()
        .filter((i) => i.checked)
        .map((i) => i.item);
    });
  await expect.poll(marcados).toEqual(["Item dentro do bloco", "Item fora do bloco"]);
});

test("marca o item concluído ao clicar no painel lateral com a opção ligada", async ({ page }) => {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
    Liturgy.set([
      { id: "bloco-1", tipo: "bloco", item: "Bloco 1" },
      { id: "item-painel", tipo: "anotacao", item: "Item do painel", blocoId: "bloco-1" },
    ]);
  });

  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(page.locator(".liturgy-page")).toBeVisible();
  await page.getByTestId("ribbon-btn-mark_done").locator("label").click();
  await expect(page.getByTestId("ribbon-btn-mark_done").getByRole("switch")).toBeChecked();
  await page.getByRole("button", { name: "Fechar: Liturgia", exact: true }).click();

  const sidebar = page.locator(".shell-sidebar.liturgy-panel");
  await expect(sidebar).toBeVisible();
  const item = sidebar.locator(".liturgy-item").filter({ hasText: "Item do painel" });
  await item.click();

  const alerta = page.getByRole("alertdialog");
  if (await alerta.isVisible()) {
    await alerta.getByRole("button", { name: "Fechar" }).click();
  }
  await expect(item).toHaveClass(/liturgy-item--checked/);

  const salvo = () =>
    page.evaluate(async () => {
      const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
      return Liturgy.list().find((i) => i.id === "item-painel")?.checked;
    });
  await expect.poll(salvo).toBeTruthy();
});
