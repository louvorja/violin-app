/** Real Electron remote-command path: link only after an announcement projects. */
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nodeProcess from "node:process";
import { closeElectronApp } from "./helpers/electron-processes.mjs";

test.skip(
  nodeProcess.env.LJ_RUN_LITURGY_REMOTE_OVERLAY !== "1",
  "Real Electron remote liturgy test is opt-in"
);
test.use({ trace: "off", screenshot: "off", video: "off" });

test("remote liturgy activates linked overlay only when a selected announcement projects", async () => {
  test.setTimeout(90_000);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lj-liturgy-remote-overlay-"));
  const env = {
    ...nodeProcess.env,
    LJ_E2E_USER_DATA: root,
    LJ_E2E_BACKGROUND_WINDOWS: "1",
    ELECTRON_DEV: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;

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
          main = app.windows().find((page) => page.url().includes("localhost:5002"));
          return Boolean(main);
        },
        { timeout: 60_000 }
      )
      .toBe(true);
    await main
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 60_000 });
    await main.evaluate(async () => {
      const [display] = await window.louvorjaApi.displays.list();
      await window.louvorjaApi.displays.setPreferred("file_projection", display.id);
    });

    const id = await main.evaluate(async () => {
      const { default: idb } = await import("/src/helpers/IndexedDB.ts");
      const { DB_TABLE } = await import("/src/constants/DbTables.ts");
      const { writeSlot } = await import("/src/helpers/Overlay.ts");
      const { createOverlaySlot } = await import("/src/types/Overlay.ts");
      const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
      await idb.put(DB_TABLE.ANNOUNCEMENTS, {
        id: "remote-announcement",
        nome: "Aviso remoto",
        ordem: 1,
        texto: "Anúncio projetado remotamente",
      });
      await writeSlot(
        createOverlaySlot({
          id: "remote-overlay",
          name: "Letreiro remoto",
          content: "Sobreposição remota",
          enabled: false,
        })
      );
      return Liturgy.add({
        tipo: "anuncios",
        item: "Anúncios remotos",
        anuncios_ids: [],
        linked_overlay_id: "remote-overlay",
      }).id;
    });

    async function sendRemoteExecute(itemId = id) {
      await app.evaluate(({ BrowserWindow }, alvo) => {
        const window = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().includes("localhost:5002")
        );
        window.webContents.send("http:song-slides", {
          action: "liturgy-execute",
          id: alvo,
          tag: "audio",
        });
      }, itemId);
    }

    async function linkedSlotEnabled() {
      return main.evaluate(async () => {
        const { readAllSlots } = await import("/src/helpers/Overlay.ts");
        return (await readAllSlots()).find((slot) => slot.id === "remote-overlay")?.enabled;
      });
    }

    await sendRemoteExecute();
    await expect
      .poll(() =>
        main.evaluate(async (itemId) => {
          const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
          return Boolean(Liturgy.get(itemId)?.checked);
        }, id)
      )
      .toBe(true);
    await main.waitForTimeout(300);
    expect(await linkedSlotEnabled()).toBe(false);
    expect(app.windows().some((page) => page.url().includes("/projection/announcements"))).toBe(
      false
    );

    await main.evaluate(async (itemId) => {
      const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
      Liturgy.update(itemId, { anuncios_ids: ["remote-announcement"] });
    }, id);
    await sendRemoteExecute();
    await expect.poll(linkedSlotEnabled).toBe(true);
    let projection;
    await expect
      .poll(() => {
        projection = app.windows().find((page) => page.url().includes("/projection/announcements"));
        return Boolean(projection);
      })
      .toBe(true);
    await expect(projection.locator(".ann-text")).toHaveText("Anúncio projetado remotamente");
    await expect(projection.locator('[data-slot-id="remote-overlay"]')).toHaveText(
      "Sobreposição remota"
    );

    /*
     * O próximo item que assume o telão recolhe o overlay vinculado do
     * anterior — mesmo vindo pelo controle remoto.
     */
    const outroId = await main.evaluate(async () => {
      const { default: Liturgy } = await import("/src/helpers/Liturgy.ts");
      return Liturgy.add({
        tipo: "anuncios",
        item: "Outro aviso remoto",
        anuncios_ids: ["remote-announcement"],
      }).id;
    });
    await sendRemoteExecute(outroId);
    await expect.poll(linkedSlotEnabled).toBe(false);
  } finally {
    try {
      if (app) expect((await closeElectronApp(app)).forced).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
});
