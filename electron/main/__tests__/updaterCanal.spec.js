// @vitest-environment node
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import Module from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const updaterPath = require.resolve("../updater.js");
const ORIGINAL_LOAD = Module._load;
const DOWNLOAD = "https://github.com/louvorja/violin-app/releases/download/";

/** `releases` é o que a API do GitHub responde; `null` simula a API fora do ar. */
function carregar({ instalada, releases }) {
  const nativo = new EventEmitter();
  nativo.isUpdaterActive = () => true;
  nativo.setFeedURL = vi.fn();
  nativo.checkForUpdates = vi.fn(async () => {});
  Module._load = function (request, ...args) {
    if (request === "electron") return { app: { getVersion: () => instalada } };
    if (request === "electron-updater") {
      return { autoUpdater: nativo, CancellationToken: class extends EventEmitter {} };
    }
    if (request === "https" || request === "http") {
      return {
        get: (_url, _opts, callback) => {
          const req = new EventEmitter();
          req.setTimeout = () => {};
          req.destroy = () => {};
          setImmediate(() => {
            const res = new EventEmitter();
            res.statusCode = releases ? 200 : 403;
            res.headers = {};
            res.resume = () => {};
            callback(res);
            res.emit("data", Buffer.from(releases ? JSON.stringify(releases) : "rate limit"));
            res.emit("end");
          });
          return req;
        },
      };
    }
    return ORIGINAL_LOAD.call(this, request, ...args);
  };
  delete require.cache[updaterPath];
  return { updater: require(updaterPath), nativo };
}

const rel = (tag, extra = {}) => ({ tag_name: tag, prerelease: tag.includes("-"), draft: false, ...extra });

afterEach(() => {
  Module._load = ORIGINAL_LOAD;
  delete require.cache[updaterPath];
  vi.restoreAllMocks();
});

describe("escolha da release por semver, de qualquer canal", () => {
  it("quem está numa beta recebe uma rc (o GitHubProvider a ignoraria)", async () => {
    const { updater, nativo } = carregar({
      instalada: "2.0.0-beta.18",
      releases: [rel("v2.0.0-rc.1"), rel("v2.0.0-beta.18"), rel("v2.0.0-beta.17")],
    });
    updater.init({ autoCheck: false, useBeta: true });
    await updater.checkForUpdates();
    expect(nativo.setFeedURL).toHaveBeenLastCalledWith({
      provider: "generic",
      url: `${DOWNLOAD}v2.0.0-rc.1`,
      useMultipleRangeRequest: false,
    });
    expect(nativo.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("quem está numa rc recebe a estável, mesmo com pré-versões ligadas", async () => {
    const { updater, nativo } = carregar({
      instalada: "2.0.0-rc.1",
      releases: [rel("v2.0.0"), rel("v2.0.0-rc.1")],
    });
    updater.init({ autoCheck: false, useBeta: true });
    await updater.checkForUpdates();
    expect(nativo.setFeedURL.mock.lastCall[0].url).toBe(`${DOWNLOAD}v2.0.0`);
  });

  it("com pré-versões desligadas, só a estável conta, e rascunho nunca", async () => {
    const { updater, nativo } = carregar({
      instalada: "2.0.0-beta.18",
      releases: [rel("v2.0.1", { draft: true }), rel("v2.1.0-rc.1"), rel("v2.0.0")],
    });
    updater.init({ autoCheck: false, useBeta: false });
    await updater.checkForUpdates();
    expect(nativo.setFeedURL.mock.lastCall[0].url).toBe(`${DOWNLOAD}v2.0.0`);
  });

  it("sem release elegível, responde 'sem atualização' sem acionar o electron-updater", async () => {
    const { updater, nativo } = carregar({
      instalada: "2.0.0-beta.18",
      releases: [rel("v2.0.0-rc.1"), rel("v2.0.0-beta.18")],
    });
    updater.init({ autoCheck: false, useBeta: false });
    const res = await updater.checkForUpdates();
    expect(res).toMatchObject({ ok: true, updateAvailable: false });
    expect(updater.status().status).toBe("not-available");
    expect(nativo.checkForUpdates).not.toHaveBeenCalled();
  });

  it("com a API do GitHub fora do ar, segue o GitHubProvider de antes", async () => {
    const { updater, nativo } = carregar({ instalada: "2.0.0-beta.18", releases: null });
    updater.init({ autoCheck: false, useBeta: true });
    await updater.checkForUpdates();
    expect(nativo.setFeedURL).toHaveBeenLastCalledWith({
      provider: "github",
      owner: "louvorja",
      repo: "violin-app",
    });
    expect(nativo.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("no Windows ARM o updater procura o metadata próprio (latest-arm64)", () => {
    const plataforma = Object.getOwnPropertyDescriptor(process, "platform");
    const arq = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    Object.defineProperty(process, "arch", { value: "arm64", configurable: true });
    try {
      const { updater, nativo } = carregar({ instalada: "2.0.0", releases: [] });
      updater.init({ autoCheck: false });
      /* Sem isto, a máquina ARM leria o latest.yml do x64 e trocaria a
       * instalação nativa pela emulada na próxima atualização. */
      expect(nativo.channel).toBe("latest-arm64");
    } finally {
      if (plataforma) Object.defineProperty(process, "platform", plataforma);
      if (arq) Object.defineProperty(process, "arch", arq);
    }
  });

  it("o status entrega a escolha efetiva de pré-versões para a tela", () => {
    const { updater } = carregar({ instalada: "2.0.0", releases: [] });
    updater.init({ autoCheck: false, useBeta: false });
    expect(updater.status().useBeta).toBe(false);
    updater.setOptions({ useBeta: true });
    expect(updater.status().useBeta).toBe(true);
  });
});
