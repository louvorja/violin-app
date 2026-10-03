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
