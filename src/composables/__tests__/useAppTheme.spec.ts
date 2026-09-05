import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAppTheme } from "@/composables/useAppTheme";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { DEFAULT_THEME_ID } from "@/config/Themes";

/**
 * Os três efeitos da troca de tema estavam copiados em cinco telas, e cada
 * cópia esquecia um: o `is_dark` que outras telas leem, o atributo sem o qual
 * os tokens não entram, e — no episódio que motivou tudo isto — a chave certa
 * do UserData, com o tema indo parar numa chave morta.
 */
describe("useAppTheme", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    $userdata.set(KEYS.OPTIONS.THEME, undefined);
    $userdata.set(KEYS.OPTIONS.THEME_LAST_LIGHT, undefined);
    $userdata.set("theme", undefined);
    delete document.documentElement.dataset.theme;
  });

  it("carimba o tema no <html>", () => {
    useAppTheme().setTheme("green");
    expect(document.documentElement.dataset.theme).toBe("green");
  });

  it("persiste em options.theme, não na chave solta", () => {
    useAppTheme().setTheme("green");
    expect($userdata.get(KEYS.OPTIONS.THEME)).toBe("green");
    expect($userdata.get("theme")).toBeNull();
  });

  it("sincroniza o sinalizador de escuro", () => {
    const { setTheme, isDark } = useAppTheme();

    setTheme("dark");
    expect(isDark.value).toBe(true);
    expect($appdata.get(KEYS.SHELL.IS_DARK)).toBe(true);

    setTheme("light");
    expect(isDark.value).toBe(false);
    expect($appdata.get(KEYS.SHELL.IS_DARK)).toBe(false);
  });

  it("tema escuro e tema claro não produzem o mesmo estado", () => {
    const { setTheme } = useAppTheme();

    setTheme("dark");
    const escuro = {
      attr: document.documentElement.dataset.theme,
      stored: $userdata.get(KEYS.OPTIONS.THEME),
      isDark: $appdata.get(KEYS.SHELL.IS_DARK),
    };

    setTheme("terracota");
    const claro = {
      attr: document.documentElement.dataset.theme,
      stored: $userdata.get(KEYS.OPTIONS.THEME),
      isDark: $appdata.get(KEYS.SHELL.IS_DARK),
    };

    expect(claro).not.toEqual(escuro);
    expect(claro).toEqual({ attr: "terracota", stored: "terracota", isDark: false });
  });

  it("o tema atual acompanha o que está persistido", () => {
    const { current } = useAppTheme();
    expect(current.value).toBe(DEFAULT_THEME_ID);

    $userdata.set(KEYS.OPTIONS.THEME, "pink");
    expect(current.value).toBe("pink");
  });

  it("id fora do registro cai no tema padrão", () => {
    $userdata.set(KEYS.OPTIONS.THEME, "roxo-neon");
    expect(useAppTheme().current.value).toBe(DEFAULT_THEME_ID);
  });

  it("alternar volta para o último tema claro em uso", () => {
    const { setTheme, toggleDark, current } = useAppTheme();

    setTheme("orange");
    toggleDark();
    expect(current.value).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    toggleDark();
    expect(current.value).toBe("orange");
    expect($appdata.get(KEYS.SHELL.IS_DARK)).toBe(false);
  });

  it("sem claro anterior, alternar sai do escuro pelo tema padrão", () => {
    const { setTheme, toggleDark, current } = useAppTheme();
    setTheme("dark");
    toggleDark();
    expect(current.value).toBe(DEFAULT_THEME_ID);
  });

  it("no boot aplica o tema persistido sem regravá-lo", () => {
    $userdata.set(KEYS.OPTIONS.THEME, "blue");

    expect(useAppTheme().applyStoredTheme()).toBe("blue");
    expect(document.documentElement.dataset.theme).toBe("blue");
    expect($appdata.get(KEYS.SHELL.IS_DARK)).toBe(false);
    expect($userdata.get(KEYS.OPTIONS.THEME_LAST_LIGHT)).toBeNull();
  });

  it("a prévia carimba o documento sem tocar no que está salvo", () => {
    const { previewTheme } = useAppTheme();
    $userdata.set(KEYS.OPTIONS.THEME, "blue");

    previewTheme("purple");
    expect(document.documentElement.dataset.theme).toBe("purple");
    expect($userdata.get(KEYS.OPTIONS.THEME)).toBe("blue");
  });

  it("recusa em tempo de compilação um tema fora do registro", () => {
    const { setTheme } = useAppTheme();
    // @ts-expect-error — o union de ThemeId é a rede que pega tema inventado.
    setTheme("roxo-neon");
    expect(useAppTheme().current.value).toBe(DEFAULT_THEME_ID);
  });
});
