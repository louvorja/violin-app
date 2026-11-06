/** @category deve-virar-composable — Usa Alert/Snackbar (Pinia); requer renderer. */
import Platform from "@/helpers/Platform";
import $alert, { escapeHtml } from "@/helpers/Alert";
import $snackbar from "@/helpers/Snackbar";
import Telemetry from "@/helpers/Telemetry";

type Translate = (_key: string, _values?: Record<string, unknown>) => string;

type RecoveryStorage = Partial<Pick<LouvorjaApi["storage"], "dataDirIssue" | "restart" | "recover" | "olderVersion" | "keepCurrentVersion">>;
const storage = (): RecoveryStorage | null => Platform.storage as RecoveryStorage | null;

/** O aviso não some: o app abriu sem os dados e o operador precisa saber por quê. */
export async function warnDataDirFallback(t: Translate): Promise<void> {
  const issue = await Promise.resolve(storage()?.dataDirIssue?.()).catch(() => null);
  if (!issue) return;
  Telemetry.track("storage_data_dir_fallback", { reason: issue.reason, attempts: issue.attempts ?? 1 });
  $snackbar.warning(
    issue.reason === "unavailable"
      ? t("options.storage.folder_fallback_notice", { dir: issue.wanted })
      : t("options.storage.prepare_failed_notice", { error: issue.message }),
    { timeout: 0, key: "data-dir-fallback", action: () => explainDataDirIssue(issue, t) }
  );
}

/** Explica em palavras simples e oferece o que dá para fazer agora. */
export function explainDataDirIssue(issue: StorageDataDirIssue, t: Translate): void {
  const attempts = issue.attempts ?? 1;
  const paragraphs = [
    issue.reason === "unavailable"
      ? t("options.storage.recovery.unavailable", { dir: issue.wanted })
      : t("options.storage.recovery.failed"),
    t("options.storage.recovery.attempts", { n: attempts }),
    issue.canReset ? t("options.storage.recovery.reset_hint") : t("options.storage.recovery.retry_hint"),
  ];
  $alert.show(
    {
      title: t("options.storage.recovery.title"),
      text: paragraphs.map(escapeHtml).join("<br><br>"),
      error: issue.message ? escapeHtml(issue.message) : null,
      translate: false,
      buttons: [
        { text: "alert.close", color: "default", value: "close" },
        ...(issue.canReset ? [{ text: "options.storage.recovery.reset", color: "error", value: "reset" }] : []),
        { text: "options.storage.recovery.retry", color: "info", value: "retry" },
      ],
    },
    async (value: string) => {
      if (value === "retry") {
        Telemetry.track("storage_recovery_action", { action: "retry", attempts });
        await storage()?.restart?.();
      } else if (value === "reset" && (await $alert.confirm(t("options.storage.recovery.reset_confirm")))) {
        Telemetry.track("storage_recovery_action", { action: "reset", attempts });
        await storage()?.recover?.("reset");
      }
    }
  );
}

/**
 * Uma versão anterior foi aberta depois da atualização e o que se fez nela
 * ficou na pasta antiga. Pergunta uma vez; qualquer resposta que não seja
 * trazer de volta mantém como está e não pergunta de novo.
 */
export async function offerOlderVersionData(t: Translate, locale = "pt-BR"): Promise<void> {
  const older = await Promise.resolve(storage()?.olderVersion?.()).catch(() => null);
  if (!older) return;
  const when = new Date(older.since).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  $alert.show(
    {
      title: t("options.storage.recovery.older_title"),
      text: escapeHtml(t("options.storage.recovery.older_text", { when })),
      translate: false,
      buttons: [
        { text: "options.storage.recovery.keep", color: "default", value: "keep" },
        { text: "options.storage.recovery.reimport", color: "info", value: "reimport" },
      ],
    },
    async (value: string) => {
      if (value === "reimport" && (await $alert.confirm(t("options.storage.recovery.reimport_confirm")))) {
        Telemetry.track("storage_recovery_action", { action: "reimport" });
        await storage()?.recover?.("reimport");
        return;
      }
      Telemetry.track("storage_recovery_action", { action: "keep" });
      await storage()?.keepCurrentVersion?.();
    }
  );
}
