/**
 * Rota OPFS do Service Worker.
 *
 * O renderer nunca lê o OPFS para exibir mídia: ele pede
 * `<base>__opfs/<pasta>/<id>/<arquivo>` e este handler devolve o arquivo com
 * `Range`. É o que permite `<video>` fazer seek, PDF paginar e `<img>` funcionar
 * sem objectURL — e sem carregar o arquivo na memória.
 *
 * Só as quatro pastas de biblioteca são servidas. O caminho é validado aqui de
 * novo: o Service Worker é uma fronteira de URL, não confia no renderer.
 */
(function () {
  "use strict";

  var KINDS = {
    "media-library": true,
    "background-projection": true,
    "background-sound": true,
    "liturgy-files": true,
  };

  var MIME = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    m4v: "video/x-m4v",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
    aac: "audio/aac",
    m4a: "audio/mp4",
    wma: "audio/x-ms-wma",
    opus: "audio/ogg",
    pdf: "application/pdf",
    slja: "application/x-louvorja-slja",
  };

  function mimeOf(name) {
    var ext = String(name || "")
      .split(".")
      .pop()
      .toLowerCase();
    return MIME[ext] || "application/octet-stream";
  }

  function routePrefix() {
    try {
      return new URL("__opfs/", self.registration.scope).pathname;
    } catch (error) {
      return "/__opfs/";
    }
  }

  function segmentsOf(pathname, prefix) {
    var rest = pathname.slice(prefix.length);
    var parts;
    try {
      parts = rest.split("/").map(decodeURIComponent);
    } catch (error) {
      return null;
    }
    if (parts.length !== 3) return null;
    if (!KINDS[parts[0]]) return null;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(parts[1])) return null;
    if (!parts[2] || parts[2] === "." || parts[2] === "..") return null;
    if (parts[2].indexOf("\\") >= 0 || parts[2].indexOf("/") >= 0) return null;
    return parts;
  }

  async function fileAt(parts) {
    var root = await navigator.storage.getDirectory();
    var dir = await root.getDirectoryHandle("louvorja", { create: false });
    dir = await dir.getDirectoryHandle(parts[0], { create: false });
    dir = await dir.getDirectoryHandle(parts[1], { create: false });
    var handle = await dir.getFileHandle(parts[2], { create: false });
    return handle.getFile();
  }

  function parseRange(header, size) {
    var match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
    if (!match) return null;
    var start = match[1] ? parseInt(match[1], 10) : null;
    var end = match[2] ? parseInt(match[2], 10) : null;
    if (start === null && end === null) return null;
    if (start === null) {
      // bytes=-N: últimos N bytes
      start = Math.max(0, size - end);
      end = size - 1;
    } else {
      if (end === null || end >= size) end = size - 1;
    }
    if (start >= size || end < start) return { invalid: true };
    return { start: start, end: end };
  }

  async function handle(request, pathname, prefix) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    var parts = segmentsOf(pathname, prefix);
    if (!parts) return new Response("Forbidden", { status: 403 });

    var file;
    try {
      file = await fileAt(parts);
    } catch (error) {
      return new Response("Not Found", { status: 404 });
    }

    var headers = new Headers({
      "Content-Type": mimeOf(parts[2]),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Disposition": "inline",
    });

    if (request.method === "HEAD") {
      headers.set("Content-Length", String(file.size));
      return new Response(null, { status: 200, headers: headers });
    }

    var range = parseRange(request.headers.get("range"), file.size);
    if (range && range.invalid) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": "bytes */" + file.size },
      });
    }
    if (range) {
      var length = range.end - range.start + 1;
      headers.set("Content-Length", String(length));
      headers.set("Content-Range", "bytes " + range.start + "-" + range.end + "/" + file.size);
      return new Response(file.slice(range.start, range.end + 1).stream(), {
        status: 206,
        headers: headers,
      });
    }

    headers.set("Content-Length", String(file.size));
    return new Response(file.stream(), { status: 200, headers: headers });
  }

  self.addEventListener("fetch", function (event) {
    var url;
    try {
      url = new URL(event.request.url);
    } catch (error) {
      return;
    }
    var prefix = routePrefix();
    if (!url.pathname.startsWith(prefix)) return;
    event.respondWith(handle(event.request, url.pathname, prefix));
    // O Workbox registra outro listener de fetch; sem isto uma navegação
    // direta para __opfs poderia chamar respondWith duas vezes.
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  });
})();
