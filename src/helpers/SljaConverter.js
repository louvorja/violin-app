/**
 * SljaConverter.js — Lê e escreve arquivos .slja (formato Delphi LouvorJA).
 *
 * O formato .slja é um ZIP com:
 *   slides.lja     — INI com seções [Geral] e [Slide:N]
 *   audio/<file>   — MP3 opcional
 *   imagens/<file> — imagens opcionais
 *
 * Convenção de codificação:
 *   - o INI é gravado em CP1252, como o Delphi faz: ele lê com TIniFile, ou
 *     seja, a API GetPrivateProfileString do Windows, que entende ANSI e
 *     UTF-16 — em UTF-8 os acentos chegam lá como mojibake
 *   - letra/letra_aux: pipe `|` representa quebra de linha (Delphi: \r\n)
 *   - cor: #RRGGBB (HTML hex)
 *   - tempo: posição em bytes do stream BASS decodificado, que é o campo que o
 *     Delphi lê ao importar; `tempo_hms` (HH:MM:SS) é o mesmo instante em forma
 *     legível e tem prioridade na leitura, por não depender da taxa do áudio
 *
 * @category helper-puro — Sem APIs Vue; sem acesso ao store.
 */

/**
 * A faixa 0x80–0x9F em ordem de byte — o único trecho em que o CP1252 diverge
 * de Latin-1. É onde moram as aspas curvas e o travessão que vêm colados do
 * Word. As cinco posições sem caractere ficam com o próprio código de controle.
 */
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

function cp1252Byte(codePoint) {
  if (codePoint < 0x80 || (codePoint >= 0xa0 && codePoint <= 0xff)) return codePoint;
  const index = CP1252_HIGH.indexOf(String.fromCodePoint(codePoint));
  return index < 0 ? -1 : 0x80 + index;
}

/**
 * Codifica o INI para os bytes que o Delphi espera — ver "Convenção de
 * codificação" no topo.
 *
 * O que não existe no CP1252 sai sem o acento (`ā` → `a`); o que nem assim
 * couber vira `?`, como em qualquer conversão para ANSI do Windows.
 */
function encodeCp1252(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const direct = cp1252Byte(ch.codePointAt(0));
    if (direct >= 0) {
      bytes.push(direct);
      continue;
    }
    let wrote = false;
    for (const base of ch.normalize("NFD").replace(/\p{M}+/gu, "")) {
      const mapped = cp1252Byte(base.codePointAt(0));
      if (mapped >= 0) {
        bytes.push(mapped);
        wrote = true;
      }
    }
    if (!wrote) bytes.push(0x3f);
  }
  return new Uint8Array(bytes);
}

/** 44100 Hz, estéreo, 16-bit — o formato do acervo, usado quando o header não diz. */
const DEFAULT_BYTES_PER_SECOND = 44100 * 2 * 2;

const MPEG_SAMPLE_RATES = {
  0: [11025, 12000, 8000], // MPEG 2.5
  2: [22050, 24000, 16000], // MPEG 2
  3: [44100, 48000, 32000], // MPEG 1
};

async function readMp3Format(blob) {
  const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());

  let offset = 0;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    offset =
      10 +
      (((head[6] & 0x7f) << 21) |
        ((head[7] & 0x7f) << 14) |
        ((head[8] & 0x7f) << 7) |
        (head[9] & 0x7f));
  }

  const buf = new Uint8Array(await blob.slice(offset, offset + 8192).arrayBuffer());
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;

    const rates = MPEG_SAMPLE_RATES[(buf[i + 1] >> 3) & 0x03];
    const layer = (buf[i + 1] >> 1) & 0x03;
    const bitrate = (buf[i + 2] >> 4) & 0x0f;
    const rateIndex = (buf[i + 2] >> 2) & 0x03;
    if (!rates || layer === 0 || bitrate === 0 || bitrate === 0x0f || rateIndex === 3) continue;

    return {
      sampleRate: rates[rateIndex],
      channels: ((buf[i + 3] >> 6) & 0x03) === 3 ? 1 : 2,
    };
  }

  return null;
}

/**
 * Bytes por segundo do stream como o BASS o decodifica (PCM 16-bit) — a unidade
 * do campo `tempo`. Lê o header do MP3, que é o formato do acervo; para os
 * demais o default serve de aproximação.
 */
async function audioBytesPerSecond(blob) {
  if (!blob) return DEFAULT_BYTES_PER_SECOND;
  const format = await readMp3Format(blob);
  return format ? format.sampleRate * format.channels * 2 : DEFAULT_BYTES_PER_SECOND;
}

