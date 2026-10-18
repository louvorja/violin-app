/** Offline storage separation with real Electron profiles; all files live in temporary roots. */
import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import nodeProcess from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { closeElectronApp } from "./helpers/electron-processes.mjs";

test.skip(nodeProcess.env.LJ_RUN_STORAGE_LOCATION !== "1", "Real Electron storage test is opt-in");
test.use({ trace: "off", screenshot: "off", video: "off" });

const VIDEO = "aaaaaaaaaaa";
const PRELOAD = path.resolve("e2e/helpers/loopback-network.cjs");
const ARGS = [
  "-r",
  PRELOAD,
  ".",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
];

async function output(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}
function environment(root) {
  const env = {
    ...nodeProcess.env,
    LJ_E2E_USER_DATA: root,
    LJ_E2E_BACKGROUND_WINDOWS: "1",
    ELECTRON_DEV: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
async function launch(root) {
  const app = await electron.launch({
    cwd: nodeProcess.cwd(),
    args: ARGS,
    env: environment(root),
    timeout: 60_000,
  });
  try {
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
    await page.waitForFunction(() => Boolean(window.louvorjaApi?.storage?.locations));
    await page
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 60_000 });
    return { app, page };
  } catch (error) {
    await closeElectronApp(app, { timeoutMs: 15_000 });
    throw error;
  }
}
async function close(session) {
  if (!session) return;
  expect((await closeElectronApp(session.app, { timeoutMs: 15_000 })).forced).toBe(false);
}
async function database(page, write) {
  return page.evaluate(
    (value) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("storage-location-fixture", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("data");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("data", value !== undefined ? "readwrite" : "readonly");
          const operation =
            value !== undefined
              ? tx
                  .objectStore("data")
                  .put({ owner: value, blob: new Blob([`private bytes: ${value}`]) }, "saved")
              : tx.objectStore("data").get("saved");
          tx.oncomplete = async () => {
            db.close();
            const result =
              value !== undefined
                ? { owner: value, blob: `private bytes: ${value}` }
                : operation.result;
            resolve(
              result
                ? {
                    owner: result.owner,
                    blob: result.blob instanceof Blob ? await result.blob.text() : result.blob,
                  }
                : null
            );
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    write
  );
}
async function locations(session) {
  return session.page.evaluate(() => window.louvorjaApi.storage.locations());
}
async function assertSingleInstance(session, root) {
  const second = await promisify(execFile)(session.app.process().spawnfile, ["-r", PRELOAD, "."], {
    cwd: nodeProcess.cwd(),
    env: environment(root),
    timeout: 15_000,
  });
  expect(second.stderr).toContain("Segunda instância detectada");
  expect(await session.app.evaluate(() => true)).toBe(true);
}
async function seedIndexedDB(root, profile) {
  const seed = path.join(root, "seed-profile.cjs");
  await output(
    seed,
    `
    const { app, BrowserWindow } = require("electron");
    app.setPath("userData", process.env.LJ_E2E_PROFILE_SEED);
    app.setPath("sessionData", process.env.LJ_E2E_PROFILE_SEED);
    app.whenReady().then(() => {
      const window = new BrowserWindow({ show: false });
      window.loadURL("http://localhost:5002");
    });
    app.on("window-all-closed", () => app.quit());
  `
  );
  await fs.mkdir(profile, { recursive: true });
  const app = await electron.launch({
    cwd: nodeProcess.cwd(),
    env: { ...environment(root), LJ_E2E_PROFILE_SEED: profile },
    args: ["-r", PRELOAD, seed, ARGS.at(-1)],
  });
  try {
    const page = await app.firstWindow();
    await page.waitForURL("http://localhost:5002/**");
    await database(page, "legacy profile");
  } finally {
    await close({ app });
  }
}
async function fetchVideo(session) {
  return session.app.evaluate(async ({ net }, video) => {
    const response = await net.fetch(`louvorja://onlinevideo/${video}.mp4`, {
      headers: { Range: "bytes=3-5" },
    });
    return { status: response.status, body: await response.text() };
  }, VIDEO);
}

test("migrates the private profile once and changes only media/video roots after restart", async () => {
  test.setTimeout(180_000);
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lj-storage-location-")));
  const legacy = path.join(root, "legacy-all-data");
  const profile = path.join(root, "profile");
  const chosenMedia = path.join(root, "Chosen collection");
  const chosenVideos = path.join(root, "Chosen videos");
  let session;
  try {
    await output(path.join(root, "data-location.json"), JSON.stringify({ dataDir: legacy }));
    await output(
      path.join(legacy, "storage", "user_data.json"),
      JSON.stringify({
        fixturePrivate: "preferences",
        options: {
          telemetry: false,
          check_updates_on_start: false,
          auto_download_updates: false,
          dev: { devtools_projections: false, devtools_main_window: false },
        },
      })
    );
    const privateFiles = {
      "library/fixture.json": '{"private":"playlist"}',
      "canva/fixture.pdf": "private canva",
      "json_db/storage-fixture.json": '{"offline":true}',
      "bin/fixture-tool": "tool",
    };
    for (const [name, value] of Object.entries(privateFiles))
      await output(path.join(legacy, name), value);
    await output(path.join(legacy, "files", "musics", "pt", "fixture.opus"), "official song");
    await output(path.join(legacy, "files", "library", "media", "private.jpg"), "private upload");
    await output(path.join(legacy, "files", "notes.txt"), "unknown file");
    await output(path.join(legacy, "Videos", `${VIDEO}.mp4`), "0123456789");
    await output(path.join(legacy, "Videos", `${VIDEO}.keep`), "");
    await output(
      path.join(legacy, "Videos", ".partial", VIDEO, "private.part"),
      "unfinished download"
    );
    await seedIndexedDB(root, path.join(legacy, ".electron"));

    session = await launch(root);
    await assertSingleInstance(session, root);
    expect(await database(session.page)).toEqual({
      owner: "legacy profile",
      blob: "private bytes: legacy profile",
    });
    expect(
      await session.app.evaluate(({ app }) => [app.getPath("userData"), app.getPath("sessionData")])
    ).toEqual([path.join(profile, ".electron"), path.join(profile, ".electron")]);
    expect(await locations(session)).toMatchObject({
      profileDir: profile,
      mediaDir: path.join(legacy, "files"),
      videosDir: path.join(legacy, "Videos"),
      restartRequired: false,
    });
    expect(
      JSON.parse(await fs.readFile(path.join(root, "storage-layout.json"), "utf8"))
    ).toMatchObject({ version: 1 });
    for (const [name, value] of Object.entries(privateFiles)) {
      expect(await fs.readFile(path.join(profile, name), "utf8")).toBe(value);
      expect(await fs.readFile(path.join(legacy, name), "utf8")).toBe(value);
    }
    expect(
      await fs.readFile(path.join(profile, "attachments", "media", "private.jpg"), "utf8")
    ).toBe("private upload");
    expect((await fs.stat(path.join(legacy, ".electron", "IndexedDB"))).isDirectory()).toBe(true);
    await database(session.page, "current profile");
    await session.page.evaluate(() => window.louvorjaApi.storage.completeSetup());
    await session.page.evaluate((value) => window.louvorjaApi.storage.configureLocations(value), {
      mediaDir: chosenMedia,
      videosDir: chosenVideos,
      mediaAction: "copy",
      videosAction: "copy",
    });
    expect(await locations(session)).toMatchObject({
      profileDir: profile,
      mediaDir: path.join(legacy, "files"),
      videosDir: path.join(legacy, "Videos"),
      restartRequired: true,
    });
    expect(await fetchVideo(session)).toEqual({ status: 206, body: "345" });
    await close(session);
    session = null;

    session = await launch(root);
    await assertSingleInstance(session, root);
    expect(await locations(session)).toMatchObject({
      profileDir: profile,
      mediaDir: chosenMedia,
      videosDir: chosenVideos,
      restartRequired: false,
      changeError: null,
    });
    expect(await session.app.evaluate(({ app }) => app.getPath("userData"))).toBe(
      path.join(profile, ".electron")
    );
    expect(await database(session.page)).toEqual({
      owner: "current profile",
      blob: "private bytes: current profile",
    });
    expect(await fetchVideo(session)).toEqual({ status: 206, body: "345" });
    expect(
      await session.page.evaluate(() => window.louvorjaApi.userStore.read("user_data"))
    ).toMatchObject({ fixturePrivate: "preferences" });
    for (const [name, value] of Object.entries(privateFiles))
      expect(await fs.readFile(path.join(profile, name), "utf8")).toBe(value);
    expect(await fs.readFile(path.join(chosenMedia, "musics", "pt", "fixture.opus"), "utf8")).toBe(
      "official song"
    );
    expect(await fs.readFile(path.join(chosenVideos, `${VIDEO}.mp4`), "utf8")).toBe("0123456789");
    expect(await fs.readFile(path.join(chosenVideos, `${VIDEO}.keep`), "utf8")).toBe("");
    for (const relative of ["library", ".electron", "storage", "canva", "notes.txt"]) {
      await expect(fs.stat(path.join(chosenMedia, relative))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    await expect(fs.stat(path.join(chosenVideos, ".partial"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await fs.readFile(path.join(legacy, "files", "library", "media", "private.jpg"), "utf8")
    ).toBe("private upload");
    expect(
      await fs.readFile(path.join(legacy, "files", "musics", "pt", "fixture.opus"), "utf8")
    ).toBe("official song");
    expect(await fs.readFile(path.join(legacy, "Videos", `${VIDEO}.mp4`), "utf8")).toBe(
      "0123456789"
    );
    expect((await fs.stat(path.join(legacy, ".electron", "IndexedDB"))).isDirectory()).toBe(true);
  } finally {
    if (session) await close(session);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("new profiles keep separate IndexedDB while reusing one collection and one writer lease", async () => {
  test.setTimeout(180_000);
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lj-storage-accounts-")));
  const firstRoot = path.join(root, "first-account");
  const secondRoot = path.join(root, "second-account");
  let first;
  let second;
  try {
    first = await launch(firstRoot);
    const defaults = await locations(first);
    expect(defaults).toMatchObject({
      profileDir: path.join(firstRoot, "profile"),
      mediaDir: path.join(firstRoot, "documents", "LouvorJA Violin", "Acervo"),
      videosDir: path.join(firstRoot, "documents", "LouvorJA Violin", "Videos"),
      setupCompleted: false,
      access: { media: { writable: true }, videos: { writable: true } },
    });
    await expect(first.page.getByTestId("media-path")).toHaveText(defaults.mediaDir);
    await expect(first.page.getByTestId("videos-path")).toHaveText(defaults.videosDir);
    await expect(first.page.getByTestId("profile-path")).toHaveText(defaults.profileDir);
    await expect(
      first.page.getByTestId("profile-path").locator("..").getByRole("button")
    ).toHaveCount(1);
    await expect(
      first.page.getByTestId("media-path").locator("..").getByRole("button")
    ).toHaveCount(2);
    await expect(
      first.page.getByTestId("videos-path").locator("..").getByRole("button")
    ).toHaveCount(2);
    await expect(first.page.locator(".storage-locations").getByRole("checkbox")).not.toBeChecked();
    expect(await database(first.page)).toBeNull();
    await database(first.page, "account one");
    await first.page.getByTestId("save-storage").click();
    await expect(first.page.locator(".storage-locations")).toHaveCount(0);
    expect(await locations(first)).toMatchObject({ setupCompleted: true });
    await output(
      path.join(defaults.mediaDir, "musics", "pt", "fixture.opus"),
      "shared official song"
    );
    await output(path.join(defaults.videosDir, `${VIDEO}.mp4`), "0123456789");

    second = await launch(secondRoot);
    expect(await database(second.page)).toBeNull();
    await database(second.page, "account two");
    await second.page.evaluate(() => window.louvorjaApi.storage.completeSetup());
    await second.page.evaluate((value) => window.louvorjaApi.storage.configureLocations(value), {
      mediaDir: defaults.mediaDir,
      videosDir: defaults.videosDir,
      mediaAction: "reuse",
      videosAction: "reuse",
    });
    await close(second);
    second = null;
    second = await launch(secondRoot);
    expect(await locations(second)).toMatchObject({
      profileDir: path.join(secondRoot, "profile"),
      mediaDir: defaults.mediaDir,
      videosDir: defaults.videosDir,
      restartRequired: false,
      access: {
        media: { writable: false, shared: true, reason: "in-use" },
        videos: { writable: false, shared: true, reason: "in-use" },
      },
    });
    expect(await database(first.page)).toEqual({
      owner: "account one",
      blob: "private bytes: account one",
    });
    expect(await database(second.page)).toEqual({
      owner: "account two",
      blob: "private bytes: account two",
    });
    expect(await fetchVideo(second)).toEqual({ status: 206, body: "345" });
    expect(
      await second.page.evaluate(() =>
        window.louvorjaApi.storage.checkLocal(["musics/pt/fixture.opus"])
      )
    ).toMatchObject({ "musics/pt/fixture.opus": "own" });
    expect(await second.page.evaluate((id) => window.louvorjaApi.onlineVideo.keep(id), VIDEO)).toBe(
      false
    );
    expect(
      await second.page.evaluate(async () => {
        try {
          await window.louvorjaApi.storage.clearFiles();
          return "unexpected success";
        } catch (error) {
          return error.message;
        }
      })
    ).toContain("somente para leitura");
    expect(
      await fs.readFile(path.join(defaults.mediaDir, "musics", "pt", "fixture.opus"), "utf8")
    ).toBe("shared official song");
    await close(first);
    first = null;
    await close(second);
    second = null;
    second = await launch(secondRoot);
    expect(await locations(second)).toMatchObject({
      access: { media: { writable: true, shared: true }, videos: { writable: true, shared: true } },
    });
    expect(await database(second.page)).toEqual({
      owner: "account two",
      blob: "private bytes: account two",
    });
    expect(await fetchVideo(second)).toEqual({ status: 206, body: "345" });
  } finally {
    if (second) await close(second);
    if (first) await close(first);
    await fs.rm(root, { recursive: true, force: true });
  }
});
