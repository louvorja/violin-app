import { test, expect } from "@playwright/test";

test("background and return recover current selection and reject old or cleared states", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const operator = await context.newPage();
  const projection = await context.newPage();
  const returned = await context.newPage();
  const a = "https://example.test/background-a.png";
  const b = "https://example.test/background-b.png";
  try {
    await operator.goto("/");
    await operator.evaluate(() => {
      window.__bgBus = new BroadcastChannel("louvorja");
      window.__sendBg = (payload) =>
        window.__bgBus.postMessage({ type: "background_projection", payload });
    });
    await operator.evaluate((url) => {
      const state = { active: true, epoch: 100, type: "image", url, title: "A" };
      localStorage.setItem("lj_background_projection", JSON.stringify(state));
      window.__sendBg(state);
    }, a);

    await projection.goto("/projection/background_projection");
    await returned.goto("/projection/background_projection/return");
    await projection.locator(".layer-root-bg").waitFor({ state: "attached", timeout: 30_000 });
    await returned.locator(".return-root-bg").waitFor({ state: "attached", timeout: 30_000 });
    await expect(projection.locator("img.layer-bg")).toHaveAttribute("src", a, {
      timeout: 20_000,
    });
    await expect(returned.locator("img.return-bg")).toHaveAttribute("src", a, {
      timeout: 20_000,
    });

    await operator.evaluate((url) => {
      const state = { active: true, epoch: 101, type: "image", url, title: "B" };
      localStorage.setItem("lj_background_projection", JSON.stringify(state));
      window.__sendBg(state);
    }, b);
    await expect(projection.locator(`img.layer-bg[src="${b}"]`)).toHaveCount(1);
    await expect(returned.locator(`img.return-bg[src="${b}"]`)).toHaveCount(1);
    await expect(projection.locator("img.layer-bg")).toHaveCount(1);
    await expect(returned.locator("img.return-bg")).toHaveCount(1);
    await expect(projection.locator("img.layer-bg")).toHaveAttribute("src", b);
    await expect(returned.locator("img.return-bg")).toHaveAttribute("src", b);
    await operator.evaluate(
      (url) => window.__sendBg({ active: true, epoch: 100, type: "image", url, title: "Old" }),
      a
    );
    await projection.waitForTimeout(100);
    await expect(projection.locator("img.layer-bg")).toHaveAttribute("src", b);
    await expect(returned.locator("img.return-bg")).toHaveAttribute("src", b);

    await operator.evaluate(() => {
      localStorage.removeItem("lj_background_projection");
      window.__sendBg({ active: false, epoch: 102 });
    });
    await expect(projection.locator(".layer-bg--fallback")).toBeVisible();
    await expect(returned.locator(".return-bg--fallback")).toBeVisible();
    await operator.evaluate(
      (url) => window.__sendBg({ active: true, epoch: 101, type: "image", url, title: "B" }),
      b
    );
    await projection.waitForTimeout(100);
    await expect(projection.locator(".layer-bg--fallback")).toBeVisible();
    await expect(returned.locator(".return-bg--fallback")).toBeVisible();
  } finally {
    await context.close();
  }
});
