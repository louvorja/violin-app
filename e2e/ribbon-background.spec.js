import { test, expect } from "@playwright/test";

/**
 * A ribbon dá ~84px ao grupo (`.ribbon-group-content` tem `max-height` e
 * `overflow: hidden`).
 *
 * O bug: o componente de fundo personalizado usava DOIS `.rfps-container` de
 * `height: 100%` — o primeiro, só com o checkbox, ocupava a altura inteira da
 * caixa e o segundo (cor, ajuste e imagem) nascia fora dela e era cortado. O
 * checkbox respondia e nada aparecia.
 *
 * Isso é um problema de LAYOUT, então não dá para cobrir com jsdom (que devolve
 * caixa 0×0): aqui se mede a posição real dos controles contra a caixa que os
 * recorta.
 */
test("fundo personalizado: cor, ajuste e imagem cabem na altura da ribbon", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    /* O botão do módulo só existe na aba "Culto" — mesma sequência do
       mobile-web.spec.js, que é quem já navega por aqui. */
    await page.locator("#ribbon-tab-worship").click({ timeout: 60_000 });
    await page.getByTestId("ribbon-btn-media_library").click({ timeout: 60_000 });
    await page.locator(".media-root").waitFor({ state: "visible", timeout: 60_000 });

    const grupo = page
      .locator(".ribbon-group")
      .filter({ has: page.locator("#rfps-custom-background") });
    await grupo.waitFor({ state: "visible", timeout: 30_000 });

    /* Um container só: as opções têm que nascer na MESMA caixa do checkbox. */
    await expect(grupo.locator(".rfps-container")).toHaveCount(1);

    const caixa = await grupo.locator(".ribbon-group-content").boundingBox();
    expect(caixa, ".ribbon-group-content sem caixa medida").not.toBeNull();

    await grupo.locator("#rfps-custom-background").check();
    await expect(grupo.locator('input[type="color"]')).toHaveCount(1);
    await expect(grupo.locator("select")).toHaveCount(1);
    await expect(grupo.locator(".opt-bg-pick")).toHaveCount(1);

    for (const alvo of ['input[type="color"]', "select", ".opt-bg-pick"]) {
      const box = await grupo.locator(alvo).first().boundingBox();
      expect(box, `${alvo} não renderizou`).not.toBeNull();
      expect(
        box.y + box.height,
        `${alvo} nasceu FORA da caixa da ribbon (cortado por overflow: hidden)`
      ).toBeLessThanOrEqual(caixa.y + caixa.height + 1);
      expect(box.y, `${alvo} nasceu acima da caixa`).toBeGreaterThanOrEqual(caixa.y - 1);
    }

    /* E o que era a linha de baixo virou coluna ao lado — nada some quando ligado. */
    await expect(grupo.locator("#rfps-custom-background")).toBeChecked();
  } finally {
    await context.close();
  }
});
