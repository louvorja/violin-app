import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock("@/helpers/Broadcast", () => ({
  default: { send: (type: string, payload: unknown) => sent.push([type, payload]), listen: vi.fn() },
}));
vi.mock("@/helpers/Platform", () => ({ default: { isDesktop: false } }));
vi.mock("@/helpers/Telemetry", () => ({ default: { track: vi.fn(), captureException: vi.fn() } }));
vi.mock("@/helpers/ProjectionWindows", () => ({
  closeProjectionWindows: vi.fn(),
  controlPresentationScreens: vi.fn(),
  keepPresentationScreens: vi.fn(),
  openMediaWindow: vi.fn(async () => {}),
}));
vi.mock("@/helpers/Projection", () => ({ close: vi.fn() }));
vi.mock("@/composables/useProjectionShutdown", () => ({ closingOnPurpose: vi.fn() }));
vi.mock("@/helpers/projection/webWindow", () => ({ isWebWindowOpen: () => true }));
vi.mock("@/helpers/AppData", () => ({ default: { get: (_k: string, f?: unknown) => f, set: vi.fn() } }));
vi.mock("@/composables/useDisplays", () => ({ useDisplays: () => ({}) }));
vi.mock("../useLiveContent", () => ({ useLiveContent: () => ({}) }));

const { BROADCAST_TYPE } = await import("@/helpers/BroadcastTypes");
const { returnOverride, showOnReturn } = await import("../useOutputs");

/** O último `<video>` que o player do retorno criou; o jsdom não toca nada. */
function playerVideos(): () => HTMLVideoElement {
  const created: HTMLVideoElement[] = [];
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string, opts?: ElementCreationOptions) => {
    const el = original(tag, opts);
    if (tag === "video") {
      (el as HTMLVideoElement).play = vi.fn(async () => {});
      (el as HTMLVideoElement).pause = vi.fn();
      (el as HTMLVideoElement).load = vi.fn();
      created.push(el as HTMLVideoElement);
    }
    return el;
  });
  return () => created.at(-1) as HTMLVideoElement;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await showOnReturn(null);
  sent.length = 0;
});

describe("vídeo só no retorno", () => {
  it("ao acabar, sai do retorno: nem o último quadro nem a miniatura ficam presos", async () => {
    const video = playerVideos();
    await showOnReturn({ type: "video", url: "louvorja://local/especial.mp4", title: "Especial", path: "/x/especial.mp4" });
    expect(returnOverride.value?.type).toBe("video");

    video().dispatchEvent(new Event("ended"));

    expect(returnOverride.value).toBeNull();
    expect(sent.at(-1)).toEqual([BROADCAST_TYPE.RETURN_OVERRIDE, { active: false }]);
  });

  it("o fim de um vídeo que já saiu não tira o que entrou depois", async () => {
    const video = playerVideos();
    await showOnReturn({ type: "video", url: "louvorja://local/a.mp4", title: "A", path: "/x/a.mp4" });
    const first = video();
    await showOnReturn({ type: "image", url: "louvorja://local/recado.jpg", title: "Recado", path: "/x/recado.jpg" });

    first.dispatchEvent(new Event("ended"));

    expect(returnOverride.value?.type).toBe("image");
  });
});
