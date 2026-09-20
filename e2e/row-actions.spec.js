/**
 * Ícones de ação da linha de música: montados só quando a linha é explorada
 * (custo de abrir a lista), mas sem esconder o recurso de quem não tem mouse.
 *
 * - mouse: em qualquer ponto da linha, e a tabela não desloca (o espaço é reservado);
 * - toque + mouse (híbrido): tocar a linha revela e mantém até tocar fora;
 * - tela só de toque (sem hover): sempre montados, e o toque no ícone funciona.
 */
import { test, expect } from "@playwright/test";
import ptMusics from "./fixtures/pt_musics.json";
import music1 from "./fixtures/music_1.json";

async function abrirMusicas(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  // O Vite responde index.html para JSONs ausentes; sem este fallback o
  // Database tenta interpretar HTML e abre um alerta modal no boot.
  // As rotas específicas abaixo têm prioridade (LIFO).
  await context.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/pt_musics*", (route) => route.fulfill({ json: ptMusics }));
  await context.route("**/music_1*", (route) => route.fulfill({ json: music1 }));

  const page = await context.newPage();
  await page.goto("/");
  await page.locator("#ribbon-tab-collections").waitFor({ state: "visible", timeout: 20_000 });
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-musics"]').click();

  const linha = page.locator('[data-testid="music-row-1"]');
  await expect(linha).toBeVisible({ timeout: 10_000 });
  return { context, page, linha };
}

const celulas = (linha) =>
  linha.evaluate((el) =>
    [...el.querySelectorAll("td")].map((td) => {
      const { x, width } = td.getBoundingClientRect();
      return { x, largura: width };
    })
  );

const botoes = (linha) => linha.locator("button");

test("mouse em qualquer ponto da linha revela os ícones, sem deslocar a tabela", async ({
  browser,
}) => {
  const { context, page, linha } = await abrirMusicas(browser);
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(true);

  await expect(botoes(linha)).toHaveCount(1);
  const antes = await celulas(linha);

  await linha.locator("td").first().hover();
  await expect(botoes(linha)).toHaveCount(8);
  const depois = await celulas(linha);
  depois.forEach((celula, i) => {
    expect(Math.abs(celula.x - antes[i].x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(celula.largura - antes[i].largura)).toBeLessThanOrEqual(0.5);
  });

  await page.mouse.move(2, 2);
  await expect(botoes(linha)).toHaveCount(1);

  await context.close();
});

test("foco de teclado dentro da linha revela os ícones", async ({ browser }) => {
  const { context, page, linha } = await abrirMusicas(browser);

  await linha.locator("td").first().click();
  await page.mouse.move(2, 2);
  await expect(botoes(linha)).toHaveCount(1);

  await page.keyboard.press("Tab");
  await expect(botoes(linha)).toHaveCount(8);

  await context.close();
});

test("abrir e fechar o menu ⋮ com o mouse não deixa os ícones presos", async ({ browser }) => {
  const { context, page, linha } = await abrirMusicas(browser);

  await linha.locator("td").first().hover();
  await expect(botoes(linha)).toHaveCount(8);

  await botoes(linha).last().click();
  await expect(page.getByRole("menu")).toBeVisible();

  const cabecalho = await page.locator("thead th").first().boundingBox();
  await page.mouse.click(cabecalho.x + 5, cabecalho.y + cabecalho.height / 2);
  await expect(page.getByRole("menu")).toBeHidden();

  await expect(botoes(linha)).toHaveCount(1);

  await context.close();
});

test("toque numa tela com mouse revela os ícones e mantém até tocar fora", async ({ browser }) => {
  const { context, page, linha } = await abrirMusicas(browser);
  const tocar = (locator) =>
    locator.evaluate((el) => {
      const init = { bubbles: true, pointerType: "touch", isPrimary: true };
      el.dispatchEvent(new PointerEvent("pointerdown", init));
      el.dispatchEvent(new PointerEvent("pointerup", init));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  await expect(botoes(linha)).toHaveCount(1);

  await tocar(linha.locator("td").first());
  await expect(botoes(linha)).toHaveCount(8);
  await page.waitForTimeout(300);
  await expect(botoes(linha)).toHaveCount(8);

  await tocar(page.locator("thead th").first());
  await expect(botoes(linha)).toHaveCount(1);

  await context.close();
});

test("tela só de toque mostra os ícones sempre e o toque neles funciona", async ({ browser }) => {
  const { context, page, linha } = await abrirMusicas(browser, { hasTouch: true });
  expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);

  await expect(botoes(linha)).toHaveCount(8);

  await linha.locator('[data-testid="mmt-btn-no-audio"]').tap();
  await expect(page.getByTitle("Minimizar")).toBeVisible({ timeout: 10_000 });

  await context.close();
});
