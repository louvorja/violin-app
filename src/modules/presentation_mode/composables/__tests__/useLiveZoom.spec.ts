import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

const sent = vi.hoisted(() => [] as { type: string; payload: unknown }[]);
vi.mock("@/helpers/Broadcast", () => ({
  default: { send: (type: string, payload: unknown) => sent.push({ type, payload }), listen: vi.fn() },
}));
const current = ref<string | null>("file");
const file = ref<{ type: string; url: string; playback_id?: string } | null>({
  type: "pdf",
  url: "blob:x",
  playback_id: "p1",
});
vi.mock("../useLiveContent", () => ({ useLiveContent: () => ({ current, file }) }));
const page = ref(1);
vi.mock("../usePdfDeck", () => ({ usePdfDeck: () => ({ page, thumbs: new Map() }) }));
vi.mock("../useMonitorRole", () => ({
  useMonitorRole: () => ({ size: ref({ width: 1920, height: 1080 }) }),
}));

const { useLiveZoom, _resetLiveZoom } = await import("../useLiveZoom");

describe("useLiveZoom", () => {
  beforeEach(() => {
    _resetLiveZoom();
    sent.length = 0;
    page.value = 1;
  });

  it("ampliar anuncia o recorte para as telas", () => {
    const zoom = useLiveZoom();
    zoom.zoomIn();
    expect(zoom.scale.value).toBe(1.25);
    expect(sent.at(-1)?.payload).toMatchObject({ key: "p1", page: 1, scale: 1.25 });
  });

  it("o ponto sob o cursor fica parado ao ampliar", () => {
    const zoom = useLiveZoom();
    zoom.zoomBy(2, { x: 0.75, y: 0.5 });
    // O ponto 0,75 da imagem continua em 0,75 do visor.
    const z = zoom.current.value!;
    expect(z.cx + (0.75 - 0.5) / z.scale).toBeCloseTo(0.75);
  });

  it("virar a página volta a 100%", async () => {
    const zoom = useLiveZoom();
    zoom.zoomIn();
    page.value = 2;
    await nextTick();
    expect(zoom.scale.value).toBe(1);
    expect(sent.at(-1)?.payload).toEqual({ key: "" });
  });

  it("sem imagem nem PDF no ar, não há zoom", () => {
    file.value = { type: "video", url: "blob:v" };
    const zoom = useLiveZoom();
    zoom.zoomIn();
    expect(zoom.scale.value).toBe(1);
    file.value = { type: "pdf", url: "blob:x", playback_id: "p1" };
  });

  it("PDF: o atalho de detalhe é 2×; clique duplo alterna entre ajustado e ele", () => {
    const zoom = useLiveZoom();
    expect(zoom.detail.value.label).toBe("2×");
    zoom.toggle({ x: 0.5, y: 0.5 });
    expect(zoom.scale.value).toBe(2);
    expect(zoom.percent.value).toBe(200);
    zoom.toggle();
    expect(zoom.scale.value).toBe(1);
  });
});
