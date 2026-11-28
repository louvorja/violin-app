import { describe, expect, it, vi } from "vitest";
import {
  AUTO_DOWNLOAD_UPDATES_DEFAULT,
  autoDownloadUpdatesEnabled,
  createUpdateOutcomeTracker,
  startupActionForAvailableUpdate,
} from "@/helpers/AppUpdatePrompt";

describe("download automático de atualizações", () => {
  it("vem ligado para quem nunca mexeu na opção", () => {
    expect(AUTO_DOWNLOAD_UPDATES_DEFAULT).toBe(true);
    for (const saved of [null, undefined, "", "false", 0]) {
      expect(autoDownloadUpdatesEnabled(saved)).toBe(true);
    }
  });

  it("respeita a escolha salva", () => {
    expect(autoDownloadUpdatesEnabled(false)).toBe(false);
    expect(autoDownloadUpdatesEnabled(true)).toBe(true);
  });
});

describe("abertura com versão nova", () => {
  const base = {
    startupCheckPending: true,
    autoDownload: false,
    newVersion: "2.0.1",
    skippedVersion: "",
  };

  it("com download manual, mostra o aviso", () => {
    expect(startupActionForAvailableUpdate(base)).toBe("prompt");
  });

  it("não insiste na versão dispensada, mas avisa da seguinte", () => {
    expect(startupActionForAvailableUpdate({ ...base, skippedVersion: "2.0.1" })).toBe("suppressed");
    expect(startupActionForAvailableUpdate({ ...base, skippedVersion: "2.0.0" })).toBe("prompt");
  });

  it("com download automático, segue a abertura sem esperar o download", () => {
    expect(startupActionForAvailableUpdate({ ...base, autoDownload: true })).toBe("continue");
    expect(
      startupActionForAvailableUpdate({ ...base, autoDownload: true, skippedVersion: "2.0.1" })
    ).toBe("continue");
  });

  it("fora da verificação da abertura, não mexe em nada", () => {
    expect(startupActionForAvailableUpdate({ ...base, startupCheckPending: false })).toBe("ignore");
    expect(
      startupActionForAvailableUpdate({ ...base, startupCheckPending: false, autoDownload: true })
    ).toBe("ignore");
  });

  it("sem versão informada, nenhuma dispensa vazia esconde o aviso", () => {
    expect(startupActionForAvailableUpdate({ ...base, newVersion: "", skippedVersion: "" })).toBe(
      "prompt"
    );
  });
});

describe("desfecho do download", () => {
  it("registra pronto para instalar uma vez por versão", () => {
    const track = vi.fn();
    const onState = createUpdateOutcomeTracker(track);

    onState({ status: "downloading", newVersion: "2.0.1" });
    onState({ status: "downloaded", newVersion: "2.0.1", installRequiresElevation: true });
    onState({ status: "downloaded", newVersion: "2.0.1", installRequiresElevation: true });

    expect(track).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledWith("app_update_ready_to_install", {
      version: "2.0.1",
      install_requires_elevation: true,
    });
  });

  it("registra a falha do download com o tipo, nunca o texto do erro", () => {
    const track = vi.fn();
    const onState = createUpdateOutcomeTracker(track);

    onState({ status: "downloading", newVersion: "2.0.1" });
    onState({ status: "error", errorKind: "network" });
    onState({ status: "downloading", newVersion: "2.0.1" });
    onState({ status: "error", errorKind: "ECONNRESET at C:\\Users\\alguem" });

    expect(track.mock.calls).toEqual([
      ["app_update_download_errored", { version: "2.0.1", error_kind: "network" }],
      ["app_update_download_errored", { version: "2.0.1", error_kind: "unknown" }],
    ]);
  });

  it("erro da verificação, sem download em curso, não conta como falha de download", () => {
    const track = vi.fn();
    const onState = createUpdateOutcomeTracker(track);

    onState({ status: "checking" });
    onState({ status: "error", errorKind: "http" });
    onState({ status: "downloading", newVersion: "2.0.1" });
    onState({ status: "available", newVersion: "2.0.1" });
    onState({ status: "error", errorKind: "http" });
    onState(null);

    expect(track).not.toHaveBeenCalled();
  });
});
