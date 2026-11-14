import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import $userdata from "@/helpers/UserData";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { ModulePresentationAuthority } from "@/presentation/ModulePresentationState";
import { useModuleMirror } from "../useModuleMirror";

const i18n = createI18n({ legacy: false, locale: "pt", messages: { pt: {} } });

function mountMirror(sources: string[]) {
  const list = reactive([...sources]);
  let api!: ReturnType<typeof useModuleMirror>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useModuleMirror(() => list);
        return () =>
          h(
            "div",
            list.map((source) => h("p", api.mirrorText(source)))
          );
      },
    }),
    { global: { plugins: [i18n] } }
  );
  return {
    list,
    text: (source: string) => api.mirrorText(source),
    lines: () => wrapper.findAll("p").map((line) => line.text()),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 14, 9, 25, 7, 400));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("espelho de módulo antes de o módulo ser aberto (#58)", () => {
  it("mostra o que cada módulo mostra ao abrir, em vez de um traço", () => {
    $userdata.set(KEYS.MODULES.TIMER_WORSHIP.LAST_TARGET_TIME, "10:00");
    $userdata.set(KEYS.MODULES.TIMER.SHOW_TARGET_TIME, false);
    const { text } = mountMirror([ModuleEnum.TIMER_WORSHIP]);

    expect(text(ModuleEnum.TIMER_WORSHIP)).toBe("00:00:00\n10:00");
    expect(text(ModuleEnum.TIMER)).toBe("00:00:00");
    expect(text(ModuleEnum.COUNTER)).toBe("0");
    expect(text(ModuleEnum.STOPWATCH)).toBe("00:00");
  });

  it("o relógio anda sozinho, vira junto com o segundo e segue as opções do Relógio", async () => {
    const { lines } = mountMirror([ModuleEnum.CLOCK]);
    expect(lines()).toEqual(["09:25:07"]);

    await vi.advanceTimersByTimeAsync(600);
    expect(lines()).toEqual(["09:25:08"]);

    $userdata.set("modules.clock.time_format", "hh:mm");
    await nextTick();
    expect(lines()).toEqual(["09:25"]);
  });

  it("o valor do módulo aberto substitui o inicial; a hora continua sendo a calculada aqui", async () => {
    const { lines } = mountMirror([ModuleEnum.COUNTER, ModuleEnum.CLOCK]);
    const authority = new ModulePresentationAuthority();
    const publish = (module: string, text: string) =>
      Broadcast.send(
        BROADCAST_TYPE.MODULE_PROJECTION_VALUE,
        authority.publish({ module, text, active: true })
      );

    publish(ModuleEnum.COUNTER, "7");
    publish(ModuleEnum.CLOCK, "08:00:00");
    await nextTick();

    expect(lines()).toEqual(["7", "09:25:07"]);
  });

  it("pede uma vez à janela principal o último valor de cada módulo espelhado", async () => {
    const send = vi.spyOn(Broadcast, "send");
    const requested = () =>
      send.mock.calls
        .filter(([type]) => type === BROADCAST_TYPE.REQUEST_MODULE_STATE)
        .map(([, payload]) => (payload as { module: string }).module);
    const { list } = mountMirror([ModuleEnum.TIMER, ModuleEnum.TIMER, ModuleEnum.CLOCK]);
    expect(requested()).toEqual([ModuleEnum.TIMER, ModuleEnum.CLOCK]);

    list.push(ModuleEnum.COUNTER);
    await nextTick();
    expect(requested()).toEqual([ModuleEnum.TIMER, ModuleEnum.CLOCK, ModuleEnum.COUNTER]);
  });
});
