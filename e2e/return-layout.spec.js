import { test, expect } from "@playwright/test";

const viewports = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

for (const viewport of viewports) {
  test(`tela de retorno mantém o próximo slide dentro do painel em ${viewport.width}×${viewport.height}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    await page.addInitScript(() => {
      localStorage.setItem(
        "user_data",
        JSON.stringify({ options: { slide: { font_size_next: 15 } } })
      );
    });

    await page.goto("/projection/return");
    await page.locator(".return-bottom").waitFor({ state: "visible" });

    await page.evaluate(() => {
      const channel = new BroadcastChannel("louvorja");
      channel.postMessage({
        type: "slide_change",
        payload: {
          slide_index: 0,
          total_slides: 14,
          title: "Teste",
          slide: { name: "Slide atual" },
          next_slide: {
            lyric:
              "Um próximo slide deliberadamente longo para ocupar duas linhas e validar a moldura da tela de retorno.",
          },
        },
      });
      channel.close();
    });

    await expect(page.locator(".return-next-content")).toContainText("deliberadamente longo");
    await expect(page.locator(".return-counter")).toHaveText("1 / 14");

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Elemento ausente: ${selector}`);
        const { top, bottom } = element.getBoundingClientRect();
        return { top, bottom };
      };
      const nextContent = document.querySelector(".return-next-content");
      const nextText = document.querySelector(".return-next-text");
      if (!nextContent || !nextText) throw new Error("Preview do próximo slide ausente");
      return {
        panel: rect(".return-bottom"),
        // O contador vive ao lado do título, no painel de cima — só o
        // próximo slide precisa caber dentro do painel do rodapé.
        children: [
          rect(".return-bottom-grid"),
          rect(".return-next-label"),
          rect(".return-next-text"),
          rect(".return-next-content"),
        ],
        nextPreview: {
          contentHeight: nextContent.scrollHeight,
          availableHeight: nextText.clientHeight,
        },
      };
    });

    for (const child of layout.children) {
      expect(child.top).toBeGreaterThanOrEqual(layout.panel.top - 1);
      expect(child.bottom).toBeLessThanOrEqual(layout.panel.bottom + 1);
    }

    // O ajuste automático (useFitText) encolhe a fonte até a letra inteira
    // caber na caixa — nunca corta o texto do próximo slide.
    expect(layout.nextPreview.contentHeight).toBeLessThanOrEqual(
      layout.nextPreview.availableHeight + 1
    );

    await context.close();
  });
}
