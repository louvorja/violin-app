/**
 * Banco local que não abre não pode travar a abertura do app.
 *
 * Reproduz o erro que o Chromium dá quando o LevelDB do perfil está preso ou
 * corrompido ("Internal error opening backing store", visto no Windows). Antes,
 * a rejeição do IndexedDB parava o boot antes do mount: janela vazia em toda
 * abertura, e a telemetria nem chegava a ligar para contar.
 */
import { test, expect } from "@playwright/test";
import ptMusics from "./fixtures/pt_musics.json";

const BREAK_INDEXEDDB = () => {
  IDBFactory.prototype.open = function open() {
    throw new DOMException(
      "Internal error opening backing store for indexedDB.open.",
      "UnknownError"
    );
  };
};

test.beforeEach(async ({ context }) => {
  await context.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await context.addInitScript(BREAK_INDEXEDDB);
});

test("janela principal monta sem o banco local e lista o catálogo da rede", async ({
  page,
  context,
}) => {
  await context.route("**/pt_musics*", (route) => route.fulfill({ json: ptMusics }));
  await page.goto("/");
  await expect(page.locator("#ribbon-tab-collections")).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="modules-ready"]')).toBeAttached({ timeout: 15000 });

  await page.locator("#ribbon-tab-collections").click();
  await page.locator('[data-testid="ribbon-btn-musics"]').click();
  await expect(page.locator('[data-testid="music-row-1"]')).toBeVisible({ timeout: 10000 });
});

test("janela auxiliar que espera o banco monta sem ele", async ({ page }) => {
  await page.goto("/clock");
  await expect(page.locator(".clock-time")).toHaveText(/\d{1,2}:\d{2}/, { timeout: 20000 });
});
