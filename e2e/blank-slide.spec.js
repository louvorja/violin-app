/**
 * Slide em branco de música personalizada (.slja) fica em branco na projeção:
 * sem o título da música nem o nome do item da liturgia (issue #15). A capa
 * sem letra continua mostrando o título.
 */
import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const NOME = "Nome que não é letra";

test("slide em branco fica só com o fundo; a capa sem letra mostra o título", async ({
  page,
  context,
}) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/json_db/") || url.origin === "http://e2e.mock")
      return route.fulfill({ json: [] });
    if (url.origin === "http://localhost:5002") return route.continue();
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.evaluate(async (nome) => {
    const songs = await import("/src/helpers/CustomSongs.ts");
    const song = songs.newSong(nome);
    song.slides = [
      songs.newSlide({ tipo: "CAPA", letra: "" }),
      songs.newSlide({ tipo: "LETRA", letra: "Primeira estrofe" }),
      songs.newSlide({ tipo: "LETRA", letra: "" }),
    ];
    await songs.saveSong(song);
  }, NOME);

  const projection = await context.newPage();
  await projection.goto("/projection");
  await expect(projection.locator(".projection-stage")).toBeVisible();
  await page.bringToFront();
  await page.keyboard.press("Control+k");
  await page.locator(".cmd-input").fill(NOME);
  await expect(page.locator(".cmd-item")).toHaveCount(1);
  await page.locator(".cmd-input").press("Enter");

  const texto = projection.locator('[data-testid="slide-content"]');
  await expect(texto).toContainText(NOME);

  await projection.bringToFront();
  await projection.keyboard.press("ArrowRight");
  await expect(texto).toContainText("Primeira estrofe");

  await projection.keyboard.press("ArrowRight");
  await expect(projection.getByText("Primeira estrofe")).toHaveCount(0);
  await expect(projection.getByText(NOME)).toHaveCount(0);
  await expect(projection.locator(".projection-stage")).toBeVisible();
});
