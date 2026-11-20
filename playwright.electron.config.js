import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

/**
 * Um teste Electron opt-in, fora da suíte web do dia a dia.
 *
 * O app em dev carrega o Vite em `http://localhost:5002` (o mesmo `webServer`
 * da suíte base). No CI roda sob `xvfb-run -a`, com `LJ_RUN_REMOTE_MUSIC_ALBUM=1`
 * — sem a variável o spec se pula sozinho.
 */
export default defineConfig({
  ...base,
  testMatch: ["remote-music-album.electron.spec.js"],
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { ...base.use, serviceWorkers: "block" },
});
