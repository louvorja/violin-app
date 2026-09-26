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

    await projection.reload();
    await expect.poll(pageColor).toEqual([0, 255, 0]);
  } finally {
    await context.close();
  }
});
