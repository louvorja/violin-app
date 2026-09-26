import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";

function twoPagePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 6 0 R >>",
    "<< /Length 25 >>\nstream\n1 0 0 rg 0 0 200 200 re f\nendstream",
    "<< /Length 25 >>\nstream\n0 1 0 rg 0 0 200 200 re f\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, value] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${value}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test("PDF page state belongs to the active file and survives reopen", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/file-projection-fixture.pdf", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: twoPagePdf(),
    })
  );
  const projection = await context.newPage();
  try {
    await projection.goto("/projection/file");
    await projection.evaluate(() => {
      window.__fileTestBus = new BroadcastChannel("louvorja");
      window.__fileTestPages = [];
      window.__fileTestBus.addEventListener("message", (event) => {
        if (event.data?.type === "file_projection_page")
          window.__fileTestPages.push(event.data.payload);
      });
      window.__fileTestBus.send = (type, payload) =>
        window.__fileTestBus.postMessage({ type, payload });
    });
    const url = "http://localhost:5002/file-projection-fixture.pdf";
    const activate = (playbackId, stageEpoch) =>
      projection.evaluate(
        ({ url, playbackId, stageEpoch }) => {
          const payload = {
            type: "pdf",
            url,
            title: "Fixture",
            page: 1,
            playback_id: playbackId,
            stage_epoch: stageEpoch,
          };
          localStorage.setItem("lj_file_projection", JSON.stringify(payload));
          window.__fileTestBus.send("file_projection", payload);
        },
        { url, playbackId, stageEpoch }
      );
    const pageColor = () =>
      projection.locator("canvas.file-projection__pdf").evaluate((canvas) => {
        const data = canvas
          .getContext("2d")
          .getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
        return [data[0], data[1], data[2]];
      });

    await activate("pdf-a", 100);
    await expect.poll(pageColor).toEqual([255, 0, 0]);
    await activate("pdf-b", 101);
    await expect
      .poll(() =>
        projection.evaluate(() =>
          window.__fileTestPages.some(
            (page) => page.playback_id === "pdf-b" && page.totalPages === 2
          )
        )
      )
      .toBe(true);
    await expect.poll(pageColor).toEqual([255, 0, 0]);
    await projection.evaluate(
      (url) =>
        window.__fileTestBus.send("file_projection", {
          type: "pdf",
          url,
          title: "Old",
          page: 2,
          playback_id: "pdf-a",
          stage_epoch: 100,
        }),
      url
    );
    await expect.poll(pageColor).toEqual([255, 0, 0]);
    await projection.evaluate(() =>
      window.__fileTestBus.send("file_projection_page", {
        playback_id: "pdf-a",
        page: 2,
        source: "operator",
      })
    );
    await expect.poll(pageColor).toEqual([255, 0, 0]);
    await projection.evaluate(() => {
      const payload = JSON.parse(localStorage.getItem("lj_file_projection"));
      localStorage.setItem("lj_file_projection", JSON.stringify({ ...payload, page: 2 }));
      window.__fileTestBus.send("file_projection_page", {
        playback_id: "pdf-b",
        page: 2,
        source: "operator",
      });
    });
    await expect.poll(pageColor).toEqual([0, 255, 0]);

    await projection.evaluate(() => {
      for (const page of [1, 2, 1]) {
        window.__fileTestBus.send("file_projection_page", {
          playback_id: "pdf-b",
          page,
          source: "operator",
        });
      }
    });
    await projection.waitForTimeout(300);
    await expect.poll(pageColor).toEqual([255, 0, 0]);
    await expect.poll(() => projection.evaluate(() => window.__fileTestPages.at(-1)?.page)).toBe(1);

    await projection.reload();
    await expect.poll(pageColor).toEqual([0, 255, 0]);
  } finally {
    await context.close();
  }
});

test("background projection and return keep the last rapid PDF page", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/file-projection-fixture.pdf", (route) =>
    route.fulfill({ status: 200, contentType: "application/pdf", body: twoPagePdf() })
  );
  const operator = await context.newPage();
  const projection = await context.newPage();
  const returned = await context.newPage();
  const url = "http://localhost:5002/file-projection-fixture.pdf";
  const color = (page, selector) =>
    page.locator(selector).evaluate((canvas) => {
      const data = canvas
        .getContext("2d")
        .getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return [data[0], data[1], data[2]];
    });
  try {
    await operator.goto("/");
    await projection.goto("/projection/background_projection");
    await projection.locator(".layer-root-bg").waitFor({ state: "attached", timeout: 30_000 });
    await operator.evaluate((pdfUrl) => {
      window.__pdfBus = new BroadcastChannel("louvorja");
      window.__pdfSend = (type, payload) => window.__pdfBus.postMessage({ type, payload });
      const state = {
        type: "pdf",
        url: pdfUrl,
        title: "Fixture",
        page: 1,
        playback_id: "background-pdf",
        stage_epoch: 100,
      };
      localStorage.setItem("lj_file_projection", JSON.stringify(state));
      window.__pdfSend("file_projection", state);
    }, url);
    await expect
      .poll(() => color(projection, "canvas.layer-file--pdf"), { timeout: 20_000 })
      .toEqual([255, 0, 0]);
    await returned.goto("/projection/background_projection/return");
    await returned.locator(".return-root-bg").waitFor({ state: "attached", timeout: 30_000 });
    await expect
      .poll(() => color(returned, "canvas.return-file--pdf"), { timeout: 20_000 })
      .toEqual([255, 0, 0]);

    await operator.evaluate(() => {
      for (const page of [2, 1, 2]) {
        window.__pdfSend("file_projection_page", {
          playback_id: "background-pdf",
          page,
          source: "operator",
        });
      }
    });
    await operator.waitForTimeout(300);
    await expect.poll(() => color(projection, "canvas.layer-file--pdf")).toEqual([0, 255, 0]);
    await expect.poll(() => color(returned, "canvas.return-file--pdf")).toEqual([0, 255, 0]);
  } finally {
    await context.close();
  }
});

test("image projection and return recover the latest file after late join and reopen", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const operator = await context.newPage();
  const projection = await context.newPage();
  const returned = await context.newPage();
  const image = (color) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${color}"/></svg>`)}`;
  const a = image("red");
  const b = image("blue");
  try {
    await operator.goto("/");
    await operator.evaluate(
      (url) =>
        localStorage.setItem(
          "lj_file_projection",
          JSON.stringify({
            type: "image",
            url,
            title: "Current",
            playback_id: "image-b",
            stage_epoch: 101,
          })
        ),
      b
    );
    await projection.goto("/projection/file");
    await returned.goto("/projection/file/return");
    await expect(projection.locator("img.file-projection__media")).toHaveAttribute("src", b);
    await expect(returned.locator("img.return-file-projection__media")).toHaveAttribute("src", b);

    await operator.evaluate((url) => {
      const bus = new BroadcastChannel("louvorja");
      bus.postMessage({
        type: "file_projection",
        payload: {
          type: "image",
          url,
          title: "Old",
          playback_id: "image-a",
          stage_epoch: 100,
        },
      });
      bus.close();
    }, a);
    await projection.waitForTimeout(100);
    await expect(projection.locator("img.file-projection__media")).toHaveAttribute("src", b);
    await expect(returned.locator("img.return-file-projection__media")).toHaveAttribute("src", b);
    await projection.reload();
    await expect(projection.locator("img.file-projection__media")).toHaveAttribute("src", b);
  } finally {
    await context.close();
  }
});
