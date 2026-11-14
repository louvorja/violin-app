"use strict";

// O worker faz I/O síncrono; os heartbeats dos leases ficam no main auxiliar,
// que continua processando timers. A resposta usa memória compartilhada para
// o worker aguardar sem depender do seu próprio event loop.
function createWorkerAcquire(port, { parentPid, waitMs = 1000 } = {}) {
  let nextId = 0;
  function request(operation, id, root) {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    port.postMessage({ type: "collection-lease", operation, id, root, signal: signal.buffer });
    while (Atomics.load(signal, 0) === 0) {
      Atomics.wait(signal, 0, 0, waitMs);
      if (parentPid) process.kill(parentPid, 0);
    }
    if (Atomics.load(signal, 0) !== 1) throw new Error("Não foi possível proteger a pasta para a cópia. Feche outras instâncias e confira as permissões de acesso.");
  }
  return (root) => {
    const id = ++nextId;
    request("acquire", id, root);
    return () => request("release", id, root);
  };
}

function createHostLeases(acquire) {
  const leases = new Map();
  function handle(message) {
    if (message?.type !== "collection-lease") return false;
    if (!(message.signal instanceof SharedArrayBuffer) || message.signal.byteLength !== 4) throw new Error("Resposta de proteção de pasta inválida.");
    const signal = new Int32Array(message.signal);
    let result = 2;
    try {
      if (!Number.isSafeInteger(message.id) || message.id <= 0) throw new Error("Identificador de proteção inválido.");
      if (message.operation === "acquire") {
        if (leases.has(message.id) || typeof message.root !== "string") throw new Error("Pedido de proteção inválido.");
        leases.set(message.id, acquire(message.root));
      } else if (message.operation === "release") {
        const release = leases.get(message.id);
        if (!release) throw new Error("Proteção desconhecida.");
        release();
        leases.delete(message.id);
      } else throw new Error("Operação de proteção inválida.");
      result = 1;
    } catch (error) { console.warn("[storage] Proteção da cópia indisponível:", error.message); }
    finally { Atomics.store(signal, 0, result); Atomics.notify(signal, 0); }
    return true;
  }
  function releaseAll() {
    for (const release of leases.values()) { try { release(); } catch { /* Encerrado ou indisponível. */ } }
    leases.clear();
  }
  return { handle, releaseAll };
}

module.exports = { createWorkerAcquire, createHostLeases };
