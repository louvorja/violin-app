/**
 * Offline browser-level checks for the canonical music presentation channel.
 * Run with: npx playwright test e2e/presentation-core.spec.js
 * No route in this file reaches a video provider or external product service.
 */
import { test, expect } from "@playwright/test";
import ptMusics from "./fixtures/pt_musics.json";
import music1 from "./fixtures/music_1.json";

const busTypes = {
  snapshot: "music_presentation_snapshot",
  slideChange: "slide_change",
  goToSlide: "go_to_slide",
};

async function offlineContext(browser, music = music1) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (/\/pt_musics(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: ptMusics });
    if (/\/music_1(?:\.|$)/.test(url.pathname)) return route.fulfill({ json: music });
    if (url.pathname.includes("/json_db/")) return route.fulfill({ json: [] });
    if (url.origin === "http://localhost:5002") return route.continue();
    return route.fulfill({ status: 204, body: "" });
  });
  return context;
}

async function observeBus(page) {
  await page.addInitScript(() => {
    const packets = [];
    const channel = new BroadcastChannel("louvorja");
    channel.addEventListener("message", (event) => packets.push(event.data));
    window.__presentationTest = {
      packets,
      send(type, payload) {
        channel.postMessage({ type, payload });
      },
    };
  });
}

async function openProjection(context) {
  const page = await context.newPage();
  await observeBus(page);
  await page.goto("/projection");
  await page.locator(".projection-stage").waitFor({ state: "visible" });
  return page;
}

async function openSong(page, audio = false) {
  await page.goto("/");
  await page.locator("#ribbon-tab-collections").waitFor({ state: "visible", timeout: 20_000 });
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 15_000 });
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-musics"]').click();
  const row = page.locator('[data-testid="music-row-1"]');
  await expect(row).toBeVisible();
  await row.hover();
  await row
    .locator(audio ? '[data-testid="mmt-btn-sing"]' : '[data-testid="mmt-btn-no-audio"]')
    .click();
  await expect(page.locator('[data-testid="slide-content"]').first()).toContainText("Aleluia");
}

test("publishes the cover while audio transfer is still pending", async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await offlineContext(browser, {
    ...music1,
    url_music: "musics/pt/Teste/001.wav",
  });
  let finishAudioRequest;
  const audioPending = new Promise((resolve) => {
    finishAudioRequest = resolve;
  });
  let audioRequestSeen = false;
  await context.route("**/001.wav", async (route) => {
    audioRequestSeen = true;
    await audioPending;
    await route.fulfill({ status: 503, body: "" }).catch(() => {});
  });
  try {
    const projection = await openProjection(context);
    const main = await context.newPage();
    await openSong(main, true);
    const packet = await waitForCanonical(projection);
    expect(packet.snapshot).toMatchObject({ active: true, slideIndex: 0 });
    await expect(projection.locator('[data-testid="slide-content"]')).toContainText("Aleluia");
    await expect.poll(() => audioRequestSeen).toBe(true);
  } finally {
    finishAudioRequest();
    await context.close();
  }
});

async function send(page, type, payload) {
  await page.evaluate(
    ({ messageType, messagePayload }) =>
      window.__presentationTest.send(messageType, messagePayload),
    { messageType: type, messagePayload: payload }
  );
}

async function latestCanonical(page) {
  return page.evaluate((type) => {
    const packets = window.__presentationTest.packets;
    return [...packets].reverse().find((message) => message?.type === type)?.payload ?? null;
  }, busTypes.snapshot);
}

async function waitForCanonical(page) {
  await expect.poll(() => latestCanonical(page)).not.toBeNull();
  return latestCanonical(page);
}

async function expectSlideText(page, lyric) {
  const expected = lyric.replace(/<[^>]*>/g, "").replace(/\s/g, "");
  await expect
    .poll(() =>
      page
        .locator('[data-testid="slide-content"]')
        .evaluate((element) => (element.textContent || "").replace(/\s/g, ""))
    )
    .toContain(expected);
}

function canonicalPacket(previousPacket, snapshot) {
  return { ...previousPacket, snapshot };
}

