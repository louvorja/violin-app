"use strict";

/**
 * protocol.js — Registra o protocolo customizado `louvorja://`.
 *
 * Hosts suportados:
 *   louvorja://app/<caminho>       — assets do build Vue em dist/ (substitui file://)
 *   louvorja://json_db/<arquivo>   — proxy com cache para <api>/json_db
 *   louvorja://files/<caminho>     — arquivos locais em <dados>/files/ (populado em D3 via HTTPS)
 *   louvorja://onlinevideo/<id>.mp4 — vídeos do YouTube baixados em dataDir/Videos/
 *   louvorja://onlinestream/<id>/video|audio — o vídeo do YouTube que ainda está baixando
 *
 * O protocolo é marcado como standard + secure para que fetch() e XHR funcionem
 * normalmente dentro do renderer sem erros de CORS/CSP. O host "app" existe
 * para que a app principal seja servida com origem real (não null como no
 * file://) — secure context, BroadcastChannel, fetch relativo, todos
 * funcionam sem hacks.
 *
 * Faz parte da Fase D2 — Cache de JSON do banco.
 */

// IMPORTANTE: importar `electron` (não desestruturar) — `protocol` e `net`
// só ficam disponíveis após `app.whenReady()`. Acessar via `require("electron")`
// dentro das funções resolve corretamente.
const electron = require("electron");
const { pathToFileURL } = require("url");
const fs = require("fs-extra");
const path = require("path");
const { randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const paths = require("./paths.js");
const jsonCache = require("./jsonCache.js");
const mediaResolver = require("./mediaResolver.js");
const { temSegmentoPai } = require("./mediaRoots.js");
const netHealth = require("./netHealth.js");
const apiConfig = require("./apiConfig.js");
const { buildCsp } = require("./csp.js");
const onlineVideo = require("./onlineVideo/index.js");
const storageAccess = require("./storageAccess.js");
const { ensureCollectionSubdirectory } = require("./sharedCollectionDirs.js");
const { publishCollectionFile } = require("./collectionPublication.js");
const audioRepair = require("./audioRepair/index.js");

// ---------------------------------------------------------------------------
// Configuração de URLs remotas
// ---------------------------------------------------------------------------

let _config = {
  databaseUrl: "",
  filesUrl: "",
  apiToken: "",
};

let _assinaturaLogada = "";

/**
 * Atualiza a configuração de URLs remotas.
 * Chamado pelo renderer via IPC logo após montar o app (main.js).
 *
 * @param {{ databaseUrl?: string, filesUrl?: string, apiToken?: string }} cfg
 */
function setRemoteConfig(cfg) {
  _config = { ..._config, ...cfg };
  apiConfig.setConfig(cfg);
  // Cada janela que monta reenvia a mesma config; só o que muda vira log.
  const assinatura = `${_config.databaseUrl}|${_config.filesUrl}`;
  if (assinatura !== _assinaturaLogada) {
    _assinaturaLogada = assinatura;
    console.log("[protocol] Remote config atualizada:", {
      databaseUrl: _config.databaseUrl,
      filesUrl: _config.filesUrl,
    });
  }
}

/**
 * Liga/desliga o auto-cache de mídia (S1). Quando OFF, stream remoto
 * passa direto para o renderer sem gravar no disco.
 */
let _autoCacheEnabled = true;
/**
 * MIME type por extensão (apenas para o host "local" onde criamos
 * Responses customizados com Range support).
 */
const _MIME_TYPES = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".oga": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".txt": "text/plain",
};
/**
 * Entrega um arquivo do disco respeitando o `Range` que o player pediu.
 *
 * `net.fetch(file://…)` não repassa esse cabeçalho: o áudio vinha inteiro, com
 * status 200, e o Chromium passava a tratar como duração da faixa apenas o
 * pedaço que já tinha em mãos. Avançar um slide para além disso encostava no
 * "fim" e encerrava o hino no meio do culto.
 */
