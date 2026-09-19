/**
 * Perfil de navegação em máquina fraca.
 *
 * Playwright emula o renderer/Chromium, não o kernel do sistema operacional:
 * CPU lenta via CDP, memória lógica via navigator e dados grandes determinísticos.
 * O mesmo teste pode rodar em runners Windows/macOS/Linux para medir também o
 * custo real de cada Electron/Chromium distribuído pela plataforma.
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

async function installSlowProfile(context, page) {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", {
      configurable: true,
      get: () => 2,
    });
    Object.defineProperty(Navigator.prototype, "deviceMemory", {
      configurable: true,
      get: () => 2,
    });
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

async function waitForMusicRows(page) {
  await page.locator('[data-testid^="music-row-"]').first().waitFor({
    state: "visible",
    timeout: 45_000,
  });
}

async function clickAndMeasure(page, locator, ready) {
  const startedAt = await page.evaluate(() => performance.now());
  await locator.click();
  await ready();
  return Math.round((await page.evaluate(() => performance.now())) - startedAt);
}

test("navegação permanece utilizável no perfil PC fraco", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // Catch-all primeiro; as rotas específicas registradas depois têm prioridade (LIFO).
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/pt_musics*", (route) => route.fulfill({ json: largeMusicFixture() }));

  const page = await context.newPage();
  await installSlowProfile(context, page);
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({
    state: "attached",
    timeout: 30_000,
  });

  const musicButton = page.locator('[data-testid="ribbon-btn-musics"]');
  const firstOpenMs = await clickAndMeasure(page, musicButton, () => waitForMusicRows(page));
  const renderedRows = await page.locator('[data-testid^="music-row-"]').count();
  const rowButtons = await page
    .locator('[data-testid^="music-row-"]')
    .first()
    .locator("button")
    .count();

  const closeButton = page.locator('[aria-label="Fechar: Músicas"]');
  await closeButton.click();
  await expect(closeButton).toHaveCount(0, { timeout: 15_000 });

  const secondOpenMs = await clickAndMeasure(page, musicButton, () => waitForMusicRows(page));
  const secondRenderedRows = await page.locator('[data-testid^="music-row-"]').count();

  console.log(
    JSON.stringify(
      {
        profile: {
          cpu_slowdown: CPU_SLOWDOWN,
          hardware_concurrency: 2,
          device_memory_gb: 2,
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

  // O perfil de 2 GB/2 threads deve usar a página reduzida de RuntimePerformance.
  expect(renderedRows).toBeLessThanOrEqual(40);
  expect(secondRenderedRows).toBeLessThanOrEqual(renderedRows);
  expect(rowButtons).toBe(1);
  expect(secondOpenMs).toBeLessThan(3_000);

  await context.close();
});
