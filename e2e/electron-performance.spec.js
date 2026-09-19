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
    const page = electronApp
      .windows()
      .find((candidate) => candidate.url().includes("localhost:5002"));
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

  const env = { ...nodeProcess.env, ELECTRON_DEV: "1", LJ_E2E_USER_DATA: root };
  delete env.ELECTRON_RUN_AS_NODE;

  let electronApp;
  try {
    const launchStartedAt = Date.now();
    electronApp = await electron.launch({
      args: [".", "--disable-gpu"],
      cwd: nodeProcess.cwd(),
      env,
      timeout: 60_000,
    });
    const page = await mainWindow(electronApp);
    await page.locator('[data-testid="modules-ready"]').waitFor({
      state: "attached",
      timeout: 60_000,
    });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: Number(nodeProcess.env.LJ_PERF_CPU || 6),
    });

    const openMusic = async () => {
      const startedAt = Date.now();
      await page.evaluate(() =>
        document.querySelector('[data-testid="ribbon-btn-musics"]')?.click()
      );
      await page.locator('[data-testid^="music-row-"]').first().waitFor({
        state: "visible",
        timeout: 45_000,
      });
      return {
        duration_ms: Date.now() - startedAt,
        rows: await page.locator('[data-testid^="music-row-"]').count(),
      };
    };

    const closeMusic = async () => {
      await page.evaluate(() => document.querySelector('[aria-label="Fechar: Músicas"]')?.click());
      await page.waitForTimeout(100);
    };

    const before = await processMetrics(electronApp);
    const first = await openMusic();
    await closeMusic();
    const second = await openMusic();
    const after = await processMetrics(electronApp);
    const result = {
      platform: nodeProcess.platform,
      electron: await electronApp.evaluate(() => globalThis.process.versions.electron),
      boot_ms: Date.now() - launchStartedAt,
      first,
      second,
      before,
      after,
    };

    console.log(JSON.stringify(result, null, 2));
    await test.info().attach("electron-performance.json", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });

    expect(second.rows).toBeLessThanOrEqual(first.rows);
    expect(second.duration_ms).toBeLessThan(3_000);
  } finally {
    await electronApp?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
