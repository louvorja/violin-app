import { describe, expect, it } from "vitest";
import { PdfPageRenderQueue } from "@/helpers/PdfPageRenderQueue";

describe("PdfPageRenderQueue", () => {
  it("serializes canvas work and skips superseded pending pages", async () => {
    const queue = new PdfPageRenderQueue();
    let release!: () => void;
    const firstStarted = new Promise<void>((resolve) => { release = resolve; });
    const painted: number[] = [];
    let active = 0;
    let maxActive = 0;
    const render = (page: number) => queue.run(async (isCurrent) => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (page === 1) await firstStarted;
      if (isCurrent()) painted.push(page);
      active--;
    });
    const first = render(1);
    await Promise.resolve();
    const second = render(2);
    const third = render(3);
    release();
    await Promise.all([first, second, third]);
    expect(maxActive).toBe(1);
    expect(painted).toEqual([3]);
  });

  it("invalidates a pending page when its document closes", async () => {
    const queue = new PdfPageRenderQueue();
    const painted: number[] = [];
    const pending = queue.run(async () => { painted.push(1); });
    queue.invalidate();
    await pending;
    expect(painted).toEqual([]);
  });
});
