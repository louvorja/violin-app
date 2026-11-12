import { useLiturgyI18n } from "../i18n";
import { parseJaImport, WEEKDAY_KEYS, type useLiturgyLibrary } from "./useLiturgyLibrary";
import { decodeJaText } from "../jaText";
import {
  isZip,
  PACKAGE_EXT,
  readPackage,
  type PackageFile,
  type ReadError,
} from "../package/format";
import { readClassicPackage } from "../package/classic";
import { installPackage, type InstallDeps } from "../package/install";
import { useBusy } from "@/composables/useBusy";
import { useOnlineVideoDownloads } from "@/composables/useOnlineVideoDownloads";
import { importLiturgyFile, removeLiturgyFile } from "@/helpers/LiturgyFiles";
import $idb from "@/helpers/IndexedDB";
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
  /**
   * Chamado quando o arquivo trouxe várias liturgias (`.ja` ou `.json` da semana),
   * com o dia da semana de cada uma — para a tela oferecer montar a semana.
   */
  onImportedWeek?: (_entries: WeekEntry[]) => void;
  /** Onde gravar os arquivos do pacote (padrão: IndexedDB e os arquivos da liturgia). */
  installDeps?: Partial<InstallDeps>;
  /** Inicia o download de um vídeo do YouTube que entrou na lista (padrão: Vídeos Online). */
  startVideoDownload?: (_id: string, _name: string) => unknown;
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

/** Liturgia gravada a partir de um arquivo com várias, e o dia (0 = domingo) a que pertence. */
export interface WeekEntry {
  item: LiturgyLibraryItem;
  day: number;
}

/**
 * Um dia para cada liturgia: o vínculo de dia da semana, quando o arquivo traz
 * (`.json` da semana do Classic), senão a POSIÇÃO (1ª = domingo...). Só a
 * primeira de cada dia entra; as outras ficam só na biblioteca.
 */
export function weekEntries(saved: { item?: LiturgyLibraryItem; day: number }[]): WeekEntry[] {
  const used = new Set<number>();
  const out: WeekEntry[] = [];
  for (const { item, day } of saved) {
    if (!item || !Number.isInteger(day) || day < 0 || day > 6 || used.has(day)) continue;
    used.add(day);
    out.push({ item, day });
  }
  return out;
}

function bindingDay(raw: unknown): number | null {
  const binding = (raw as { binding?: { type?: unknown; value?: unknown } } | null)?.binding;
  if (!binding || binding.type !== "day_of_week") return null;
  const day = Number(binding.value);
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : null;
}

/** Uma liturgia lida do arquivo, ainda não gravada. */
interface Parsed {
  name: string;
  color?: string;
  items: LiturgyItem[];
  files: PackageFile[];
}

/** Mensagem do erro de leitura (chave em `library.*`). */
const READ_ERROR_KEY: Partial<Record<ReadError, string>> = {
  too_large: "library.import_too_large",
  unsupported_version: "library.import_unsupported_version",
};

/**
 * Importar uma liturgia para a biblioteca, de um `.llja` (pacote com os
 * arquivos), de um `.json` (export antigo do app) ou de um `.ja` (Delphi).
 * `busy` fica ligado enquanto o arquivo é lido, interpretado e gravado, para a
 * tela mostrar o loader — e desligado enquanto o operador responde a uma pergunta.
 */
