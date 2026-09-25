/**
 * Verifies same-feature reopen after Electron's native/user-initiated close.
 * Isolated dev app, temporary user-data profile and loopback-only networking.
 * Run: VITE_TARGET=desktop LJ_RUN_NATIVE_WINDOW_REOPEN=1 \
 *   npx playwright test e2e/native-window-reopen.electron.spec.js --output /tmp/lj-native-window-reopen
 */
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nodeProcess from "node:process";
import { closeElectronApp } from "./helpers/electron-processes.mjs";

test.skip(
  nodeProcess.env.LJ_RUN_NATIVE_WINDOW_REOPEN !== "1",
  "Real Electron native-window lifecycle test is opt-in"
);
test.use({ trace: "off", screenshot: "off", video: "off" });

test("native close waits for the old music window before reopening the feature", async () => {
  test.setTimeout(90_000);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-native-window-reopen-"));
  const guard = path.resolve("e2e/helpers/loopback-network.cjs");
  const env = { ...nodeProcess.env, LJ_E2E_USER_DATA: root, ELECTRON_DEV: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  let closed;

  try {
    await fs.mkdir(path.join(root, "storage"), { recursive: true });
    await fs.writeFile(
      path.join(root, "storage", "user_data.json"),
      JSON.stringify({
        options: {
          telemetry: false,
          check_updates_on_start: false,
          auto_download_updates: false,
          dev: { devtools_projections: false, devtools_main_window: false },
        },
      })
    );

    app = await electron.launch({
      args: [
        "-r",
        guard,
        ".",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      ],
      cwd: nodeProcess.cwd(),
      env,
      timeout: 60_000,
    });

    expect(
      await app.evaluate(() => {
        try {
          globalThis.process
            .getBuiltinModule("node:http")
            .request("http://external-disabled.invalid");
          return false;
        } catch (error) {
          return error.message === "External HTTP disabled by isolated download E2E";
        }
      })
    ).toBe(true);

    let page;
    await expect
      .poll(
        () => {
          page = app.windows().find((candidate) => candidate.url().includes("localhost:5002"));
          return Boolean(page);
        },
        { timeout: 60_000 }
      )
      .toBe(true);
    await page.waitForFunction(() => Boolean(window.louvorjaApi?.windows));
    await page.locator('[data-testid="modules-ready"]').waitFor({
      state: "attached",
      timeout: 60_000,
    });

    const [display] = await page.evaluate(() => window.louvorjaApi.displays.list());
    const first = await page.evaluate(
      ({ monitorId }) =>
        window.louvorjaApi.windows.open({
          route: "/projection",
          feature: "musicas",
          monitorId,
          fullscreen: false,
          alwaysOnTop: false,
          frame: true,
          width: 480,
          height: 270,
        }),
      { monitorId: display.id }
    );
    expect(first.id).toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(() => window.louvorjaApi.windows.listOpen()))
      .toContain("musicas");

    let firstPage;
    await expect
      .poll(() => {
        firstPage = app.windows().find((candidate) => candidate.url().endsWith("/projection"));
        return Boolean(firstPage);
      })
      .toBe(true);
    await firstPage.locator(".projection-stage").waitFor({ state: "visible" });

    // Start a deliberately delayed close from BrowserWindow itself. This
    // bypasses windowFactory.close and follows Electron's native close event.
    await app.evaluate(({ BrowserWindow }, id) => {
      const win = BrowserWindow.fromId(id);
      globalThis.__nativeReopenProbe = { closeRequestedAt: Date.now(), closedAt: null };
      win.once("closed", () => {
        globalThis.__nativeReopenProbe.closedAt = Date.now();
      });
      win.on("close", (event) => {
        if (globalThis.__nativeReopenProbe.closePrevented) return;
        globalThis.__nativeReopenProbe.closePrevented = true;
        event.preventDefault();
        setTimeout(() => win.close(), 120);
      });
      win.close();
    }, first.id);

    const second = await page.evaluate(
      ({ monitorId }) =>
        window.louvorjaApi.windows.open({
          route: "/projection",
          feature: "musicas",
          monitorId,
          fullscreen: false,
          alwaysOnTop: false,
          frame: true,
          width: 480,
          height: 270,
        }),
      { monitorId: display.id }
    );

    expect(second.id).toBeGreaterThan(0);
    expect(second.id).not.toBe(first.id);
    const lifecycle = await app.evaluate(
      ({ BrowserWindow }, { oldId, newId }) => ({
        oldWindowPresent: Boolean(BrowserWindow.fromId(oldId)),
        newWindowPresent: Boolean(BrowserWindow.fromId(newId)),
        ...globalThis.__nativeReopenProbe,
      }),
      { oldId: first.id, newId: second.id }
    );
    expect(lifecycle.oldWindowPresent).toBe(false);
    expect(lifecycle.newWindowPresent).toBe(true);
    expect(lifecycle.closedAt).toBeGreaterThan(lifecycle.closeRequestedAt);
    expect(lifecycle.closePrevented).toBe(true);

    await expect.poll(() => firstPage.isClosed()).toBe(true);
    let secondPage;
    await expect
      .poll(() => {
        secondPage = app.windows().find((candidate) => candidate.url().endsWith("/projection"));
        return Boolean(secondPage);
      })
      .toBe(true);
    expect(secondPage).not.toBe(firstPage);
    await secondPage.locator(".projection-stage").waitFor({ state: "visible" });
    await expect
      .poll(() => page.evaluate(() => window.louvorjaApi.windows.listOpen()))
      .toContain("musicas");
  } finally {
    try {
      closed = await closeElectronApp(app);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }

  expect(closed.forced).toBe(false);
});
