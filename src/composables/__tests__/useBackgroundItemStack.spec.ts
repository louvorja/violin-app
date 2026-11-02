import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive, ref } from "vue";
import {
  BACKGROUND_FIRST_FRAME_TIMEOUT_MS,
  useBackgroundItemStack,
} from "@/composables/useBackgroundItemStack";

function montar() {
  const item = reactive({ active: false, type: "", url: "" });
  const fadeMs = ref(500);
  let api!: ReturnType<typeof useBackgroundItemStack>;
  const wrapper: VueWrapper = mount({
    setup() {
      api = useBackgroundItemStack(item, fadeMs);
      return () => null;
    },
  });
  return { item, fadeMs, api, wrapper };
}

let ctx: ReturnType<typeof montar>;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  ctx?.wrapper.unmount();
  vi.useRealTimers();
});

async function ativar(url: string, type = "image") {
  ctx.item.active = true;
  ctx.item.type = type;
  ctx.item.url = url;
  await nextTick();
}

describe("useBackgroundItemStack", () => {
  it("espera o primeiro frame antes de animar a camada inicial", async () => {
    ctx = montar();
    await ativar("a");

    expect(ctx.api.layers.value).toHaveLength(1);
    const key = ctx.api.layers.value[0].key;
    expect(ctx.api.pendingKey.value).toBe(key);
    expect(ctx.api.enteringKey.value).toBeNull();

    ctx.api.markReady(key);
    expect(ctx.api.pendingKey.value).toBeNull();
    expect(ctx.api.enteringKey.value).toBe(key);

    vi.advanceTimersByTime(500);
    expect(ctx.api.layers.value).toHaveLength(1);
    expect(ctx.api.enteringKey.value).toBeNull();
  });

  it("coloca o novo por cima e só remove o antigo depois do fade", async () => {
    ctx = montar();
    await ativar("a");
    const a = ctx.api.layers.value[0].key;
    ctx.api.markReady(a);
    vi.advanceTimersByTime(500);

    await ativar("b");
    expect(ctx.api.layers.value).toHaveLength(2);
    const b = ctx.api.layers.value[1].key;
    expect(ctx.api.layers.value[0].key).toBe(a);
    expect(ctx.api.pendingKey.value).toBe(b);
    expect(ctx.api.enteringKey.value).toBeNull();

    ctx.api.markReady(b);
    expect(ctx.api.enteringKey.value).toBe(b);
    vi.advanceTimersByTime(500);

    expect(ctx.api.layers.value).toHaveLength(1);
    expect(ctx.api.layers.value[0].key).toBe(b);
  });

  it("troca enquanto a anterior ainda carrega e descarta a pendente", async () => {
    ctx = montar();
    await ativar("a");
    expect(ctx.api.layers.value).toHaveLength(1);

    await ativar("b");
    expect(ctx.api.layers.value).toHaveLength(1);
    const b = ctx.api.layers.value[0].key;
    expect(ctx.api.pendingKey.value).toBe(b);
  });

  it("troca rápida durante o fade congela a anterior e anima só a nova", async () => {
    ctx = montar();
    await ativar("a");
    const a = ctx.api.layers.value[0].key;
    ctx.api.markReady(a);
    vi.advanceTimersByTime(200);

    await ativar("b");
    expect(ctx.api.layers.value).toHaveLength(2);
    expect(ctx.api.enteringKey.value).toBeNull();
    const b = ctx.api.layers.value[1].key;

    ctx.api.markReady(b);
    expect(ctx.api.enteringKey.value).toBe(b);
    vi.advanceTimersByTime(500);
    expect(ctx.api.layers.value).toHaveLength(1);
    expect(ctx.api.layers.value[0].key).toBe(b);
  });

  it("se o primeiro frame não chega, começa no timeout", async () => {
    ctx = montar();
    await ativar("a");
    const a = ctx.api.layers.value[0].key;
    expect(ctx.api.pendingKey.value).toBe(a);

    vi.advanceTimersByTime(BACKGROUND_FIRST_FRAME_TIMEOUT_MS);
    expect(ctx.api.pendingKey.value).toBeNull();
    expect(ctx.api.enteringKey.value).toBe(a);

    vi.advanceTimersByTime(500);
    expect(ctx.api.layers.value).toHaveLength(1);
  });

  it("a mesma URL não cria outra camada e reset limpa tudo", async () => {
    ctx = montar();
    await ativar("a");
    const a = ctx.api.layers.value[0].key;
    ctx.api.markReady(a);
    vi.advanceTimersByTime(500);

    await ativar("a", "image");
    expect(ctx.api.layers.value).toHaveLength(1);

    ctx.api.reset();
    expect(ctx.api.layers.value).toHaveLength(0);
    expect(ctx.api.pendingKey.value).toBeNull();
    expect(ctx.api.enteringKey.value).toBeNull();
  });

  it("parar remove a pendente e mantém a camada visível até o reset", async () => {
    ctx = montar();
    await ativar("a");
    expect(ctx.api.layers.value).toHaveLength(1);

    await ativar("b");
    expect(ctx.api.layers.value).toHaveLength(1);

    ctx.item.active = false;
    await nextTick();
    expect(ctx.api.layers.value).toHaveLength(0);

    ctx.item.active = true;
    ctx.item.url = "c";
    await nextTick();
    expect(ctx.api.layers.value).toHaveLength(1);
  });
});
