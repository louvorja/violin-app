import { describe, expect, it } from "vitest";
import {
  adjust,
  createCountdownState,
  endTimeText,
  overtimeTurnedOff,
  pause,
  refreshIdle,
  reset,
  shiftTarget,
  start,
  tick,
  type CountdownConfig,
  type CountdownEvent,
  type CountdownState,
} from "../countdown";

/** 28/11/2026 às hh:mm:ss, mais `ms`, no fuso local. */
function at(hh: number, mm: number, ss = 0, ms = 15): number {
  return new Date(2026, 10, 28, hh, mm, ss, ms).getTime();
}

function cfg(over: Partial<CountdownConfig> = {}): CountdownConfig {
  return {
    mode: "down",
    defineBy: "end",
    target: "10:00",
    durationMinutes: 10,
    overtime: true,
    ...over,
  };
}

/** Roda o relógio de segundo em segundo, de `from` até `to` (inclusive), juntando os eventos. */
function run(
  state: CountdownState,
  config: CountdownConfig,
  from: number,
  to: number
): { events: Array<[number, CountdownEvent]> } {
  const events: Array<[number, CountdownEvent]> = [];
  for (let now = from; now <= to; now += 1000) {
    for (const e of tick(state, config, now)) events.push([state.seconds, e]);
  }
  return { events };
}

describe("Temporizador de Culto — hora de término", () => {
  it("parado mostra o tempo até o horário e acompanha o relógio", () => {
    const s = createCountdownState();
    const c = cfg();
    refreshIdle(s, c, at(9, 50));
    expect(s.seconds).toBe(600);
    tick(s, c, at(9, 51));
    expect(s.seconds).toBe(540);
  });

  it("toca abertura, 5 min e 1 min 10 s antes da marca, e o fim no zero", () => {
    const s = createCountdownState();
    const c = cfg();
    expect(start(s, c, at(9, 50))).toEqual(["start"]);
    const { events } = run(s, c, at(9, 50, 1), at(10, 0, 2));
    expect(events).toEqual([
      [310, "five"],
      [70, "one"],
      [0, "end"],
    ]);
    // Com tempo excedido segue contando.
    expect(s.running).toBe(true);
    expect(s.seconds).toBe(-2);
  });

  it("iniciar já abaixo dos 5 min não toca o aviso de 5 min", () => {
    const s = createCountdownState();
    const c = cfg();
    start(s, c, at(9, 57));
    const { events } = run(s, c, at(9, 57, 1), at(9, 59, 0));
    expect(events).toEqual([[70, "one"]]);
  });

  it("pausar e somar 1 min: o horário anda e a retomada segue o relógio", () => {
    const s = createCountdownState();
    let c = cfg();
    start(s, c, at(9, 50));
    run(s, c, at(9, 50, 1), at(9, 55, 0));
    pause(s, c, at(9, 55, 0, 500));
    expect(s.seconds).toBe(300);

    const r = adjust(s, c, 1, at(9, 55, 10));
    expect(r.target).toBe("10:01");
    c = { ...c, ...r };
    expect(s.seconds).toBe(360);
    expect(s.running).toBe(false);

    start(s, c, at(9, 56));
    expect(s.seconds).toBe(300);
    tick(s, c, at(9, 56, 1));
    expect(s.seconds).toBe(299);
  });

  it("tirar tempo nunca toca um aviso fora de hora", () => {
    const s = createCountdownState();
    let c = cfg();
    start(s, c, at(9, 50));
    run(s, c, at(9, 50, 1), at(9, 53, 20)); // faltam 400 s
    expect(s.seconds).toBe(400);
    c = { ...c, ...adjust(s, c, -5, at(9, 53, 20, 500)) };
    expect(s.seconds).toBe(100);
    const { events } = run(s, c, at(9, 53, 21), at(9, 54, 31));
    expect(events).toEqual([[70, "one"]]);
  });

  it("somar tempo depois do aviso faz ele tocar de novo ao cruzar outra vez", () => {
    const s = createCountdownState();
    let c = cfg();
    start(s, c, at(9, 50));
    const first = run(s, c, at(9, 50, 1), at(9, 55, 0));
    expect(first.events).toEqual([[310, "five"]]);
    c = { ...c, ...adjust(s, c, 5, at(9, 55, 0, 500)) }; // 300 → 600
    expect(s.seconds).toBe(600);
    const again = run(s, c, at(9, 55, 1), at(10, 0, 0));
    expect(again.events).toEqual([[310, "five"]]);
  });

  it("horário já passado com tempo excedido começa no negativo e dispara o fim", () => {
    const s = createCountdownState();
    const c = cfg({ target: "09:59" });
    expect(start(s, c, at(10, 0))).toEqual(["start", "end"]);
    expect(s.seconds).toBe(-60);
    expect(s.running).toBe(true);
  });

  it("sem tempo excedido, para no zero; somar minutos e iniciar retoma", () => {
    const s = createCountdownState();
    let c = cfg({ overtime: false });
    start(s, c, at(9, 59));
    const { events } = run(s, c, at(9, 59, 1), at(10, 0, 5));
    expect(events.at(-1)).toEqual([0, "end"]);
    expect(s.running).toBe(false);
    expect(s.seconds).toBe(0);

    c = { ...c, ...adjust(s, c, 5, at(10, 0, 6)) };
    expect(c.target).toBe("10:05");
    expect(start(s, c, at(10, 0, 6, 100))).toEqual([]);
    expect(s.running).toBe(true);
    expect(s.seconds).toBe(294);
  });

  it("desligar o excedido no meio dele zera e para", () => {
    const s = createCountdownState();
    const c = cfg();
    start(s, c, at(9, 59));
    run(s, c, at(9, 59, 1), at(10, 0, 30));
    expect(s.seconds).toBe(-30);
    const off = { ...c, overtime: false };
    overtimeTurnedOff(s, off, at(10, 0, 30, 500));
    expect(s.running).toBe(false);
    expect(s.seconds).toBe(0);
    // Não toca o fim de novo enquanto continua parado.
    expect(tick(s, off, at(10, 0, 31))).toEqual([]);
  });

  it("progressivo por hora de término: pausa não perde o tempo do relógio", () => {
    const s = createCountdownState();
    const c = cfg({ mode: "up" });
    start(s, c, at(9, 50));
    expect(s.seconds).toBe(0);
    run(s, c, at(9, 50, 1), at(9, 51, 0));
    expect(s.seconds).toBe(60);
    pause(s, c, at(9, 51, 0, 500));
    start(s, c, at(9, 53));
    expect(s.seconds).toBe(180);
  });

  it("progressivo não toca avisos e para no total", () => {
    const s = createCountdownState();
    const c = cfg({ mode: "up", target: "09:56" });
    start(s, c, at(9, 50));
    const { events } = run(s, c, at(9, 50, 1), at(9, 56, 3));
    expect(events).toEqual([[360, "end"]]);
    expect(s.running).toBe(false);
    expect(s.seconds).toBe(360);
  });

  it("reiniciar volta à prévia e limpa os avisos", () => {
    const s = createCountdownState();
    const c = cfg();
    start(s, c, at(9, 50));
    run(s, c, at(9, 50, 1), at(9, 55, 0));
    reset(s, c, at(9, 55, 1));
    expect(s.started).toBe(false);
    expect(s.running).toBe(false);
    expect(s.seconds).toBe(299);
    expect(s.fiveFired).toBe(false);
  });
});

