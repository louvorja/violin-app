import { useLiturgyI18n } from "../i18n";
import { parseJaImport, WEEKDAY_KEYS, type useLiturgyLibrary } from "./useLiturgyLibrary";
import { decodeJaText } from "../jaText";
import { attachPackedFiles, isLlja, LLJA_EXT, readLlja, type PackedFile } from "../package";
import { useBusy } from "@/composables/useBusy";
import { importLiturgyFile } from "@/helpers/LiturgyFiles";
import $alert, { escapeHtml } from "@/helpers/Alert";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";
import type { LiturgyItem } from "@/types/Liturgy";
import type { LiturgyLibraryItem } from "@/types/LiturgyLibrary";

type Library = Pick<
  ReturnType<typeof useLiturgyLibrary>,
  "parseImport" | "getByName" | "save" | "list"
>;
type Report = (_error: unknown, _operation: string, _properties?: Record<string, unknown>) => void;
type Format = "json" | "ja" | "llja";

/** O aviso ao operador. Só é dito depois de o loader sair, senão os dois aparecem juntos. */
type Notice = (() => void) | null;

/** O que fazer com uma liturgia cujo nome já existe na biblioteca. */
export type ConflictChoice = "replace" | "copy" | "cancel";

export interface ImportOptions {
  /**
   * Chamado com a liturgia que acabou de entrar — para a tela oferecer abri-la.
   * Não é chamado no `.ja` com várias liturgias.
   */
  onImported?: (_item: LiturgyLibraryItem) => void;
  /** Onde guardar os arquivos que vêm dentro do `.llja` (padrão: o mesmo dos arquivos da liturgia). */
  storeFile?: (_file: File) => Promise<{ dir: string; ref_id: string }>;
}

function telemetryProperties(file: File, format: Format) {
  return {
    format,
    size_bytes: Math.min(Math.max(0, file.size || 0), 50 * 1024 * 1024),
    mime_type: file.type || "unknown",
  };
}

