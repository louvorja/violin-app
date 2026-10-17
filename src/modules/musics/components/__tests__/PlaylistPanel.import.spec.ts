import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { makeI18n } from "@/components/ui/__tests__/mountUi";
import ptApp from "@/lang/pt.json";
import esApp from "@/lang/es.json";
import ptMusics from "../../lang/pt.json";
import esMusics from "../../lang/es.json";
import type { Playlist } from "@/types/Music";

const mocks = vi.hoisted(() => ({
  importPlaylist: vi.fn(),
  track: vi.fn(),
  captureException: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("../../composables/usePlaylists", async () => {
  const { ref } = await import("vue");
  return {
    usePlaylists: () => ({
      playlists: ref([]),
      selectedPlaylistId: ref(null),
      createPlaylist: vi.fn(),
      renamePlaylist: vi.fn(),
      deletePlaylist: vi.fn(),
      selectPlaylist: vi.fn(),
      getPlaylistDuration: vi.fn(),
      exportPlaylist: vi.fn(),
      importPlaylist: mocks.importPlaylist,
    }),
  };
});
vi.mock("@/components/ui", () => ({
  LjIcon: { template: "<span />" },
  LjInput: { template: "<input />" },
}));
vi.mock("@/helpers/Alert", () => ({ default: { confirm: vi.fn() } }));
vi.mock("@/helpers/Snackbar", () => ({ default: { error: mocks.notifyError } }));
vi.mock("@/helpers/Telemetry", () => ({
  default: { track: mocks.track, captureException: mocks.captureException },
}));
vi.mock("@/helpers/ScrollMemory", () => ({
  setScrollPosition: vi.fn(),
  getScrollPosition: () => 0,
}));

const { default: PlaylistPanel } = await import("../PlaylistPanel.vue");
const imported: Playlist = {
  id: "imported",
  name: "Culto",
  songs: [],
  createdAt: "2026-10-07T12:00:00.000Z",
  updatedAt: "2026-10-07T12:00:00.000Z",
};
const wrappers: VueWrapper[] = [];
let selectedFile: File | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  selectedFile = null;
  mocks.importPlaylist.mockReset().mockResolvedValue(imported);
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    // eslint-disable-next-line no-unused-vars -- Receiver do TypeScript, usado pelo corpo como this.
    this: HTMLInputElement
  ) {
    Object.defineProperty(this, "files", { value: selectedFile ? [selectedFile] : [] });
    this.dispatchEvent(new Event("change"));
  });
});

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
});

async function selectImport(text: string | null, locale: "pt" | "es" = "pt", readError?: Error) {
  const i18n = makeI18n(locale);
  i18n.global.setLocaleMessage("pt", {
    ...ptApp,
    modules: { ...ptApp.modules, musics: ptMusics },
  });
  i18n.global.setLocaleMessage("es", {
    ...esApp,
    modules: { ...esApp.modules, musics: esMusics },
  });
  if (text !== null) {
    selectedFile = new File([text], "playlist.json", { type: "application/json" });
    Object.defineProperty(selectedFile, "text", {
      value: readError ? vi.fn().mockRejectedValue(readError) : vi.fn().mockResolvedValue(text),
    });
  }
  const wrapper = mount(PlaylistPanel, { shallow: true, global: { plugins: [i18n] } });
  wrappers.push(wrapper);
  const label = locale === "pt" ? ptMusics.playlists.import : esMusics.playlists.import;
  await wrapper.get(`button[aria-label="${label}"]`).trigger("click");
  await flushPromises();
}

describe("PlaylistPanel — resultado da importação de arquivo", () => {
  it("registra sucesso somente depois de criar a playlist", async () => {
    await selectImport(JSON.stringify(imported));

    expect(mocks.importPlaylist).toHaveBeenCalledWith(imported);
    expect(mocks.track).toHaveBeenCalledWith("music_playlist_imported", { format: "json" });
    expect(mocks.track.mock.calls.map(([event]) => event)).not.toContain(
      "music_playlist_import_failed"
    );
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it.each([
    ["pt", "Falha ao importar: arquivo inválido."],
    ["es", "Falló al importar: archivo inválido."],
  ] as const)(
    "informa rejeição do formato em %s, sem sucesso nem conteúdo bruto",
    async (locale, message) => {
      mocks.importPlaylist.mockResolvedValue(null);
      await selectImport(JSON.stringify({ name: "PRIVATE_FILE_CONTENT", songs: [null] }), locale);

      expect(mocks.notifyError).toHaveBeenCalledWith(message);
      expect(mocks.track).toHaveBeenCalledWith("music_playlist_import_failed", {
        format: "json",
        reason: "invalid_format",
      });
      expect(mocks.track.mock.calls.map(([event]) => event)).not.toContain(
        "music_playlist_imported"
      );
      expect(mocks.captureException).not.toHaveBeenCalled();
      expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("PRIVATE_FILE_CONTENT");
    }
  );

  it("informa JSON inválido sem enviar trechos do arquivo em exceções", async () => {
    await selectImport("PRIVATE_FILE_CONTENT { arquivo inválido");

    expect(mocks.importPlaylist).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith("Falha ao importar: arquivo inválido.");
    expect(mocks.track).toHaveBeenCalledWith("music_playlist_import_failed", {
      format: "json",
      reason: "invalid_json",
    });
    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("PRIVATE_FILE_CONTENT");
  });

  it.each(["leitura", "gravação"])("informa falha de %s sem sucesso", async (operation) => {
    const error = new Error("armazenamento indisponível");
    if (operation === "gravação") mocks.importPlaylist.mockRejectedValue(error);
    await selectImport(JSON.stringify(imported), "pt", operation === "leitura" ? error : undefined);

    expect(mocks.notifyError).toHaveBeenCalledWith("Falha ao importar: arquivo inválido.");
    expect(mocks.captureException).toHaveBeenCalledWith(error, { source: "music_playlist_import" });
    expect(mocks.track).toHaveBeenCalledWith("music_playlist_import_failed", {
      format: "json",
      reason: "exception",
    });
    expect(mocks.track.mock.calls.map(([event]) => event)).not.toContain("music_playlist_imported");
  });

  it("cancelar o seletor não registra importação nem erro", async () => {
    await selectImport(null);

    expect(mocks.importPlaylist).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });
});
