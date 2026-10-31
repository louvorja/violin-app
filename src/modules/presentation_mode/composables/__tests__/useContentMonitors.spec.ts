import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";

const state = vi.hoisted(() => ({
  isDesktop: true,
  featureRoles: {} as Record<string, string | null>,
}));
vi.mock("@/helpers/Platform", () => ({
  default: {
    get isDesktop() {
      return state.isDesktop;
    },
  },
}));
const roles = ref([
  { role: "projection", status: "resolved", reason: null, displayId: 2 as number | null },
]);
// Como o useDisplays de verdade: trocar o papel sobe o contador compartilhado.
const featureRolesVersion = ref(0);
const setFeatureRole = vi.fn(async (feature: string, role: string | null) => {
  state.featureRoles[feature] = role;
  featureRolesVersion.value += 1;
});
vi.mock("@/composables/useDisplays", () => ({
  useDisplays: () => ({
    roles,
    getFeatureRole: async (feature: string) => state.featureRoles[feature] ?? null,
    setFeatureRole,
    featureRolesVersion,
  }),
}));

const { divergingFeatures, useContentMonitors } = await import("../useContentMonitors");

function montar() {
  let api!: ReturnType<typeof useContentMonitors>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useContentMonitors();
        return () => h("div");
      },
    })
  );
  return { api, wrapper };
}

describe("arquivos e vídeos fora da Tela principal", () => {
  it("só acusa o que não segue o papel Projeção, e nada sem Tela principal", () => {
    const tudo = { file_projection: "stage", online_video: "projection" };
    expect(divergingFeatures(true, tudo).map((f) => f.feature)).toEqual(["file_projection"]);
    expect(divergingFeatures(true, { file_projection: null }).map((f) => f.feature)).toEqual([
      "file_projection",
    ]);
    expect(divergingFeatures(false, tudo)).toEqual([]);
  });

  it('"Usar a Tela principal" põe as duas opções de volta na Projeção', async () => {
    state.isDesktop = true;
    // Arquivos em "mesma janela" nas Opções, vídeos no retorno.
    state.featureRoles = { file_projection: null, online_video: "stage" };
    const { api, wrapper } = montar();
    await flushPromises();
    expect(api.diverging.value.map((f) => f.feature)).toEqual(["file_projection", "online_video"]);

    await api.followMainScreen();

    expect(setFeatureRole).toHaveBeenCalledWith("file_projection", "projection");
    expect(setFeatureRole).toHaveBeenCalledWith("online_video", "projection");
    expect(api.diverging.value).toEqual([]);
    wrapper.unmount();
  });

  it("no navegador, a feature sem escolha segue o padrão e não acusa nada", async () => {
    state.isDesktop = false;
    state.featureRoles = {};
    const { api, wrapper } = montar();
    await flushPromises();
    expect(api.diverging.value).toEqual([]);
    wrapper.unmount();
  });

  it("percebe a troca feita nas Opções na hora, sem relógio", async () => {
    vi.useFakeTimers();
    state.isDesktop = true;
    state.featureRoles = { file_projection: "projection", online_video: "projection" };
    const { api, wrapper } = montar();
    await vi.waitFor(() => expect(api.featureRoles.value.file_projection).toBe("projection"));
    expect(vi.getTimerCount()).toBe(0);

    // As Opções gravam pelo mesmo useDisplays.
    await setFeatureRole("file_projection", "operator");
    await vi.waitFor(() =>
      expect(api.diverging.value.map((f) => f.feature)).toEqual(["file_projection"])
    );

    wrapper.unmount();
    vi.useRealTimers();
  });
});
