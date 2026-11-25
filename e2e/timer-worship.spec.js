import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

/*
 * Temporizador de Culto (#88): definir por duração, ±minutos sem zerar,
 * relógio abaixo da contagem e áudio de cada aviso pela Biblioteca de Mídia.
 * O relógio da página começa às 10:58.
 */
const START = new Date(2026, 10, 5, 10, 58, 0);

async function openWorship(page, settings = {}) {
  await page.clock.install({ time: START });
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page
    .locator('[data-testid="modules-ready"]')
    .waitFor({ state: "attached", timeout: 30_000 });
  await page.locator("#ribbon-tab-worship").click();
  await page.locator('[data-testid="ribbon-btn-timer_worship"]').click();
  await expect(page.getByTestId("timer-worship-display")).toBeVisible();
  await page.clock.setSystemTime(START);
  await page.evaluate(async (settings) => {
    const { default: userdata } = await import("/src/helpers/UserData.ts");
    userdata.set("modules.timer_worship.mode", "down");
    for (const [key, value] of Object.entries(settings)) {
      userdata.set(`modules.timer_worship.${key}`, value);
    }
    // Grava o que o temporizador manda tocar, em vez de tocar de verdade.
    const { default: media } = await import("/src/composables/useMedia.ts");
    window.__played = [];
    media.openAudio = async (params) => {
      window.__played.push(params.title);
    };
  }, settings);
}

const display = (page) => page.getByTestId("timer-worship-display");
const toggle = (page) => page.getByTestId("ribbon-btn-timer_worship_toggle");
const played = (page) => page.evaluate(() => window.__played);

async function setTarget(page, value) {
  const time = page.locator('input[type="time"]').first();
  await time.fill(value);
  await time.dispatchEvent("change");
}

test("duração: pausar congela e retomar continua de onde parou", async ({ page }) => {
  await openWorship(page, {
    define_by: "duration",
    duration_minutes: 10,
    sound_start: false,
    sound_five_min: false,
    sound_one_min: false,
  });
  await expect(page.getByTestId("ribbon-btn-timer_worship_duration_minutes")).toBeVisible();
  await expect(page.locator('input[type="time"]')).toHaveCount(0);
  await expect(display(page)).toContainText("00:10:00");
  // Abaixo da contagem, a hora em que vai acabar: 10:58 + 10 min.
  await expect(page.getByTestId("timer-worship-extra")).toHaveText("11:08");

  await toggle(page).click();
  await page.clock.runFor(60_000);
  await expect(display(page)).toContainText(/00:0[89]:\d\d/);
  const atPause = await display(page).innerText();
  await toggle(page).click();
  await page.clock.runFor(120_000);
  await expect(display(page)).toContainText(atPause.split("\n")[0]);
  await toggle(page).click();
  await page.clock.runFor(2_000);
  await expect(display(page)).not.toContainText(atPause.split("\n")[0]);
});

test("±min na barra de baixo: pausado, soma sem zerar e o horário anda junto", async ({ page }) => {
  await openWorship(page, { sound_start: false, sound_five_min: false, sound_one_min: false });
  await setTarget(page, "11:00");
  await toggle(page).click();
  await page.clock.runFor(30_000);
  await toggle(page).click(); // pausa com ~1:30
  await expect(display(page)).toContainText(/00:01:[23]\d/);

  await page.getByTestId("timer-worship-adjust-plus-5").click();
  await expect(display(page)).toContainText(/00:06:[23]\d/);
  await expect(page.getByTestId("timer-worship-extra")).toHaveText("11:05");
  // Continua pausado: o botão segue em "Iniciar".
  await expect(toggle(page)).toContainText("Iniciar");

  await page.getByTestId("timer-worship-adjust-minus-1").click();
  await expect(page.getByTestId("timer-worship-extra")).toHaveText("11:04");
  await toggle(page).click();
  await page.clock.runFor(1_000);
  await expect(display(page)).toContainText(/00:05:[12]\d/);
});

test("rodando, tirar minutos não toca o aviso de 5 min fora de hora", async ({ page }) => {
  await openWorship(page, { sound_start: false, sound_five_min: true, sound_one_min: true });
  await setTarget(page, "11:05"); // 7 min
  await toggle(page).click();
  await page.clock.runFor(5_000);
  await page.getByTestId("timer-worship-adjust-minus-5").click(); // ~1:55
  await page.clock.runFor(10_000);
  expect(await played(page)).toEqual([]);
  // Os 10 s antes de 1 min: o aviso de 1 minuto toca.
  await page.clock.runFor(40_000);
  await expect.poll(() => played(page)).toEqual(["1 minuto"]);
});

