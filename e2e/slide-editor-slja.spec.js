import fs from "node:fs/promises";
import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";
import JSZip from "jszip";

test.use({ serviceWorkers: "block" });

function minimalMp3(fillByte = 0x55) {
  const bytes = new Uint8Array(64);
  bytes[0] = 0xff;
  bytes[1] = 0xfb;
  bytes[2] = 0x90;
  bytes[3] = 0x00;
  bytes.fill(fillByte, 4);
  return bytes;
}

async function mockAppNetwork(context) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/json_db/") || url.origin === "http://e2e.mock") {
      return route.fulfill({ json: [] });
    }
    if (url.origin === "http://localhost:5002") return route.continue();
    return route.fulfill({ status: 204, body: "" });
  });
}

async function openSlideEditor(page) {
  await page.goto("/");
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  const tipDialog = page.getByRole("dialog", { name: "Dica do LouvorJA" });
  if (await tipDialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await tipDialog.getByRole("button", { name: "Fechar" }).first().click();
  }
  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-slide_editor"]').click();
  await expect(page.locator('[data-testid="se-track"]')).toBeVisible({ timeout: 15_000 });
}

test.describe("Editor de Slides & fluxo .slja (#59, #61, #62)", () => {
  test("prévia e projeção refletem cor, tamanho e texto exatos (#59)", async ({
    page,
    context,
  }) => {
    await mockAppNetwork(context);
    await openSlideEditor(page);

    const projection = await context.newPage();
    await projection.goto("/projection");
    await expect(projection.locator(".projection-stage")).toBeVisible();

    await page.locator(".se-slide-list-add").click();

    const textArea = page.locator("textarea.se-textarea").first();
    await textArea.fill("LOUVAI AO SENHOR");

    const formatPanel = page.locator("details.se-panel").nth(1);
    const textColorInput = formatPanel.locator('input[type="color"]').nth(1);
    await textColorInput.fill("#00cc66");
    await textColorInput.dispatchEvent("change");

    const fontSizeInput = formatPanel.locator('input[type="number"]').nth(0);
    await fontSizeInput.fill("38");
    await fontSizeInput.dispatchEvent("change");

    const previewMain = page.locator(".se-preview-text--main");
    await expect(previewMain).toContainText("LOUVAI AO SENHOR");
    await expect(previewMain).toHaveCSS("color", "rgb(0, 204, 102)");

    await page.locator("#ribbon-tab-ctx_slide_editor_slides").click();
    await page.locator('[data-testid="ribbon-btn-editor_project"]').click();

    const projectedMain = projection.locator(".lj-slide__text--lyric");
    await expect(projectedMain).toContainText("LOUVAI AO SENHOR", { timeout: 10_000 });
    await expect(projectedMain).toHaveCSS("color", "rgb(0, 204, 102)");
  });

  test("classifica .slja legado, preserva ms, converte faixa e exporta pacote unificado (#61, #62)", async ({
    page,
    context,
  }) => {
    await mockAppNetwork(context);
    await openSlideEditor(page);

    const zip = new JSZip();
    zip.file(
      "slides.lja",
      [
        "[Geral]",
        "slides=2",
        "nome=Legado Dual",
        "url_musica=audio/CantadoAntigo.mp3",
        "[Slide:1]",
        "tipo=CAPA",
        "letra=Legado Dual",
        "tempo_hms=00:00:00.000",
        "[Slide:2]",
        "tipo=LETRA",
        "letra=Verso com milissegundos",
        "tempo_hms=00:00:04.250",
      ].join("\r\n")
    );
    zip.file("audio/CantadoAntigo.mp3", minimalMp3(0x33));
    const buffer = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

    await page.locator('input[type="file"][accept=".slja,.lja"]').setInputFiles({
      name: "Legado Dual.slja",
      mimeType: "application/zip",
      buffer,
    });

    await expect(page.locator('[data-testid="slja-choice-playback"]')).toBeVisible();
    await page.locator('[data-testid="slja-choice-playback"]').click();
    await page.locator('[data-testid="slja-confirm-import"]').click();

    await expect(page.locator('[data-testid="se-track"]')).toHaveText("Playback");
    await expect(page.locator(".se-thumb-time").first()).toContainText("00:00:04.250");

    // Converte a faixa importada incorretamente para Cantado preservando tempo fracionado (#61, #62).
    const audioDetails = page.locator("details.se-panel").nth(3);
    await audioDetails.locator("summary").click();
    await page.locator('[data-testid="se-convert-track"]').click();

    await expect(page.locator('[data-testid="se-track"]')).toHaveText("Cantado");
    await expect(page.locator(".se-thumb-time").first()).toContainText("00:00:04.250");

    // Alterna para Playback e anexa segunda faixa de áudio para habilitar exportação unificada.
    await page.locator("#ribbon-tab-ctx_slide_editor_audio").click();
    await page.locator('[data-testid="ribbon-btn-editor_audio_track"]').click();
    await expect(page.locator('[data-testid="se-track"]')).toHaveText("Playback");

    await page.locator('input[type="file"][accept="audio/*"]').setInputFiles({
      name: "NovoPB.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from(minimalMp3(0x77)),
    });
    await expect(page.locator(".se-audio-time")).toContainText(/\d\d:\d\d:\d\d/);

    await page.locator("#ribbon-tab-ctx_slide_editor_file").click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="ribbon-btn-editor_export"]').click();

    await expect(page.locator('[data-testid="slja-export-unified"]')).toBeVisible();
    await page.locator('[data-testid="slja-export-unified"]').click();

    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const exportedZip = await JSZip.loadAsync(await fs.readFile(downloadPath));
    const iniBytes = await exportedZip.file("slides.lja").async("uint8array");
    const iniText = new TextDecoder("windows-1252").decode(iniBytes);
    expect(iniText).toContain("faixa=ambos");
    expect(iniText).toContain("url_musica=");
    expect(iniText).toContain("url_playback=");
    expect(iniText).toContain("tempo_hms=00:00:04.250");

    const audioEntries = Object.keys(exportedZip.files).filter((name) => name.startsWith("audio/"));
    expect(audioEntries.length).toBeGreaterThanOrEqual(2);
  });
});
