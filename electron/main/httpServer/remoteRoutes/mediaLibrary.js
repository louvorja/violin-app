"use strict";

/**
 * Rotas da Biblioteca de Mídia no controle remoto.
 */
const path = require("path");
const { randomUUID } = require("crypto");
const fs = require("fs");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const paths = require("../../paths.js");
const { safeSend } = require("../../safeWebContents.js");
const { joinDentroDe } = require("../../mediaRoots.js");

/** PowerPoint enviado pelo celular: o PC converte (fontes + slides) antes de pôr na Biblioteca. */
const PPT_UPLOAD_EXT = ["pptx", "ppsx", "pptm", "ppt", "pps", "odp"];

function register(app, ctx) {
  const {
    getValidMainWindow,
    requestRenderer,
    requestRendererSilent,
    sendRendererError,
    getUserData,
    isPlainObject,
    hasMediaLibraryPermission,
    isMediaLibraryItemsResponse,
    isMediaLibraryCanvaResponse,
    isMediaLibraryCanvaExportResponse,
    isMediaLibraryPlaylistAddResponse,
    isMediaLibraryCommandResponse,
    isMediaLibraryImageResponse,
  } = ctx;

  // ---------------------------------------------------------------
  // /api/media-library — Biblioteca de Mídia (controle remoto)
  // GET  action=library|canva|image — acervo (IDB do renderer), itens do
  //      Canva (integração) e miniatura em binário
  // POST action=project|canva-project|playlist — projeta um item/design ou
  //      controla a playlist do desktop
  // POST /api/media-library/upload — stream de bytes do celular, gravado em
  //      <perfil>/library/media/ e registrado na biblioteca pelo renderer
  // Permission: media_library (ou root)
  // ---------------------------------------------------------------

  const MEDIA_LIBRARY_READ_ACTIONS = new Set(["library", "canva", "playlist", "image"]);
  const MEDIA_LIBRARY_ACTIONS = new Set([
    "project",
    "canva-project",
    "canva-export",
    "canva-clear-cache",
    "playlist",
  ]);
  const MEDIA_LIBRARY_COMMANDS = new Set([
    "add",
    "add-canva",
    "remove",
    "clear",
    "goto",
    "play",
    "next",
    "prev",
    "stop",
  ]);
  const MEDIA_LIBRARY_MAX_BYTES = 8 * 1024 * 1024;
  const MEDIA_LIBRARY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
  const MEDIA_LIBRARY_UPLOAD_MAX_BYTES = 300 * 1024 * 1024;
  // Espelha IMAGE_EXT/AUDIO_EXT/VIDEO_EXT do desktop (constants/FileTypes.ts)
  // + pdf. Áudio entra aqui porque a biblioteca passou a aceitá-lo: sem isso, o
  // celular receberia "extensão não suportada" para um tipo que o desktop aceita.
  const MEDIA_LIBRARY_EXT = [
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "heic", "heif",
    "mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus",
    "mp4", "webm", "mkv", "mov", "avi", "m4v",
    "pdf",
    ...PPT_UPLOAD_EXT,
  ];

  /** Extensão aceita de um nome de arquivo (sem o ponto: "jpg"). */
  function mediaLibraryExt(fileName) {
    const ext = String(fileName || "")
      .split(/[?#]/)[0]
      .split(".")
      .pop()
      ?.toLowerCase() || "";
    return MEDIA_LIBRARY_EXT.includes(ext) ? ext : "";
  }

  function mediaLibraryType(ext) {
    if (ext === "pdf") return "pdf";
    if (["mp4", "webm", "mkv", "mov", "avi", "m4v"].includes(ext)) return "video";
    if (["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus"].includes(ext)) return "audio";
    return "image";
  }

  app.get("/api/media-library", async (req, res) => {
    if (!hasMediaLibraryPermission(req)) {
      console.log("[httpServer] media-library → 403 (device sem a permission media_library)");
      return res.status(403).json({ error: "Device sem permissão da biblioteca de mídia" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const action = req.query.action || "library";
    if (!MEDIA_LIBRARY_READ_ACTIONS.has(action)) {
      return res
        .status(400)
        .json({ error: "action inválida para GET", valid: [...MEDIA_LIBRARY_READ_ACTIONS] });
    }

    if (action === "image") {
      // Miniatura: URLs http(s) (thumb do Canva) seguem redirecionamento —
      // o cliente carrega direto. O resto (louvorja://local, caminho absoluto
      // de import) busca os bytes no renderer pelo protocolo louvorja://.
      const raw = typeof req.query.url === "string" ? req.query.url : "";
      let url;
      try {
        url = decodeURIComponent(raw);
      } catch {
        url = raw;
      }
      if (!url) {
        return res.status(400).json({ error: "url é obrigatória" });
      }
      if (/^https?:\/\//i.test(url)) {
        res.set("Location", url).status(302).end();
        return;
      }
      try {
        const image = await requestRenderer(
          mainWindow,
          res,
          "http:media-library",
          { action: "image", url },
          {
            prefix: "media-library",
            timeoutMs: 5_000,
            maxPayloadBytes: MEDIA_LIBRARY_IMAGE_MAX_BYTES,
            validatePayload: isMediaLibraryImageResponse,
          }
        );
        if (res.headersSent || res.writableEnded) return;
        if (!image.data) {
          return res.status(404).json({ error: "Miniatura não encontrada" });
        }
        const bytes = ArrayBuffer.isView(image.data)
          ? Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
          : Buffer.from(image.data);
        res.set("Content-Type", image.mime);
        res.set("Cache-Control", "private, max-age=86400");
        res.send(bytes);
      } catch (error) {
        console.warn(
          `[httpServer] media-library image falhou: ${error?.code || error?.message || error}`
        );
        sendRendererError(res, error, "Timeout ao buscar a miniatura");
      }
      return;
    }

    if (action === "playlist") {
      // A playlist vive no user_data (mesma chave do módulo no desktop) — o
      // main já tem o userData em mãos, então serve direto, sem round-trip:
      // funciona com o módulo fechado, que é o caso do controle remoto.
      const userData = typeof getUserData === "function" ? getUserData() : {};
      const salva = userData?.modules?.media_library?.playlist;
      const items = (Array.isArray(salva) ? salva : [])
        .slice(0, 500)
        .map((item) => ({
          id: String(item?.id ?? "").slice(0, 256),
          name: String(item?.name ?? "").slice(0, 500),
          type: String(item?.type ?? "image").slice(0, 32) || "image",
        }))
        .filter((item) => item.id);
      console.log(`[httpServer] media-library → playlist ok (${items.length} itens)`);
      return res.json({ status: "ok", items });
    }

    const lang = req.query.lang === "es" ? "es" : "pt";
    const payload =
      action === "canva"
        ? {
            action,
            folderId: typeof req.query.folderId === "string" ? req.query.folderId.trim().slice(0, 256) : "",
            view: typeof req.query.view === "string" ? req.query.view.trim().slice(0, 32) : "",
            ownership: typeof req.query.ownership === "string" ? req.query.ownership.trim().slice(0, 16) : "",
            continuation: typeof req.query.continuation === "string" ? req.query.continuation.trim().slice(0, 512) : "",
          }
        : { action: "library", lang };

    try {
      const data = await requestRenderer(
        mainWindow,
        res,
        "http:media-library",
        payload,
        {
          prefix: "media-library",
          timeoutMs: 8_000,
          maxPayloadBytes: MEDIA_LIBRARY_MAX_BYTES,
          validatePayload:
            action === "canva" ? isMediaLibraryCanvaResponse : isMediaLibraryItemsResponse,
        }
      );
      if (!res.headersSent && !res.writableEnded) {
        // Canva desconectado/erro do renderer: devolve o motivo real em 502
        // (o validador passa o envelope de erro de propósito).
        if (data.status === "error") {
          console.log(`[httpServer] media-library → canva falhou: ${data.error}`);
          return res.status(502).json({ error: data.error });
        }
        const count = Array.isArray(data?.items) ? data.items.length : 0;
        console.log(`[httpServer] media-library → ${action} ok (${count} itens)`);
        res.json(data);
      }
    } catch (error) {
      console.warn(
        `[httpServer] media-library → ${action} falhou: ${error?.code || error?.message || error}`
      );
      sendRendererError(res, error, "Timeout ao buscar a biblioteca de mídia");
    }
  });



  app.post("/api/media-library", async (req, res) => {
    if (!hasMediaLibraryPermission(req)) {
      console.log("[httpServer] media-library → 403 no comando (device sem a permission)");
      return res.status(403).json({ error: "Device sem permissão da biblioteca de mídia" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    const action = req.body && req.body.action;
    if (!MEDIA_LIBRARY_ACTIONS.has(action)) {
      return res
        .status(400)
        .json({ error: "action inválida", valid: [...MEDIA_LIBRARY_ACTIONS] });
    }

    if (action === "project") {
      const id = typeof req.body.id === "string" ? req.body.id.trim().slice(0, 256) : "";
      if (!id) {
        return res.status(400).json({ error: "id é obrigatório para project" });
      }
      try {
        const data = await requestRenderer(
          mainWindow,
          res,
          "http:media-library",
          { action: "project", id },
          {
            prefix: "media-library",
            timeoutMs: 5_000,
            maxPayloadBytes: 8_192,
            validatePayload: isMediaLibraryCommandResponse,
          }
        );
        if (!res.headersSent && !res.writableEnded) {
          if (data.status === "error") {
            return res.status(404).json({ error: data.error });
          }
          res.json({ status: "ok", action });
        }
      } catch (error) {
        console.warn(
          `[httpServer] media-library project falhou: ${error?.code || error?.message || error}`
        );
        sendRendererError(res, error, "Timeout ao projetar o item");
      }
      return;
    }

    if (action === "canva-project") {
      const designId = typeof req.body.designId === "string" ? req.body.designId.trim().slice(0, 256) : "";
      // Item imagem do Canva não tem design: projeta a própria URL de thumbnail
      // na janela de site (mesmo caminho do "ao vivo").
      const url = typeof req.body.url === "string" ? req.body.url.trim().slice(0, 4096) : "";
      const kind = req.body.kind === "image" ? "image" : "design";
      if (designId) {
        // Export PDF/site pode levar minutos (poll do Canva): o comando é
        // disparado e o desktop acompanha na própria UI — sem round-trip.
        safeSend(mainWindow, "http:media-library", { action: "canva-project", designId, kind });
        return res.json({ status: "ok", action });
      }
      if (url && /^https?:\/\//i.test(url)) {
        safeSend(mainWindow, "http:media-library", { action: "canva-project", url });
        return res.json({ status: "ok", action });
      }
      return res.status(400).json({ error: "designId ou url é obrigatório para canva-project" });
    }

    if (action === "canva-export") {
      // Exporta sem projetar — o botão do card. Round-trip porque o job leva
      // até ~1 min e o cliente precisa saber se o arquivo saiu.
      const designId = typeof req.body.designId === "string" ? req.body.designId.trim().slice(0, 256) : "";
      if (!designId) {
        return res.status(400).json({ error: "designId é obrigatório para canva-export" });
      }
      const format = req.body.format === "jpg" ? "jpg" : "pdf";
      try {
        const data = await requestRenderer(
          mainWindow,
          res,
          "http:media-library",
          { action: "canva-export", designId, format },
          {
            prefix: "media-library",
            timeoutMs: 30_000,
            maxPayloadBytes: 8_192,
            validatePayload: isMediaLibraryCanvaExportResponse,
          }
        );
        if (!res.headersSent && !res.writableEnded) {
          if (data.status === "error") {
            return res.status(502).json({ error: data.error });
          }
          res.json({
            status: "ok",
            cached: data.cached === true,
            ...(typeof data.title === "string" ? { title: data.title } : {}),
            ...(Number.isInteger(data.pageCount) ? { pageCount: data.pageCount } : {}),
          });
        }
      } catch (error) {
        console.warn(
          `[httpServer] media-library canva-export falhou: ${error?.code || error?.message || error}`
        );
        sendRendererError(res, error, "Timeout ao exportar o design do Canva");
      }
      return;
    }

    if (action === "canva-clear-cache") {
      const designId = typeof req.body.designId === "string" ? req.body.designId.trim().slice(0, 256) : "";
      if (!designId) {
        return res.status(400).json({ error: "designId é obrigatório para canva-clear-cache" });
      }
      try {
        const data = await requestRenderer(
          mainWindow,
          res,
          "http:media-library",
          { action: "canva-clear-cache", designId },
          {
            prefix: "media-library",
            timeoutMs: 10_000,
            maxPayloadBytes: 8_192,
            validatePayload: isMediaLibraryCommandResponse,
          }
        );
        if (!res.headersSent && !res.writableEnded) {
          if (data.status === "error") {
            return res.status(502).json({ error: data.error });
          }
          res.json({ status: "ok", action });
        }
      } catch (error) {
        console.warn(
          `[httpServer] media-library canva-clear-cache falhou: ${error?.code || error?.message || error}`
        );
        sendRendererError(res, error, "Timeout ao limpar o cache do design");
      }
      return;
    }

    const command = req.body && req.body.command;
    if (!MEDIA_LIBRARY_COMMANDS.has(command)) {
      return res
        .status(400)
        .json({ error: "command inválido", valid: [...MEDIA_LIBRARY_COMMANDS] });
    }

    /*
     * `add-canva` é o único comando com resposta do renderer: no modo PDF ele
     * exporta o arquivo (JPG/PDF) antes de anexar, e isso leva até ~1 min —
     * o cliente precisa do item (ou do motivo) para saber se entrou.
     */
    if (command === "add-canva") {
      const designId = typeof req.body.designId === "string" ? req.body.designId.trim().slice(0, 256) : "";
      if (!designId) {
        return res.status(400).json({ error: "designId é obrigatório para add-canva" });
      }
      try {
        const data = await requestRenderer(
          mainWindow,
          res,
          "http:media-library",
          {
            action: "playlist",
            command: "add-canva",
            designId,
            kind: req.body.kind === "image" ? "image" : "design",
            name: typeof req.body.name === "string" ? req.body.name.trim().slice(0, 500) : "",
          },
          {
            prefix: "media-library",
            timeoutMs: 30_000,
            maxPayloadBytes: 8_192,
            validatePayload: isMediaLibraryPlaylistAddResponse,
          }
        );
        if (!res.headersSent && !res.writableEnded) {
          if (data.status === "error") {
            return res.status(502).json({ error: data.error });
          }
          res.json({ status: "ok", item: data.item });
        }
      } catch (error) {
        console.warn(
          `[httpServer] media-library add-canva falhou: ${error?.code || error?.message || error}`
        );
        sendRendererError(res, error, "Timeout ao adicionar o item do Canva à playlist");
      }
      return;
    }

    // `add` leva o id do item; `remove`/`goto` levam o índice na playlist.
    let extra = {};
    if (command === "add") {
      const id = typeof req.body.id === "string" ? req.body.id.trim().slice(0, 256) : "";
      if (!id) {
        return res.status(400).json({ error: "id é obrigatório para add" });
      }
      extra = { id };
    } else if (command === "remove" || command === "goto") {
      const index = req.body.index;
      if (!Number.isInteger(index) || index < 0 || index > 499) {
        return res.status(400).json({ error: "index deve ser um inteiro entre 0 e 499" });
      }
      extra = { index };
    }
    safeSend(mainWindow, "http:media-library", { action: "playlist", command, ...extra });
    res.json({ status: "ok", action, command });
  });



  // ---------------------------------------------------------------
  // POST /api/media-library/upload — o celular envia UM arquivo.
  //
  // Corpo: os bytes crus (Content-Type livre — o express.json global não
  // consome stream de outro type, então o pipe chega inteiro aqui).
  // Headers: X-File-Name (obrigatório, URL-encoded), X-Category-Id (opcional).
  //
  // O main grava em <perfil>/library/media/<id>.<ext> (tmp + rename) e
  // avisa o renderer para registrar na biblioteca — aí o item já projeta.
  // ---------------------------------------------------------------
  /*
   * PowerPoints do celular em conversão: o celular pergunta o andamento
   * (GET /api/media-library/phone-uploads) e mostra "Preparando os slides…" na
   * lista até o item ficar pronto. Concluído some em 10 minutos; com falha, o
   * arquivo enviado fica 7 dias para o celular tentar de novo sem reenviar.
   */
  const phoneUploads = new Map();
  /*
   * Arquivo e categoria de cada envio — só para o retry; não vai na resposta
   * do celular (não expõe caminho local).
   */
  const phoneUploadSources = new Map();
  const PHONE_UPLOAD_KEEP_MS = 10 * 60 * 1000;
  /** Falhou: guarda o arquivo e a mensagem para "Tentar de novo". */
  const PHONE_UPLOAD_RETRY_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
  /** `converting` sem fim (app fechou no meio) não fica preso na lista do celular. */
  const PHONE_UPLOAD_STALE_MS = 30 * 60 * 1000;

  function limparPhoneUploads() {
    const agora = Date.now();
    for (const [id, u] of phoneUploads) {
      const idade = agora - u.updatedAt;
      if (u.status === "converting") {
        if (idade > PHONE_UPLOAD_STALE_MS) {
          Object.assign(u, {
            status: "error",
            message: "A conversão não terminou. Tente de novo.",
            updatedAt: agora,
          });
        }
        continue;
      }
      const limite = u.status === "error" ? PHONE_UPLOAD_RETRY_KEEP_MS : PHONE_UPLOAD_KEEP_MS;
      if (idade <= limite) continue;
      phoneUploads.delete(id);
      const info = phoneUploadSources.get(id);
      phoneUploadSources.delete(id);
      if (info?.source) void fs.promises.unlink(info.source).catch(() => {});
    }
  }

  app.get("/api/media-library/phone-uploads", (req, res) => {
    if (!hasMediaLibraryPermission(req)) {
      return res.status(403).json({ error: "Device sem permissão da biblioteca de mídia" });
    }
    limparPhoneUploads();
    res.json({ uploads: [...phoneUploads.values()] });
  });

  /*
   * Falhou a conversão? O celular pede para tentar de novo sem reenviar o
   * arquivo (que continua em <perfil>/library/media até 7 dias).
   */
  app.post("/api/media-library/phone-uploads/:id/retry", async (req, res) => {
    if (!hasMediaLibraryPermission(req)) {
      return res.status(403).json({ error: "Device sem permissão da biblioteca de mídia" });
    }
    limparPhoneUploads();
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }
    const uploadId = typeof req.params?.id === "string" ? req.params.id : "";
    const atual = phoneUploads.get(uploadId);
    const info = phoneUploadSources.get(uploadId);
    if (!atual || !info) {
      return res.status(404).json({ error: "Envio não encontrado" });
    }
    if (atual.status === "converting") {
      return res.status(409).json({ error: "A conversão já está em andamento" });
    }
    const existe = await fs.promises
      .stat(info.source)
      .then((st) => st.isFile())
      .catch(() => false);
    if (!existe) {
      // Sumiu do disco: não há o que reconverter; o celular precisa reenviar.
      phoneUploads.delete(uploadId);
      phoneUploadSources.delete(uploadId);
      return res.status(410).json({ error: "O arquivo enviado não está mais disponível. Envie de novo." });
    }
    void converterPowerPointDoCelular(
      mainWindow,
      uploadId,
      info.source,
      info.fileName,
      info.categoryId
    );
    res.status(202).json({ status: "converting", uploadId, name: info.fileName });
  });

  /** Converte o PowerPoint que chegou do celular e registra o PDF na Biblioteca. */
  async function converterPowerPointDoCelular(mainWindow, uploadId, source, fileName, categoryId) {
    // Retry usa o mesmo arquivo: o envio não precisa ser repetido.
    phoneUploadSources.set(uploadId, { source, fileName, categoryId });
    const estado = { id: uploadId, name: fileName, status: "converting", phase: "fonts", done: 0, total: 0, message: "", itemId: null, updatedAt: Date.now() };
    phoneUploads.set(uploadId, estado);
    const atualizar = (patch) => Object.assign(estado, patch, { updatedAt: Date.now() });
    // O PC mostra o andamento na lista de tarefas em segundo plano.
    const avisar = (payload) =>
      safeSend(mainWindow, "http:media-library", { action: "phone-pptx", id: uploadId, name: fileName, ...payload });
    avisar({ status: "converting" });
    let ultimoAviso = 0;
    try {
      const pptx = require("../../pptx/index.js");
      const pref = getUserData()?.options?.file_projection?.presentation_engine;
      const engine = pref === "powerpoint" || pref === "libreoffice" ? pref : "auto";
      const r = await pptx.convert(source, {
        engine,
        onProgress: (p) => {
          safeSend(mainWindow, "pptx:progress", { path: source, ...p });
          if (!p || p.phase === "done") return;
          atualizar({
            phase: p.phase === "font" ? "fonts" : p.phase,
            ...(Number.isInteger(p.total) ? { done: p.done || 0, total: p.total } : {}),
          });
          const agora = Date.now();
          if (agora - ultimoAviso > 500) {
            ultimoAviso = agora;
            avisar({ status: "progress", phase: estado.phase, done: estado.done, total: estado.total });
          }
        },
      });
      if (!r || !r.ok) {
        const message = (r && r.message) || "Falha ao converter";
        // O arquivo enviado fica: o celular tenta de novo sem reenviar os bytes.
        atualizar({ status: "error", message });
        avisar({ status: "error", message });
        return;
      }
      const record = {
        id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: fileName,
        path: r.path,
        type: "pdf",
        addedAt: Date.now(),
        ...(categoryId ? { categoryId } : {}),
        pptx: {
          source,
          fonts: Array.isArray(r.fonts) ? r.fonts : [],
          features: r.features || null,
          nativeAvailable: r.nativeAvailable === true,
        },
      };
      /*
       * Só entra na Biblioteca depois do `put` no IndexedDB: o celular vê
       * "pronto" exatamente quando o item já pode ser listado. Sem `res` HTTP
       * pendente (a rota respondeu 202), usamos o round-trip silencioso.
       */
      let confirmacao = null;
      try {
        confirmacao = await requestRendererSilent(
          mainWindow,
          "http:media-library",
          { action: "saved", record },
          {
            prefix: "media-library",
            timeoutMs: 8_000,
            maxPayloadBytes: 8_192,
            validatePayload: (payload) =>
              isPlainObject(payload) &&
              (payload.status === "ok" ||
                (payload.status === "error" && typeof payload.error === "string")),
          }
        );
      } catch (error) {
        const message = `Falha ao registrar na Biblioteca: ${String(error?.message || error).slice(0, 240)}`;
        atualizar({ status: "error", message });
        avisar({ status: "error", message });
        return;
      }
      if (!confirmacao || confirmacao.status !== "ok") {
        const message = `Falha ao registrar na Biblioteca: ${String(confirmacao?.error || "sem confirmação").slice(0, 240)}`;
        atualizar({ status: "error", message });
        avisar({ status: "error", message });
        return;
      }
      atualizar({ status: "done", itemId: record.id });
      avisar({ status: "done" });
      phoneUploadSources.delete(uploadId);
      console.log(`[httpServer] media-library PowerPoint do celular convertido → ${r.path}`);
    } catch (error) {
      const message = String(error?.message || error).slice(0, 300);
      console.warn("[httpServer] media-library PowerPoint do celular falhou:", message);
      // Mesma regra da falha de conversão: mantém o envio para "Tentar de novo".
      atualizar({ status: "error", message });
      avisar({ status: "error", message });
    }
  }

  app.post("/api/media-library/upload", async (req, res) => {
    if (!hasMediaLibraryPermission(req)) {
      console.log("[httpServer] media-library upload → 403 (device sem a permission)");
      return res.status(403).json({ error: "Device sem permissão da biblioteca de mídia" });
    }
    const mainWindow = getValidMainWindow();
    if (!mainWindow) {
      return res.status(503).json({ error: "Janela principal não disponível" });
    }

    let rawName = typeof req.headers["x-file-name"] === "string" ? req.headers["x-file-name"] : "";
    try {
      rawName = decodeURIComponent(rawName);
    } catch {
      /* nome veio sem encode: usa como veio */
    }
    const fileName = path.basename(rawName.replace(/\\/g, "/").split("/").pop() || "").trim();
    const ext = mediaLibraryExt(fileName);
    if (!fileName || !ext) {
      return res.status(400).json({
        error: "X-File-Name inválido ou extensão não suportada",
        valid: MEDIA_LIBRARY_EXT,
      });
    }

    const dest = joinDentroDe(
      paths.privateMediaDir(),
      `upl_${randomUUID()}.${ext}`
    );
    if (!dest) {
      return res.status(500).json({ error: "Destino inválido no diretório de mídia" });
    }

    // Contador no pipe: `stream.pipeline` cuida do backpressure e do cleanup
    // (o laço manual com `once("drain"/"error")` vazava listener a cada chunk
    // pendurado no write stream).
    let received = 0;
    const tooLarge = new Error("arquivo grande demais");
    tooLarge.code = "TOO_LARGE";
    const counter = new Transform({
      transform(chunk, _enc, callback) {
        received += chunk.length;
        if (received > MEDIA_LIBRARY_UPLOAD_MAX_BYTES) {
          callback(tooLarge);
          return;
        }
        callback(null, chunk);
      },
    });

    const tmp = `${dest}.tmp`;
    let stream;
    try {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      stream = fs.createWriteStream(tmp, { flags: "wx", mode: 0o600 });
      await pipeline(req, counter, stream);
    } catch (error) {
      if (stream && !stream.destroyed) stream.destroy();
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
      if (error?.code === "TOO_LARGE") {
        req.destroy?.();
        return res.status(413).json({ error: "Arquivo excede o limite de 300 MB" });
      }
      // Celular desistiu no meio: não há para quem responder 500.
      if (error?.code === "ERR_STREAM_PREMATURE_CLOSE" || res.destroyed) {
        console.warn("[httpServer] media-library upload abortado pelo cliente");
        return;
      }
      console.warn("[httpServer] media-library upload falhou:", error?.message || error);
      return res.status(500).json({ error: "Falha ao gravar o arquivo" });
    }
    await fs.promises.rename(tmp, dest);

    const categoryId = typeof req.headers["x-category-id"] === "string"
      ? req.headers["x-category-id"].trim().slice(0, 256)
      : "";

    // PowerPoint: a conversão leva de segundos a minutos. O celular ouve "recebido"
    // (202) na hora; o PC converte com o programa escolhido em Opções e só então
    // o item entra na Biblioteca — o mesmo item que "Adicionar arquivos" criaria.
    if (PPT_UPLOAD_EXT.includes(ext)) {
      const uploadId = `pu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      res.status(202).json({ status: "converting", name: fileName, uploadId });
      void converterPowerPointDoCelular(mainWindow, uploadId, dest, fileName, categoryId);
      return;
    }

    const id = path.basename(dest, `.${ext}`);
    const record = {
      id,
      name: fileName,
      path: dest,
      type: mediaLibraryType(ext),
      addedAt: Date.now(),
      ...(categoryId ? { categoryId } : {}),
    };
    // Confirmação do registro: só depois do `put` no IndexedDB o item existe
    // de verdade — sem esperar, o cliente recarregava a lista antes da
    // gravação e o arquivo "sumia" até o próximo refresh.
    try {
      const confirmacao = await requestRenderer(
        mainWindow,
        res,
        "http:media-library",
        { action: "saved", record },
        {
          prefix: "media-library",
          timeoutMs: 5_000,
          maxPayloadBytes: 8_192,
          validatePayload: (payload) =>
            isPlainObject(payload) &&
            (payload.status === "ok" ||
              (payload.status === "error" && typeof payload.error === "string")),
        }
      );
      if (res.headersSent || res.writableEnded) return;
      if (confirmacao.status === "error") {
        console.warn("[httpServer] media-library upload → registro recusado:", confirmacao.error);
        return res.status(500).json({ error: confirmacao.error || "Falha ao registrar na biblioteca" });
      }
    } catch (error) {
      console.warn(
        `[httpServer] media-library upload: registro não confirmado: ${error?.code || error?.message || error}`
      );
      if (res.headersSent || res.writableEnded) return;
      sendRendererError(res, error, "Timeout ao registrar o arquivo na biblioteca");
      return;
    }

    console.log(`[httpServer] media-library upload ok (${received} bytes) → ${dest}`);
    res.status(201).json({ status: "ok", item: record });
  });
}

module.exports = { register };
