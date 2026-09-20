/**
 * Navegação com renderer desacelerado.
 *
 * Playwright emula o renderer/Chromium, não o kernel do sistema operacional:
 * a CPU lenta via CDP reproduz o custo de PCs fracos sem bifurcar o
 * comportamento da aplicação por memória ou número de núcleos.
 */
import { test, expect } from "@playwright/test";

const MUSIC_COUNT = 1_889;
const CPU_SLOWDOWN = 6;

function largeMusicFixture() {
  return Array.from({ length: MUSIC_COUNT }, (_, index) => ({
    id_music: index + 1,
    name: `Música de teste ${String(index + 1).padStart(4, "0")}`,
    duration: 180 + (index % 120),
    has_instrumental_music: index % 3 === 0 ? 1 : 0,
    track: String(index + 1).padStart(3, "0"),
    albums: [{ id_album: (index % 12) + 1, name: `Coletânea ${index % 12}` }],
    albums_names: `Coletânea ${index % 12}`,
    lyric: `Letra de teste ${index + 1}`,
  }));
}

async function installSlowRenderer(context, page) {
  await context.addInitScript(() => {
    window.__ljPerformanceLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__ljPerformanceLongTasks.push(Math.round(entry.duration));
      }
    }).observe({ type: "longtask", buffered: true });
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
}

async function waitForMusicRows(page, expectedRows = 1) {
  await page.locator('[data-testid^="music-row-"]').first().waitFor({
    state: "visible",
    timeout: 45_000,
  });
  await expect(page.locator('[data-testid^="music-row-"]')).toHaveCount(expectedRows, {
    timeout: 45_000,
  });
}

async function clickAndMeasure(page, locator, ready) {
  const startedAt = await page.evaluate(() => performance.now());
  await locator.click();
  await ready();
  return Math.round((await page.evaluate(() => performance.now())) - startedAt);
}

test("navegação permanece utilizável com renderer desacelerado", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // Catch-all primeiro; as rotas específicas registradas depois têm prioridade (LIFO).
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  // Sem arquivo estático, o fallback SPA do Vite devolve index.html. Responder
  // JSON aqui evita que catálogos auxiliares ausentes abram alerta modal no boot.
  await context.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/pt_musics*", (route) => route.fulfill({ json: largeMusicFixture() }));

  const page = await context.newPage();
  await installSlowRenderer(context, page);
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({
    state: "attached",
    timeout: 30_000,
  });

  const musicButton = page.locator('[data-testid="ribbon-btn-musics"]');
  const firstOpenMs = await clickAndMeasure(page, musicButton, () => waitForMusicRows(page, 60));
  const renderedRows = await page.locator('[data-testid^="music-row-"]').count();
  const rowButtons = await page
    .locator('[data-testid^="music-row-"]')
    .first()
    .locator("button")
    .count();

  // A abertura sem filtro não constrói o índice completo. A primeira busca
  // precisa materializá-lo sob demanda e alcançar uma música fora da página
  // inicial, preservando o comportamento do catálogo inteiro.
  const searchInput = page.getByRole("textbox");
  await searchInput.fill("Música de teste 1889");
  await expect(page.locator('[data-testid="music-row-1889"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid^="music-row-"]')).toHaveCount(1);

  const closeButton = page.locator('[aria-label="Fechar: Músicas"]');
  await closeButton.click();
  await expect(closeButton).toHaveCount(0, { timeout: 15_000 });

  const secondOpenMs = await clickAndMeasure(page, musicButton, () => waitForMusicRows(page, 60));
  const secondRenderedRows = await page.locator('[data-testid^="music-row-"]').count();

  console.log(
    JSON.stringify(
      {
        renderer: {
          cpu_slowdown: CPU_SLOWDOWN,
          table_page_size: 60,
        },
        first_open_ms: firstOpenMs,
        second_open_ms: secondOpenMs,
        rendered_rows: renderedRows,
        second_rendered_rows: secondRenderedRows,
        row_buttons_before_hover: rowButtons,
        long_tasks_ms: await page.evaluate(() => window.__ljPerformanceLongTasks || []),
      },
      null,
      2
    )
  );

  // O lote é único para todos os equipamentos; a CPU desacelerada só valida
  // que o mesmo caminho permanece responsivo em cenário desfavorável.
  expect(renderedRows).toBe(60);
  expect(secondRenderedRows).toBe(60);
  expect(rowButtons).toBe(1);
  expect(secondOpenMs).toBeLessThan(3_000);

  await context.close();
});
