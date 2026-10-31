"use strict";

/**
 * converters — quem transforma o .pptx em PDF.
 *
 * Quem desenha é o PRÓPRIO programa de apresentação, então sai igual ao que o
 * operador vê no PowerPoint (desde que as fontes estejam instaladas — é o que
 * o `index.js` resolve antes de chamar aqui).
 *
 * Com o PowerPoint, cada slide sai como imagem e o PDF é montado só com essas
 * imagens. Um PDF "normal" do PowerPoint traz as fontes embutidas num formato
 * (CID TrueType) que o pdf.js da projeção não desenhou direito no Electron 41
 * — o título caía numa fonte qualquer. Com imagens não existe fonte a ler.
 *
 *   Windows → PowerPoint por PowerShell/COM;  sem PowerPoint → LibreOffice
 *   macOS   → PowerPoint por AppleScript;     sem PowerPoint → LibreOffice
 *   Linux   → LibreOffice (headless)
 */
const fs = require("fs/promises");
const fss = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const { runWindowsTask } = require("./windowsScript.js");
const { imagesToPdf } = require("./imagesPdf.js");

/** Largura das imagens dos slides (a altura segue a proporção do slide). */
const SLIDE_WIDTH_PX = 1920;

const MAC_PPT_APP = "/Applications/Microsoft PowerPoint.app";
/** O PowerPoint do Mac roda em sandbox: só lê/grava sem pedir permissão dentro do próprio container. */
const MAC_PPT_CONTAINER = path.join(os.homedir(), "Library", "Containers", "com.microsoft.Powerpoint", "Data");

/**
 * O macOS 27 (Golden Gate) deixou de perguntar e passou a negar, por padrão, o
 * acesso ao container de outro app. Sem a permissão em Ajustes → Privacidade e
 * Segurança → Arquivos e Pastas, o `mkdir` falha com EPERM/Operation not permitted.
 */
const MAC_PERMISSION_MESSAGE =
  "O macOS bloqueou o acesso do LouvorJA à pasta do PowerPoint. Abra Ajustes do Sistema → " +
  "Privacidade e Segurança → Arquivos e Pastas, procure o LouvorJA (ou Electron, no modo " +
  "de desenvolvimento) e permita o acesso ao Microsoft PowerPoint. Depois clique em Tentar de novo.";

/** O erro veio da proteção de container do macOS? */
function isPermissionError(e) {
  const code = e && (e.code || e.errno);
  if (code === "EPERM" || code === "EACCES" || code === 1 || code === 13) return true;
  return /operation not permitted|permission denied|não permitido|sem permissão/i.test(
    String((e && e.message) || "")
  );
}

function macPermissionError() {
  const err = new Error(MAC_PERMISSION_MESSAGE);
  err.code = "mac_permission";
  return err;
}

/**
 * Confere se o PowerPoint do Mac consegue usar a pasta de trabalho.
 *
 * A pasta fica dentro do container do PowerPoint para ele ler e gravar sem
 * pedir "Conceder acesso" a cada arquivo. No macOS 27, porém, o próprio
 * LouvorJA precisa de permissão para entrar nesse container; a sonda detecta
 * isso antes de qualquer trabalho pesado.
 *
 * @param {{tempDir?: string}} [opts]
 * @returns {Promise<{ok: true, base: string} | {ok: false, permission: boolean, base?: string}>}
 */
async function macStagingDisponivel(opts = {}) {
  const base = _existe(MAC_PPT_CONTAINER)
    ? path.join(MAC_PPT_CONTAINER, "tmp", "louvorja")
    : opts.tempDir;
  if (!base) return { ok: false, permission: false };
  try {
    await fs.mkdir(base, { recursive: true });
    // `mkdir` pode passar quando a pasta já existe; a sonda confirma a escrita.
    const probe = path.join(base, `.lj-write-${process.pid}-${Date.now()}`);
    await fs.writeFile(probe, "");
    await fs.unlink(probe).catch(() => {});
    return { ok: true, base };
  } catch (e) {
    if (isPermissionError(e)) return { ok: false, permission: true, base };
    throw e;
  }
}