function parseIniWithSections(text) {
  const sections = {};
  let currentSection = "_default";
  sections[currentSection] = {};

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) return;

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!sections[currentSection]) sections[currentSection] = {};
      return;
    }

    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) sections[currentSection][key] = value;
  });

  return sections;
}

function stringifyIni(sections, sectionOrder) {
  const order = sectionOrder || Object.keys(sections);
  const lines = [];
  for (const name of order) {
    const sec = sections[name];
    if (!sec) continue;
    lines.push(`[${name}]`);
    for (const [k, v] of Object.entries(sec)) {
      if (v === undefined || v === null || v === "") continue;
      lines.push(`${k}=${v}`);
    }
    lines.push("");
  }
  return lines.join("\r\n");
}

function roundMs(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1000) / 1000;
}

function hmsToSeconds(hms) {
  if (!hms) return 0;
  const normalized = String(hms).trim().replace(",", ".");
  const parts = normalized.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return roundMs(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return roundMs(parts[0] * 60 + parts[1]);
  return roundMs(parts[0] || 0);
}

function secondsToHms(seconds, { fractional = true } = {}) {
  const rounded = roundMs(seconds);
  const totalMs = Math.round(rounded * 1000);
  const wholeSeconds = fractional ? Math.floor(totalMs / 1000) : Math.floor(rounded);
  const ms = fractional ? totalMs % 1000 : 0;
  const h = Math.floor(wholeSeconds / 3600);
  const m = Math.floor((wholeSeconds % 3600) / 60);
  const s = wholeSeconds % 60;
  const base = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  return ms > 0 ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

function parseTempoPair(hmsRaw, bytesRaw, bytesPerSecond) {
  const hasHms = typeof hmsRaw === "string" && hmsRaw.trim() !== "";
  if (hasHms && /[.,]\d+/.test(hmsRaw)) {
    return hmsToSeconds(hmsRaw);
  }

  const bytesNum = Number(bytesRaw || 0);
  if (hasHms) {
    const hmsSeconds = hmsToSeconds(hmsRaw);
    // Preserva milissegundos de `tempo` quando `tempo_hms` veio truncado em inteiros.
    if (Number.isFinite(bytesNum) && bytesNum > 0) {
      const byteSeconds = roundMs(bytesNum / bytesPerSecond);
      if (Math.floor(byteSeconds) === Math.floor(hmsSeconds)) {
        return byteSeconds;
      }
    }
    return hmsSeconds;
  }

  return Number.isFinite(bytesNum) && bytesNum > 0 ? roundMs(bytesNum / bytesPerSecond) : 0;
}

function parseSlideTempoSeconds(sec, bytesPerSecond) {
  return parseTempoPair(sec.tempo_hms, sec.tempo, bytesPerSecond);
}

function parseSlidePlaybackTempoSeconds(sec, bytesPerSecond) {
  const hasPb =
    (typeof sec.tempo_hms_pb === "string" && sec.tempo_hms_pb.trim() !== "") ||
    (typeof sec.tempo_pb === "string" && sec.tempo_pb.trim() !== "");
  if (!hasPb) return undefined;
  return parseTempoPair(sec.tempo_hms_pb, sec.tempo_pb, bytesPerSecond);
}

function decodeLetra(letra) {
  if (!letra) return "";
  return letra.replace(/\|/g, "\n").replace(/\\n/g, "\n");
}

function encodeLetra(letra) {
  if (!letra) return "";
  return letra.replace(/\r\n/g, "|").replace(/\n/g, "|");
}

function parseSlja(
  iniText,
  bytesPerSecond = DEFAULT_BYTES_PER_SECOND,
  playbackBytesPerSecond = bytesPerSecond
) {
  const sections = parseIniWithSections(iniText);
  const geral = sections["Geral"] || sections["_default"] || {};
  const slidesCount = parseInt(geral.slides || "0", 10);

  const slides = [];
  for (let i = 1; i <= slidesCount; i++) {
    const sec = sections[`Slide:${i}`];
    if (!sec) continue;

    const tempo_seconds_pb = parseSlidePlaybackTempoSeconds(sec, playbackBytesPerSecond);
    slides.push({
      index: i,
      tipo: sec.tipo || (i === 1 ? "CAPA" : "LETRA"),
      letra: decodeLetra(sec.letra || ""),
      letra_aux: decodeLetra(sec.letra_aux || ""),
      tamanho_letra: parseInt(sec.tamanho_letra || (i === 1 ? "18" : "14"), 10),
      tamanho_letra_aux: parseInt(sec.tamanho_letra_aux || "10", 10),
      cor_letra: sec.cor_letra || (i === 1 ? "#efb400" : "#FFFFFF"),
      cor_letra_aux: sec.cor_letra_aux || "#efb400",
      fundo_letra: sec.fundo_letra === undefined ? true : sec.fundo_letra === "1",
      cor_fundo: sec.cor_fundo || "#000000",
      imagem: sec.imagem || "",
      imagem_posicao: parseInt(sec.imagem_posicao || "5", 10),
      tempo_seconds: parseSlideTempoSeconds(sec, bytesPerSecond),
      ...(tempo_seconds_pb !== undefined ? { tempo_seconds_pb } : {}),
      text_align: sec.text_align || "center",
    });
  }

  return {
    meta: {
      slides_count: slidesCount,
      versao: geral.versao || "",
      url_musica: geral.url_musica || "",
      url_playback: geral.url_playback || "",
      faixa: String(geral.faixa || "")
        .trim()
        .toLowerCase(),
      audio: geral.audio || "0",
      // Nome da música gravado pelo LouvorJA no export (pode faltar em
      // arquivos legados/Delphi).
      nome: geral.nome || geral.titulo || "",
    },
    slides,
  };
}

/**
 * Preenche a imagem dos slides ANTERIORES à primeira imagem do pacote.
 *
 * Uso na importação: quando o 1º slide (capa) não tem fundo mas um seguinte
 * tem, os anteriores herdam essa imagem — igual ao comportamento da capa no
 * LouvorJA. Slides posteriores à primeira imagem não são alterados (permanecem
 * sem fundo), e a imagem_posicao original de cada slide é preservada.
 *
 * @param {Array<{imagem?: string}>} [slides]
 * @returns {Array} Mesmo array, com `imagem` preenchida nos slides leading.
 */
function fillMissingImages(slides = []) {
  let first = -1;
  for (let i = 0; i < slides.length; i++) {
    if (slides[i] && slides[i].imagem) {
      first = i;
      break;
    }
  }
  if (first <= 0) return slides;

  for (let i = 0; i < first; i++) {
    slides[i].imagem = slides[first].imagem;
  }
  return slides;
}

/**
 * Resolve o nome da música a partir do pacote .slja importado.
 *
 * Prioridade:
 *   1. [Geral].nome (gravado pelo export do LouvorJA)
 *   2. Letra do primeiro slide (convenção: a capa traz o nome da música)
 *   3. Nome do arquivo .slja (sem extensão)
 *
 * @param {object} data        Resultado de loadSlja ({ meta, slides }).
 * @param {string} fileName    Nome do arquivo importado (ex.: "hino.slja").
 * @returns {string}           Nome resolvido (pode retornar "").
 */
function resolveSongName(data = {}, fileName = "") {
  const iniNome = String((data.meta && data.meta.nome) || "").trim();
  if (iniNome) return iniNome;

  const firstSlide = Array.isArray(data.slides) ? data.slides[0] : null;
  const capaNome = String((firstSlide && firstSlide.letra) || "")
    .replace(/\s+/g, " ")
    .trim();
  if (capaNome) return capaNome;

  return String(fileName || "")
    .trim()
    .replace(/\.(slja|lja)$/i, "");
}

/**
 * Sufixo do nome do arquivo de playback. Um .slja comporta uma faixa só, então
 * o LouvorJA clássico (26.11+) pareia `Música.slja` com `Música -PB.slja` na
 * pasta da coletânea personalizada.
 */
const PLAYBACK_SUFFIX = " -PB";

/**
 * Nome da música a que um playback pertence, ou `null` quando o nome não é de
 * playback. Mesma regra do `ehNomePlayback` do clássico: o sufixo é digitado à
 * mão, então vale "-PB", " -PB", "- PB" e " - PB", em qualquer caixa.
 *
 * @param {string} name  Nome do arquivo sem a extensão.
 * @returns {string | null}
 */
function playbackBaseName(name) {
  let s = String(name ?? "").trimEnd();
  if (s.length < 3 || s.slice(-2).toUpperCase() !== "PB") return null;
  s = s.slice(0, -2).trimEnd();
  if (!s.endsWith("-")) return null;
  // Sem nada antes do traço não há música a que o playback pertença.
  return s.slice(0, -1).trim() || null;
}

function buildIniFromSlides({
  meta = {},
  slides = [],
  audioPath = "",
  playbackPath = "",
  bytesPerSecond = DEFAULT_BYTES_PER_SECOND,
  playbackBytesPerSecond = bytesPerSecond,
}) {
  const sections = {};
  const order = ["Geral"];

  sections["Geral"] = {
    slides: String(slides.length),
    audio: meta.audio || (audioPath || playbackPath ? "1" : "0"),
  };
  if (audioPath) sections["Geral"].url_musica = audioPath;
  if (playbackPath) sections["Geral"].url_playback = playbackPath;
  if (meta.faixa) sections["Geral"].faixa = meta.faixa;
  if (meta.versao) sections["Geral"].versao = meta.versao;
  if (meta.nome) sections["Geral"].nome = meta.nome;

  slides.forEach((s, idx) => {
    const i = idx + 1;
    const name = `Slide:${i}`;
    order.push(name);
    const sec = {};

    sec.tipo = s.tipo || (i === 1 ? "CAPA" : "LETRA");
    if (s.letra) sec.letra = encodeLetra(s.letra);
    if (s.letra_aux) sec.letra_aux = encodeLetra(s.letra_aux);

    sec.fundo_letra = s.fundo_letra === false ? "0" : "1";

    if (s.tamanho_letra) sec.tamanho_letra = String(s.tamanho_letra);
    if (s.tamanho_letra_aux) sec.tamanho_letra_aux = String(s.tamanho_letra_aux);
    if (s.cor_letra) sec.cor_letra = s.cor_letra;
    if (s.cor_letra_aux) sec.cor_letra_aux = s.cor_letra_aux;
    if (s.cor_fundo) sec.cor_fundo = s.cor_fundo;

    if (s.imagem) sec.imagem = s.imagem;
    if (s.imagem_posicao) sec.imagem_posicao = String(s.imagem_posicao);
    if (s.text_align && s.text_align !== "center") sec.text_align = s.text_align;

    const seconds = Number(s.tempo_seconds || 0);
    sec.tempo_hms = secondsToHms(seconds);
    sec.tempo = String(Math.round(seconds * bytesPerSecond));

    if (s.tempo_seconds_pb !== undefined) {
      const pbSeconds = Number(s.tempo_seconds_pb || 0);
      sec.tempo_hms_pb = secondsToHms(pbSeconds);
      sec.tempo_pb = String(Math.round(pbSeconds * playbackBytesPerSecond));
    }

    sections[name] = sec;
  });

  return stringifyIni(sections, order);
}

function decodeIni(iniBytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(iniBytes);
  } catch {
    return new TextDecoder("windows-1252").decode(iniBytes);
  }
}

async function isZip(blob) {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b;
}

/**
 * Lê um .slja (zip) ou um .lja solto do LouvorJA clássico.
 *
 * O .lja é só o INI: áudio e imagens ficam em arquivos ao lado, fora do
 * alcance do seletor de arquivo. Nesse caso o resultado vem com `loose: true`,
 * sem mídia, e os tempos em bytes são convertidos pelo formato padrão do acervo.
 */
async function loadSlja(file) {
  const blob = file instanceof Blob ? file : new Blob([file]);

  if (!(await isZip(blob))) {
    const parsed = parseSlja(decodeIni(new Uint8Array(await blob.arrayBuffer())));
    if (!parsed.slides.length) throw new Error("o arquivo não é uma apresentação .slja nem .lja");
    return { ...parsed, audio: null, audioName: null, images: new Map(), loose: true };
  }

  const jszipMod = await import("jszip");
  const JSZip = jszipMod.default?.default ?? jszipMod.default ?? jszipMod;
  const zip = await JSZip.loadAsync(blob);

  const ljaFile = zip.file("slides.lja");
  if (!ljaFile) throw new Error("slides.lja não encontrado no arquivo .slja");

  const iniText = decodeIni(await ljaFile.async("uint8array"));

  // Varredura da raiz com normalização de separador — zips gerados pelo
  // Delphi gravam entradas como "imagens\foto.png" (barra invertida), que
  // zip.folder() não encontra.
  const audioEntries = [];
  const images = new Map();
  const pending = [];

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return;
    const norm = relativePath.replace(/\\/g, "/");

    const imgMatch = norm.match(/^imagens\/(.*)$/i) || norm.match(/^images\/(.*)$/i);
    if (imgMatch) {
      pending.push(zipEntry.async("blob").then((b) => images.set(imgMatch[1], b)));
      return;
    }

    const audMatch = norm.match(/^audio\/(.*)$/i);
    if (audMatch) {
      pending.push(
        zipEntry.async("blob").then((b) => {
          audioEntries.push({ norm: norm.toLowerCase(), name: audMatch[1], blob: b });
        })
      );
    }
  });

  await Promise.all(pending);

  const sections = parseIniWithSections(iniText);
  const geral = sections["Geral"] || sections["_default"] || {};
  const normRef = (v) =>
    String(v || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .toLowerCase();
  const urlMusica = normRef(geral.url_musica);
  const urlPlayback = normRef(geral.url_playback);

  const playbackEntry = urlPlayback
    ? audioEntries.find(
        (e) => e.norm === urlPlayback || e.norm.endsWith(`/${urlPlayback.replace(/^audio\//, "")}`)
      ) || null
    : null;
  const primaryEntry =
    (urlMusica
      ? audioEntries.find(
          (e) =>
            e !== playbackEntry &&
            (e.norm === urlMusica || e.norm.endsWith(`/${urlMusica.replace(/^audio\//, "")}`))
        )
      : null) ||
    audioEntries.find((e) => e !== playbackEntry) ||
    null;

  const audio = primaryEntry?.blob || null;
  const audioName = primaryEntry?.name || null;
  const playbackAudio = playbackEntry?.blob || null;
  const playbackAudioName = playbackEntry?.name || null;

  const bpsPrimary = await audioBytesPerSecond(audio);
  const bpsPlayback = playbackAudio ? await audioBytesPerSecond(playbackAudio) : bpsPrimary;
  const parsed = parseSlja(iniText, bpsPrimary, bpsPlayback);

  return {
    ...parsed,
    audio,
    audioName,
    playbackAudio,
    playbackAudioName,
    images,
    loose: false,
  };
}