/** "Culto" → "Culto (2)", "Culto (3)"…, sem repetir nome da biblioteca. */
export function copyName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  for (let n = 2; ; n += 1) {
    const candidate = `${name} (${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Uma liturgia lida do arquivo, ainda não gravada. */
interface Parsed {
  name: string;
  color?: string;
  items: LiturgyItem[];
  files: Map<string, PackedFile>;
}

/**
 * Importar uma liturgia para a biblioteca, de um `.llja` (pacote com os
 * arquivos), de um `.json` (export antigo do app) ou de um `.ja` (Delphi).
 * `busy` fica ligado enquanto o arquivo é lido, interpretado e gravado, para a
 * tela mostrar o loader — e desligado enquanto o operador responde a uma pergunta.
 */
export function useLiturgyImport(library: Library, report: Report, options: ImportOptions = {}) {
  const { t } = useLiturgyI18n();
  const { busy, run } = useBusy();
  const storeFile = options.storeFile ?? importLiturgyFile;

  /**
   * Nome-base de uma liturgia do `.ja`, pela POSIÇÃO no arquivo.
   *
   * A ordem é a da semana a partir de DOMINGO: a primeira é domingo, a segunda
   * segunda, e assim por diante até sábado, reiniciando no oitavo. O nome que o
   * arquivo traz no item `categoria` é ignorado de propósito: o operador
   * organiza o arquivo na ordem dos dias, e essa ordem é a informação que ele
   * reconhece.
   *
   * (`WEEKDAY_KEYS` já está na ordem de `Date.getDay()`, 0 = domingo — por isso
   * o índice entra direto, sem deslocamento.)
   */
  function nomePelaPosicao(index: number): string {
    const dia = WEEKDAY_KEYS[index % WEEKDAY_KEYS.length];
    return t(`library.weekday_${dia}`);
  }

  const done = (): void => $snackbar.success(t("library.import_success"));
  const invalid = (): void => $snackbar.error(t("library.import_invalid"));

  /** Pergunta o que fazer com o nome repetido. Sem loader enquanto o operador lê. */
  function askConflict(name: string): Promise<ConflictChoice> {
    return new Promise((resolve) => {
      $alert.show(
        {
          title: escapeHtml(t("library.import_title")),
          text: escapeHtml(t("library.import_conflict", { name })),
          translate: false,
          buttons: [
            { text: "alert.cancel", color: "error", value: "cancel" },
            { text: "modules.liturgy.library.import_as_copy", color: "info", value: "copy" },
            { text: "modules.liturgy.library.import_replace", color: "info", value: "replace" },
          ],
        },
        (value?: string) => resolve(value === "replace" || value === "copy" ? value : "cancel")
      );
    });
  }

  /** Lê `.llja` ou `.json` até a liturgia, sem gravar nada. */
  async function parse(file: File, format: "json" | "llja"): Promise<Parsed | null> {
    if (format === "llja") {
      const pack = await readLlja(file);
      if (!pack) return null;
      const parsed = library.parseImport(pack.json);
      return parsed ? { ...parsed, files: pack.files } : null;
    }
    const parsed = library.parseImport(await file.text());
    return parsed ? { ...parsed, files: new Map() } : null;
  }

  /**
   * `.json` da semana exportado pelo Classic: `{ schema, liturgies: [...] }`,
   * uma liturgia por dia. Cada uma entra na biblioteca com o nome que trouxe
   * (numerado se já existir), sem perguntas — como no `.ja`. O vínculo de dia
   * não é trazido: carregaria liturgias sozinho nos dias de quem importou.
   *
   * Devolve quantas entraram, ou `null` se o arquivo não é uma coleção.
   */
  async function importCollection(text: string, ctx: Context): Promise<number | null> {
    let data: { liturgies?: unknown };
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    if (!data || !Array.isArray(data.liturgies)) return null;
    const usados = new Set((await library.list()).map((l) => l.name.toLowerCase()));
    let count = 0;
    let items = 0;
    for (const [index, raw] of data.liturgies.entries()) {
      const parsed = library.parseImport(JSON.stringify(raw));
      if (!parsed || parsed.items.length === 0) continue;
      const base = parsed.name.trim() || nomePelaPosicao(index);
      let nome = base;
      for (let n = 1; usados.has(nome.toLowerCase()); n += 1) nome = `${base} ${n}`;
      usados.add(nome.toLowerCase());
      await library.save({
        name: nome,
        ...(parsed.color ? { color: parsed.color } : {}),
        items: parsed.items,
      });
      count += 1;
      items += parsed.items.length;
    }
    Telemetry.track("liturgy_import_completed", {
      ...ctx.properties,
      liturgy_count: count,
      item_count: items,
    });
    return count;
  }

  type Saved = { item: LiturgyLibraryItem | undefined; failed: string[] } | null;
  type Context = { format: "json" | "llja"; properties: ReturnType<typeof telemetryProperties> };

  /** Guarda os arquivos do pacote e grava a liturgia. Roda dentro do loader. */
  async function store(
    parsed: Parsed,
    choice: ConflictChoice | null,
    existing: LiturgyLibraryItem | undefined,
    ctx: Context
  ): Promise<Saved> {
    try {
      let name = parsed.name;
      if (choice === "copy") {
        name = copyName(
          parsed.name,
          (await library.list()).map((l) => l.name)
        );
      }
      const { items, failed } = await attachPackedFiles(parsed.items, parsed.files, storeFile);
      const data = {
        ...(choice === "replace" && existing ? { id: existing.id } : {}),
        name,
        ...(parsed.color ? { color: parsed.color } : {}),
        items,
      };
      const item = await library.save(data);
      Telemetry.track("liturgy_import_completed", {
        ...ctx.properties,
        overwritten: choice === "replace",
        as_copy: choice === "copy",
        item_count: items.length,
        file_count: parsed.files.size,
        failed_files: failed.length,
      });
      return { item, failed };
    } catch (error) {
      report(error, `import_${ctx.format}_save`, ctx.properties);
      console.error(`[Liturgia] import ${ctx.format} falhou:`, error);
      return null;
    }
  }

  async function importOne(file: File): Promise<void> {
    const ctx: Context = { format: "json", properties: telemetryProperties(file, "json") };

    // 1) Ler o arquivo; sem conflito de nome, já grava aqui mesmo (um loader só).
    const first = await run(async () => {
      try {
        // Pelo conteúdo, não só pela extensão: um .llja renomeado continua sendo ZIP.
        if (file.name.toLowerCase().endsWith(`.${LLJA_EXT}`) || (await isLlja(file)))
          ctx.format = "llja";
        ctx.properties = telemetryProperties(file, ctx.format);
        Telemetry.track("liturgy_import_started", ctx.properties);
        if (ctx.format === "json") {
          const count = await importCollection(await file.text(), ctx);
          if (count !== null) return count > 0 ? { collection: count } : { invalid: true as const };
        }
        const parsed = await parse(file, ctx.format);
        if (!parsed) {
          Telemetry.track("liturgy_import_failed", {
            ...ctx.properties,
            reason: "invalid_format",
          });
          return { invalid: true as const };
        }
        const existing = await library.getByName(parsed.name);
        if (existing) return { parsed, existing };
        return { saved: await store(parsed, null, undefined, ctx) };
      } catch (error) {
        report(error, `import_${ctx.format}`, ctx.properties);
        console.error(`[Liturgia] leitura do ${ctx.format} falhou:`, error);
        return { invalid: true as const };
      }
    });
    if ("invalid" in first) {
      invalid();
      return;
    }
    if ("collection" in first) {
      done();
      return;
    }

    let saved: Saved;
    if ("saved" in first) {
      saved = first.saved ?? null;
    } else {
      // 2) Nome repetido: o operador decide (sem loader), e a gravação volta com ele.
      const choice = await askConflict(first.parsed.name);
      if (choice === "cancel") return;
      saved = await run(() => store(first.parsed, choice, first.existing, ctx));
    }
    if (!saved) {
      invalid();
      return;
    }
    if (saved.failed.length) {
      $snackbar.warning(t("library.import_files_failed", { n: saved.failed.length }));
    } else {
      done();
    }
    // `save` de teste pode não devolver nada; a tela só oferece abrir o que existe.
    if (saved.item && options.onImported) options.onImported(saved.item);
  }

  // O `.ja` do Delphi é INI em Windows-1252 até a v26.6 e UTF-8 com BOM depois:
  // `decodeJaText` escolhe como o próprio clássico escolhe.
  async function importJa(file: File): Promise<Notice> {
    const properties = telemetryProperties(file, "ja");
    Telemetry.track("liturgy_import_started", properties);
    try {
      const buffer = await file.arrayBuffer();
      const { text, encoding } = decodeJaText(buffer);
      const parsed = parseJaImport(text);
      if (!parsed || parsed.length === 0) {
        Telemetry.track("liturgy_import_failed", {
          ...properties,
          encoding,
          reason: "invalid_format",
        });
        return invalid;
      }
      /**
       * Um `.ja` pode trazer várias liturgias salvas juntas (ex.: culto e escola
       * sabatina); confirmar sobrescrita uma a uma travaria o import numa fila de
       * diálogos. Cada uma entra como item novo na biblioteca.
       *
       * O nome vem da POSIÇÃO (1ª = domingo, 2ª = segunda, ...). O conjunto de
       * nomes usados inclui a biblioteca inteira E as liturgias deste arquivo:
       * sem isso, dois grupos do mesmo dia viravam duas liturgias com o mesmo nome.
       **/
      const usados = new Set((await library.list()).map((liturgia) => liturgia.name.toLowerCase()));
      for (const [index, liturgy] of parsed.entries()) {
        const base = nomePelaPosicao(index);
        let nome = base;
        for (let n = 1; usados.has(nome.toLowerCase()); n += 1) nome = `${base} ${n}`;
        usados.add(nome.toLowerCase());
        await library.save({ name: nome, items: liturgy.items });
      }
      Telemetry.track("liturgy_import_completed", {
        ...properties,
        encoding,
        liturgy_count: parsed.length,
        item_count: parsed.reduce((total, liturgy) => total + liturgy.items.length, 0),
      });
      return done;
    } catch (error) {
      report(error, "import_ja", properties);
      console.error("[Liturgia] leitura do .ja falhou:", error);
      return invalid;
    }
  }

  let importing = false;

  async function importFile(file: File): Promise<void> {
    // `busy` cai enquanto o operador responde; esta trava cobre o import inteiro.
    if (busy.value || importing) return;
    importing = true;
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith(".ja")) {
        const notice = await run(() => importJa(file));
        notice?.();
        return;
      }
      await importOne(file);
    } finally {
      importing = false;
    }
  }

  /** Abre o seletor de arquivo e importa o escolhido. */
  function doImport(): void {
    if (busy.value || importing) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.${LLJA_EXT},.json,.ja`;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void importFile(file);
    };
    input.click();
  }

  return { busy, importFile, doImport };
}
