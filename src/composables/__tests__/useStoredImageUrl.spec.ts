import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { useStoredImageUrl } from "../useStoredImageUrl";
import { getImageBlob } from "@/helpers/AudioLibrary";

vi.mock("@/helpers/AudioLibrary", () => ({ getImageBlob: vi.fn() }));
const scopes: ReturnType<typeof effectScope>[] = [];
function setup(source: ReturnType<typeof ref<string>>) {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => useStoredImageUrl(source))!;
}
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.restoreAllMocks();
});

describe("imagem persistida dos módulos", () => {
  it("preserva URLs antigas e desktop sem consultar a biblioteca", async () => {
    vi.mocked(getImageBlob).mockClear();
    const source = ref("data:image/png;base64,old");
    const url = setup(source);
    expect(url.value).toBe(source.value);
    source.value = "louvorja://local/background.png";
    await nextTick();
    expect(url.value).toBe(source.value);
    expect(getImageBlob).not.toHaveBeenCalled();
  });

  it("descarta leitura antiga e revoga somente a URL de seu consumidor", async () => {
    let finish!: (_blob: Blob) => void;
    vi.mocked(getImageBlob)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(new Blob(["new"]));
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:preview")
      .mockReturnValueOnce("blob:projection");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const source = ref("lib://image/old.png");
    const preview = setup(source);
    source.value = "lib://image/new.png";
    await nextTick();
    await nextTick();
    const projection = setup(source);
    await nextTick();
    finish(new Blob(["old"]));
    await nextTick();
    expect(create).toHaveBeenCalledTimes(2);
    expect(preview.value).toBe("blob:preview");
    expect(projection.value).toBe("blob:projection");
    scopes.shift()!.stop();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:preview");
    expect(projection.value).toBe("blob:projection");
  });

  it("uma imagem removida não mantém o fundo anterior", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:existing");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(getImageBlob)
      .mockResolvedValueOnce(new Blob(["image"]))
      .mockResolvedValueOnce(null);
    const source = ref("lib://image/exists.png");
    const url = setup(source);
    await nextTick();
    source.value = "lib://image/missing.png";
    await nextTick();
    expect(url.value).toBe("");
    expect(revoke).toHaveBeenCalledWith("blob:existing");
  });
});
