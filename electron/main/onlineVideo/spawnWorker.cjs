"use strict";
// Abre o yt-dlp e o ffmpeg fora do processo principal. No Windows, criar o processo
// espera o antivírus examinar o executável — de 2 a 17 s nos perfis de out/2026 — e,
// feito no main, isso congela todas as janelas, a projeção inclusive.
const { spawn } = require("node:child_process");
const { killTree } = require("./runner.js");

/** A porta é injetada nos testes; em produção é a `parentPort` privada do Electron. */
function runWorker(port, { spawnImpl = spawn } = {}) {
  const children = new Map();
  const send = (message) => port.postMessage(message);

  function start({ id, bin, args, options }) {
    let closed = false;
    const close = (code, signal) => {
      if (closed) return;
      closed = true;
      children.delete(id);
      send({ id, type: "close", code, signal });
    };
    const fail = (error) => send({ id, type: "error", message: String(error?.message || error), code: error?.code });

    let child;
    try {
      child = spawnImpl(bin, args, options);
    } catch (error) {
      fail(error);
      close(-1, null);
      return;
    }
    children.set(id, child);
    send({ id, type: "spawn", pid: child.pid });
    // Cópia exata dos bytes: o Buffer do stream costuma ser uma fatia de um bloco maior.
    child.stdout?.on("data", (data) => send({ id, type: "stdout", data: new Uint8Array(data) }));
    child.stderr?.on("data", (data) => send({ id, type: "stderr", data: new Uint8Array(data) }));
    child.on("error", (error) => {
      fail(error);
      if (child.pid === undefined) close(-1, null);
    });
    child.on("close", close);
  }

  port.on("message", ({ data: message }) => {
    if (!message || !Number.isSafeInteger(message.id)) return;
    if (message.type === "spawn") start(message);
    else if (message.type === "kill") children.get(message.id)?.kill(message.signal);
    else if (message.type === "kill-tree") {
      const child = children.get(message.id);
      if (child) killTree(child);
    }
  });
  send({ type: "ready" });
}

if (process.parentPort) runWorker(process.parentPort);
module.exports = { runWorker };
