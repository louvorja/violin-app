import { Buffer } from "node:buffer";
import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });

/*
 * Item "Utilitário" da liturgia: abre o módulo já configurado e, com
 * "Iniciar automaticamente ao clicar", já começa a contar.
 */
const START = new Date(2026, 10, 28, 9, 0, 0);

async function openLiturgy(page) {
  await page.clock.install({ time: START });
  await page.route("http://e2e.mock/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/json_db/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.locator('[data-testid="modules-ready"]').waitFor({ state: "attached" });
  await page.clock.setSystemTime(START);
  // Sem áudio no teste: os avisos do Temporizador de Culto ficam desligados.
  await page.evaluate(async () => {
    const { default: userdata } = await import("/src/helpers/UserData.ts");
    for (const key of ["sound_start", "sound_five_min", "sound_one_min"])
      userdata.set(`modules.timer_worship.${key}`, false);
  });
  await page.getByRole("button", { name: "Editar liturgia" }).click();
  await expect(page.locator(".liturgy-page")).toBeVisible();
}

async function chooseOption(dialog, page, label, option) {
  await dialog.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function addUtility(page, setup) {
  await page.getByTestId("liturgy-add-item").last().click();
  const dialog = page.getByRole("dialog");
  await chooseOption(dialog, page, "Tipo", "Utilitário");
  await setup(dialog);
  await dialog.getByTestId("item-save").click();
  await expect(dialog).not.toBeVisible();
}

test("Temporizador de Culto até 9:45, iniciando sozinho ao clicar", async ({ page }) => {
  await openLiturgy(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Temporizador de Culto");
    // O nome do item acompanha o módulo escolhido.
    await expect(dialog.getByTestId("item-name")).toHaveValue("Temporizador de Culto");
    await dialog.getByTestId("utility-target").fill("09:45");
    await dialog.getByTestId("utility-autostart").click();
  });

  const card = page.locator("[data-item-id]").filter({ hasText: "Temporizador de Culto" });
  await expect(card).toContainText("até 09:45 · inicia sozinho");
  await card.getByRole("button", { name: "Temporizador de Culto" }).click();

  const display = page.getByTestId("timer-worship-display");
  await expect(display).toBeVisible();
  await expect(page.getByTestId("ribbon-btn-timer_worship_toggle")).toContainText("Pausar");
  await page.clock.runFor(3_000);
  // Começou a contar até 09:45 (sob carga o relógio do teste anda uns segundos a mais).
  await expect(display).toContainText(/00:44:[0-5]\d/);
  await expect(page.getByTestId("timer-worship-extra")).toHaveText("09:45");
});

test("por duração e sem iniciar sozinho: abre pronto, esperando o Iniciar", async ({ page }) => {
  await openLiturgy(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Temporizador de Culto");
    await dialog.getByTestId("item-name").fill("Sermão");
    await chooseOption(dialog, page, "Definir por", "Duração");
    await expect(dialog.getByTestId("utility-target")).toHaveCount(0);
    await dialog.getByTestId("utility-minutes").fill("25");
  });

  const card = page.locator("[data-item-id]").filter({ hasText: "Sermão" });
  await expect(card).toContainText("25 min");
  await expect(card).not.toContainText("inicia sozinho");
  await card.getByRole("button", { name: "Sermão" }).click();

  const display = page.getByTestId("timer-worship-display");
  await expect(display).toContainText("00:25:00");
  await expect(page.getByTestId("ribbon-btn-timer_worship_toggle")).toContainText("Iniciar");
  await page.clock.runFor(3_000);
  await expect(display).toContainText("00:25:00");
});

test("Cronômetro regressivo de 5 min, iniciando sozinho", async ({ page }) => {
  await openLiturgy(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Cronômetro");
    await dialog.getByTestId("utility-minutes").fill("5");
    await dialog.getByTestId("utility-autostart").click();
  });
  await page
    .locator("[data-item-id]")
    .filter({ hasText: "Cronômetro" })
    .getByRole("button", { name: "Cronômetro" })
    .click();
  await page.clock.runFor(3_000);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const state = await import("/src/modules/stopwatch/state.ts");
        return {
          running: state.running.value,
          mode: state.mode.value,
          target: state.targetSeconds.value,
        };
      })
    )
    .toEqual({ running: true, mode: "down", target: 300 });
});

