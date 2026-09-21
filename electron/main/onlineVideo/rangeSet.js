"use strict";

/**
 * Intervalos de bytes já gravados num arquivo que vai sendo baixado aos pedaços.
 * Todos os limites são inclusivos, como no cabeçalho `Range`.
 */
class RangeSet {
  constructor() {
    /** @type {Array<[number, number]>} ordenados e sem sobreposição */
    this.ranges = [];
  }

  /** Marca [start, end] como presente, juntando o que encosta ou se sobrepõe. */
  add(start, end) {
    if (!(end >= start)) return;
    const merged = [];
    let s = start;
    let e = end;
    let placed = false;
    for (const [a, b] of this.ranges) {
      if (b + 1 < s) merged.push([a, b]);
      else if (a > e + 1) {
        if (!placed) {
          merged.push([s, e]);
          placed = true;
        }
        merged.push([a, b]);
      } else {
        s = Math.min(s, a);
        e = Math.max(e, b);
      }
    }
    if (!placed) merged.push([s, e]);
    this.ranges = merged;
  }

  /** [start, end] está inteiro presente? */
  covers(start, end) {
    for (const [a, b] of this.ranges) {
      if (a <= start && b >= end) return true;
      if (a > start) return false;
    }
    return false;
  }

  /**
   * Primeiro trecho que falta a partir de `from`, dentro de um arquivo de `size`
   * bytes; null se do ponto em diante já está tudo aqui.
   * @returns {{ start: number, end: number } | null}
   */
  firstGap(from, size) {
    let pos = Math.max(0, from);
    if (pos > size - 1) return null;
    for (const [a, b] of this.ranges) {
      if (b < pos) continue;
      if (a > pos) return { start: pos, end: Math.min(a - 1, size - 1) };
      pos = b + 1;
      if (pos > size - 1) return null;
    }
    return { start: pos, end: size - 1 };
  }

  /** Quantos bytes já estão presentes. */
  get bytes() {
    let n = 0;
    for (const [a, b] of this.ranges) n += b - a + 1;
    return n;
  }
}

module.exports = { RangeSet };
