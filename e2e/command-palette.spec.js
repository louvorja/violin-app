import { test, expect } from "@playwright/test";

test("a primeira abertura da palette busca um hino", async ({ page }) => {
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/pt_musics*", (route) =>
    route.fulfill({
      json: [
        {
          id_music: 1,
          name: "Santo, Santo, Santo!",
          duration: "2:17",
          track: "001",
          has_instrumental_music: 1,
          albums: [
            {
              id_album: 1,
              name: "Hinário Adventista",
              type: "hymnal",
              pivot: { track: 1 },
            },
          ],
          albums_names: "Hinário Adventista",
          lyric: "Santo",
        },
      ],
    })
  );

  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({
    state: "attached",
    timeout: 30_000,
  });

  await page.keyboard.press("Control+k");
  const input = page.locator('input[placeholder*="Buscar"]');
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill("hino");

  // A primeira abertura busca e indexa o catálogo. Em runners carregados,
  // esse trabalho pode passar do timeout padrão de 5 s do Playwright.
  await expect(page.locator(".cmd-item")).toContainText(["Abrir Hinário", "Santo, Santo, Santo!"], {
    timeout: 20_000,
  });
  await expect(page.locator(".cmd-empty")).toHaveCount(0);
});