test("Temporizador de Culto sem abertura e com outro áudio no aviso de 5 min", async ({ page }) => {
  await openLiturgy(page);
  await page.evaluate(async () => {
    const { default: idb } = await import("/src/helpers/IndexedDB.ts");
    const { DB_TABLE } = await import("/src/constants/DbTables.ts");
    await idb.put(DB_TABLE.MEDIA_LIBRARY, {
      id: "cinco-coral",
      name: "Cinco minutos (coral)",
      type: "audio",
      mime: "audio/mpeg",
      data: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
    });
  });
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Temporizador de Culto");
    await dialog.getByTestId("item-name").fill("Escola Sabatina");
    await dialog.getByTestId("utility-target").fill("09:45");
    // Sem a abertura, o campo do áudio dela some.
    await dialog.getByTestId("utility-sound_start").click();
    await expect(dialog.getByTestId("utility-sound_start_file")).toHaveCount(0);
    await dialog.getByTestId("utility-sound_five_file-pick").click();
    await page.getByText("Cinco minutos (coral)").click();
    await expect(dialog.getByTestId("utility-sound_five_file")).toContainText(
      "Cinco minutos (coral)"
    );
    await chooseOption(dialog, page, "Avisar faltando", "2 min");
  });

  const card = page.locator("[data-item-id]").filter({ hasText: "Escola Sabatina" });
  await expect(card).toContainText("até 09:45 · sem abertura");
  await card.getByRole("button", { name: "Escola Sabatina" }).click();
  await expect(page.getByTestId("timer-worship-display")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ud = JSON.parse(localStorage.getItem("user_data") || "{}").modules?.timer_worship;
        return {
          start: ud?.sound_start,
          five: ud?.sound_five_min_file?.libraryId,
          alert: ud?.alert_seconds,
        };
      })
    )
    .toEqual({ start: false, five: "cinco-coral", alert: 120 });
});

test("Sorteio de nomes", async ({ page }) => {
  await openLiturgy(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Sorteio");
    await dialog.getByTestId("item-name").fill("Sorteio dos brindes");
    await chooseOption(dialog, page, "Sortear", "Nomes");
    await dialog.getByTestId("utility-names").fill("Ana\nJoão\n\nMaria");
  });
  const draw = page.locator("[data-item-id]").filter({ hasText: "Sorteio dos brindes" });
  await expect(draw).toContainText("3 nomes");
  await draw.getByRole("button", { name: "Sorteio dos brindes" }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { drawState } = await import("/src/modules/draw/state.ts");
        return { mode: drawState.mode, names: [...drawState.names] };
      })
    )
    .toEqual({ mode: "names", names: ["Ana", "João", "Maria"] });
});

test("Contador começando em 10", async ({ page }) => {
  await openLiturgy(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Contador");
    await dialog.getByTestId("utility-start").fill("10");
  });
  await page
    .locator("[data-item-id]")
    .filter({ hasText: "Contador" })
    .getByRole("button", { name: "Contador" })
    .click();
  await expect(page.locator(".subtab").filter({ hasText: "Contador" })).toBeVisible();
  await expect(page.getByText("10", { exact: true }).first()).toBeVisible();
});

test("Relógio abre em 12 horas, sem opção de iniciar", async ({ page }) => {
  await openLiturgy(page);
  await page.getByTestId("liturgy-add-item").last().click();
  const dialog = page.getByRole("dialog");
  await chooseOption(dialog, page, "Tipo", "Utilitário");
  await chooseOption(dialog, page, "Utilitário", "Relógio");
  await expect(dialog.getByTestId("utility-autostart")).toHaveCount(0);
  await expect(dialog.getByTestId("utility-mode")).toHaveCount(0);
  await chooseOption(dialog, page, "Formato", "12 horas");
  await dialog.getByTestId("item-save").click();
  await page
    .locator("[data-item-id]")
    .filter({ hasText: "Relógio" })
    .getByRole("button", { name: "Relógio" })
    .click();
  await expect(page.locator(".subtab").filter({ hasText: "Relógio" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("user_data") || "{}").modules?.clock?.hour_cycle
      )
    )
    .toBe("12h");
});

async function seedLibrary(page) {
  await page.evaluate(async () => {
    const { default: idb } = await import("/src/helpers/IndexedDB.ts");
    const { DB_TABLE } = await import("/src/constants/DbTables.ts");
    const bytes = () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });
    await idb.put(DB_TABLE.MEDIA_LIBRARY, {
      id: "aviso-diacono",
      name: "Aviso do diácono",
      type: "audio",
      mime: "audio/mpeg",
      data: bytes(),
    });
    await idb.put(DB_TABLE.MEDIA_LIBRARY, {
      id: "fim-culto",
      name: "Fim do culto",
      type: "audio",
      mime: "audio/mpeg",
      data: bytes(),
    });
    await idb.put(DB_TABLE.MEDIA_LIBRARY, {
      id: "video-encerramento",
      name: "Vídeo de encerramento",
      type: "video",
      path: "https://e2e.mock/encerramento.mp4",
    });
  });
}

