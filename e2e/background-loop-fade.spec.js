import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";

test("Projeção de Fundo alterna modo de loop e empilha camada de crossfade ao terminar vídeo (#64)", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const operator = await context.newPage();
  const projection = await context.newPage();
  const returned = await context.newPage();
  const videoUrl = "https://example.test/bg-loop.mp4";

  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.href === videoUrl) {
      return route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.alloc(64) });
    }
    if (url.origin === "http://localhost:5002") return route.continue();
    return route.fulfill({ json: [] });
  });

  try {
    await operator.goto("/");
    await operator
      .locator('[data-testid="modules-ready"]')
      .waitFor({ state: "attached", timeout: 30_000 });
    await operator.evaluate(() => {
      window.__bgBus = new BroadcastChannel("louvorja");
      window.__sendBg = (payload) =>
        window.__bgBus.postMessage({ type: "background_projection", payload });
    });

    await operator.evaluate(async (url) => {
      const { default: UserData } = await import("/src/helpers/UserData.ts");
      const { KEYS } = await import("/src/constants/UserDataKeys.ts");
      UserData.set(KEYS.MODULES.BACKGROUND_PROJECTION.LOOP_FADE, true);
      UserData.set(KEYS.MODULES.BACKGROUND_PROJECTION.FADE_DURATION, 400);
      await UserData.flush?.();
      const state = { active: true, epoch: 300, type: "video", url, title: "Loop Video" };
      localStorage.setItem("lj_background_projection", JSON.stringify(state));
      window.__sendBg(state);
    }, videoUrl);
    await operator.waitForTimeout(450);

    await projection.goto("/projection/background_projection");
    await returned.goto("/projection/background_projection/return");

    const projVideos = projection.locator("video.layer-bg");
    const retVideos = returned.locator("video.return-bg");
    await expect(projVideos).toHaveCount(1, { timeout: 20_000 });
    await expect(retVideos).toHaveCount(1, { timeout: 20_000 });

    // Com LOOP_FADE ativo, o loop nativo do <video> fica desabilitado para permitir crossfade.
    await expect(projVideos.first()).not.toHaveAttribute("loop", "");
    await expect(retVideos.first()).not.toHaveAttribute("loop", "");

    // Disparar `ended` empilha temporariamente uma segunda instância por cima e depois poda para 1.
    await projVideos.first().dispatchEvent("ended");
    await retVideos.first().dispatchEvent("ended");
    await expect(projVideos).toHaveCount(2);
    await expect(retVideos).toHaveCount(2);

    // Após o timeout do primeiro frame (1500ms) + fade (400ms), resta apenas a camada nova.
    await expect(projVideos).toHaveCount(1, { timeout: 4_000 });
    await expect(retVideos).toHaveCount(1, { timeout: 4_000 });
  } finally {
    await context.close();
  }
});
