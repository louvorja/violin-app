import { describe, expect, it } from "vitest";
import {
  AUTO_THEME_ID,
  DARK_THEME_ID,
  DEFAULT_THEME_ID,
  DEFAULT_THEME_PREFERENCE,
  THEME_IDS,
  isThemeId,
  isThemePreference,
  pickLightTheme,
  resolveTheme,
} from "@/config/Themes";

describe("Themes — preferência Automático", () => {
  it("o Automático é uma preferência, não um tema", () => {
    expect(isThemePreference(AUTO_THEME_ID)).toBe(true);
    expect(isThemeId(AUTO_THEME_ID)).toBe(false);
    expect(THEME_IDS).not.toContain(AUTO_THEME_ID);
  });

  it("todo tema do registro é uma preferência válida; lixo não é", () => {
    for (const id of THEME_IDS) expect(isThemePreference(id)).toBe(true);
    expect(isThemePreference("roxo-neon")).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it("quem nunca escolheu acompanha o sistema", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe(AUTO_THEME_ID);
  });
});

describe("pickLightTheme", () => {
  it("devolve o último tema claro guardado", () => {
    expect(pickLightTheme("green")).toBe("green");
  });

  it("sem nada guardado, cai no tema padrão", () => {
    expect(pickLightTheme(null)).toBe(DEFAULT_THEME_ID);
    expect(pickLightTheme(undefined)).toBe(DEFAULT_THEME_ID);
  });

  it("um valor que não é tema claro não serve de volta do escuro", () => {
    expect(pickLightTheme(DARK_THEME_ID)).toBe(DEFAULT_THEME_ID);
    expect(pickLightTheme(AUTO_THEME_ID)).toBe(DEFAULT_THEME_ID);
    expect(pickLightTheme("roxo-neon")).toBe(DEFAULT_THEME_ID);
  });
});

describe("resolveTheme", () => {
  it("um tema escolhido vale sempre, seja qual for o modo do sistema", () => {
    expect(resolveTheme("green", true, null)).toBe("green");
    expect(resolveTheme("green", false, null)).toBe("green");
    expect(resolveTheme(DARK_THEME_ID, false, "green")).toBe(DARK_THEME_ID);
  });

  it("Automático com o sistema escuro resolve para o tema escuro", () => {
    expect(resolveTheme(AUTO_THEME_ID, true, "green")).toBe(DARK_THEME_ID);
  });

  it("Automático com o sistema claro volta ao último tema claro", () => {
    expect(resolveTheme(AUTO_THEME_ID, false, "green")).toBe("green");
    expect(resolveTheme(AUTO_THEME_ID, false, null)).toBe(DEFAULT_THEME_ID);
  });

  it("nunca resolve para o próprio Automático", () => {
    for (const systemDark of [true, false]) {
      const id = resolveTheme(AUTO_THEME_ID, systemDark, AUTO_THEME_ID);
      expect(isThemeId(id)).toBe(true);
    }
  });
});
