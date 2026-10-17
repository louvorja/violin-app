/**
 * @category helper-puro — `fetch` com prazo CANCELÁVEL, para o Canva.
 *
 * Existe por causa de um `AbortSignal.timeout()` que não pode ser cancelado: o
 * timer vive até disparar, mesmo com a resposta já lida. No poll de exportação
 * (uma requisição por segundo, até 60) isso deixa uma pilha de timers de 15 s
 * pendentes, e cada um que dispara tarde manda o undici fechar um corpo que já
 * estava fechado — `ERR_INVALID_STATE: ReadableStream is already closed`, que
 * sai num tick, fora do `try/catch` de quem chamou, e chega na tela como
 * exceção sem um único quadro do nosso código.
 *
 * Aqui o prazo cobre a operação inteira — cabeçalhos e corpo — e o timer só
 * some quando o corpo acabou de ser lido. O corpo também é lido DENTRO do
 * helper, pelo consumidor, e é cancelado se o consumidor sair sem ler (status
 * de erro, arquivo grande demais): conexão pendurada segura o socket até o GC.
 */

/**
 * Executa `fetch` sob prazo e entrega a resposta ao consumidor.
 *
 * O consumidor recebe a `Response` e devolve o que o chamador precisa; ler o
 * corpo é decisão dele, porque o teto por `Content-Length` precisa vir ANTES de
 * baixar o arquivo inteiro.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} ms            prazo da operação inteira, em ms
 * @param {(res: Response) => Promise<any>} consumidor
 * @returns {Promise<any>} o que o consumidor devolveu
 */
async function comPrazo(url, init, ms, consumidor) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`O Canva não respondeu em ${Math.round(ms / 1000)}s`));
  }, ms);

  let res;
  try {
    res = await fetch(url, { ...(init || {}), signal: controller.signal });
    return await consumidor(res);
  } finally {
    clearTimeout(timer);
    /*
     * O consumidor pode ter saído por status ou por tamanho sem tocar no
     * corpo. Sem este cancelamento a conexão fica pendurada até o GC decidir
     * unlikear — e é o que transforma um erro em vazamento de socket.
     */
    if (res && !res.bodyUsed && res.body) {
      void res.body.cancel().catch(() => {
        /* já fechado pelo undici */
      });
    }
  }
}

/** `fetch` sob prazo devolvendo o corpo já lido em `Uint8Array`. */
async function comPrazoBuffer(url, init, ms) {
  return comPrazo(url, init, ms, async (res) => {
    if (!res.ok) throw httpError(res, res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    return { res, buf };
  });
}

/** `fetch` sob prazo devolvendo o corpo já lido em `Uint8Array`. */
async function comPrazoJson(url, init, ms) {
  return comPrazo(url, init, ms, async (res) => {
    /*
     * Corpo ilegível vira `null` — quem chamou decide o que isso significa.
     * Status 2xx sem corpo é normal; status de erro sem corpo também.
     */
    const json = await res.json().catch(() => null);
    return { res, json };
  });
}

/** Erro de status no mesmo formato que o resto do Canva usa. */
function httpError(res, status, mensagem) {
  const erro = new Error(mensagem || `Erro ${status} do Canva.`);
  erro.code = "canva_" + status;
  erro.status = status;
  return erro;
}

module.exports = { comPrazo, comPrazoBuffer, comPrazoJson, httpError };