describe("Temporizador de Culto — duração", () => {
  it("pausar congela e retomar continua de onde parou", () => {
    const s = createCountdownState();
    const c = cfg({ defineBy: "duration", durationMinutes: 10 });
    refreshIdle(s, c, at(9, 0));
    expect(s.seconds).toBe(600);
    start(s, c, at(9, 0));
    run(s, c, at(9, 0, 1), at(9, 1, 0));
    expect(s.seconds).toBe(540);
    pause(s, c, at(9, 1, 0, 400));
    start(s, c, at(9, 20));
    expect(s.seconds).toBe(540);
    tick(s, c, at(9, 20, 1));
    expect(s.seconds).toBe(539);
  });

  it("pausado, +5 min soma só a esta contagem", () => {
    const s = createCountdownState();
    const c = cfg({ defineBy: "duration", durationMinutes: 10 });
    start(s, c, at(9, 0));
    run(s, c, at(9, 0, 1), at(9, 1, 0));
    pause(s, c, at(9, 1, 0, 400));
    expect(adjust(s, c, 5, at(9, 2))).toEqual({});
    expect(s.seconds).toBe(840);
    start(s, c, at(9, 3));
    tick(s, c, at(9, 3, 1));
    expect(s.seconds).toBe(839);
  });

  it("parado, os botões mudam a duração configurada (mínimo 1 min)", () => {
    const s = createCountdownState();
    const c = cfg({ defineBy: "duration", durationMinutes: 3 });
    expect(adjust(s, c, 5, at(9, 0))).toEqual({ durationMinutes: 8 });
    expect(s.seconds).toBe(480);
    expect(adjust(s, c, -10, at(9, 0))).toEqual({ durationMinutes: 1 });
    expect(s.seconds).toBe(60);
  });

  it("a hora de término acompanha o relógio enquanto pausado", () => {
    const s = createCountdownState();
    const c = cfg({ defineBy: "duration", durationMinutes: 30 });
    expect(endTimeText(s, c, at(9, 0))).toBe("09:30");
    start(s, c, at(9, 0));
    pause(s, c, at(9, 10));
    expect(endTimeText(s, c, at(9, 15))).toBe("09:35");
  });

  it("ajuste com tempo excedido volta a contar e rearma o fim", () => {
    const s = createCountdownState();
    let c = cfg({ defineBy: "duration", durationMinutes: 1 });
    start(s, c, at(9, 0));
    const first = run(s, c, at(9, 0, 1), at(9, 1, 5));
    // Começou com 60 s, já abaixo da marca do aviso de 1 min: só o fim toca.
    expect(first.events.map(([, e]) => e)).toEqual(["end"]);
    expect(s.seconds).toBe(-5);
    c = { ...c, ...adjust(s, c, 1, at(9, 1, 5, 500)) };
    expect(s.seconds).toBe(55);
    expect(s.alarmed).toBe(false);
    const again = run(s, c, at(9, 1, 6), at(9, 2, 1));
    expect(again.events).toEqual([[0, "end"]]);
  });
});