async function _responderArquivo(caminho, request) {
  const stat = await fs.stat(caminho);
  const fileSize = stat.size;
  const reparo = audioRepair.forFile(caminho, stat);
  const rangeHeader = request.headers.get("range");
  const match = rangeHeader && rangeHeader.match(/^bytes=(\d+)-(\d*)$/);

  if (!match) {
    return new Response(reparo ? _corpoReparado(caminho, 0, fileSize - 1, reparo) : fs.createReadStream(caminho), {
      status: 200,
      headers: {
        "Content-Type": _getMimeType(caminho),
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const start = parseInt(match[1], 10);
  // O cliente pode pedir além do EOF sem conhecer o tamanho (RFC 9110, 14.1.2).
  // Corpo e cabeçalhos precisam descrever apenas os bytes que existem.
  const end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1;
  if (start >= fileSize || end < start) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}` },
    });
  }

  if (reparo) {
    return new Response(_corpoReparado(caminho, start, end, reparo), {
      status: 206,
      headers: {
        "Content-Type": _getMimeType(caminho),
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const stream = fs.createReadStream(caminho, { start, end });
  /*
   * Ciclo de vida do corpo da faixa, com uma bandeira em vez de `try/catch`
   * mudo em cada evento.
   *
   * O consumidor cancela a faixa o tempo todo — seek de vídeo, troca de slide,
   * projeção fechada no meio — e cada cancelamento deixa o controller em estado
   * fechado. O stream do disco, porém, CONTINUA disparando `data`/`end`/`error`
   * depois disso, e fechar (ou errar, ou enfileirar) um controller já fechado
   * lança. A exceção saía daqui num tick, fora do `try/catch` de quem pediu o
   * arquivo — o catch vazio escondia o local e sobrava só o
   * "ReadableStream is already closed" na tela.
   *
   * Com a bandeira, cada operação acontece no máximo uma vez e nenhuma
   * exceção escapa.
   *
   * A leitura acompanha o consumo: sem pausar quando a fila enche, o player
   * pedia `bytes=0-` e o main lia o vídeo inteiro para a memória, uma vez por
   * janela e por seek, e travava em coleta de lixo durante a projeção.
   */
  let encerrado = false;
  const readable = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => {
        if (encerrado) return;
        try {
          controller.enqueue(chunk);
          if (controller.desiredSize <= 0) stream.pause();
        } catch {
          // Consumer fechou o stream (seek/navegação) → para de ler do disco.
          encerrado = true;
          stream.destroy();
        }
      });
      stream.on("end", () => {
        if (encerrado) return;
        encerrado = true;
        try { controller.close(); } catch { /* fechado pelo consumidor */ }
      });
      stream.on("error", (err) => {
        if (encerrado) return;
        encerrado = true;
        try { controller.error(err); } catch { /* idem */ }
      });
    },
    pull() {
      stream.resume();
    },
    cancel() {
      encerrado = true;
      stream.destroy();
    },
  }, new CountQueuingStrategy({ highWaterMark: 16 }));

  return new Response(readable, {
    status: 206,
    headers: {
      "Content-Type": _getMimeType(caminho),
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
    },
  });
}

const _CHUNK_REPARADO = 64 * 1024;

/**
 * Corpo de `[start, end]` com os quadros de áudio recusados trocados por
 * silêncio (ver `audioRepair`). Lê sob demanda — só quando o player pede mais
 * — e não entrega bytes que a varredura ainda não conferiu.
 */
function _corpoReparado(caminho, start, end, reparo) {
  let fh = null;
  let pos = start;
  let fechado = false;
  // O teto vale para o pedido inteiro, não para cada pedaço: um salto para
  // longe do ponto conferido congelava o vídeo até a varredura chegar lá.
  let esperaRestante = audioRepair.CHUNK_WAIT_MAX_MS;
  const fechar = () => {
    if (fechado) return;
    fechado = true;
    fh?.close().catch(() => {});
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        if (!fh) {
          const aberto = await fs.promises.open(caminho, "r");
          if (fechado) {
            aberto.close().catch(() => {});
            return;
          }
          fh = aberto;
        }
        if (pos > end) {
          fechar();
          controller.close();
          return;
        }
        const n = Math.min(_CHUNK_REPARADO, end - pos + 1);
        const espera = reparo.waitFor(pos + n, esperaRestante);
        if (espera) {
          const inicio = Date.now();
          await espera;
          esperaRestante -= Date.now() - inicio;
        }
        if (fechado) return;
        const buf = Buffer.allocUnsafe(n);
        const { bytesRead } = await fh.read(buf, 0, n, pos);
        if (fechado) return;
        if (bytesRead === 0) {
          fechar();
          controller.close();
          return;
        }
        const chunk = bytesRead < n ? buf.subarray(0, bytesRead) : buf;
        reparo.apply(chunk, pos);
        pos += bytesRead;
        controller.enqueue(chunk);
      } catch (err) {
        fechar();
        try { controller.error(err); } catch { /* o player já encerrou */ }
      }
    },
    cancel() {
      fechar();
    },
  }, new CountQueuingStrategy({ highWaterMark: 16 }));
}

function _getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return _MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Caminho absoluto de um `louvorja://local/<caminho>`; `null` quando ele tenta
 * sair da pasta (`..`). O pathname vem percent-encoded (%20 → espaço).
 */
function _caminhoLocal(pathname) {
  let raw = decodeURIComponent(pathname);
  // Windows: strip leading / antes da letra de drive (/C:/... → C:/...)
  if (/^\/[A-Za-z]:\//.test(raw)) raw = raw.slice(1);
  return !raw || temSegmentoPai(raw) ? null : raw;
}

/**
 * Por que um arquivo local não pode ser entregue — `null` quando pode.
 *
 * Só ENOENT/ENOTDIR é "não existe". Sem permissão (pasta protegida do macOS,
 * ACL do Windows) e disco que não responde (unidade de rede, Google Drive sem
 * conexão) são outra coisa: dizer "não encontrado" mandava o operador procurar
 * um arquivo que está lá.
 */
async function _falhaLocal(caminho) {
  try {
    const st = await fs.stat(caminho);
    if (!st.isFile()) return { tipo: "not_found", code: "ENOTFILE" };
    await fs.access(caminho, fs.constants.R_OK);
    return null;
  } catch (e) {
    const code = typeof e?.code === "string" ? e.code : "UNKNOWN";
    if (code === "ENOENT" || code === "ENOTDIR") return { tipo: "not_found", code };
    if (code === "EACCES" || code === "EPERM") return { tipo: "permission", code };
    return { tipo: "unreadable", code };
  }
}

/** O status diz o motivo (o renderer só lê o status de uma origem cruzada). */
function _respostaDeFalhaLocal(falha) {
  const status = falha.tipo === "not_found" ? 404 : falha.tipo === "permission" ? 403 : 500;
  if (falha.tipo !== "not_found") {
    console.warn(`[protocol] local: ${falha.tipo} (${falha.code})`);
  }
  return new Response(falha.tipo, {
    status,
    headers: { "X-Louvorja-File-Error": falha.tipo, "X-Louvorja-File-Code": falha.code },
  });
}

/** O mesmo caminho que o host `local` serve, para quem recebe só a URL. */
function localPathFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "louvorja:" || parsed.host !== "local") return null;
    return _caminhoLocal(parsed.pathname || "/");
  } catch {
    return null;
  }
}

function setAutoCacheEnabled(enabled) {
  _autoCacheEnabled = !!enabled;
}

/**
 * Endereço novo de um arquivo pessoal que ficou num endereço antigo.
 *
 * Cache do Canva e anexos moraram dentro da pasta de dados única e agora vivem
 * no perfil privado. URLs guardadas antes da mudança continuam apontando para o
 * endereço velho. A que dói é o `LJ_FILE_PROJECTION` do telão: reabrir a última
 * projeção cairia num arquivo inexistente e a tela ficaria vazia até o operador
 * projetar de novo. Só vale para um ARQUIVO dentro de uma origem conhecida.
 *
 * @param {string} absoluto
 * @returns {string|null}
 */
function _enderecoNovoPrivado(absoluto) {
  try {
    const alvo = path.resolve(absoluto);
    for (const { from, to } of paths.privatePathMappings()) {
      const origem = path.resolve(from);
      if (alvo.startsWith(`${origem}${path.sep}`)) return path.join(to, path.relative(origem, alvo));
    }
  } catch (_) {
    /* Sem layout legível não há endereço antigo a procurar. */
  }
  return null;
}

/**
 * Resposta remota que o player pode abandonar no meio. O Electron cancela o
 * corpo que devolvemos quando o player desiste do trecho (busca dentro da
 * faixa, troca de versão), mas não repassa isso à resposta do `net.fetch`: o
 * pedido ao servidor seguia aberto, os abandonados enchiam a janela da conexão
 * com dados que ninguém lia e o trecho seguinte não chegava — a música parava.
 */
function _abandonableResponse(response, abort) {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        try { controller.error(error); } catch { /* o player já encerrou */ }
      }
    },
    cancel() {
      abort.abort();
      reader.cancel().catch(() => {});
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** O streaming permanece privado; só o arquivo completo é publicado no acervo. */
async function _writeStreamToFile(readable, finalPath) {
  const root = paths.filesDir();
  const shared = storageAccess.status().media?.shared === true;
  const workDir = path.join(paths.dataDir(), "temp", "downloads");
  await fs.ensureDir(workDir, { mode: 0o700 });
  const tmp = path.join(workDir, `autocache-${randomUUID()}.partial`);
  try {
    await ensureCollectionSubdirectory(root, path.dirname(finalPath), { shared });
    await pipeline(Readable.fromWeb(readable), fs.createWriteStream(tmp, { flags: "wx", mode: 0o600 }));
    await publishCollectionFile(tmp, finalPath, { root, shared,
      cancelled: () => !storageAccess.canWrite("media"),
    });
    console.log("[protocol] Auto-cached:", finalPath);
  } finally { await fs.remove(tmp); }
}

// ---------------------------------------------------------------------------
// Registro do scheme (antes do app.whenReady)
// ---------------------------------------------------------------------------

/**
 * Registra `louvorja://` como scheme privilegiado.
 * DEVE ser chamado antes de `app.whenReady()`.
 */
function register() {
  electron.protocol.registerSchemesAsPrivileged([
    {
      scheme: "louvorja",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

// ---------------------------------------------------------------------------
// Handler do protocolo (após app.whenReady)
// ---------------------------------------------------------------------------

/**
 * Instala o handler para `louvorja://`.
 * DEVE ser chamado dentro de `app.whenReady()`.
 */
function handle() {
  electron.protocol.handle("louvorja", async (request) => {
    try {
      const url = new URL(request.url);
      const host = url.host; // "app" | "json_db" | "files"
      const pathname = url.pathname || "/";

      // ------------------------------------------------------------------
      // louvorja://app/<caminho>
      // Serve assets do build Vue (dist/). Substitui file:// para que
      // a origem do renderer não seja null.
      // ------------------------------------------------------------------
      if (host === "app") {
        const distDir = path.join(electron.app.getAppPath(), "dist");
        const cleaned = pathname.replace(/^\/+/, "") || "index.html";
        const localPath = path.resolve(distDir, cleaned);

        if (!localPath.startsWith(distDir + path.sep) && localPath !== distDir) {
          console.warn("[protocol] app: path traversal bloqueado:", pathname);
          return new Response("Forbidden", { status: 403 });
        }

        // CSP defense-in-depth: aplica política estrita para páginas que NÃO
        // são projeção de vídeo (YouTube IFrame API precisa de 'unsafe-inline').
        const isFileVideoProjection = url.hash?.startsWith("#/projection/file");
        const response = (await fs.pathExists(localPath))
          ? await electron.net.fetch(pathToFileURL(localPath).toString())
          : await electron.net.fetch(pathToFileURL(path.join(distDir, "index.html")).toString());

        if (response.status === 404) {
          return response;
        }

        if (!isFileVideoProjection) {
          const csp = buildCsp("prod-desktop");
          return new Response(response.body, {
            status: response.status,
            headers: {
              ...Object.fromEntries(response.headers),
              "Content-Security-Policy": csp,
            },
          });
        }

        return response;
      }

      // ------------------------------------------------------------------
      // louvorja://json_db/<arquivo>
      // Serve JSON com cache em <dados>/json_db/
      // ------------------------------------------------------------------
      if (host === "json_db") {
        const headers = {
          "Api-Token": _config.apiToken,
        };

        try {
          const result = await jsonCache.fetchJson(
            pathname,
            _config.databaseUrl,
            headers,
            { fresh: url.searchParams.get("fresh") === "1" || url.searchParams.has("_") || pathname === "/config" }
          );

          if (result.status === 404) {
            return new Response("Not found", { status: 404 });
          }

          return new Response(result.body, {
            status: result.status || 200,
            headers: {
              "Content-Type": result.contentType,
              "X-Cache": result.fromCache ? "HIT" : "MISS",
            },
          });
        } catch (e) {
          console.error(`[protocol] Erro ao buscar JSON em ${pathname}:`, e);
          // A API não foi alcançada: diz isso ao renderer em vez de um 500 que ele
          // leria como defeito do servidor e mostraria num diálogo.
          if (e && e.networkFailure) {
            return new Response(e.message || "Network unavailable", {
              status: 503,
              headers: { "X-Network-Error": "1" },
            });
          }
          return new Response(e.message || "JSON Cache Error", { status: 500 });
        }
      }

      // ------------------------------------------------------------------
      // louvorja://onlinevideo/<id>.mp4
      // Vídeo do YouTube já baixado para o cache local. O ID tem formato
      // fixo, então nada que chegue aqui vira caminho fora do cache.
      // ------------------------------------------------------------------
      if (host === "onlinevideo") {
        const m = /^\/([A-Za-z0-9_-]{11})\.mp4$/.exec(pathname);
        const file = m ? await onlineVideo.fileFor(m[1]) : null;
        if (!file) return new Response("Not found", { status: 404 });
        return await _responderArquivo(file, request);
      }

      // ------------------------------------------------------------------
      // louvorja://onlinestream/<id>/video | audio
      // O vídeo do YouTube que ainda está baixando: as janelas leem, por Range,
      // do arquivo que o main vai preenchendo — uma cópia só para todas. Só
      // atende ID de formato fixo e as duas trilhas conhecidas.
      // ------------------------------------------------------------------
      if (host === "onlinestream") {
        const m = /^\/([A-Za-z0-9_-]{11})\/(video|audio)$/.exec(pathname);
        const served = m ? onlineVideo.serveStream(m[1], m[2], request) : null;
        if (!served) {
          console.warn("[protocol] onlinestream sem sessão para:", pathname);
          return new Response("Not found", { status: 404 });
        }
        return new Response(served.body, { status: served.status, headers: served.headers });
      }

      // ------------------------------------------------------------------
      // louvorja://files/<caminho>
      // Serve arquivos locais de <dados>/files/. Se faltar, busca remoto
      // E grava no disco em paralelo (auto-cache S1) — exceto para Range
      // requests (não cacheamos partials).
      // ------------------------------------------------------------------
      if (host === "files") {
        // Decodifica o pathname para resolver corretamente no filesystem.
        // Sem isso, caracteres especiais (%20, %C3%A1, etc.) ficam literais
        // no caminho e criam pastas duplicadas (ex: "Adoradores%205" ao lado
        // de "Adoradores 5"). O host "local" já faz decode — aqui aplicamos
        // o mesmo padrão.  decodeURIComponent pode falhar em URIs malformadas;
        // nesse caso usamos o pathname cru como fallback.
        let rawRelative;
        try {
          rawRelative = decodeURIComponent(pathname).replace(/^\/+/, "");
        } catch {
          rawRelative = pathname.replace(/^\/+/, "");
        }
        // Onde gravar, se for preciso baixar. Também é o guard de path
        // traversal: fora da pasta de dados, devolve null.
        const localPath = mediaResolver.resolveWrite(rawRelative);
        if (!localPath) {
          console.warn("[protocol] Path traversal bloqueado:", pathname);
          return new Response("Forbidden", { status: 403 });
        }

        // Prioriza o que já está no disco, em qualquer origem de leitura: a
        // pasta de dados e, quando configurado, o acervo da versão clássica —
        // aceitando .mp3 onde o banco pede .opus, e .bmp onde pede .jpg.
        const achado = await mediaResolver.resolveRead(rawRelative);
        if (achado) {
          return await _responderArquivo(achado.path, request);
        }

        // Fallback: stream remoto. Cacheia se for request "completo" (sem Range).
        if (_config.filesUrl) {
          let sourceUrl = null;
          try {
            const candidate = url.searchParams.get("source");
            if (candidate && /^https?:\/\//i.test(candidate)) sourceUrl = candidate;
          } catch {
            sourceUrl = null;
          }
          const remoteUrl = sourceUrl ||
            _config.filesUrl + (pathname.startsWith("/") ? pathname : "/" + pathname);
          const rangeHeader = request.headers.get("range");
          const isRangeRequest = !!rangeHeader;
          const headers = _config.apiToken ? { "Api-Token": _config.apiToken } : {};
          // Sem repassar o Range, o servidor devolve 200 com a faixa inteira e o
          // player conclui que não dá para navegar nela: a duração vira o pedaço
          // que chegou, e pular um slide adiante encosta nesse "fim".
          if (rangeHeader) headers.Range = rangeHeader;

          try {
            const abort = new AbortController();
            const response = await electron.net.fetch(remoteUrl, { headers, signal: abort.signal });
            // Resposta é resposta: mesmo um 404 prova que o servidor respondeu.
            netHealth.report(true, "protocol");

            if (!response.ok || response.status !== 200 || isRangeRequest) {
              return _abandonableResponse(response, abort); // não cacheamos parciais nem erros
            }

            if (!_autoCacheEnabled || !require("./storageAccess.js").canWrite("media") || !response.body) {
              return _abandonableResponse(response, abort);
            }

            // Tee: uma branch vai ao renderer; a outra usa temporário privado.
            const [forRenderer, forDisk] = response.body.tee();
            _writeStreamToFile(forDisk, localPath).catch((e) =>
              console.warn("[protocol] Auto-cache falhou:", e.message || e)
            );

            return new Response(forRenderer, {
              status: 200,
              headers: response.headers,
            });
          } catch (fetchErr) {
            // De propósito não reporta falha ao netHealth: aqui passa arquivo a
            // arquivo, e uma requisição pode morrer por motivo que nada tem a
            // ver com a rede — o renderer cancelou ao trocar de slide, o nome
            // tem caractere que o servidor recusa, o arquivo não existe lá.
            // Contar isso como internet fora acendia o aviso de "sem conexão"
            // no meio de um culto com a rede perfeita. O sinal de falha fica
            // com o catálogo (jsonCache) e com a sondagem explícita.
            console.warn("[protocol] Falha ao buscar remoto:", remoteUrl, fetchErr.message);
            return new Response("File not found locally and remote fetch failed", { status: 404 });
          }
        }

        return new Response("File not found", { status: 404 });
      }

      // ------------------------------------------------------------------
      // louvorja://local/<caminho-absoluto>
      // Serve arquivos de caminhos absolutos arbitrários (liturgia,
      // arrastar/soltar, etc). Ex:
      //   louvorja://local/Users/diego/Music/song.mp3          (Unix)
      //   louvorja://local/C:/Users/diego/Music/song.mp3       (Windows)
      //
      // O pathname (ex: /Users/diego/Music/song.mp3) é o caminho
      // absoluto real (a `/` inicial já faz parte do path Unix).
      // ------------------------------------------------------------------
      if (host === "local") {
        const raw = _caminhoLocal(pathname);
        if (!raw) {
          console.warn("[protocol] local: path traversal bloqueado:", pathname);
          return new Response("Forbidden", { status: 403 });
        }

        const falha = await _falhaLocal(raw);
        if (falha?.tipo === "not_found") {
          /* Arquivo pessoal no endereço antigo: serve do novo. */
          const migrado = _enderecoNovoPrivado(raw);
          if (migrado && !(await _falhaLocal(migrado))) {
            return await _responderArquivo(migrado, request);
          }
        }
        if (falha) return _respostaDeFalhaLocal(falha);

        return await _responderArquivo(raw, request);
      }

      // Host desconhecido
      return new Response(`louvorja:// host desconhecido: "${host}"`, {
        status: 404,
      });
    } catch (e) {
      console.error("[protocol] Erro interno:", e);
      return new Response(e.message || "Internal error", { status: 500 });
    }
  });

  console.log("[protocol] Handler louvorja:// registrado.");
}

/**
 * Retorna a config atual de URLs remotas. Usado pelo bridge SSE
 * (httpServer/events.js) para traduzir `louvorja://files/...` em URLs HTTPS
 * que clients remotos (OBS, celular) consigam carregar — eles não conhecem
 * o protocolo customizado do Electron.
 */
function getRemoteConfig() {
  return { ..._config };
}

module.exports = {
  register,
  handle,
  setRemoteConfig,
  getRemoteConfig,
  setAutoCacheEnabled,
  localPathFromUrl,
};
