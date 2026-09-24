/**
 * Real app/preload/main/utility-process download test; the download fixture is loopback-only.
 * VITE_TARGET=desktop LJ_RUN_DOWNLOAD_UTILITY=1 npx playwright test e2e/download-utility.electron.spec.js
 * Packaged mode may make normal bootstrap requests and requires explicit opt-in.
 * The profile and media are temporary. No external logs, traces or screenshots.
 */
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import nodeProcess from "node:process";
import { Buffer } from "node:buffer";
import { closeElectronApp } from "./helpers/electron-processes.mjs";

test.skip(nodeProcess.env.LJ_RUN_DOWNLOAD_UTILITY !== "1", "Real Electron download is opt-in");
test.use({ trace: "off", screenshot: "off", video: "off" });

test("downloads and cancels through the real preload in a separate utility process", async () => {
  const testInfo = test.info();
  test.setTimeout(120000);
  const packagedExecutable = nodeProcess.env.LJ_ELECTRON_EXECUTABLE?.trim();
  if (packagedExecutable && nodeProcess.env.LJ_ALLOW_PACKAGED_BOOTSTRAP_NETWORK !== "1") {
    throw new Error(
      "Packaged mode may make normal bootstrap network requests; set LJ_ALLOW_PACKAGED_BOOTSTRAP_NETWORK=1 to opt in"
    );
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-download-utility-e2e-"));
  const fixture = Buffer.alloc(512 * 1024, 42);
  const requests = [];
  const timers = new Set();
  const sockets = new Set();
  let slow = false;
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(200, {
      "content-length": fixture.length,
      "content-type": "application/octet-stream",
    });
    let offset = 0;
    const timer = setInterval(() => {
      const end = Math.min(offset + (slow ? 1024 : 32768), fixture.length);
      res.write(fixture.subarray(offset, end));
      offset = end;
      if (offset === fixture.length) res.end();
    }, 30);
    timers.add(timer);
    res.on("close", () => {
      clearInterval(timer);
      timers.delete(timer);
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let app;
  let utilityPid;
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
    const guard = path.resolve("e2e/helpers/loopback-network.cjs");
    const env = { ...nodeProcess.env, LJ_E2E_USER_DATA: root };
    if (packagedExecutable) delete env.ELECTRON_DEV;
    else env.ELECTRON_DEV = "1";
    delete env.ELECTRON_RUN_AS_NODE;
    // Packaged Electron treats -r as an application argument, so it cannot
    // load the test guard. Packaged mode has a separate explicit opt-in above;
    // dev mode keeps the guard and Chromium network restriction.
    const launchArgs = packagedExecutable
      ? []
      : [
          "-r",
          guard,
          ".",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
        ];
    app = await electron.launch({
      executablePath: packagedExecutable ? path.resolve(packagedExecutable) : undefined,
      args: launchArgs,
      env,
      timeout: 60000,
    });
    if (packagedExecutable) {
      const runtime = await app.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        executable: app.getPath("exe"),
        userData: app.getPath("userData"),
        documents: app.getPath("documents"),
      }));
      expect(runtime.packaged).toBe(true);
      expect(await fs.realpath(runtime.executable)).toBe(await fs.realpath(packagedExecutable));
      expect(path.resolve(runtime.userData)).toBe(root);
      expect(path.resolve(runtime.documents)).toBe(path.join(root, "documents"));
    } else {
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
    }
    let page;
    await expect
      .poll(
        () => {
          page = app
            .windows()
            .find((candidate) =>
              packagedExecutable
                ? candidate.url().startsWith("louvorja://app/")
                : candidate.url().includes("localhost:5002")
            );
          return !!page;
        },
        { timeout: 60000 }
      )
      .toBe(true);
    await page.waitForFunction(() => !!window.louvorjaApi?.download);
    await page
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 60000 });
    await page.evaluate(async (url) => {
      const api = window.louvorjaApi.download;
      window.__downloadTest = { progress: 0, terminal: null, cancelled: false };
      window.__downloadTestCleanup = [
        api.onProgress(() => {
          window.__downloadTest.progress++;
        }),
        api.onQueueDone((data) => {
          window.__downloadTest.terminal = data;
        }),
        api.onQueueCancelled(() => {
          window.__downloadTest.cancelled = true;
        }),
      ];
      await api.setApiConfig({ filesUrl: url, apiUrl: url, paramsUrl: url, apiToken: "" });
    }, baseUrl);
    // Exercise the actual BrowserWindow lifecycle which changes presentation
    // activity, using a small framed window safe for a single-monitor desk.
    const projection = await page.evaluate(async () => {
      const [display] = await window.louvorjaApi.displays.list();
      return window.louvorjaApi.windows.open({
        route: "/projection",
        feature: "musicas",
        monitorId: display.id,
        fullscreen: false,
        alwaysOnTop: false,
        frame: true,
        width: 480,
        height: 270,
      });
    });
    expect(projection.id).toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(() => window.louvorjaApi.windows.listOpen()))
      .toContain("musicas");
    let projectionPage;
    await expect
      .poll(() => {
        projectionPage = app.windows().find((candidate) => candidate.url().endsWith("/projection"));
        return !!projectionPage;
      })
      .toBe(true);
    await projectionPage.locator(".projection-stage").waitFor({ state: "visible" });
    expect(
      await app.evaluate(({ BrowserWindow }, id) => {
        const win = BrowserWindow.fromId(id);
        return {
          visible: win.isVisible(),
          fullscreen: win.isFullScreen(),
          kiosk: win.isKiosk(),
          alwaysOnTop: win.isAlwaysOnTop(),
        };
      }, projection.id)
    ).toEqual({ visible: true, fullscreen: false, kiosk: false, alwaysOnTop: false });
    const start = async (name) =>
      page.evaluate(
        async ({ name, size }) => {
          window.__downloadTest = { progress: 0, terminal: null, cancelled: false };
          return window.louvorjaApi.download.start([
            { remote: `/${name}`, local: name, expectedSize: size },
          ]);
        },
        { name, size: fixture.length }
      );
    expect((await start("complete.bin")).queued).toBe(1);
    await expect
      .poll(async () => {
        const metrics = await app.evaluate(({ app }) =>
          app
            .getAppMetrics()
            .filter((metric) => metric.name === "LouvorJA Downloads")
            .map((metric) => ({ pid: metric.pid, type: metric.type }))
        );
        utilityPid = metrics[0]?.pid;
        return metrics.length;
      })
      .toBe(1);
    expect(utilityPid).not.toBe(app.process().pid);
    await expect
      .poll(() => page.evaluate(() => window.__downloadTest.terminal))
      .toEqual({ downloaded: 1, failed: 0 });
    const filesDir = path.join(root, "documents", "LouvorJA Violin", "files");
    expect(await fs.readFile(path.join(filesDir, "complete.bin"))).toEqual(fixture);
    expect(await page.evaluate(() => window.__downloadTest.progress)).toBeGreaterThan(0);

    slow = true;
    expect((await start("retry.bin")).queued).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__downloadTest.progress)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.louvorjaApi.download.cancel())).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__downloadTest.cancelled)).toBe(true);
    await expect(fs.stat(path.join(filesDir, "retry.bin"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.stat(path.join(filesDir, "retry.bin.tmp"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    slow = false;
    expect((await start("retry.bin")).queued).toBe(1);
    await expect
      .poll(() => page.evaluate(() => window.__downloadTest.terminal))
      .toEqual({ downloaded: 1, failed: 0 });
    expect(await fs.readFile(path.join(filesDir, "retry.bin"))).toEqual(fixture);
    await expect
      .poll(async () =>
        app.evaluate(
          ({ app }) =>
            app.getAppMetrics().filter((metric) => metric.name === "LouvorJA Downloads").length
        )
      )
      .toBe(0);
    expect(requests.filter((url) => url === "/retry.bin")).toHaveLength(2);
    expect(projectionPage.isClosed()).toBe(false);
    expect(await page.evaluate(() => window.louvorjaApi.windows.listOpen())).toContain("musicas");
    await page.evaluate(async () => {
      window.__downloadTestCleanup.forEach((off) => off());
      await window.louvorjaApi.windows.close("musicas");
    });
    await expect.poll(() => projectionPage.isClosed()).toBe(true);
    expect(await page.evaluate(() => window.louvorjaApi.windows.listOpen())).not.toContain(
      "musicas"
    );
    await testInfo.attach("download-summary", {
      contentType: "application/json",
      body: JSON.stringify({
        separate_process: true,
        bytes_verified: fixture.length * 2,
        cancel_cleanup: true,
        retry_completed: true,
        real_projection_window_did_not_pause_download: true,
        projection_closed_cleanly: true,
      }),
    });
  } finally {
    try {
      closed = await closeElectronApp(app);
    } finally {
      for (const timer of timers) clearInterval(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
  expect(closed.forced).toBe(false);
});
