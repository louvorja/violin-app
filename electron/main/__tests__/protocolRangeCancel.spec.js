// @vitest-environment node
/**
 * `louvorja://local` com `Range`: o corpo pode ser cancelado a qualquer momento.
 *
 * Seek de vídeo, troca de slide e projeção fechada no meio deixam o stream do
 * disco continuar disparando eventos depois que o consumidor já foi embora. Com
 * o `try/catch` mudo em cada evento, fechar/errar/enfileirar um controller já
 * fechado lançava — e a exceção saía num tick, fora do `try/catch` de quem pediu
 * o arquivo, e aparecia na tela como "ReadableStream is already closed" sem um
 * único quadro do nosso código no stack.
 *
 * Aqui o contrato é: cancelar no meio e depois deixar o arquivo falar não causa
 * erro nenhum, e o corpo continua delivering enquanto ninguém cancela.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "fs-extra";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Path from "@/helpers/Path";

const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(join(tmpdir(), "louvorja-protocol-range-"));
const filesDir = join(root, "files");
const localFile = join(root, "video.mp4");
let handleRequest;

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub("electron", {
  protocol: {
    handle: (_scheme, handler) => {
      handleRequest = handler;
    },
  },
  app: { getAppPath: () => root },
});
stub("../paths.js", { filesDir: () => filesDir });
stub("../onlineVideo/index.js", { fileFor: () => null });

const protocol = require("../protocol.js");

/** Arquivo grande o bastante para a faixa não caber num único chunk. */
const ALTO = Buffer.alloc(512 * 1024, "a");

describe("faixa cancelada no meio", () => {
  beforeAll(async () => {
    fs.ensureDirSync(filesDir);
    fs.writeFileSync(localFile, ALTO);
    protocol.handle();
  });

  afterAll(() => {
    fs.removeSync(root);
  });

  it("sem Range, entrega o arquivo inteiro", async () => {
    const res = await handleRequest(new Request(Path.local(localFile)));
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(ALTO.length);
  });

  it("com Range, entrega só a faixa pedida", async () => {
    const res = await handleRequest(
      new Request(Path.local(localFile), { headers: { Range: "bytes=10-19" } })
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 10-19/${ALTO.length}`);
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  it("cancelar no meio não gera erro mesmo com o arquivo ainda falando", async () => {
    /* O caso real: o vídeo pede a faixa, seeks, e o `<video>` é removido —
       o stream do disco continua empurrando bytes para um corpo que ninguém
       mais vai ler. */
    const res = await handleRequest(
      new Request(Path.local(localFile), { headers: { Range: "bytes=0-" } })
    );
    const corpo = res.body;
    expect(corpo).toBeTruthy();

    /* Ler um pedaço e cancelar é o que o player faz ao buscar (seek) e sair. */
    const reader = corpo.getReader();
    await reader.read();
    await reader.cancel();

    /* Deixa o fs terminar de falar com o disco: nenhuma exceção pode escapar. */
    await new Promise((r) => setTimeout(r, 50));
    expect(res.bodyUsed).toBe(true);
  });

  it("cancelar antes de ler nada também é limpo", async () => {
    const res = await handleRequest(
      new Request(Path.local(localFile), { headers: { Range: "bytes=0-" } })
    );

    await expect(res.body.cancel()).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 50));
  });
});
