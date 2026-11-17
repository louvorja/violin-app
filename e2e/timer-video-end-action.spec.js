import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.use({
  serviceWorkers: "block",
  launchOptions: {
    args: ["--autoplay-policy=no-user-gesture-required"],
  },
});

const SAMPLE_MP4 = fs.readFileSync(path.resolve("e2e/fixtures/timer-sample.mp4"));
const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const FIVE_SEC_START = new Date(2026, 10, 5, 10, 59, 55);

const TIMER_MODULES = [
  { id: "timer", tab: "utilities", display: "timer-display" },
  { id: "timer_worship", tab: "worship", display: "timer-worship-display" },
];

async function prepareRoutesAndMock(context) {
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await context.route("https://example.test/timer-sample.mp4", (route) => {
    const range = route.request().headers()["range"];
    const total = SAMPLE_MP4.length;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
      return route.fulfill({
        status: 206,
        contentType: "video/mp4",
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(end - start + 1),
        },
        body: SAMPLE_MP4.subarray(start, end + 1),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "video/mp4",
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(total),
      },
      body: SAMPLE_MP4,
    });
  });
  await context.route("https://example.test/timer-image.png", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: SAMPLE_PNG })
  );
}

async function openTimerModuleAtFiveSeconds(page, mod) {
  await page.clock.install({ time: FIVE_SEC_START });
  await page.goto("/");
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.locator(`#ribbon-tab-${mod.tab}`).click();
  await page.locator(`[data-testid="ribbon-btn-${mod.id}"]`).click();
  await expect(page.getByTestId(mod.display)).toBeVisible();
  await page.clock.setSystemTime(FIVE_SEC_START);
}

async function configureTimerEnd(page, moduleId, endVideo) {
  await page.evaluate(
    async ({ moduleId, endVideo }) => {
      const { default: userdata } = await import("/src/helpers/UserData.ts");
      const { KEYS } = await import("/src/constants/UserDataKeys.ts");
      const { MediaEnum } = await import("/src/enums/MediaEnum.ts");
      const keys = moduleId === "timer" ? KEYS.MODULES.TIMER : KEYS.MODULES.TIMER_WORSHIP;

      userdata.set(keys.MODE, "down");
      if ("COUNT_OVERTIME" in keys) userdata.set(keys.COUNT_OVERTIME, false);
      if ("SOUND_START" in keys) {
        userdata.set(keys.SOUND_START, false);
        userdata.set(keys.SOUND_FIVE_MIN, false);
        userdata.set(keys.SOUND_ONE_MIN, false);
      }
      userdata.set(keys.END_ACTION, MediaEnum.VIDEO);
      userdata.set(keys.END_ACTION_VIDEO, endVideo);
    },
    { moduleId, endVideo }
  );

  // Mantém tempo excedido desligado também no Temporizador de Culto.
  if (moduleId === "timer_worship") {
    await page.evaluate(async () => {
      const { default: userdata } = await import("/src/helpers/UserData.ts");
      const { KEYS } = await import("/src/constants/UserDataKeys.ts");
      userdata.set(KEYS.MODULES.TIMER_WORSHIP.COUNT_OVERTIME, false);
    });
  }

  const time = page
    .locator(`[data-testid="ribbon-btn-${moduleId}_set_time"] input, input[type="time"]`)
    .first();
  await time.fill("11:00");
  await time.dispatchEvent("change");
}

