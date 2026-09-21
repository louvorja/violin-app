/**
 * Mede o caminho real do Electron: protocolo louvorja://, preload, main
 * process, renderer e métricas dos processos Chromium.
 *
 * Rode com:
 *   VITE_TARGET=desktop LJ_RUN_ELECTRON_PERF=1 \
 *     npx playwright test e2e/electron-performance.spec.js
 *
 * A suíte é opt-in porque precisa iniciar uma aplicação Electron real e deve
 * rodar em uma máquina/runner por vez.
 */
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodeProcess from "node:process";

test.skip(!nodeProcess.env.LJ_RUN_ELECTRON_PERF, "Electron performance test is opt-in");

const MUSIC_COUNT = 1_889;

function musicFixture() {
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

async function mainWindow(electronApp) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = electronApp.windows().find((candidate) => {
      const url = candidate.url();
      return (
        url !== "about:blank" &&
        !url.includes("splash.html") &&
        (url.includes("localhost:5002") || url.includes("index.html"))
      );
    });
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Janela principal do Electron não apareceu");
}

async function processMetrics(electronApp) {
  return (await electronApp.evaluate(({ app }) => app.getAppMetrics())).map((item) => ({
    type: item.type,
    pid: item.pid,
    cpu_percent: item.cpu?.percentCPUUsage,
    working_set_kb: item.memory?.workingSetSize,
  }));
}

test("Electron mantém a reabertura da aba estável", async () => {
  test.setTimeout(120_000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "louvorja-electron-perf-"));
  fs.mkdirSync(path.join(root, "json_db"), { recursive: true });
  fs.writeFileSync(path.join(root, "json_db", "pt_musics.json"), JSON.stringify(musicFixture()));

  const packagedExecutable = nodeProcess.env.LJ_ELECTRON_EXECUTABLE;
  const env = { ...nodeProcess.env, LJ_E2E_USER_DATA: root };
  if (packagedExecutable) {
    delete env.ELECTRON_DEV;
  } else {
    env.ELECTRON_DEV = "1";
  }
  delete env.ELECTRON_RUN_AS_NODE;

  let electronApp;
  try {
    const launchStartedAt = Date.now();
    electronApp = await electron.launch({
      executablePath: packagedExecutable || undefined,
      args: packagedExecutable ? ["--disable-gpu"] : [".", "--disable-gpu"],
      cwd: nodeProcess.cwd(),
      env,
      timeout: 60_000,
    });
    const page = await mainWindow(electronApp);
    await page.locator('[data-testid="modules-ready"]').waitFor({
      state: "attached",
      timeout: 60_000,
    });

    const startupOverlay = page.locator(".lj-dialog__overlay[data-state='open']");
    if (
      await startupOverlay
        .waitFor({ state: "visible", timeout: 2_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await page.keyboard.press("Escape");
      await startupOverlay.waitFor({ state: "detached", timeout: 15_000 });
    }

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: Number(nodeProcess.env.LJ_PERF_CPU || 6),
    });

    const openMusic = async () => {
      const startedAt = Date.now();
      await page.evaluate(() =>
        document.querySelector('[data-testid="ribbon-btn-musics"]')?.click()
      );
      const searchInput = page.getByPlaceholder("Buscar por...");
      await searchInput.waitFor({
        state: "visible",
        timeout: 45_000,
      });
      const controlsReadyMs = Date.now() - startedAt;
      await page.locator('[data-testid^="music-row-"]').first().waitFor({
        state: "visible",
        timeout: 45_000,
      });
      return {
        controls_ready_ms: controlsReadyMs,
        duration_ms: Date.now() - startedAt,
        rows: await page.locator('[data-testid^="music-row-"]').count(),
      };
    };

    const closeMusic = async () => {
      await page.evaluate(() => document.querySelector('[aria-label="Fechar: Músicas"]')?.click());
      await page.waitForTimeout(100);
    };

    const openSettings = async () => {
      const startedAt = Date.now();
      await page.locator(".app-menu-btn").click();
      await page.locator("#opt-sec-general").waitFor({
        state: "visible",
        timeout: 45_000,
      });
      const firstPaintMs = Date.now() - startedAt;
      await expect(page.locator(".opt-section")).toHaveCount(9, {
        timeout: 15_000,
      });
      return {
        first_paint_ms: firstPaintMs,
        full_content_ms: Date.now() - startedAt,
        sections: await page.locator(".opt-section").count(),
      };
    };

    const closeSettings = async () => {
      await page.locator(".app-menu-back").click();
      await page.locator("#opt-sec-general").waitFor({
        state: "detached",
        timeout: 15_000,
      });
    };

    const before = await processMetrics(electronApp);
    const settingsImmediate = await openSettings();
    await closeSettings();

    // Simula o uso normal: a shell já ficou interativa e o preload ocioso do
    // chunk de Configurações teve oportunidade de terminar antes do clique.
    await page.waitForTimeout(2_200);
    const settingsFirst = await openSettings();
    await closeSettings();
    const settingsSecond = await openSettings();
    await closeSettings();
    const first = await openMusic();

    // Garante que o catálogo lazy do módulo foi mesclado: antes da regressão
    // do path do import.meta.glob, este texto aparecia como chave crua.
    const searchInput = page.getByPlaceholder("Buscar por...");
    await expect(searchInput).toBeVisible({ timeout: 45_000 });

    await closeMusic();
    const second = await openMusic();

    const searchStartedAt = Date.now();
    await searchInput.fill("Música de teste 1889");
    await page.locator('[data-testid="music-row-1889"]').waitFor({
      state: "visible",
      timeout: 45_000,
    });
    const search = {
      duration_ms: Date.now() - searchStartedAt,
      rows: await page.locator('[data-testid^="music-row-"]').count(),
    };

    const after = await processMetrics(electronApp);
    const result = {
      platform: nodeProcess.platform,
      electron: await electronApp.evaluate(() => globalThis.process.versions.electron),
      boot_ms: Date.now() - launchStartedAt,
      settings_immediate: settingsImmediate,
      settings_first_after_idle: settingsFirst,
      settings_second: settingsSecond,
      first,
      second,
      search,
      before,
      after,
    };

    console.log(JSON.stringify(result, null, 2));
    await test.info().attach("electron-performance.json", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });

    expect(settingsImmediate.sections).toBeGreaterThanOrEqual(8);
    expect(settingsFirst.sections).toBeGreaterThanOrEqual(8);
    expect(settingsSecond.sections).toBeGreaterThanOrEqual(8);
    expect(second.rows).toBeLessThanOrEqual(first.rows);
    expect(second.duration_ms).toBeLessThan(3_000);
    expect(search.rows).toBe(1);
    expect(search.duration_ms).toBeLessThan(3_000);
  } finally {
    await electronApp?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