const savedModule = (page, id) =>
  page.evaluate((id) => JSON.parse(localStorage.getItem("user_data") || "{}").modules?.[id], id);

test("Temporizador de Culto: avisos extras do item e áudio ao terminar", async ({ page }) => {
  await openLiturgy(page);
  await seedLibrary(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Temporizador de Culto");
    await dialog.getByTestId("item-name").fill("Culto Divino");
    await dialog.getByTestId("utility-target").fill("09:45");
    await expect(dialog.getByTestId("utility-extras")).toHaveCount(0);
    await chooseOption(dialog, page, "Avisos extras", "Os deste item");
    await dialog.getByTestId("utility-extra-add").click();
    const time = dialog.getByTestId("utility-extra-0-time");
    await expect(time).toHaveValue("10:00");
    await time.fill("2:00");
    await time.press("Enter");
    await dialog.getByTestId("utility-extra-0-pick").click();
    await page.getByText("Aviso do diácono").click();
    await expect(dialog.getByTestId("utility-extra-0")).toContainText("Aviso do diácono");

    await chooseOption(dialog, page, "Ação", "Tocar áudio");
    await dialog.getByTestId("utility-end_file-pick").click();
    // Para áudio, o vídeo não aparece na lista.
    await expect(page.getByText("Vídeo de encerramento")).toHaveCount(0);
    await page.getByText("Fim do culto").click();
    await expect(dialog.getByTestId("utility-end_file")).toContainText("Fim do culto");
  });

  const card = page.locator("[data-item-id]").filter({ hasText: "Culto Divino" });
  await expect(card).toContainText("no fim: Fim do culto");
  await card.getByRole("button", { name: "Culto Divino" }).click();
  await expect(page.getByTestId("timer-worship-display")).toBeVisible();
  await expect
    .poll(async () => {
      const tw = await savedModule(page, "timer_worship");
      return {
        extras: (tw?.sound_extras ?? []).map((c) => [c.seconds, c.libraryId]),
        action: tw?.timer_end_action,
        title: tw?.timer_end_data_audio?.title,
      };
    })
    .toEqual({ extras: [[120, "aviso-diacono"]], action: "audio", title: "Fim do culto" });
});

test("Temporizador: projetar vídeo ao terminar", async ({ page }) => {
  await openLiturgy(page);
  await seedLibrary(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Temporizador");
    await dialog.getByTestId("utility-target").fill("09:30");
    await chooseOption(dialog, page, "Ação", "Projetar vídeo ou imagem");
    await dialog.getByTestId("utility-end_file-pick").click();
    await expect(page.getByText("Fim do culto")).toHaveCount(0);
    await page.getByText("Vídeo de encerramento").click();
  });
  await page
    .locator("[data-item-id]")
    .filter({ hasText: "Temporizador" })
    .getByRole("button", { name: "Temporizador" })
    .click();
  await expect
    .poll(async () => {
      const timer = await savedModule(page, "timer");
      return { action: timer?.timer_end_action, data: timer?.timer_end_data_video };
    })
    .toEqual({
      action: "video",
      data: { url: "https://e2e.mock/encerramento.mp4", type: "video" },
    });
});

test("Sorteio: importar lista .txt, duração do efeito e opções da projeção", async ({ page }) => {
  await openLiturgy(page);
  await addUtility(page, async (dialog) => {
    await chooseOption(dialog, page, "Utilitário", "Sorteio");
    await chooseOption(dialog, page, "Sortear", "Nomes");
    await dialog.getByTestId("utility-names").fill("Ana");
    await dialog.locator('input[type="file"][accept*=".txt"]').setInputFiles({
      name: "lista.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("﻿João\r\nAna\r\n\r\nMaria\r\n"),
    });
    // Junta sem repetir a "Ana" que já estava.
    await expect(dialog.getByTestId("utility-names")).toHaveValue("Ana\nJoão\nMaria");
    await chooseOption(dialog, page, "Duração do efeito", "5 s");
    await dialog.getByTestId("utility-show_history").click();
    await dialog.getByTestId("utility-random_finish").click();
  });
  await page
    .locator("[data-item-id]")
    .filter({ hasText: "Sorteio" })
    .getByRole("button", { name: "Sorteio" })
    .click();
  await expect
    .poll(async () => {
      const draw = await savedModule(page, "draw");
      return {
        effect: draw?.effect_duration,
        history: draw?.show_drawn_history,
        random: draw?.random_finish,
        names: draw?.names,
      };
    })
    .toEqual({ effect: 5000, history: true, random: false, names: ["Ana", "João", "Maria"] });
});
