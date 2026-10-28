import process from "node:process";
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";

// Run with:
//   npx playwright test --config playwright.mobile.config.js --workers=1
//   LJ_MOBILE_WEB_BUILD=1 npx playwright test --config playwright.mobile.config.js --workers=1
// The second command builds and previews the real web/PWA target, not Electron.
const builtWeb = process.env.LJ_MOBILE_WEB_BUILD === "1";
const port = builtWeb ? 5016 : 5015;
const baseURL = `http://localhost:${port}`;
const fixtureEnv = { ...base.webServer.env, VITE_TARGET: "web" };

export default defineConfig({
  ...base,
  testMatch: ["mobile-web.spec.js", "media-fullscreen.mobile.spec.js"],
  outputDir: "./test-results/mobile-playwright",
  use: {
    ...base.use,
    baseURL,
    serviceWorkers: "block",
    reducedMotion: "reduce",
    colorScheme: "light",
  },
  projects: [
    {
      name: "android-chromium",
      use: {
        ...devices["Pixel 7"],
        ...(base.projects[0].use.launchOptions
          ? { launchOptions: base.projects[0].use.launchOptions }
          : {}),
      },
    },
    {
      name: "iphone-webkit",
      testMatch: "media-fullscreen.mobile.spec.js",
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: builtWeb
    ? {
        command:
          "npx vite build --outDir test-results/mobile-web-build && npx vite preview --outDir test-results/mobile-web-build --port 5016 --strictPort",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 180_000,
        env: fixtureEnv,
      }
    : {
        command: "npx vite --port 5015 --strictPort",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 60_000,
        env: fixtureEnv,
      },
});
