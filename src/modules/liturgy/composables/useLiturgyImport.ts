import { useLiturgyI18n } from "../i18n";
import { parseJaImport, WEEKDAY_KEYS, type useLiturgyLibrary } from "./useLiturgyLibrary";
import { decodeJaText } from "../jaText";
import { useBusy } from "@/composables/useBusy";
import $alert from "@/helpers/Alert";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";

type Library = Pick<
  ReturnType<typeof useLiturgyLibrary>,
  "parseImport" | "getByName" | "save" | "list"
>;
type Report = (_error: unknown, _operation: string, _properties?: Record<string, unknown>) => void;

/** O aviso ao operador. Só é dito depois de o loader sair, senão os dois aparecem juntos. */
type Notice = (() => void) | null;

function telemetryProperties(file: File, format: "json" | "ja") {
  return {
    format,
    size_bytes: Math.min(Math.max(0, file.size || 0), 50 * 1024 * 1024),
    mime_type: file.type || "unknown",
  };
}

/**
 * Importar uma liturgia para a biblioteca, de um `.json` (exportado pelo app) ou de um `.ja`
 * (Delphi). `busy` fica ligado enquanto o arquivo é lido, interpretado e gravado, para a tela
 * mostrar o loader.
 */
export function useLiturgyImport(library: Library, report: Report) {
  const { t } = useLiturgyI18n();
  const { busy, run } = useBusy();

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

  const done: Notice = () => $snackbar.success(t("library.import_success"));
  const invalid: Notice = () => $snackbar.error(t("library.import_invalid"));

  async function importJson(file: File): Promise<Notice> {
    const properties = telemetryProperties(file, "json");
    Telemetry.track("liturgy_import_started", properties);
    try {
      const text = await file.text();
      const parsed = library.parseImport(text);
      if (!parsed) {
        Telemetry.track("liturgy_import_failed", { ...properties, reason: "invalid_format" });
        return invalid;
      }
      const existing = await library.getByName(parsed.name);
      if (existing) {
        // O operador decide: sem loader enquanto ele lê a pergunta; ele volta a aparecer ao gravar.
        $alert.yesno(
          { title: t("library.import_title"), text: t("library.save_overwrite_confirm") },
          async (btn?: string) => {
            if (btn !== "yes") return;
            const notice = await run(async (): Promise<Notice> => {
              try {
                await library.save({ id: existing.id, name: parsed.name, items: parsed.items });
                Telemetry.track("liturgy_import_completed", {
                  ...properties,
                  overwritten: true,
                  item_count: parsed.items.length,
                });
                return done;
              } catch (error) {
                report(error, "import_json_save", properties);
                console.error("[Liturgia] import JSON falhou:", error);
                return invalid;
              }
            });
            notice?.();
          }
        );
        return null;
      }
      await library.save({ name: parsed.name, items: parsed.items });
      Telemetry.track("liturgy_import_completed", {
        ...properties,
        overwritten: false,
        item_count: parsed.items.length,
      });
      return done;
    } catch (error) {
      report(error, "import_json", properties);
      console.error("[Liturgia] leitura do JSON falhou:", error);
      return invalid;
    }
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

  async function importFile(file: File): Promise<void> {
    if (busy.value) return;
    const notice = await run(() =>
      file.name.toLowerCase().endsWith(".ja") ? importJa(file) : importJson(file)
    );
    notice?.();
  }

  /** Abre o seletor de arquivo e importa o escolhido. */
  function doImport(): void {
    if (busy.value) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.ja";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void importFile(file);
    };
    input.click();
  }

  return { busy, importFile, doImport };
}
