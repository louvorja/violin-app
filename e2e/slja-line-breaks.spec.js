import { test, expect } from "@playwright/test";
import JSZip from "jszip";

test.use({ serviceWorkers: "block" });

for (const origem of ["arquivo", "coletânea"]) {
  test(`.slja via ${origem} mantém duas linhas na projeção`, async ({ page, context }) => {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes("/json_db/") || url.origin === "http://e2e.mock")
        return route.fulfill({ json: [] });
      if (url.origin === "http://localhost:5002") return route.continue();
      return route.fulfill({ status: 204, body: "" });
    });
    await page.goto("/");
    await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
    const projection = await context.newPage();
    await projection.goto("/projection");
    await expect(projection.locator(".projection-stage")).toBeVisible();

    const zip = new JSZip();
    zip.file(
      "slides.lja",
      [
        "[Geral]",
        "slides=1",
        "nome=Hino com quebras",
        "[Slide:1]",
        "tipo=LETRA",
        "letra=Ricos e pobres, Plebeus e nobres|Diante do trono de Deus",
        "letra_aux=Primeira linha|Segunda linha",
      ].join("\r\n")
    );
    const bytes = [...(await zip.generateAsync({ type: "uint8array" }))];
    await page.evaluate(
      async ({ bytes, origem }) => {
        const file = new Blob([new Uint8Array(bytes)]);
        if (origem === "arquivo") {
          const { openSlja } = await import("/src/helpers/SljaPlayer.ts");
          await openSlja(file, { origin: "liturgy" });
        } else {
          const converter = (await import("/src/helpers/SljaConverter.js")).default;
          const { newSong, saveSong, getSong } = await import("/src/helpers/CustomSongs.ts");
          const imported = await converter.loadSlja(file);
          const song = newSong(imported.meta.nome);
          song.slides = imported.slides;
          await saveSong(song);
          const media = (await import("/src/composables/useMedia.ts")).default;
          await media.openCustomSong(await getSong(song.id));
        }
      },
      { bytes, origem }
    );

    const main = projection.locator(".lj-slide__text--lyric");
    const aux = projection.locator(".lj-slide__text--aux");
    await expect(main).toContainText("Diante do trono de Deus");
    await expect(main.locator("br")).toHaveCount(1);
    await expect(aux.locator("br")).toHaveCount(1);
    for (const text of [main, aux]) {
      // Mede a disposição real no navegador, não só a presença da marcação.
      await expect
        .poll(() =>
          text.evaluate((el) => {
            const first = document.createRange();
            const last = document.createRange();
            first.selectNodeContents(el.firstChild);
            last.selectNodeContents(el.lastChild);
            return last.getBoundingClientRect().top > first.getBoundingClientRect().top;
          })
        )
        .toBe(true);
    }
  });
}
