/** Music-only canonical domain. No clocks, I/O, framework or platform dependencies. */
import { isSynced, nextMarked, slideAt } from "./SlideMarkers";

export interface MusicSlide {
  lyric?: string;
  cover?: boolean;
  [key: string]: unknown;
}

export interface MusicSnapshot {
  readonly sessionId: string;
  readonly revision: number;
  readonly active: boolean;
  readonly title: string;
  readonly slideIndex: number;
  readonly totalSlides: number;
  readonly slide: Readonly<MusicSlide> | null;
  readonly nextSlide: Readonly<MusicSlide> | null;
}

export type MusicOperation =
  | { type: "select"; index: number }
  | { type: "clock"; position: number }
  | { type: "times"; times: readonly number[] }
  | { type: "close" };

export type MusicCommand = MusicOperation & { sessionId: string; commandId: number };

/**
 * One authority supplies monotonically increasing command IDs per session.
 * Repeated and older IDs are no-ops, without an ever-growing deduplication set.
 * Reopening creates a new instance/session; a closed session cannot be revived.
 */
export class MusicPresentationCore {
  private readonly slides: readonly Readonly<MusicSlide>[];
  private times: readonly number[];
  private lastCommandId = 0;
  private state: MusicSnapshot;

  constructor(sessionId: string, slides: readonly MusicSlide[], times: readonly number[], title: string) {
    this.slides = slides.map((slide) => Object.freeze({ ...slide }));
    this.times = [...times];
    this.state = Object.freeze({
      sessionId, revision: 0, active: true, title, slideIndex: 0,
      totalSlides: slides.length, slide: this.slides[0] ?? null, nextSlide: this.slides[this.nextIndex(0)] ?? null,
    });
  }

  private nextIndex(index: number): number {
    return isSynced(this.times) ? nextMarked(this.times, index) : index + 1;
  }

  snapshot(): MusicSnapshot { return this.state; }

  dispatch(command: MusicCommand): MusicSnapshot {
    if (!this.state.active || command.sessionId !== this.state.sessionId ||
        !Number.isSafeInteger(command.commandId) || command.commandId <= this.lastCommandId) return this.state;
    this.lastCommandId = command.commandId;
    let index = this.state.slideIndex;
    if (command.type === "times") this.times = [...command.times];
    if (command.type === "select") {
      const requested = Number.isFinite(command.index) ? Math.floor(command.index) : 0;
      index = Math.max(0, Math.min(requested, this.slides.length - 1));
    }
    if (command.type === "clock" && isSynced(this.times)) {
      index = slideAt(this.times, command.position, this.slides.length);
    }
    const closed = command.type === "close";
    this.state = Object.freeze({
      ...this.state, revision: this.state.revision + 1, active: !closed,
      title: closed ? "" : this.state.title,
      slideIndex: closed ? 0 : index, totalSlides: closed ? 0 : this.slides.length,
      slide: closed ? null : this.slides[index] ?? null,
      nextSlide: closed ? null : this.slides[this.nextIndex(index)] ?? null,
    });
    return this.state;
  }
}
