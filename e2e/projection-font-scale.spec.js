import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const surfaces = [
  { name: "Full HD", width: 1920, height: 1080 },
  { name: "4K", width: 3840, height: 2160 },
  { name: "8K", width: 7680, height: 4320 },
  { name: "LED ultralargo", width: 5760, height: 1080 },
  { name: "prévia", width: 320, height: 180, preview: true },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/json_db/") || url.origin === "http://e2e.mock")
      return route.fulfill({ json: [] });
    if (url.origin === "http://localhost:5002") return route.continue();
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/projection");
  await expect(page.locator(".projection-stage")).toBeVisible();
});

for (const kind of ["lyric", "cover", "aux"]) {
  test(`${kind}: tamanho proporcional à projeção e à prévia, sem teto em pixels`, async ({
    page,
  }) => {
    await page.evaluate(async (kind) => {
      const { default: broadcast } = await import("/src/helpers/Broadcast.ts");
      const { BROADCAST_TYPE } = await import("/src/helpers/BroadcastTypes.ts");
      broadcast.send(BROADCAST_TYPE.MUSIC_PRESENTATION_SNAPSHOT, {
        schema: 1,
        selectionRevision: 1,
        progress: 0,
        slideProgress: 0,
        emittedAt: Date.now(),
        snapshot: {
          sessionId: "font-scale-test",
          revision: 1,
          active: true,
          title: "Teste de escala",
          slideIndex: 0,
          totalSlides: 1,
          slide: {
            lyric: kind === "aux" ? "" : "AMÉM",
            aux_lyric: kind === "aux" ? "AMÉM" : "",
            cover: kind === "cover",
          },
          nextSlide: null,
        },
      });
    }, kind);
    const text = page.locator(`.lj-slide__text--${kind}`);
    await expect(text).toHaveText("AMÉM");

    for (const surface of surfaces) {
      await test.step(surface.name, async () => {
        // A prévia tem seu próprio container dentro de uma janela maior.
        await page.setViewportSize(surface.preview ? { width: 1920, height: 1080 } : surface);
        await page.locator(".projection-stage").evaluate((stage, surface) => {
          stage.style.width = surface.preview ? `${surface.width}px` : "";
          stage.style.height = surface.preview ? `${surface.height}px` : "";
        }, surface);

        for (const percent of [10, 20, 30, 50]) {
          await page.evaluate(async (percent) => {
            const { default: userdata } = await import("/src/helpers/UserData.ts");
            const { KEYS } = await import("/src/constants/UserDataKeys.ts");
            const keys = KEYS.OPTIONS.SLIDE;
            userdata.set(keys.CUSTOM_TEXT_FORMAT, true);
            for (const key of [keys.TITLE_SIZE, keys.BODY_SIZE, keys.AUX_SIZE]) {
              userdata.set(key, percent);
            }
          }, percent);
          await expect
            .poll(async () => text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
            .toBeCloseTo((surface.height * percent) / 100, 1);
        }

        // Uma palavra curta pode ocupar boa parte do telão sem sair dele.
        const bounds = await text.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const slide = el.closest(".lj-slide").getBoundingClientRect();
          return {
            top: box.top - slide.top,
            bottom: box.bottom - slide.top,
            left: box.left - slide.left,
            right: box.right - slide.left,
            heightRatio: box.height / slide.height,
          };
        });
        expect(bounds.heightRatio).toBeGreaterThan(0.8);
        expect(bounds.top).toBeGreaterThanOrEqual(-1);
        expect(bounds.left).toBeGreaterThanOrEqual(-1);
        expect(bounds.bottom).toBeLessThanOrEqual(surface.height + 1);
        expect(bounds.right).toBeLessThanOrEqual(surface.width + 1);
      });
    }
  });
}
