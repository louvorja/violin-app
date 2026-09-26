/** Serializes PDF.js work on one canvas and keeps only the latest requested page. */
export class PdfPageRenderQueue {
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();

  run(task: (_isCurrent: () => boolean) => Promise<void>): Promise<void> {
    const generation = ++this.generation;
    const isCurrent = () => generation === this.generation;
    const next = this.tail.then(async () => {
      if (isCurrent()) await task(isCurrent);
    });
    this.tail = next.catch(() => {});
    return next;
  }

  invalidate(): void {
    ++this.generation;
  }
}