function _exec(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || stdout || err.message).trim();
        reject(new Error(msg.slice(0, 600) || err.message));
      } else resolve(String(stdout));
    });
  });
}

const _existe = (p) => {
  try {
    return fss.existsSync(p);
  } catch {
    return false;
  }
};

/** Caminho do LibreOffice (`soffice`), ou null. */
function findSoffice(platform = process.platform) {
  const candidatos = [];
  if (platform === "win32") {
    for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "C:\\Program Files"]) {
      if (base) candidatos.push(path.join(base, "LibreOffice", "program", "soffice.exe"));
    }
  } else if (platform === "darwin") {
    candidatos.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  } else {
    candidatos.push("/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice", "/snap/bin/libreoffice", "/opt/libreoffice/program/soffice");
    try {
      for (const d of fss.readdirSync("/opt")) {
        if (/^libreoffice/i.test(d)) candidatos.push(path.join("/opt", d, "program", "soffice"));
      }
    } catch {
      /* sem /opt */
    }
  }
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (dir) candidatos.push(path.join(dir, platform === "win32" ? "soffice.exe" : "soffice"));
  }
  return candidatos.find(_existe) || null;
}

async function _windowsHasPowerPoint() {
  try {
    await _exec("reg", ["query", "HKCR\\PowerPoint.Application"], 15000);
    return true;
  } catch {
    return false;
  }
}

/** Programas que o operador pode escolher em Opções. */
const ENGINES = ["auto", "powerpoint", "libreoffice"];

/**
 * Depois de o macOS negar o container do PowerPoint, decide o que fazer.
 * No modo "auto" cai para o LibreOffice; escolhido "powerpoint", o operador
 * recebe a explicação em vez de uma troca silenciosa.
 * @param {{id: string, label?: string}} converter
 * @param {string} engine
 * @param {string|null} soffice
 */
function planoAposBloqueio(converter, engine, soffice) {
  if (converter.id !== "powerpoint") return { converter, fallback: false };
  if (engine === "auto" && soffice) {
    return { converter: { id: "libreoffice", label: "LibreOffice", soffice }, fallback: true };
  }
  return { converter: null, fallback: false, permission: true };
}

/**
 * Qual programa vai gerar/apresentar, respeitando a escolha do operador.
 *
 * "auto" prefere o PowerPoint (é quem desenha o .pptx igual ao original) e cai
 * no LibreOffice. Escolhido um programa que não está instalado, usa o outro e
 * avisa por `fallback`.
 * @param {string} [platform]
 * @param {string} [preferencia]  "auto" | "powerpoint" | "libreoffice"
 * @returns {Promise<{id: "powerpoint"|"libreoffice"|null, label: string, soffice?: string,
 *   preferido: string, fallback: boolean, disponiveis: {powerpoint: boolean, libreoffice: boolean}}>}
 */
async function detectConverter(platform = process.platform, preferencia = "auto") {
  const pref = ENGINES.includes(preferencia) ? preferencia : "auto";
  const temPowerPoint =
    (platform === "win32" && (await _windowsHasPowerPoint())) || (platform === "darwin" && _existe(MAC_PPT_APP));
  const soffice = findSoffice(platform);
  const disponiveis = { powerpoint: !!temPowerPoint, libreoffice: !!soffice };
  const pp = { id: "powerpoint", label: "PowerPoint" };
  const lo = { id: "libreoffice", label: "LibreOffice", soffice };
  let escolha = null;
  if (pref === "libreoffice") escolha = soffice ? lo : temPowerPoint ? pp : null;
  else escolha = temPowerPoint ? pp : soffice ? lo : null;
  if (!escolha) return { id: null, label: "", preferido: pref, fallback: false, disponiveis };
  return { ...escolha, preferido: pref, fallback: pref !== "auto" && pref !== escolha.id, disponiveis };
}

