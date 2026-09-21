import { describe, it, expect, beforeEach, vi } from "vitest";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { startThemeSync, useAppTheme } from "@/composables/useAppTheme";
import $appdata from "@/helpers/AppData";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import { AUTO_THEME_ID, DARK_THEME_ID, DEFAULT_THEME_ID } from "@/config/Themes";

/**
 * O jsdom não tem `matchMedia`. Este falso responde só à consulta de esquema
 * escuro e deixa o teste virar o modo do sistema, como o SO faria. Precisa
 * existir antes da primeira leitura do modo: o composable instala o ouvinte
 * uma vez e o reaproveita pelo resto do arquivo.
 */
type ChangeListener = (_event: { matches: boolean }) => void;
const system = { dark: false, listeners: new Set<ChangeListener>() };

function setSystemDark(dark: boolean): void {
  system.dark = dark;
  system.listeners.forEach((listener) => listener({ matches: dark }));
}

vi.stubGlobal("matchMedia", (query: string) => ({
  get matches() {
    return query.includes("prefers-color-scheme: dark") ? system.dark : false;
  },
  addEventListener: (_type: string, listener: ChangeListener) => system.listeners.add(listener),
  removeEventListener: (_type: string, listener: ChangeListener) =>
    system.listeners.delete(listener),
}));

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
    $appdata.set(KEYS.SHELL.IS_DARK, false);
    delete document.documentElement.dataset.theme;
    setSystemDark(false);
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

  it("id fora do registro cai na preferência padrão, o Automático", () => {
    $userdata.set(KEYS.OPTIONS.THEME, "roxo-neon");
    const { preference, current } = useAppTheme();
    expect(preference.value).toBe(AUTO_THEME_ID);
    expect(current.value).toBe(DEFAULT_THEME_ID);
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

  describe("modo Automático", () => {
    it("quem nunca escolheu um tema acompanha o sistema", () => {
      expect(useAppTheme().preference.value).toBe(AUTO_THEME_ID);
    });

    it("sistema escuro vira o tema escuro; claro volta ao tema padrão", () => {
      const { current, isDark } = useAppTheme();

      setSystemDark(true);
      expect(current.value).toBe(DARK_THEME_ID);
      expect(isDark.value).toBe(true);

      setSystemDark(false);
      expect(current.value).toBe(DEFAULT_THEME_ID);
      expect(isDark.value).toBe(false);
    });

    it("no claro usa o último tema claro escolhido e não o perde ao passar pelo escuro", () => {
      const { setTheme, current, lightTheme } = useAppTheme();

      setTheme("green");
      setTheme(AUTO_THEME_ID);
      expect(current.value).toBe("green");

      setSystemDark(true);
      expect(current.value).toBe(DARK_THEME_ID);
      expect(lightTheme.value).toBe("green");

      setSystemDark(false);
      expect(current.value).toBe("green");
    });

    it("persiste 'auto' e carimba o tema resolvido, nunca o próprio 'auto'", () => {
      setSystemDark(true);
      useAppTheme().setTheme(AUTO_THEME_ID);

      expect($userdata.get(KEYS.OPTIONS.THEME)).toBe(AUTO_THEME_ID);
      expect(document.documentElement.dataset.theme).toBe(DARK_THEME_ID);
      expect($appdata.get(KEYS.SHELL.IS_DARK)).toBe(true);
    });

    it("escolher o Automático não regrava o último tema claro", () => {
      const { setTheme } = useAppTheme();
      setTheme(DARK_THEME_ID);
      setTheme(AUTO_THEME_ID);
      expect($userdata.get(KEYS.OPTIONS.THEME_LAST_LIGHT)).toBeNull();
    });

    it("um tema explícito ignora o sistema", () => {
      const { setTheme, current } = useAppTheme();
      setTheme("pink");

      setSystemDark(true);
      expect(current.value).toBe("pink");
      setSystemDark(false);
      expect(current.value).toBe("pink");
    });

    it("alternar com o sistema escuro sai do Automático e vai para o claro", () => {
      const { setTheme, toggleDark, preference, current } = useAppTheme();
      setTheme(AUTO_THEME_ID);
      setSystemDark(true);

      toggleDark();
      expect(preference.value).toBe(DEFAULT_THEME_ID);
      expect(current.value).toBe(DEFAULT_THEME_ID);
      expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID);
    });

    it("alternar com o sistema claro sai do Automático e vai para o escuro", () => {
      const { setTheme, toggleDark, preference, isDark } = useAppTheme();
      setTheme(AUTO_THEME_ID);

      toggleDark();
      expect(preference.value).toBe(DARK_THEME_ID);
      expect(isDark.value).toBe(true);

      setSystemDark(false);
      expect(isDark.value).toBe(true);
    });

    it("startThemeSync acompanha a virada do sistema no <html> e no is_dark", async () => {
      const stop = startThemeSync();
      try {
        expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID);

        setSystemDark(true);
        await nextTick();
        expect(document.documentElement.dataset.theme).toBe(DARK_THEME_ID);
        expect($appdata.get(KEYS.SHELL.IS_DARK)).toBe(true);

        setSystemDark(false);
        await nextTick();
        expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID);
        expect($appdata.get(KEYS.SHELL.IS_DARK)).toBe(false);
      } finally {
        stop();
      }
    });

    it("startThemeSync carimba o tema que outra janela gravou", async () => {
      const stop = startThemeSync();
      try {
        $userdata.set(KEYS.OPTIONS.THEME, "terracota");
        await nextTick();
        expect(document.documentElement.dataset.theme).toBe("terracota");
      } finally {
        stop();
      }
    });
  });

  it("recusa em tempo de compilação um tema fora do registro", () => {
    const { setTheme } = useAppTheme();
    // @ts-expect-error — o union de ThemeId é a rede que pega tema inventado.
    setTheme("roxo-neon");
    expect(useAppTheme().current.value).toBe(DEFAULT_THEME_ID);
  });
});
