// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import { EventEmitter } from "events";
import os from "os";
import path from "path";
import fs from "fs";

const require = createRequire(import.meta.url);
const { createYoutubeAccount, toNetscape, isLoggedIn, fileHasSession, chromeUserAgent, PARTITION } = require("../onlineVideo/youtubeAccount.js");

const cookie = (name, domain, extra = {}) => ({ name, value: `v-${name}`, domain, path: "/", secure: true, expirationDate: 2000000000, ...extra });

function fakeWindow() {
  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  win.webContents.setWindowOpenHandler = () => {};
  win.loadURL = async () => {};
  win.isDestroyed = () => false;
  win.close = () => win.emit("closed");
  win.focus = () => {};
  return win;
}

describe("youtubeAccount", () => {
  let dir;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-yt-"))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("a sessão de login não é guardada no perfil (pasta de dados)", () => {
    expect(PARTITION.startsWith("persist:")).toBe(false);
  });

  it("exporta só cookies do YouTube — nada do google.com nem de outros sites", () => {
    const text = toNetscape([
      cookie("SAPISID", ".youtube.com", { httpOnly: true }),
      cookie("SID", ".google.com"),
      cookie("track", ".evil-youtube.com.example"),
    ]);
    expect(text).toContain("#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2000000000\tSAPISID\tv-SAPISID");
    expect(text).not.toContain("google.com");
    expect(text).not.toContain("evil");
    expect(fileHasSession(text)).toBe(true);
    expect(fileHasSession(toNetscape([cookie("PREF", ".youtube.com")]))).toBe(false);
  });

  it("logado só com cookie de sessão do YouTube", () => {
    expect(isLoggedIn([cookie("SAPISID", ".youtube.com")])).toBe(true);
    expect(isLoggedIn([cookie("PREF", ".youtube.com")])).toBe(false);
  });

  it("a janela de login se apresenta como Chrome, sem Electron nem o app", () => {
    const ua = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 louvorja-violin/2.0.0 Chrome/140.0 Electron/41.0.0 Safari/537.36";
    expect(chromeUserAgent(ua)).toBe("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36");
  });

  it("entrar, consultar e sair", async () => {
    let jar = [];
    let ua = null;
    const session = {
      cookies: { get: async () => jar },
      clearStorageData: async () => (jar = []),
      setUserAgent: (v) => (ua = v),
    };
    const win = fakeWindow();
    const cookiesFile = path.join(dir, "youtube-cookies.txt");
    const account = createYoutubeAccount({
      session: () => session,
      cookiesFile,
      createWindow: () => win,
      userAgent: "X Chrome/1 Electron/2",
    });

    const done = account.login();
    expect(ua).toBe("X Chrome/1");
    // Ainda no meio do login: voltar ao YouTube sem sessão não fecha a janela.
    win.webContents.emit("did-navigate", {}, "https://www.youtube.com/");
    await new Promise((r) => setTimeout(r, 10));
    jar = [cookie("SAPISID", ".youtube.com"), cookie("SID", ".google.com")];
    win.webContents.emit("did-navigate", {}, "https://www.youtube.com/");
    expect(await done).toEqual({ loggedIn: true });
    expect(fs.readFileSync(cookiesFile, "utf8")).not.toContain("google.com");

    // Depois de reiniciar o app (sessão em memória vazia), o arquivo ainda diz quem entrou.
    jar = [];
    expect(await account.status()).toEqual({ loggedIn: true });

    // Cada execução do yt-dlp ganha uma cópia própria.
    const a = account.cookiesFor();
    const b = account.cookiesFor();
    expect(a).not.toBe(b);
    expect(fs.readFileSync(a, "utf8")).toContain("SAPISID");

    expect(await account.logout()).toEqual({ loggedIn: false });
    expect(fs.existsSync(cookiesFile)).toBe(false);
    expect(account.cookiesFor()).toBeUndefined();
  });

  it("fechar a janela sem entrar deixa sem conta", async () => {
    const session = { cookies: { get: async () => [] }, clearStorageData: async () => {}, setUserAgent: () => {} };
    const win = fakeWindow();
    const account = createYoutubeAccount({ session: () => session, cookiesFile: path.join(dir, "c.txt"), createWindow: () => win });
    const done = account.login();
    win.close();
    expect(await done).toEqual({ loggedIn: false });
  });
});