/**
 * Escreve um pacote .slja como Blob.
 *
 * @param {object} input
 * @param {object} [input.meta]                 Metadados gerais (versao, audio, faixa).
 * @param {string} [input.nome]                 Nome da música — gravado em [Geral].nome.
 * @param {Array} input.slides                  Lista de slides (schema CustomSlide).
 * @param {Blob | null} [input.audio]           Blob do MP3 principal (gravado em audio/<audioName>).
 * @param {string} [input.audioName]            Nome do arquivo de áudio (default: 'audio.mp3').
 * @param {Blob | null} [input.playbackAudio]   Blob opcional da faixa de playback (export unificado).
 * @param {string} [input.playbackAudioName]    Nome do arquivo de playback (default: 'playback.mp3').
 * @param {Map<string, Blob>} [input.images]    Imagens deduplicadas: chave = path no ZIP (`imagens/<name>`), valor = Blob.
 * @returns {Promise<Blob>}                     Pacote .slja pronto para download/save.
 */
async function writeSlja({
  meta = {},
  nome = "",
  slides = [],
  audio = null,
  audioName = "audio.mp3",
  playbackAudio = null,
  playbackAudioName = "playback.mp3",
  images = null,
} = {}) {
  const jszipMod = await import("jszip");
  const JSZip = jszipMod.default?.default ?? jszipMod.default ?? jszipMod;
  const zip = new JSZip();

  let audioPath = "";
  if (audio) {
    audioPath = `audio/${audioName.replace(/^audio\//, "")}`;
    zip.file(audioPath, audio);
  }

  let playbackPath = "";
  if (playbackAudio) {
    const cleanPb = playbackAudioName.replace(/^audio\//, "");
    const candidate = `audio/${cleanPb}`;
    playbackPath = candidate === audioPath ? `audio/pb-${cleanPb}` : candidate;
    zip.file(playbackPath, playbackAudio);
  }

  const slidesForIni = slides.map((s) => {
    if (!s.imagem) return s;
    const path = s.imagem.startsWith("imagens/")
      ? s.imagem
      : `imagens/${s.imagem.split(/[\\/]/).pop()}`;
    return { ...s, imagem: path };
  });

  const bpsPrimary = await audioBytesPerSecond(audio);
  const bpsPlayback = playbackAudio ? await audioBytesPerSecond(playbackAudio) : bpsPrimary;
  const iniText = buildIniFromSlides({
    meta: { ...meta, ...(nome ? { nome } : {}) },
    slides: slidesForIni,
    audioPath,
    playbackPath,
    bytesPerSecond: bpsPrimary,
    playbackBytesPerSecond: bpsPlayback,
  });
  zip.file("slides.lja", encodeCp1252(iniText));

  if (images && images.size > 0) {
    for (const [path, blob] of images.entries()) {
      const normalized = path.startsWith("imagens/") ? path : `imagens/${path}`;
      zip.file(normalized, blob);
    }
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export default {
  parseSlja,
  loadSlja,
  writeSlja,
  buildIniFromSlides,
  parseIniWithSections,
  stringifyIni,
  encodeCp1252,
  audioBytesPerSecond,
  hmsToSeconds,
  secondsToHms,
  decodeLetra,
  encodeLetra,
  resolveSongName,
  fillMissingImages,
  PLAYBACK_SUFFIX,
  playbackBaseName,
};