test("Exibir: relógio, os dois e nada", async ({ page }) => {
  await openWorship(page);
  await setTarget(page, "11:00");
  const exibir = page.locator('[data-testid="ribbon-btn-timer_worship_second_line"] select');
  const extra = page.getByTestId("timer-worship-extra");
  await expect(extra).toHaveText("11:00");
  await exibir.selectOption("clock");
  await expect(extra).toHaveText(/10:58:\d\d/);
  await exibir.selectOption("both");
  await expect(extra).toContainText("11:00");
  await expect(extra).toContainText(/10:58:\d\d/);
  await exibir.selectOption("none");
  await expect(extra).toHaveCount(0);
});

test("Áudios: aviso com áudio da Biblioteca de Mídia e volta ao padrão", async ({ page }) => {
  await openWorship(page, { sound_start: true, sound_five_min: false, sound_one_min: false });
  await page.evaluate(async () => {
    const { default: idb } = await import("/src/helpers/IndexedDB.ts");
    const { DB_TABLE } = await import("/src/constants/DbTables.ts");
    await idb.put(DB_TABLE.MEDIA_LIBRARY, {
      id: "lit-abertura",
      name: "Abertura litúrgica",
      type: "audio",
      mime: "audio/mpeg",
      data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/mpeg" }),
    });
    await idb.put(DB_TABLE.MEDIA_LIBRARY, {
      id: "foto",
      name: "Foto da igreja",
      type: "image",
      path: "foto.jpg",
    });
  });

  await page.getByTestId("ribbon-btn-timer_worship_sounds").click();
  const row = page.getByTestId("tw-sound-start");
  await expect(row).toContainText("Padrão do programa");
  await page.getByTestId("tw-sound-start-pick").click();
  // Só os áudios aparecem para escolher.
  await expect(page.getByText("Foto da igreja")).toHaveCount(0);
  await page.getByText("Abertura litúrgica").click();
  await expect(row).toContainText("Abertura litúrgica");

  await page.getByTestId("tw-sound-start-play").click();
  await expect.poll(() => played(page)).toEqual(["Abertura litúrgica"]);
  await page.keyboard.press("Escape");

  // Iniciar toca o áudio escolhido como abertura.
  await setTarget(page, "11:00");
  await toggle(page).click();
  await expect.poll(() => played(page)).toEqual(["Abertura litúrgica", "Abertura litúrgica"]);

  // Voltar ao padrão.
  await page.getByTestId("ribbon-btn-timer_worship_sounds").click();
  await page.getByTestId("tw-sound-start-default").click();
  await expect(row).toContainText("Padrão do programa");
  await page.getByTestId("tw-sound-start-play").click();
  await expect.poll(async () => (await played(page)).at(-1)).toBe("Abertura");
});

test("áudio escolhido que sumiu da biblioteca toca o padrão", async ({ page }) => {
  await openWorship(page, {
    sound_start: true,
    sound_start_file: { libraryId: "apagado", name: "Apagado" },
  });
  await setTarget(page, "11:00");
  await toggle(page).click();
  await expect.poll(() => played(page)).toEqual(["Abertura"]);
});

test("avisos extras: novo aviso faltando 2:00 com áudio da biblioteca", async ({ page }) => {
  await openWorship(page, { sound_start: false, sound_five_min: false, sound_one_min: false });
  await page.evaluate(async () => {
    const { default: idb } = await import("/src/helpers/IndexedDB.ts");
    const { DB_TABLE } = await import("/src/constants/DbTables.ts");
    await idb.put(DB_TABLE.MEDIA_LIBRARY, {
      id: "lit-encerramento",
      name: "Encerramento do culto",
      type: "audio",
      mime: "audio/mpeg",
      data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/mpeg" }),
    });
  });

  await page.getByTestId("ribbon-btn-timer_worship_sounds").click();
  await page.getByTestId("tw-extra-add").click();
  const time = page.getByTestId("tw-extra-0-time");
  await expect(time).toHaveValue("10:00");
  await time.fill("2:00");
  await time.press("Enter");
  await expect(page.getByTestId("tw-extra-0")).toContainText("Escolha um áudio");
  await page.getByTestId("tw-extra-0-pick").click();
  await page.getByText("Encerramento do culto").click();
  await expect(page.getByTestId("tw-extra-0")).toContainText("Encerramento do culto");
  await page.getByTestId("tw-extra-0-play").click();
  await expect.poll(() => played(page)).toEqual(["Encerramento do culto"]);
  await page.keyboard.press("Escape");

  await setTarget(page, "11:01"); // 3 min
  await toggle(page).click();
  await page.clock.runFor(50_000);
  expect(await played(page)).toEqual(["Encerramento do culto"]);
  await page.clock.runFor(15_000); // passa por 2:00
  await expect
    .poll(() => played(page))
    .toEqual(["Encerramento do culto", "Encerramento do culto"]);

  // Remover tira da lista e da contagem.
  await page.getByTestId("ribbon-btn-timer_worship_sounds").click();
  await page.getByTestId("tw-extra-0-remove").click();
  await expect(page.getByTestId("tw-extra-0")).toHaveCount(0);
});