test.describe("canonical music presentation core", () => {
  for (const order of ["projection-first", "producer-first"]) {
    test(`uses canonical state for rendering and late join/reopen (${order})`, async ({
      browser,
    }) => {
      test.setTimeout(60_000);
      const context = await offlineContext(browser);
      try {
        let projection = order === "projection-first" ? await openProjection(context) : null;
        const main = await context.newPage();
        await openSong(main);
        projection ??= await openProjection(context);

        const initialPacket = await waitForCanonical(projection);
        expect(initialPacket).toMatchObject({
          schema: 1,
          snapshot: {
            active: true,
            title: expect.any(String),
            slideIndex: 0,
            totalSlides: expect.any(Number),
            slide: expect.objectContaining({ lyric: expect.any(String) }),
          },
        });
        await expect(projection.locator('[data-testid="slide-content"]')).toContainText(
          initialPacket.snapshot.slide.lyric.split("\n")[0]
        );

        expect(initialPacket.snapshot.totalSlides).toBeGreaterThan(1);
        const targetIndex = initialPacket.snapshot.slideIndex === 0 ? 1 : 0;
        await send(projection, busTypes.goToSlide, {
          index: targetIndex,
          presentation_session: initialPacket.snapshot.sessionId,
        });
        await expect
          .poll(() => latestCanonical(projection))
          .toMatchObject({
            snapshot: {
              sessionId: initialPacket.snapshot.sessionId,
              slideIndex: targetIndex,
            },
          });
        const currentPacket = await latestCanonical(projection);
        expect(currentPacket.snapshot.revision).toBeGreaterThan(initialPacket.snapshot.revision);
        await expectSlideText(projection, currentPacket.snapshot.slide.lyric);

        // A genuinely older core revision and a conflicting legacy packet must
        // not roll the visual selection back after the newer slide is selected.
        const current = currentPacket.snapshot;
        await send(
          projection,
          busTypes.snapshot,
          canonicalPacket(initialPacket, {
            ...initialPacket.snapshot,
            revision: current.revision - 1,
            slide: { ...initialPacket.snapshot.slide, lyric: "STALE CANONICAL" },
          })
        );
        await send(projection, busTypes.slideChange, {
          slide_index: initialPacket.snapshot.slideIndex,
          slide: { lyric: "STALE LEGACY" },
          next_slide: null,
          title: "Stale legacy packet",
          total_slides: current.totalSlides,
          presentation_session: current.sessionId,
          presentation_revision: initialPacket.snapshot.revision,
        });
        await expect(projection.locator('[data-testid="slide-content"]')).not.toContainText(
          /STALE (CANONICAL|LEGACY)/
        );

        await projection.close();
        projection = await openProjection(context);
        await expectSlideText(projection, current.slide.lyric);
        const recovered = await waitForCanonical(projection);
        expect(recovered.snapshot.sessionId).toBe(current.sessionId);

        // The visible slide keeps its established stage geometry and remains paintable.
        const visual = await projection.locator('[data-testid="slide-content"]').boundingBox();
        expect(visual?.width).toBeGreaterThan(0);
        expect(visual?.height).toBeGreaterThan(0);
        await expect(projection.locator(".projection-stage")).toHaveCSS("visibility", "visible");
      } finally {
        await context.close();
      }
    });

    test(`canonical close retires the active session (${order})`, async ({ browser }) => {
      test.setTimeout(60_000);
      const context = await offlineContext(browser);
      try {
        let projection = order === "projection-first" ? await openProjection(context) : null;
        const main = await context.newPage();
        await openSong(main);
        projection ??= await openProjection(context);
        const packet = await waitForCanonical(projection);

        await send(
          projection,
          busTypes.snapshot,
          canonicalPacket(packet, {
            ...packet.snapshot,
            revision: packet.snapshot.revision + 1,
            active: false,
            title: "",
            slideIndex: 0,
            totalSlides: 0,
            slide: null,
            nextSlide: null,
          })
        );
        await expect(projection.locator('[data-testid="slide-content"]')).toBeHidden();
        await send(projection, busTypes.snapshot, packet);
        await expect(projection.locator('[data-testid="slide-content"]')).toBeHidden();
      } finally {
        await context.close();
      }
    });
  }
});

test("direct cutover ignores versioned SLIDE_CHANGE without a valid canonical snapshot", async ({
  browser,
}) => {
  const context = await offlineContext(browser);
  try {
    const projection = await openProjection(context);

    // A versioned compatibility event is only a correlation/request hint; it
    // cannot become visual state when the canonical snapshot is absent.
    await send(projection, busTypes.slideChange, {
      slide_index: 0,
      slide: { lyric: "VERSIONED LEGACY MUST NOT RENDER", tipo: "LETRA" },
      next_slide: null,
      title: "Missing canonical snapshot",
      total_slides: 1,
      presentation_session: "missing-session",
      presentation_revision: 1,
    });
    await expect(projection.locator('[data-testid="slide-content"]')).toBeHidden();

    await send(projection, busTypes.snapshot, { schema: 1, snapshot: { active: true, slide: [] } });
    await send(projection, busTypes.slideChange, {
      slide_index: 0,
      slide: { lyric: "VERSIONED LEGACY AFTER MALFORMED PACKET MUST NOT RENDER", tipo: "LETRA" },
      next_slide: null,
      title: "Malformed canonical snapshot",
      total_slides: 1,
      presentation_session: "missing-session",
      presentation_revision: 2,
    });
    await expect(projection.locator('[data-testid="slide-content"]')).toBeHidden();
  } finally {
    await context.close();
  }
});
