import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";

test.use({ serviceWorkers: "block" });

async function openTimer(page) {
  await page.goto("/");
  await page.getByTestId("modules-ready").waitFor({ state: "attached" });
  await page.evaluate(async () => {
    const { default: modules } = await import("/src/helpers/Modules.js");
    modules.open("timer");
  });
  await expect(page.locator(".timer-stage")).toBeVisible();
  await page.getByTestId("ribbon-btn-timer_toggle_format").click();
  await expect(page.locator(".field-image")).toBeVisible();
}

test("fundo grande de módulo preserva imagem e preferências após recarregar", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openTimer(page);
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1280;
    const drawing = canvas.getContext("2d");
    const pixels = drawing.createImageData(1280, 1280);
    for (let offset = 0; offset < pixels.data.length; offset += 65536) {
      crypto.getRandomValues(pixels.data.subarray(offset, offset + 65536));
    }
    drawing.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const bytes = Buffer.from(encoded, "base64");
  expect(bytes.length).toBeGreaterThan(5 * 1024 * 1024);
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".field-image").getByTitle("Escolher arquivo").click();
  await (await chooser).setFiles({ name: "fundo.png", mimeType: "image/png", buffer: bytes });
  await expect
    .poll(() =>
      page
        .locator(".timer-stage img")
        .evaluateAll((images) =>
          images.some((image) => image.complete && image.naturalWidth === 1280)
        )
    )
    .toBe(true);
  const saved = await page.evaluate(async () => {
    const { default: userData } = await import("/src/helpers/UserData.ts");
    const { KEYS } = await import("/src/constants/UserDataKeys.ts");
    userData.set(KEYS.OPTIONS.THEME, "dark");
    userData.flushPendingWebSave();
    const stored = localStorage.getItem("user_data");
    const data = JSON.parse(stored);
    return { bytes: stored.length, image: data.modules.timer.image, theme: data.options.theme };
  });
  expect(saved.theme).toBe("dark");
  expect(saved.bytes).toBeLessThan(100_000);
  expect(saved.image).toBeTruthy();
  expect(errors.filter((message) => /quota|setItem/i.test(message))).toEqual([]);
  await openTimer(page);
  await expect
    .poll(() =>
      page
        .locator(".timer-stage img")
        .evaluateAll((images) =>
          images.some((image) => image.complete && image.naturalWidth === 1280)
        )
    )
    .toBe(true);
  const projection = await context.newPage();
  await projection.goto("/projection/module?module=timer");
  await expect
    .poll(() =>
      projection
        .locator(".module-projection > img")
        .evaluateAll((images) =>
          images.some((image) => image.complete && image.naturalWidth === 1280)
        )
    )
    .toBe(true);
  await page.evaluate(async (image) => {
    const { default: userData } = await import("/src/helpers/UserData.ts");
    for (const module of ["draw", "name_draw", "bible"])
      userData.set(`modules.${module}.image`, image);
    userData.flushPendingWebSave();
  }, saved.image);
  for (const module of ["draw", "name_draw"]) {
    await projection.goto(`/projection/module?module=${module}`);
    await expect
      .poll(() =>
        projection
          .locator("img")
          .evaluateAll((images) =>
            images.some((image) => image.complete && image.naturalWidth === 1280)
          )
      )
      .toBe(true);
  }
  await projection.goto("/projection/bible");
  await expect
    .poll(() =>
      projection
        .locator(".projection-bible-root > img")
        .evaluateAll((images) =>
          images.some((image) => image.complete && image.naturalWidth === 1280)
        )
    )
    .toBe(true);
  await projection.close();
});