for (const mod of TIMER_MODULES) {
  test(`${mod.id}: timer de 5s com MP4 local e player parado inicia vídeo com áudio e projeção sincronizada`, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await prepareRoutesAndMock(context);
    try {
      const page = await context.newPage();
      const projection = await context.newPage();
      await projection.goto("/projection/file");

      await openTimerModuleAtFiveSeconds(page, mod);
      await configureTimerEnd(page, mod.id, {
        url: "https://example.test/timer-sample.mp4",
        type: "video",
      });

      await expect(page.getByTestId(mod.display)).toContainText(/00:00:0[45]/);

      // Player começa parado (sem faixa tocando).
      expect(
        await page.evaluate(() => {
          const el = document.getElementById("__audio");
          return el ? el.paused : true;
        })
      ).toBe(true);

      await page.getByTestId(`ribbon-btn-${mod.id}_toggle`).click();
      await page.clock.runFor(6_000);
      await expect(page.getByTestId(mod.display)).toContainText("00:00:00");

      // Player principal inicia o MP4 com áudio (não mudo) e projeção acompanha sem autoplay.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const el = document.getElementById("__audio");
              return el
                ? {
                    tag: el.tagName.toLowerCase(),
                    src: el.getAttribute("src"),
                    paused: el.paused,
                    muted: el.muted,
                  }
                : null;
            }),
          { timeout: 10_000 }
        )
        .toMatchObject({
          tag: "video",
          src: "https://example.test/timer-sample.mp4",
          paused: false,
          muted: false,
        });

      await expect
        .poll(
          () =>
            projection.evaluate(() => {
              const v = document.querySelector("video.file-projection__media");
              return v
                ? {
                    autoplay: v.autoplay,
                    paused: v.paused,
                    muted: v.muted,
                  }
                : null;
            }),
          { timeout: 10_000 }
        )
        .toMatchObject({
          autoplay: false,
          paused: false,
          muted: true,
        });

      await expect
        .poll(
          () =>
            projection.evaluate(
              () => document.querySelector("video.file-projection__media")?.currentTime ?? 0
            ),
          { timeout: 10_000 }
        )
        .toBeGreaterThan(0.15);
    } finally {
      await context.close();
    }
  });
}

test("timer: imagem ao fim exibe <img>, fundo ativo sincroniza vídeo normal e pausa/seek respondem sem autoplay geral", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await prepareRoutesAndMock(context);
  try {
    const page = await context.newPage();
    const bgProjection = await context.newPage();
    await bgProjection.goto("/projection/background_projection");

    await openTimerModuleAtFiveSeconds(page, TIMER_MODULES[0]);
    await configureTimerEnd(page, "timer", {
      url: "https://example.test/timer-image.png",
      type: "image",
    });

    await expect(page.getByTestId("timer-display")).toContainText(/00:00:0[45]/);
    await page.getByTestId("ribbon-btn-timer_toggle").click();
    await page.clock.runFor(6_000);

    await expect(bgProjection.locator(".file-projection img.layer-file")).toHaveAttribute(
      "src",
      "https://example.test/timer-image.png"
    );
    expect(
      await page.evaluate(() => document.getElementById("__audio")?.getAttribute("src") ?? null)
    ).toBeNull();

    // Vídeo normal com fundo ativo: projeta dentro do BackgroundProjection, toca e obedece pausa/seek.
    await page.evaluate(async () => {
      const { default: Media } = await import("/src/composables/useMedia.ts");
      await Media.projectFile(
        {
          url: "https://example.test/timer-sample.mp4",
          type: "video",
          title: "Video normal",
        },
        "https://example.test/timer-sample.mp4",
        { stopExistingAudio: true }
      );
    });

    await expect
      .poll(
        () =>
          bgProjection.evaluate(() => {
            const v = document.querySelector(".file-projection video.layer-file");
            return v
              ? {
                  autoplay: v.autoplay,
                  paused: v.paused,
                }
              : null;
          }),
        { timeout: 10_000 }
      )
      .toMatchObject({ autoplay: false, paused: false });

    await expect
      .poll(
        () =>
          bgProjection.evaluate(
            () => document.querySelector(".file-projection video.layer-file")?.currentTime ?? 0
          ),
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0.15);

    // Pausa e seek pelo player refletem na projeção com fundo ativo.
    await page.evaluate(async () => {
      const { default: Media } = await import("/src/composables/useMedia.ts");
      Media.pause(true);
    });
    await expect
      .poll(() =>
        bgProjection.evaluate(
          () => document.querySelector(".file-projection video.layer-file")?.paused ?? false
        )
      )
      .toBe(true);

    await page.evaluate(async () => {
      const { default: Media } = await import("/src/composables/useMedia.ts");
      Media.goToTime(2.0);
    });
    await expect
      .poll(
        () =>
          bgProjection.evaluate(
            () => document.querySelector(".file-projection video.layer-file")?.currentTime ?? 0
          ),
        { timeout: 10_000 }
      )
      .toBeGreaterThanOrEqual(1.8);
  } finally {
    await context.close();
  }
});
