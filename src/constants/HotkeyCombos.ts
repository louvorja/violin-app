/**
 * Combinações dos atalhos com modificador — o registro em `main-shell.js` e o
 * que a interface mostra (dicas, F1) leem daqui.
 *
 * `Mod` é o Command no Mac e o Ctrl nos outros sistemas. `Ctrl` explícito marca
 * onde o Mac já usa o Command para outra coisa.
 */
export const HOTKEY = {
  HOTKEYS: "F1",
  COMMAND_PALETTE: "Mod+k",
  // ⌘Espaço é o Spotlight.
  QUICK_SEARCH: "Ctrl+Space",
  BIBLE_SEARCH: "Mod+b",
  // ⌘M minimiza a janela.
  MUSIC_SEARCH: "Ctrl+m",
  CHAT: "Mod+i",
  FOCUS_SEARCH: "Mod+f",
  // ⌘W fecha a janela pelo menu nativo do macOS.
  CLOSE_MODULE: "Ctrl+w",
  CLEAR_CACHE: "Mod+Shift+F2",
  // ⌥⌘D mostra e esconde o Dock.
  DEV_MODE: "Ctrl+Alt+d",
  OVERLAY: "Mod+o",
  BACKGROUND_PROJECTION: "Mod+p",
  // ⌘Tab troca de aplicativo.
  NEXT_MODULE: "Ctrl+Tab",
  PREV_MODULE: "Ctrl+Shift+Tab",
  PREV_SLIDE: "Mod+ArrowUp",
  NEXT_SLIDE: "Mod+ArrowDown",
  PREV_SLIDE_PAGE: "Mod+PageUp",
  NEXT_SLIDE_PAGE: "Mod+PageDown",
  PREV_MUSIC: "Mod+ArrowLeft",
  NEXT_MUSIC: "Mod+ArrowRight",
  LITURGY_NEW_ITEM: "Mod+n",
  LITURGY_NEW_ANNOTATION: "Mod+Shift+n",
} as const;
