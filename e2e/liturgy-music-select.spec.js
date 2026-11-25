import { expect, test } from "@playwright/test";
import ptMusics from "./fixtures/pt_musics.json";

test.use({ serviceWorkers: "block" });

/**
 * #86: o campo Música do item da liturgia seleciona o texto ao receber foco,
 * para trocar a música só digitando. O segundo clique, já focado, posiciona o
 * cursor normalmente (quem só quer corrigir um trecho).
 */
test("campo Música seleciona o texto ao focar e o segundo clique posiciona o cursor", async ({
  page,
}) => {
  await page.route("http://e2e.mock/**", (r) => r.fulfill({ json: [] }));
  await page.route(/(?:pt_musics|\/db\/musics\/pt)/, (r) => r.fulfill({ json: ptMusics }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await page.getByTestId("liturgy-add-item").last().click();

  const dialog = page.getByRole("dialog");
  await dialog.locator(".lif-field--type").getByRole("combobox").click();
  await page.getByRole("option", { name: "Música", exact: true }).click();
  await dialog.getByText("Escolher na hora do culto").click();

  const campo = dialog.getByPlaceholder("Digite o título ou o número do hino...");
  await campo.click();
  await campo.pressSequentially("Ale");
  await page.getByRole("option").first().click();
  const escolhida = await campo.inputValue();
  expect(escolhida).not.toBe("");

  const selecao = () =>
    campo.evaluate((el) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));

  // Clique: o texto todo fica selecionado e digitar substitui.
  await dialog.getByTestId("item-name").click();
  await campo.click();
  expect(await selecao()).toBe(escolhida);
  await page.keyboard.type("San");
  await expect(campo).toHaveValue("San");

  // Segundo clique, já focado: posiciona o cursor, sem selecionar.
  await campo.click({ position: { x: 20, y: 10 } });
  expect(await selecao()).toBe("");
});
