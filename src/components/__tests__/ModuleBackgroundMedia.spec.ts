import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ModuleBackgroundMedia from "../ModuleBackgroundMedia.vue";

describe("ModuleBackgroundMedia — fundo de módulo", () => {
  it("renderiza vídeo em loop, mudo e sem controles", () => {
    const w = mount(ModuleBackgroundMedia, {
      props: { src: "louvorja://local/video.mp4" },
      attrs: { class: "module-bg", style: "object-fit: cover" },
    });

    const video = w.find("video");
    expect(video.exists()).toBe(true);
    expect(video.attributes("src")).toContain("video.mp4");
    expect(video.attributes("autoplay")).toBeDefined();
    expect(video.attributes("loop")).toBeDefined();
    expect((video.element as HTMLVideoElement).muted).toBe(true);
    expect(video.attributes("controls")).toBeUndefined();
    expect(video.classes()).toContain("module-bg");
    expect(video.attributes("style")).toContain("object-fit: cover");
  });

  it("mantém GIF/imagem no <img>", () => {
    const w = mount(ModuleBackgroundMedia, {
      props: { src: "louvorja://local/fundo.gif" },
    });

    expect(w.find("video").exists()).toBe(false);
    expect(w.find("img").attributes("src")).toContain("fundo.gif");
  });

  it("força vídeo para blob sem extensão quando o caller sabe o tipo", () => {
    const w = mount(ModuleBackgroundMedia, {
      props: { src: "blob:http://localhost/abc", video: true },
    });

    expect(w.find("video").exists()).toBe(true);
  });

  it("reconhece o marcador #video de mídia sem extensão", () => {
    const w = mount(ModuleBackgroundMedia, {
      props: { src: "blob:http://localhost/abc#video" },
    });

    expect(w.find("video").exists()).toBe(true);
  });
});
