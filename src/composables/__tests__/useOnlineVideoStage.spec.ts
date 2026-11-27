import { describe, expect, it, vi, beforeEach } from "vitest";
import { effectScope, nextTick, ref } from "vue";

const stageEpoch = ref(0);
const close = vi.fn(() => {
  stageEpoch.value++;
});

vi.mock("@/composables/useMedia", () => ({
  default: { close, stageEpoch: () => stageEpoch.value },
}));

const { useOnlineVideoStage } = await import("../useOnlineVideoStage");

type Song = { onlineVideo?: { itemKey?: string } } | null;

function setup() {
  const currentSong = ref<Song>(null);
  const scope = effectScope();
  const stage = scope.run(() => useOnlineVideoStage(currentSong))!;
  return { stage, currentSong };
}

/** Como o `Media.openYouTube`: assumir o palco avança a época. */
const opensOnStage = async () => {
  stageEpoch.value++;
  return true;
};

describe("useOnlineVideoStage — o destaque segue o palco, não só os cliques da tela", () => {
  beforeEach(() => {
    stageEpoch.value = 0;
    close.mockClear();
  });

  it("solta o item quando a mídia é fechada por fora (X do player, fim do vídeo)", async () => {
    const { stage } = setup();
    await stage.project("v1", opensOnStage);
    expect(stage.projectingId.value).toBe("v1");

    stageEpoch.value++;
    await nextTick();

    expect(stage.projectingId.value).toBe("");
  });

  it("solta o item quando outro módulo projeta por cima", async () => {
    const { stage } = setup();
    await stage.project("v1", opensOnStage);

    await opensOnStage();
    await nextTick();

    expect(stage.projectingId.value).toBe("");
  });

  it("mantém o item enquanto o palco é o mesmo", async () => {
    const { stage } = setup();
    await stage.project("v1", opensOnStage);
    await nextTick();

    expect(stage.projectingId.value).toBe("v1");
  });

  it("abertura cancelada não deixa o item marcado", async () => {
    const { stage } = setup();

    expect(await stage.project("v1", async () => false)).toBe(false);

    expect(stage.projectingId.value).toBe("");
  });

  it("um segundo pedido durante a abertura fica com o destaque", async () => {
    const { stage } = setup();
    let finishFirst: (_opened: boolean) => void = () => {};
    const first = stage.project("v1", () => new Promise<boolean>((r) => (finishFirst = r)));
    await stage.project("v2", opensOnStage);

    finishFirst(false);
    await first;
    await nextTick();

    expect(stage.projectingId.value).toBe("v2");
  });

  it("parar fecha a mídia e solta o item", async () => {
    const { stage } = setup();
    await stage.project("v1", opensOnStage);

    stage.stop();
    await nextTick();

    expect(close).toHaveBeenCalledWith(true);
    expect(stage.projectingId.value).toBe("");
  });

  it("a playlist conduz o destaque entre itens e o solta ao terminar", async () => {
    const { stage, currentSong } = setup();

    currentSong.value = { onlineVideo: { itemKey: "v1" } };
    await opensOnStage();
    await nextTick();
    expect(stage.projectingId.value).toBe("v1");

    currentSong.value = { onlineVideo: { itemKey: "v2" } };
    await opensOnStage();
    await nextTick();
    expect(stage.projectingId.value).toBe("v2");

    currentSong.value = null;
    await nextTick();
    expect(stage.projectingId.value).toBe("");
  });

  it("o fim de uma playlist que o vídeo avulso substituiu não o derruba", async () => {
    const { stage, currentSong } = setup();
    currentSong.value = { onlineVideo: { itemKey: "v1" } };
    await nextTick();

    await stage.project("v9", opensOnStage);
    currentSong.value = null;
    await nextTick();

    expect(stage.projectingId.value).toBe("v9");
  });
});
