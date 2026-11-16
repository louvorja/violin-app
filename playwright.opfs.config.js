import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";

// Build de produção: o SW só é registrado de verdade fora do dev server.
export default defineConfig({
  ...base,
  testDir: "./e2e-opfs",
  testMatch: ["opfs.spec.js"],
  use: { ...base.use, baseURL: "http://localhost:5015", serviceWorkers: "allow" },
  webServer: {
    command: "npm run build && npx vite preview --port 5015 --strictPort",
    url: "http://localhost:5015",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ...base.webServer.env },
  },
});
