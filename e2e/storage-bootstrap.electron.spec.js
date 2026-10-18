/** Progresso da migração usa Chromium isolado, sem abrir o perfil copiado. */
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import nodeProcess from "node:process";
import { Buffer } from "node:buffer";

test.skip(nodeProcess.env.LJ_RUN_STORAGE_LOCATION !== "1", "Real Electron storage test is opt-in");
test.use({ trace: "off", screenshot: "off", video: "off" });

test("mostra progresso em sessão temporária e publica o perfil sem abrir seu IndexedDB", async () => {
  test.setTimeout(60_000);
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "lj-storage-bootstrap-e2e-"))
  );
  const bootstrap = path.join(root, "appData");
  const legacy = path.join(root, "legacy");
  const temporary = path.join(root, "ui");
  let app;
  try {
    await fs.mkdir(bootstrap);
    await fs.mkdir(temporary);
    const db = path.join(legacy, ".electron", "IndexedDB", "fixture");
    await fs.mkdir(db, { recursive: true });
    // Arquivos sintéticos nunca são abertos como LevelDB. O volume permite
    // observar a UI enquanto a migração ainda está trabalhando no worker.
    for (let batch = 0; batch < 60; batch++) {
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          fs.writeFile(path.join(db, `${batch}-${index}.ldb`), Buffer.alloc(4096, index))
        )
      );
    }
    await fs.writeFile(
      path.join(bootstrap, "data-location.json"),
      JSON.stringify({ dataDir: legacy })
    );
    const request = path.join(temporary, "request.json");
    await fs.writeFile(
      request,
      JSON.stringify({
        version: 1,
        bootstrap,
        documents: path.join(root, "Documents"),
        videos: path.join(root, "Videos"),
        programDir: nodeProcess.cwd(),
        ownedBootstrapPid: nodeProcess.pid,
      })
    );
    const env = {
      ...nodeProcess.env,
      LJ_STORAGE_BOOTSTRAP_REQUEST: request,
      LJ_E2E_BACKGROUND_WINDOWS: "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      args: [".", "--lj-storage-bootstrap"],
      cwd: nodeProcess.cwd(),
      env,
    });
    const exited = new Promise((resolve) => app.process().once("exit", (code) => resolve(code)));
    const page = await app.firstWindow();
    await page.waitForURL("**/storage-bootstrap.html?**");
    expect(
      await app.evaluate(({ app, BrowserWindow }) => ({
        userData: app.getPath("userData"),
        sessionData: app.getPath("sessionData"),
        persistent: BrowserWindow.getAllWindows()[0].webContents.session.isPersistent(),
      }))
    ).toEqual({
      userData: path.join(temporary, "ui-profile"),
      sessionData: path.join(temporary, "ui-profile"),
      persistent: false,
    });
    await expect(page.locator("#title")).toHaveText(/Preparando/);
    expect(await exited).toBe(0);
    expect(JSON.parse(await fs.readFile(path.join(temporary, "result.json"), "utf8"))).toEqual({
      ok: true,
    });
    expect(
      await fs.readFile(
        path.join(bootstrap, "profile", ".electron", "IndexedDB", "fixture", "59-72.ldb")
      )
    ).toEqual(await fs.readFile(path.join(db, "59-72.ldb")));
    expect(await fs.readdir(path.join(bootstrap, "profile", ".electron"))).toEqual(["IndexedDB"]);
    app = null;
  } finally {
    if (app && app.process().exitCode === null) app.process().kill("SIGKILL");
    await fs.rm(root, { recursive: true, force: true });
  }
});