// ── PowerPoint no Windows ──────────────────────────────────────────────────
/**
 * Cópia do arquivo SEM a marca "baixado da internet".
 *
 * O Windows grava essa marca (Zone.Identifier) em tudo que vem do navegador,
 * WhatsApp ou e-mail, e o PowerPoint abre esses arquivos no "Modo de Exibição
 * Protegido" — onde a automação falha com um E_FAIL sem explicação. Copiar
 * byte a byte (stream, não CopyFile) gera um arquivo novo sem a marca; o
 * original do operador fica como está.
 */
async function _copiaSemMarca(input, dir) {
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `entrada${path.extname(input).toLowerCase()}`);
  await new Promise((resolve, reject) => {
    const r = fss.createReadStream(input);
    const w = fss.createWriteStream(dest);
    r.on("error", reject);
    w.on("error", reject);
    w.on("finish", resolve);
    r.pipe(w);
  });
  return dest;
}

async function _windowsPowerPoint(input, output, opts) {
  const outDir = path.join(opts.tempDir, `png-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    const copia = await _copiaSemMarca(input, path.join(outDir, "in"));
    const res = await runWindowsTask(
      "convert",
      {
        input: copia,
        outDir,
        width: SLIDE_WIDTH_PX,
        withWindow: !!opts.withWindow,
        restartIfIdle: !!opts.fontsChanged,
      },
      { tempDir: opts.tempDir, timeoutMs: 10 * 60 * 1000, onProgress: opts.onSlide }
    );
    const nomes = Array.isArray(res.files) ? res.files : res.files ? [res.files] : [];
    const imagens = nomes.map((n) => path.join(outDir, path.basename(String(n))));
    if (!imagens.length) throw new Error("O PowerPoint não exportou nenhum slide.");
    await imagesToPdf(imagens, output, { width: Number(res.slideWidth), height: Number(res.slideHeight) });
    return { staleFonts: !!res.staleFonts };
  } finally {
    fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── PowerPoint no Mac ──────────────────────────────────────────────────────
const MAC_SCRIPT = `
on run argv
  set inPath to item 1 of argv
  set outPath to item 2 of argv
  set restartIdle to (item 3 of argv) is "1"
  set inFile to POSIX file inPath
  set outFile to (POSIX file outPath) as text
  set wasRunning to application "Microsoft PowerPoint" is running
  set stale to "0"
  if wasRunning and restartIdle then
    tell application "Microsoft PowerPoint" to set n to count of presentations
    if n is 0 then
      tell application "Microsoft PowerPoint" to quit
      delay 2
      set wasRunning to false
    else
      set stale to "1"
    end if
  end if
  tell application "Microsoft PowerPoint"
    open inFile
    set pres to active presentation
    save pres in outFile as save as PNG
    close pres saving no
    if not wasRunning then quit
  end tell
  return stale
end run
`;

/** Último recurso no Mac: o PDF do próprio PowerPoint (texto, não imagem). */
const MAC_PDF_SCRIPT = `
on run argv
  set inFile to POSIX file (item 1 of argv)
  set outFile to (POSIX file (item 2 of argv)) as text
  set wasRunning to application "Microsoft PowerPoint" is running
  tell application "Microsoft PowerPoint"
    open inFile
    set pres to active presentation
    save pres in outFile as save as PDF
    close pres saving no
    if not wasRunning then quit
  end tell
end run
`;

/**
 * PDF → um PNG por página, pelo PDFKit do macOS (JavaScript for Automation).
 * argv: pdf, pasta de saída, largura em pixels. Devolve quantas páginas.
 */
const MAC_RASTER_SCRIPT = `
ObjC.import("Quartz");
ObjC.import("AppKit");
function run(argv) {
  var doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (!doc || doc.isNil()) return "0";
  var largura = parseInt(argv[2], 10) || 1920;
  var n = doc.pageCount;
  for (var i = 0; i < n; i++) {
    var page = doc.pageAtIndex(i);
    var b = page.boundsForBox(0);
    var esc = largura / b.size.width;
    var img = page.thumbnailOfSizeForBox($.NSMakeSize(Math.round(b.size.width * esc), Math.round(b.size.height * esc)), 0);
    var rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation);
    var png = rep.representationUsingTypeProperties(4, $.NSDictionary.dictionary);
    png.writeToFileAtomically(argv[1] + "/Slide" + (i + 1) + ".png", true);
  }
  return String(n);
}
`;

async function _macPowerPoint(input, output, opts) {
  // Igual ao Windows: cada slide vira PNG e o PDF é montado aqui.
  // Copia para dentro do container do PowerPoint: fora dele o macOS pede
  // "Conceder acesso" a cada arquivo novo e a automação fica parada esperando.
  // O `index.js` já confere a permissão; a checagem aqui cobre chamadas diretas
  // e o caso de a permissão ser revogada no meio do caminho.
  const staging = opts.stagingBase
    ? { ok: true, base: opts.stagingBase }
    : await macStagingDisponivel(opts);
  if (!staging.ok) throw macPermissionError();
  const base = staging.base;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpIn = path.join(base, `${id}${path.extname(input).toLowerCase()}`);
  const tmpOut = path.join(base, `${id}-slides`);
  const tmpPdf = path.join(base, `${id}.pdf`);
  const desde = Date.now() - 1000;
  const log = typeof opts.log === "function" ? opts.log : () => {};
  try {
    await fs.copyFile(input, tmpIn);
    const out = await _exec("osascript", ["-e", MAC_SCRIPT, tmpIn, tmpOut, opts.fontsChanged ? "1" : "0"], 10 * 60 * 1000);
    // O nome da pasta muda conforme a versão do PowerPoint: "<id>-slides/Slide1.png",
    // "<id>/Slide1.png" ou "<id>-slides.png". Tudo que começa com o id é desta conversão;
    // sem nada assim, vale qualquer PNG que apareceu na pasta durante a exportação.
    const todas = await _listarPngs(base);
    let imagens = todas.filter((f) => f.startsWith(path.join(base, id)));
    if (!imagens.length) imagens = await _novas(todas, desde);
    if (imagens.length) {
      await imagesToPdf(imagens, output);
      return { staleFonts: out.trim() === "1" };
    }
    // Sem imagens: o PDF do próprio PowerPoint, desenhado em imagem pelo próprio
    // macOS (PDFKit). O PDF de texto direto no pdf.js trocava as letras das fontes
    // do arquivo por símbolos ("!\"#$%&…"), igual acontecia no Windows.
    log("[pptx] mac: PNG não veio", { base, pngs: todas.length, saida: out.trim() });
    await _exec("osascript", ["-e", MAC_PDF_SCRIPT, tmpIn, tmpPdf], 10 * 60 * 1000);
    if (!_existe(tmpPdf)) {
      throw new Error(
        `O PowerPoint não exportou nenhum slide (pasta: ${base}; PNGs encontrados: ${todas.length}).`
      );
    }
    const rasterDir = path.join(base, `${id}-raster`);
    await fs.mkdir(rasterDir, { recursive: true });
    try {
      await _exec("osascript", ["-l", "JavaScript", "-e", MAC_RASTER_SCRIPT, tmpPdf, rasterDir, "1920"], 5 * 60 * 1000);
    } catch (e) {
      log("[pptx] mac: PDFKit não desenhou os slides:", e.message);
    }
    const desenhadas = await _listarPngs(rasterDir);
    if (desenhadas.length) {
      await imagesToPdf(desenhadas, output);
      return { staleFonts: out.trim() === "1" };
    }
    await fs.copyFile(tmpPdf, output);
    return { staleFonts: out.trim() === "1", pdfText: true };
  } catch (e) {
    if (e && e.code === "mac_permission") throw e;
    // Só trata como bloqueio do container o erro que aconteceu dentro dele.
    // Um EPERM ao gravar o PDF final é problema da pasta de dados, não do macOS.
    const alvo = String((e && e.path) || "");
    const destino = String((e && e.dest) || "");
    const noContainer = !alvo || alvo.startsWith(base) || destino.startsWith(base);
    if (isPermissionError(e) && noContainer) throw macPermissionError();
    if (/-1743|not authori[sz]ed|não autorizado/i.test(e.message)) {
      throw new Error(
        "O macOS bloqueou o controle do PowerPoint. Abra Ajustes do Sistema → Privacidade e Segurança → Automação e permita o LouvorJA controlar o Microsoft PowerPoint."
      );
    }
    throw e;
  } finally {
    fs.unlink(tmpIn).catch(() => {});
    fs.unlink(tmpPdf).catch(() => {});
    for (const nome of await fs.readdir(base).catch(() => [])) {
      if (nome.startsWith(id)) fs.rm(path.join(base, nome), { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** PNGs criados depois de `desde` (a exportação que acabou de rodar). */
async function _novas(arquivos, desde) {
  const out = [];
  for (const f of arquivos) {
    const st = await fs.stat(f).catch(() => null);
    if (st && st.mtimeMs >= desde) out.push(f);
  }
  return out;
}

/** PNGs de uma pasta (recursivo), na ordem natural: Slide2 antes de Slide10. */
async function _listarPngs(dir) {
  const out = [];
  for (const it of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) out.push(...(await _listarPngs(p)));
    else if (/\.png$/i.test(it.name)) out.push(p);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// ── LibreOffice (Linux, ou quem não tem PowerPoint) ───────────────────────
async function _libreOffice(input, output, opts) {
  const soffice = opts.soffice || findSoffice();
  if (!soffice) throw new Error("LibreOffice não encontrado.");
  const work = path.join(opts.tempDir, `lo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  // Perfil próprio: com um LibreOffice já aberto, o --headless entregaria o
  // trabalho para ele e voltaria sem converter nada.
  const profile = path.join(opts.tempDir, "lo-profile");
  await fs.mkdir(work, { recursive: true });
  const tmpIn = path.join(work, `apresentacao${path.extname(input).toLowerCase()}`);
  await fs.copyFile(input, tmpIn);
  try {
    await _exec(
      soffice,
      [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--convert-to",
        "pdf",
        "--outdir",
        work,
        tmpIn,
      ],
      10 * 60 * 1000
    );
    const pdf = path.join(work, "apresentacao.pdf");
    if (!_existe(pdf)) throw new Error("O LibreOffice não gerou o PDF.");
    await fs.copyFile(pdf, output);
    return { staleFonts: false };
  } finally {
    fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Converte. `output` é sobrescrito.
 * @param {{id: string, soffice?: string}} converter  vindo de `detectConverter`
 * @param {string} input
 * @param {string} output
 * @param {{tempDir: string, fontsChanged?: boolean, withWindow?: boolean, platform?: string,
 *   onSlide?: (p: {done: number, total: number}) => void}} opts  onSlide: contagem dos slides (PowerPoint no Windows)
 * @returns {Promise<{staleFonts: boolean}>}  staleFonts = o PowerPoint já estava com
 *   apresentação aberta e não pôde reiniciar para ler as fontes recém-instaladas
 */
async function convertToPdf(converter, input, output, opts) {
  const platform = opts.platform || process.platform;
  if (converter.id === "powerpoint") {
    return platform === "win32" ? _windowsPowerPoint(input, output, opts) : _macPowerPoint(input, output, opts);
  }
  if (converter.id === "libreoffice") return _libreOffice(input, output, { ...opts, soffice: converter.soffice });
  throw new Error("Nenhum conversor disponível.");
}

module.exports = {
  detectConverter,
  convertToPdf,
  findSoffice,
  isPermissionError,
  macStagingDisponivel,
  macPermissionError,
  planoAposBloqueio,
  MAC_PERMISSION_MESSAGE,
  ENGINES,
  MAC_SCRIPT,
  SLIDE_WIDTH_PX,
};
