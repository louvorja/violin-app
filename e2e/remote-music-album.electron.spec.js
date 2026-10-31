import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nodeProcess from "node:process";
import { closeElectronApp } from "./helpers/electron-processes.mjs";

test.skip(nodeProcess.env.LJ_RUN_REMOTE_MUSIC_ALBUM !== "1", "Teste Electron opt-in");
test.use({ trace: "off", screenshot: "off", video: "off", serviceWorkers: "block" });

test("controle remoto lista e seleciona álbum presente só no IndexedDB, offline", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-remote-album-"));
  const env = {
    ...nodeProcess.env,
    LJ_E2E_USER_DATA: root,
    LJ_E2E_BACKGROUND_WINDOWS: "1",
    ELECTRON_DEV: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    await fs.writeFile(path.join(root, "data-location.json"), JSON.stringify({ dataDir: root }));
    await fs.mkdir(path.join(root, "storage"), { recursive: true });
    await fs.mkdir(path.join(root, "json_db"), { recursive: true });
    await fs.writeFile(
      path.join(root, "storage", "user_data.json"),
      JSON.stringify({
        options: { telemetry: false, check_updates_on_start: false, auto_download_updates: false },
      })
    );
    await fs.writeFile(
      path.join(root, "json_db", "pt_categories.json"),
      JSON.stringify([
        { id_category: 1, name: "Coletâneas", albums: [{ id_album: 9, name: "Álbum offline" }] },
      ])
    );
    app = await electron.launch({
      args: [
        "-r",
        path.resolve("e2e/helpers/loopback-network.cjs"),
        ".",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      ],
      cwd: nodeProcess.cwd(),
      env,
      timeout: 60_000,
    });
    let main;
    await expect
      .poll(
        () => {
          main = app.windows().find((win) => win.url().includes("localhost:5002"));
          return Boolean(main);
        },
        { timeout: 60_000 }
      )
      .toBe(true);
    await main
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 60_000 });
    const server = await main.evaluate(async () => {
      const database = (await import("/src/helpers/Database.ts")).default;
      await database.seed("album_9", {
        id_album: 9,
        name: "Álbum offline",
        musics: [
          { id_music: 91, name: "Canção offline", duration: "00:03:39", has_instrumental_music: 1 },
        ],
      });
      return window.louvorjaApi.httpServer.start({ port: 17891 });
    });
    // Nem a preparação nem a consulta podem criar a cópia legada.
    await expect(fs.access(path.join(root, "json_db", "album_9.json"))).rejects.toThrow();
    const base = `http://127.0.0.1:${server.port}`;
    const response = await page.request.get(
      `${base}/api/music-library?action=songs&album=album:9&token=${server.token}`
    );
    expect(response.status()).toBe(200);
    expect((await response.json()).songs).toMatchObject([
      { id_music: 91, name: "Canção offline", duration: "3:39", albums_names: "Álbum offline" },
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/remote?token=${server.token}`);
    await page.getByRole("tab", { name: "Músicas" }).click();
    await expect(page.locator(".rm-item").filter({ hasText: "Álbum offline" })).toBeVisible();
    await page.locator(".rm-item").filter({ hasText: "Álbum offline" }).click();
    await page.locator(".rm-item").filter({ hasText: "Canção offline" }).click();
    await expect(page.getByRole("dialog", { name: "Canção offline" })).toBeVisible();
    await expect(fs.access(path.join(root, "json_db", "album_9.json"))).rejects.toThrow();
  } finally {
    try {
      if (app) expect((await closeElectronApp(app)).forced).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});