export function useLiturgyImport(library: Library, report: Report, options: ImportOptions = {}) {
  const { t } = useLiturgyI18n();
  const { busy, run } = useBusy();
  const installDeps: InstallDeps = {
    get: (table, id) => $idb.get(table, id),
    getAll: (table) => $idb.getAll(table),
    put: (table, record) => $idb.put(table, record as { id: string }),
    del: (table, id) => $idb.del(table, id),
    storeLiturgyFile: importLiturgyFile,
    removeLiturgyFile,
    importedCategoryName: t("library.imported_category"),
    ...options.installDeps,
  };
  const startVideoDownload =
    options.startVideoDownload ??
    ((id: string, name: string) => useOnlineVideoDownloads().startForNewLink(id, name));

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

  /**
   * Lê o arquivo até a liturgia, sem gravar nada: pacote do Violin, `.llja` do
   * Classic (mapper) ou `.json`.
   */
  async function parse(
    file: File,
    format: "json" | "llja"
  ): Promise<{ parsed: Parsed } | { error: ReadError }> {
    if (format === "llja") {
      const pack = await readPackage(file);
      if (pack && !pack.ok) return { error: pack.error };
      const source = pack?.ok
        ? { json: pack.liturgyJson, files: pack.files }
        : await readClassicPackage(file).then((c) => c && { json: c.liturgyJson, files: c.files });
      if (!source) return { error: "not_liturgy" };
      const parsed = library.parseImport(source.json);
      return parsed ? { parsed: { ...parsed, files: source.files } } : { error: "invalid" };
    }
    const parsed = library.parseImport(await file.text());
    return parsed ? { parsed: { ...parsed, files: [] } } : { error: "invalid" };
  }

  /**
   * `.json` da semana exportado pelo Classic: `{ schema, liturgies: [...] }`,
   * uma liturgia por dia. Cada uma entra na biblioteca com o nome que trouxe
   * (numerado se já existir), sem perguntas — como no `.ja`. O vínculo de dia
   * não é trazido: carregaria liturgias sozinho nos dias de quem importou.
   *
   * Devolve quantas entraram, ou `null` se o arquivo não é uma coleção.
   */
  async function importCollection(
    text: string,
    ctx: Context
  ): Promise<{ item?: LiturgyLibraryItem; day: number }[] | null> {
    let data: { liturgies?: unknown };
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    if (!data || !Array.isArray(data.liturgies)) return null;
    const usados = new Set((await library.list()).map((l) => l.name.toLowerCase()));
    const saved: { item?: LiturgyLibraryItem; day: number }[] = [];
    let items = 0;
    for (const [index, raw] of data.liturgies.entries()) {
      const parsed = library.parseImport(JSON.stringify(raw));
      if (!parsed || parsed.items.length === 0) continue;
      const base = parsed.name.trim() || nomePelaPosicao(index);
      let nome = base;
      for (let n = 1; usados.has(nome.toLowerCase()); n += 1) nome = `${base} ${n}`;
      usados.add(nome.toLowerCase());
      const item = await library.save({
        name: nome,
        ...(parsed.color ? { color: parsed.color } : {}),
        items: parsed.items,
      });
      saved.push({ item, day: bindingDay(raw) ?? index });
      items += parsed.items.length;
    }
    Telemetry.track("liturgy_import_completed", {
      ...ctx.properties,
      liturgy_count: saved.length,
      item_count: items,
    });
    return saved;
  }

  type Saved = {
    item: LiturgyLibraryItem | undefined;
    missing: string[];
    unsupported: string[];
    stored: number;
    videos: number;
  } | null;
  type Context = { format: "json" | "llja"; properties: ReturnType<typeof telemetryProperties> };

  /** Guarda os arquivos do pacote e grava a liturgia. Roda dentro do loader. */
  async function store(
    parsed: Parsed,
    choice: ConflictChoice | null,
    existing: LiturgyLibraryItem | undefined,
    ctx: Context
  ): Promise<Saved> {
    let installed: Awaited<ReturnType<typeof installPackage>> | null = null;
    try {
      let name = parsed.name;
      if (choice === "copy") {
        name = copyName(
          parsed.name,
          (await library.list()).map((l) => l.name)
        );
      }
      // Bibliotecas primeiro; a liturgia por último. Se ela não gravar, desfaz.
      installed = await installPackage(parsed.items, parsed.files, installDeps);
      const data = {
        ...(choice === "replace" && existing ? { id: existing.id } : {}),
        name,
        ...(parsed.color ? { color: parsed.color } : {}),
        items: installed.items,
      };
      const item = await library.save(data);
      for (const video of installed.youtube) {
        try {
          void Promise.resolve(startVideoDownload(video.id, video.name)).catch(() => {});
        } catch {
          // O vídeo ficou na lista; o download pode ser feito por lá.
        }
      }
      Telemetry.track("liturgy_import_completed", {
        ...ctx.properties,
        overwritten: choice === "replace",
        as_copy: choice === "copy",
        item_count: installed.items.length,
        file_count: parsed.files.length,
        stored_files: installed.stored,
        missing_files: installed.missing.length,
        unsupported_files: installed.unsupported.length,
        youtube_count: installed.youtube.length,
      });
      return {
        item,
        missing: installed.missing,
        unsupported: installed.unsupported,
        stored: installed.stored,
        videos: installed.youtube.length,
      };
    } catch (error) {
      if (installed) await installed.rollback().catch(() => {});
      report(error, `import_${ctx.format}_save`, ctx.properties);
      console.error(`[Liturgia] import ${ctx.format} falhou:`, error);
      return null;
    }
  }

  /**
   * Resumo ao operador: tudo certo, ou o que ficou para trás. `next` vem depois
   * que ele fecha o aviso — o app mostra um diálogo de cada vez.
   */
  function reportImported(saved: NonNullable<Saved>, next: () => void): void {
    if (!saved.missing.length && !saved.unsupported.length) {
      done();
      next();
      return;
    }
    const list = (names: string[]) => {
      const shown = names.slice(0, 5).map((n) => `• ${escapeHtml(n)}`);
      if (names.length > 5) shown.push(`… +${names.length - 5}`);
      return shown.join("<br>");
    };
    const parts: string[] = [];
    if (saved.missing.length)
      parts.push(`${escapeHtml(t("library.import_partial"))}<br>${list(saved.missing)}`);
    // Veio no pacote, mas nenhuma biblioteca do app guarda esse tipo (PowerPoint, por exemplo).
    if (saved.unsupported.length)
      parts.push(`${escapeHtml(t("library.import_unsupported"))}<br>${list(saved.unsupported)}`);
    $alert.info(
      {
        title: escapeHtml(t("library.import_title")),
        text: parts.join("<br><br>"),
        translate: false,
      },
      () => next()
    );
  }

  /**
   * Depois de gravar várias liturgias: uma só, a tela oferece abrir (como no
   * `.llja`); várias, oferece montar a semana com cada uma no seu dia.
   */
  function offerOpen(saved: { item?: LiturgyLibraryItem; day: number }[]): void {
    const real = saved.filter((s): s is WeekEntry => !!s.item);
    if (real.length === 1) {
      options.onImported?.(real[0].item);
      return;
    }
    const week = weekEntries(real);
    if (week.length > 1) options.onImportedWeek?.(week);
    else if (week.length === 1) options.onImported?.(week[0].item);
  }

  async function importOne(file: File): Promise<void> {
    const ctx: Context = { format: "json", properties: telemetryProperties(file, "json") };

    // 1) Ler o arquivo; sem conflito de nome, já grava aqui mesmo (um loader só).
    const first = await run(async () => {
      try {
        // Pelo conteúdo, não só pela extensão: um .llja renomeado continua sendo ZIP.
        const lower = file.name.toLowerCase();
        if (lower.endsWith(`.${PACKAGE_EXT}`) || lower.endsWith(".zip") || (await isZip(file)))
          ctx.format = "llja";
        ctx.properties = telemetryProperties(file, ctx.format);
        Telemetry.track("liturgy_import_started", ctx.properties);
        if (ctx.format === "json") {
          const collection = await importCollection(await file.text(), ctx);
          if (collection !== null)
            return collection.length > 0 ? { collection } : { invalid: true as const };
        }
        const read = await parse(file, ctx.format);
        if ("error" in read) {
          Telemetry.track("liturgy_import_failed", {
            ...ctx.properties,
            reason: read.error === "invalid" ? "invalid_format" : read.error,
          });
          return { invalid: true as const, reason: read.error };
        }
        const parsed = read.parsed;
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
      const key = "reason" in first && first.reason ? READ_ERROR_KEY[first.reason] : undefined;
      if (key) $snackbar.error(t(key));
      else invalid();
      return;
    }
    if ("collection" in first) {
      done();
      offerOpen(first.collection ?? []);
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
    const item = saved.item;
    // `save` de teste pode não devolver nada; a tela só oferece abrir o que existe.
    reportImported(saved, () => {
      if (item && options.onImported) options.onImported(item);
    });
  }

  // O `.ja` do Delphi é INI em Windows-1252 até a v26.6 e UTF-8 com BOM depois:
  // `decodeJaText` escolhe como o próprio clássico escolhe.
  async function importJa(
    file: File
  ): Promise<{ notice: Notice; saved: { item?: LiturgyLibraryItem; day: number }[] }> {
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
        return { notice: invalid, saved: [] };
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
      const saved: { item?: LiturgyLibraryItem; day: number }[] = [];
      for (const [index, liturgy] of parsed.entries()) {
        const base = nomePelaPosicao(index);
        let nome = base;
        for (let n = 1; usados.has(nome.toLowerCase()); n += 1) nome = `${base} ${n}`;
        usados.add(nome.toLowerCase());
        const item = await library.save({ name: nome, items: liturgy.items });
        saved.push({ item, day: index });
      }
      Telemetry.track("liturgy_import_completed", {
        ...properties,
        encoding,
        liturgy_count: parsed.length,
        item_count: parsed.reduce((total, liturgy) => total + liturgy.items.length, 0),
      });
      return { notice: done, saved };
    } catch (error) {
      report(error, "import_ja", properties);
      console.error("[Liturgia] leitura do .ja falhou:", error);
      return { notice: invalid, saved: [] };
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
        const result = await run(() => importJa(file));
        if (!result) return;
        result.notice?.();
        offerOpen(result.saved);
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
    input.accept = `.${PACKAGE_EXT},.zip,.json,.ja`;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void importFile(file);
    };
    input.click();
  }

  return { busy, importFile, doImport };
}