describe("Temporizador de Culto — duração sem pulo de 1 s", () => {
  it("iniciar no meio do segundo não mostra um segundo a mais", () => {
    const c = cfg({ defineBy: "duration", durationMinutes: 6 });
    const s = createCountdownState();
    const now = at(9, 0, 0, 700);
    start(s, c, now);
    expect(s.seconds).toBe(360);
    tick(s, c, now + 50);
    expect(s.seconds).toBe(360);
    tick(s, c, at(9, 0, 1, 0));
    expect(s.seconds).toBe(359);
  });

  it("retomar no meio do segundo não sobe 1 s e volta", () => {
    const c = cfg({ defineBy: "duration", durationMinutes: 6 });
    const s = createCountdownState();
    start(s, c, at(9, 0, 0, 0));
    tick(s, c, at(9, 0, 30, 0));
    pause(s, c, at(9, 0, 30, 100));
    expect(s.seconds).toBe(330);
    // Retoma com 0,7 s do segundo andado: a tela não pode mostrar 331.
    const resumeAt = at(9, 2, 0, 700);
    start(s, c, resumeAt);
    expect(s.seconds).toBe(330);
    tick(s, c, resumeAt + 50);
    expect(s.seconds).toBe(330);
    tick(s, c, at(9, 2, 1, 0));
    expect(s.seconds).toBe(329);
  });
});

describe("shiftTarget", () => {
  it("dá a volta na meia-noite", () => {
    expect(shiftTarget("23:55", 10)).toBe("00:05");
    expect(shiftTarget("00:03", -5)).toBe("23:58");
    expect(shiftTarget("10:45", 1)).toBe("10:46");
  });
});

describe("Temporizador de Culto — avisos extras", () => {
  it("tocam na marca, só ao passar por ela", () => {
    const s = createCountdownState();
    const c = cfg({ marks: [600, 150] });
    start(s, c, at(9, 45)); // 15 min
    const { events } = run(s, c, at(9, 45, 1), at(9, 58, 0));
    expect(events.filter(([, e]) => e.startsWith("mark"))).toEqual([
      [600, "mark:600"],
      [150, "mark:150"],
    ]);
  });

  it("iniciar abaixo da marca ou tirar tempo por cima dela não toca", () => {
    const s = createCountdownState();
    let c = cfg({ marks: [600] });
    start(s, c, at(9, 52)); // 8 min, abaixo dos 10
    expect(run(s, c, at(9, 52, 1), at(9, 53, 0)).events).toEqual([]);

    const s2 = createCountdownState();
    c = cfg({ marks: [600] });
    start(s2, c, at(9, 45));
    c = { ...c, ...adjust(s2, c, -10, at(9, 45, 0, 500)) }; // 15 → 5 min
    expect(run(s2, c, at(9, 45, 1), at(9, 46, 0)).events).toEqual([]);
  });

  it("progressivo não toca avisos extras", () => {
    const s = createCountdownState();
    const c = cfg({ mode: "up", target: "09:20", marks: [600] });
    start(s, c, at(9, 0));
    const { events } = run(s, c, at(9, 0, 1), at(9, 15, 0));
    expect(events).toEqual([]);
  });
});
