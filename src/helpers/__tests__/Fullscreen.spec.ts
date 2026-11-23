import { describe, expect, it } from "vitest";
import { computed, defineComponent, h, nextTick, ref, watch } from "vue";
import { mount } from "@vue/test-utils";
import { useFullscreenStage } from "@/helpers/Fullscreen";

/** Como o `<Fullscreen>` do vue-fullscreen: só pede tela cheia quando o v-model muda. */
function fakeFullscreen(requests: { count: number }) {
  return defineComponent({
    props: { modelValue: { type: Boolean, default: false } },
    emits: ["update:modelValue"],
    setup(props) {
      watch(
        () => props.modelValue,
        (value) => {
          if (value) requests.count++;
        }
      );
      return () => h("div");
    },
  });
}

function mountStage(initial: boolean) {
  const requests = { count: 0 };
  const Fullscreen = fakeFullscreen(requests);
  const active = ref(initial);
  const visible = ref(true);
  const host = mount(
    defineComponent({
      setup() {
        const flag = computed({ get: () => active.value, set: (value) => (active.value = value) });
        const { stage, model } = useFullscreenStage(flag);
        return () =>
          visible.value
            ? h(Fullscreen, {
                ref: stage,
                modelValue: model.value,
                "onUpdate:modelValue": (value: boolean) => (model.value = value),
              })
            : null;
      },
    })
  );
  return { requests, active, visible, stage: () => host.findComponent(Fullscreen) };
}

describe("useFullscreenStage", () => {
  it("pede tela cheia uma vez quando o palco monta já com ela ligada", async () => {
    const { requests } = mountStage(true);
    await nextTick();
    await nextTick();
    expect(requests.count).toBe(1);
  });

  it("pede uma vez quando a tela cheia liga com o palco já montado", async () => {
    const { requests, active } = mountStage(false);
    await nextTick();
    expect(requests.count).toBe(0);
    active.value = true;
    await nextTick();
    await nextTick();
    expect(requests.count).toBe(1);
  });

  it("pede de novo quando o palco é remontado com a tela cheia ligada", async () => {
    const { requests, visible } = mountStage(true);
    await nextTick();
    await nextTick();
    visible.value = false;
    await nextTick();
    visible.value = true;
    await nextTick();
    await nextTick();
    expect(requests.count).toBe(2);
  });

  it("repassa ao flag a saída comunicada pelo componente", async () => {
    const { active, stage } = mountStage(true);
    await nextTick();
    await nextTick();
    stage().vm.$emit("update:modelValue", false);
    expect(active.value).toBe(false);
  });
});
