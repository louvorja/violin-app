import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import { nextTick, toRaw } from "vue";
import LjCalendar from "../LjCalendar.vue";
import { mountUi } from "./mountUi";

/**
 * A suíte inteira roda em América/São Paulo, de propósito.
 *
 * Datas de agenda são dias civis. Se o componente montar um `Date` a partir de
 * "2026-03-05" pelo construtor de string, o valor vira meia-noite UTC e, lido em
 * hora local a oeste de Greenwich, volta para 04/03 — a agenda toda anda um dia
 * para trás. Num runner em UTC esse defeito passa despercebido e só aparece na
 * máquina do usuário, ao vivo. Fixar um fuso negativo aqui faz cada asserção de
 * grade e de posicionamento também valer como teste de fuso.
 */
const tzOriginal = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});

afterAll(() => {
  process.env.TZ = tzOriginal;
});

interface Agendado {
  id: string;
  name: string;
  start: string;
  end?: string;
  color?: string;
}

const montados: VueWrapper[] = [];

afterEach(() => {
  while (montados.length) montados.pop()?.unmount();
  document.body.innerHTML = "";
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function montar(props: Record<string, unknown>, options: any = {}) {
  const wrapper = mountUi(LjCalendar, { props, ...options });
  montados.push(wrapper as unknown as VueWrapper);
  return wrapper;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type Wrapper = ReturnType<typeof montar>;

function celulas(w: Wrapper) {
  return w.findAll(".lj-calendar__day");
}

function datas(w: Wrapper): (string | undefined)[] {
  return celulas(w).map((c) => c.attributes("data-date"));
}

function celula(w: Wrapper, date: string) {
  return w.get(`.lj-calendar__day[data-date="${date}"]`);
}

function chips(w: Wrapper, date: string): string[] {
  return celula(w, date)
    .findAll(".lj-calendar__event")
    .map((e) => e.text());
}

function cabecalho(w: Wrapper): string[] {
  return w.findAll(".lj-calendar__weekday").map((e) => e.text());
}

describe("LjCalendar — fuso", () => {
  it("roda mesmo num fuso a oeste de Greenwich, senão o teste de fuso não vale nada", () => {
    // 180 minutos = UTC-3. Se algum dia o runner ignorar process.env.TZ, este
    // caso avisa em vez de deixar a suíte virar decoração.
    expect(new Date(2026, 2, 5).getTimezoneOffset()).toBe(180);
  });

  it("põe o evento no dia escrito na string, não no dia anterior", () => {
    const w = montar({
      modelValue: "2026-03-15",
      locale: "pt-BR",
      events: [{ id: "1", name: "Ensaio", start: "2026-03-05", end: "2026-03-05" }] as Agendado[],
    });

    expect(chips(w, "2026-03-05")).toEqual(["Ensaio"]);
    expect(chips(w, "2026-03-04")).toEqual([]);
  });

  it("aceita data com hora colada sem deslocar o dia", () => {
    const w = montar({
      modelValue: "2026-03-15",
      events: [{ id: "1", name: "Culto", start: "2026-03-01T00:00:00" }] as Agendado[],
    });

    expect(chips(w, "2026-03-01")).toEqual(["Culto"]);
    // Março de 2026 começa num domingo: se a data escorregasse um dia, o evento
    // cairia fora da grade e sumiria em vez de aparecer no dia errado.
    expect(w.findAll(".lj-calendar__event")).toHaveLength(1);
  });

  it("modelValue em Date usa os componentes locais da data", () => {
    const w = montar({ modelValue: new Date(2026, 1, 10), locale: "pt-BR" });

    expect(datas(w)[0]).toBe("2026-02-01");
    expect(datas(w).at(-1)).toBe("2026-02-28");
  });
});

describe("LjCalendar — grade do mês", () => {
  it("mês que começa no primeiro dia da semana não ganha célula de fora", () => {
    // Fevereiro de 2026: começa num domingo e tem 28 dias — quatro semanas
    // exatas, o caso em que um off-by-one na borda apareceria sozinho.
    const w = montar({ modelValue: "2026-02-01", locale: "pt-BR" });

    const todas = datas(w);
    expect(todas).toHaveLength(28);
    expect(w.findAll(".lj-calendar__week")).toHaveLength(4);
    expect(todas[0]).toBe("2026-02-01");
    expect(todas.at(-1)).toBe("2026-02-28");
    expect(w.findAll(".lj-calendar__day--outside")).toHaveLength(0);
  });

  it("fevereiro bissexto mostra o dia 29 e completa as semanas com o mês vizinho", () => {
    const w = montar({ modelValue: "2024-02-15", locale: "pt-BR" });

    const todas = datas(w);
    expect(todas).toHaveLength(35);
    expect(w.findAll(".lj-calendar__week")).toHaveLength(5);
    expect(todas[0]).toBe("2024-01-28");
    expect(todas.at(-1)).toBe("2024-03-02");
    expect(todas).toContain("2024-02-29");
    expect(celula(w, "2024-01-28").classes()).toContain("lj-calendar__day--outside");
    expect(celula(w, "2024-02-29").classes()).not.toContain("lj-calendar__day--outside");
  });

  it("fevereiro comum para no dia 28", () => {
    const w = montar({ modelValue: "2025-02-15", locale: "pt-BR" });

    const todas = datas(w);
    expect(todas).toContain("2025-02-28");
    expect(todas).not.toContain("2025-02-29");
    expect(todas.filter((d) => d?.startsWith("2025-02-"))).toHaveLength(28);
  });

  it("meses longos que transbordam ocupam seis semanas", () => {
    // Maio de 2026 começa numa sexta e tem 31 dias: 5 de folga + 31 = 36 > 35.
    const w = montar({ modelValue: "2026-05-10", locale: "pt-BR" });

    expect(w.findAll(".lj-calendar__week")).toHaveLength(6);
    expect(datas(w)).toHaveLength(42);
  });

  it("cada dia é sequencial e único — nenhum salto de horário de verão", () => {
    const w = montar({ modelValue: "2026-10-18", locale: "pt-BR" });

    const todas = datas(w) as string[];
    expect(new Set(todas).size).toBe(todas.length);
    for (let i = 1; i < todas.length; i++) {
      const anterior = new Date(`${todas[i - 1]}T12:00:00`);
      const atual = new Date(`${todas[i]}T12:00:00`);
      expect(Math.round((atual.getTime() - anterior.getTime()) / 86_400_000)).toBe(1);
    }
  });

  it("toda célula carrega a própria data em data-date", () => {
    const w = montar({ modelValue: "2026-02-01" });

    expect(celulas(w)).toHaveLength(28);
    expect(datas(w).every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || ""))).toBe(true);
  });
});

describe("LjCalendar — locale", () => {
  it("em pt-BR a semana começa no domingo", () => {
    const w = montar({ modelValue: "2026-02-15", locale: "pt-BR" });

    expect(cabecalho(w)[0].toLowerCase()).toMatch(/^dom/);
    expect(datas(w)[0]).toBe("2026-02-01");
  });

  it("em es a semana começa na segunda", () => {
    const w = montar({ modelValue: "2026-02-15", locale: "es" });

    expect(cabecalho(w)[0].toLowerCase()).toMatch(/^lun/);
    expect(cabecalho(w).at(-1)?.toLowerCase()).toMatch(/^dom/);
    // 1º/2026-02 é domingo: com semana começando na segunda, a grade abre em 26/01.
    expect(datas(w)[0]).toBe("2026-01-26");
    expect(datas(w).at(-1)).toBe("2026-03-01");
  });

  it("os sete nomes do cabeçalho seguem o idioma", () => {
    const pt = montar({ modelValue: "2026-02-15", locale: "pt-BR" });
    const es = montar({ modelValue: "2026-02-15", locale: "es" });

    expect(cabecalho(pt)).toHaveLength(7);
    expect(cabecalho(es)).toHaveLength(7);
    expect(cabecalho(pt)).not.toEqual(cabecalho(es));
    // Rótulo curto na coluna, nome inteiro para quem usa leitor de tela.
    expect(pt.findAll(".lj-calendar__weekday")[0].attributes("aria-label")).toMatch(/domingo/i);
  });

  it("firstDayOfWeek sobrepõe o primeiro dia que o locale define", () => {
    const w = montar({ modelValue: "2026-02-15", locale: "pt-BR", firstDayOfWeek: 1 });

    expect(cabecalho(w)[0].toLowerCase()).toMatch(/^seg/);
    expect(datas(w)[0]).toBe("2026-01-26");
  });
});

describe("LjCalendar — eventos", () => {
  const eventos: Agendado[] = [
    { id: "a", name: "Ensaio", start: "2026-02-03", end: "2026-02-03", color: "#c62828" },
    { id: "b", name: "Culto", start: "2026-02-03", end: "2026-02-03" },
    { id: "c", name: "Reunião", start: "2026-02-20", end: "2026-02-20" },
  ];

  it("cada evento cai na célula do seu dia", () => {
    const w = montar({ modelValue: "2026-02-01", events: eventos });

    expect(chips(w, "2026-02-03")).toEqual(["Ensaio", "Culto"]);
    expect(chips(w, "2026-02-20")).toEqual(["Reunião"]);
    expect(chips(w, "2026-02-04")).toEqual([]);
    expect(w.findAll(".lj-calendar__event")).toHaveLength(3);
  });

  it("evento de vários dias aparece em todos os dias do intervalo", () => {
    const w = montar({
      modelValue: "2026-02-01",
      events: [{ id: "x", name: "Semana Santa", start: "2026-02-10", end: "2026-02-13" }],
    });

    for (const d of ["2026-02-10", "2026-02-11", "2026-02-12", "2026-02-13"]) {
      expect(chips(w, d)).toEqual(["Semana Santa"]);
    }
    expect(chips(w, "2026-02-09")).toEqual([]);
    expect(chips(w, "2026-02-14")).toEqual([]);
  });

  it("evento de um dia só dispensa o campo de fim", () => {
    const w = montar({
      modelValue: "2026-02-01",
      events: [{ id: "x", name: "Vigília", start: "2026-02-07" }],
    });

    expect(chips(w, "2026-02-07")).toEqual(["Vigília"]);
    expect(w.findAll(".lj-calendar__event")).toHaveLength(1);
  });

  it("evento fora da grade não é desenhado", () => {
    const w = montar({
      modelValue: "2026-02-01",
      events: [{ id: "x", name: "Antigo", start: "2020-01-01", end: "2020-01-01" }],
    });

    expect(w.findAll(".lj-calendar__event")).toHaveLength(0);
  });

  it("evento longo que atravessa a grade é recortado nas bordas visíveis", () => {
    const w = montar({
      modelValue: "2026-02-01",
      events: [{ id: "x", name: "Ano todo", start: "2025-01-01", end: "2027-12-31" }],
    });

    // Fevereiro de 2026 são exatamente 28 células, todas ocupadas.
    expect(w.findAll(".lj-calendar__event")).toHaveLength(28);
    expect(chips(w, "2026-02-01")).toEqual(["Ano todo"]);
    expect(chips(w, "2026-02-28")).toEqual(["Ano todo"]);
  });

  it("ignora evento sem data de início em vez de quebrar a grade", () => {
    const w = montar({
      modelValue: "2026-02-01",
      events: [
        { id: "x", name: "Sem data", start: "" },
        { id: "y", name: "Válido", start: "2026-02-05" },
      ],
    });

    expect(w.findAll(".lj-calendar__event")).toHaveLength(1);
    expect(chips(w, "2026-02-05")).toEqual(["Válido"]);
  });

  it("usa os campos que o chamador indicar", () => {
    const w = montar({
      modelValue: "2026-02-01",
      events: [{ id: "x", titulo: "Escola Sabatina", dia: "2026-02-07", tom: "#00695c" }],
      eventStart: "dia",
      eventEnd: "dia",
      eventLabel: "titulo",
      eventColor: "tom",
    });

    expect(chips(w, "2026-02-07")).toEqual(["Escola Sabatina"]);
    const chip = celula(w, "2026-02-07").get(".lj-calendar__event");
    expect(chip.attributes("style")).toContain("#00695c");
  });

  it("a cor do evento vira variável inline, e sem cor não vira nada", () => {
    const w = montar({ modelValue: "2026-02-01", events: eventos });

    const [comCor, semCor] = celula(w, "2026-02-03").findAll(".lj-calendar__event");
    expect(comCor.attributes("style")).toContain("#c62828");
    expect(semCor.attributes("style")).toBeUndefined();
  });

  it("o chip leva o texto no title, porque o corte é por reticências", () => {
    const w = montar({ modelValue: "2026-02-01", events: eventos });

    expect(celula(w, "2026-02-20").get(".lj-calendar__event").attributes("title")).toBe("Reunião");
  });
});

describe("LjCalendar — corte com +N", () => {
  const cinco: Agendado[] = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    name: `Item ${i + 1}`,
    start: "2026-02-10",
    end: "2026-02-10",
  }));

  it("guarda a última linha para o indicador quando não cabe", () => {
    const w = montar({ modelValue: "2026-02-01", events: cinco, maxEvents: 3, eventMoreText: "+{0} mais" });

    // Três linhas no total: duas de evento e uma de indicador.
    expect(chips(w, "2026-02-10")).toEqual(["Item 1", "Item 2"]);
    expect(celula(w, "2026-02-10").get(".lj-calendar__more").text()).toBe("+3 mais");
  });

  it("não corta quando os eventos cabem no teto", () => {
    const w = montar({ modelValue: "2026-02-01", events: cinco, maxEvents: 5 });

    expect(chips(w, "2026-02-10")).toHaveLength(5);
    expect(celula(w, "2026-02-10").find(".lj-calendar__more").exists()).toBe(false);
  });

  it("o texto do indicador vem do chamador, com {0} recebendo a contagem", () => {
    const w = montar({
      modelValue: "2026-02-01",
      events: cinco,
      maxEvents: 2,
      eventMoreText: "+{0} más",
    });

    expect(celula(w, "2026-02-10").get(".lj-calendar__more").text()).toBe("+4 más");
  });

  it("na semana nada é cortado — é para onde o +N leva", () => {
    const w = montar({ modelValue: "2026-02-10", type: "week", events: cinco, maxEvents: 3 });

    expect(chips(w, "2026-02-10")).toHaveLength(5);
    expect(w.findAll(".lj-calendar__more")).toHaveLength(0);
  });
});

describe("LjCalendar — semana", () => {
  it("desenha uma linha de sete dias a partir do primeiro dia da semana", () => {
    const w = montar({ modelValue: "2026-02-11", type: "week", locale: "pt-BR" });

    expect(w.findAll(".lj-calendar__week")).toHaveLength(1);
    expect(datas(w)).toEqual([
      "2026-02-08",
      "2026-02-09",
      "2026-02-10",
      "2026-02-11",
      "2026-02-12",
      "2026-02-13",
      "2026-02-14",
    ]);
  });

  it("respeita o primeiro dia do locale também na semana", () => {
    const w = montar({ modelValue: "2026-02-11", type: "week", locale: "es" });

    expect(datas(w)[0]).toBe("2026-02-09");
    expect(datas(w).at(-1)).toBe("2026-02-15");
  });

  it("nenhum dia da semana é marcado como fora do mês", () => {
    const w = montar({ modelValue: "2026-03-01", type: "week", locale: "pt-BR" });

    expect(datas(w)[0]).toBe("2026-03-01");
    expect(w.findAll(".lj-calendar__day--outside")).toHaveLength(0);
  });
});

describe("LjCalendar — cliques", () => {
  const eventos: Agendado[] = [
    { id: "a", name: "Ensaio", start: "2026-02-03", end: "2026-02-03" },
    { id: "b", name: "Culto", start: "2026-02-03", end: "2026-02-03" },
    { id: "c", name: "Extra", start: "2026-02-03", end: "2026-02-03" },
  ];

  it("clicar no dia emite a data daquela célula", async () => {
    const w = montar({ modelValue: "2026-02-01" });

    await celula(w, "2026-02-17").trigger("click");

    const emitido = w.emitted("dayClick");
    expect(emitido).toHaveLength(1);
    const carga = emitido?.[0][0] as { date: string; day: { dayOfMonth: number; outside: boolean } };
    expect(carga.date).toBe("2026-02-17");
    expect(carga.day.dayOfMonth).toBe(17);
    expect(carga.day.outside).toBe(false);
  });

  it("clicar num dia de outro mês avisa que ele é de fora", async () => {
    const w = montar({ modelValue: "2024-02-15" });

    await celula(w, "2024-01-28").trigger("click");

    const carga = w.emitted("dayClick")?.[0][0] as { date: string; day: { outside: boolean } };
    expect(carga.date).toBe("2024-01-28");
    expect(carga.day.outside).toBe(true);
  });

  it("clicar num evento emite o evento original e não o dia", async () => {
    const w = montar({ modelValue: "2026-02-01", events: eventos });

    await celula(w, "2026-02-03").findAll(".lj-calendar__event")[1].trigger("click");

    const carga = w.emitted("eventClick")?.[0][0] as { event: Agendado; date: string };
    // `toRaw` porque o VTU embrulha as props num reactive: o que chega ao
    // consumidor é o proxy do MESMO objeto que ele passou, não uma cópia.
    expect(toRaw(carga.event)).toBe(eventos[1]);
    expect(carga.date).toBe("2026-02-03");
    // Sem isto, abrir um evento também abriria o diálogo de criar um novo.
    expect(w.emitted("dayClick")).toBeUndefined();
  });

  it("clicar no +N emite os escondidos e não o dia", async () => {
    const w = montar({ modelValue: "2026-02-01", events: eventos, maxEvents: 2 });

    await celula(w, "2026-02-03").get(".lj-calendar__more").trigger("click");

    const carga = w.emitted("moreClick")?.[0][0] as { date: string; hidden: Agendado[] };
    expect(carga.date).toBe("2026-02-03");
    expect(carga.hidden.map((e) => e.name)).toEqual(["Culto", "Extra"]);
    expect(w.emitted("dayClick")).toBeUndefined();
  });
});

describe("LjCalendar — teclado e semântica", () => {
  it("expõe a grade e as células com os papéis certos", () => {
    const w = montar({ modelValue: "2026-02-01", ariaLabel: "Agenda" });

    expect(w.attributes("role")).toBe("grid");
    expect(w.attributes("aria-label")).toBe("Agenda");
    expect(w.findAll('[role="columnheader"]')).toHaveLength(7);
    expect(w.findAll('[role="row"]')).toHaveLength(5); // cabeçalho + 4 semanas
    expect(celula(w, "2026-02-01").attributes("role")).toBe("gridcell");
    expect(celula(w, "2026-02-01").attributes("aria-label")).toMatch(/fevereiro/i);
  });

  it("só uma célula fica no caminho do Tab", () => {
    const w = montar({ modelValue: "2026-02-17" });

    const tabulaveis = celulas(w).filter((c) => c.attributes("tabindex") === "0");
    expect(tabulaveis).toHaveLength(1);
    expect(tabulaveis[0].attributes("data-date")).toBe("2026-02-17");
  });

  it("Enter na célula focada abre o dia", async () => {
    const w = montar({ modelValue: "2026-02-01" });

    await celula(w, "2026-02-17").trigger("keydown", { key: "Enter" });

    expect((w.emitted("dayClick")?.[0][0] as { date: string }).date).toBe("2026-02-17");
  });

  it("Enter num chip de evento não abre o dia por baixo", async () => {
    const w = montar({
      modelValue: "2026-02-01",
      events: [{ id: "a", name: "Ensaio", start: "2026-02-03" }],
    });

    await celula(w, "2026-02-03").get(".lj-calendar__event").trigger("keydown", { key: "Enter" });

    expect(w.emitted("dayClick")).toBeUndefined();
  });

  it("as setas andam pela grade sem mexer no mês em foco", async () => {
    const w = montar({ modelValue: "2026-02-10" }, { attachTo: document.body });

    const partida = celula(w, "2026-02-10").element as HTMLElement;
    partida.focus();
    await celula(w, "2026-02-10").trigger("keydown", { key: "ArrowRight" });
    await nextTick();
    expect((document.activeElement as HTMLElement)?.dataset.date).toBe("2026-02-11");

    await celula(w, "2026-02-11").trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    expect((document.activeElement as HTMLElement)?.dataset.date).toBe("2026-02-18");

    // Navegar é do teclado; trocar de mês continua sendo do chamador.
    expect(w.emitted("update:modelValue")).toBeUndefined();
    expect(datas(w)[0]).toBe("2026-02-01");
  });

  it("a seta para trás no primeiro dia da grade não sai do calendário", async () => {
    const w = montar({ modelValue: "2026-02-01" }, { attachTo: document.body });

    (celula(w, "2026-02-01").element as HTMLElement).focus();
    await celula(w, "2026-02-01").trigger("keydown", { key: "ArrowLeft" });
    await nextTick();

    expect((document.activeElement as HTMLElement)?.dataset.date).toBe("2026-02-01");
  });
});

describe("LjCalendar — hoje", () => {
  it("marca a célula de hoje e só ela", () => {
    const agora = new Date();
    const iso = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(
      agora.getDate()
    ).padStart(2, "0")}`;

    const w = montar({ modelValue: iso });

    const marcadas = w.findAll(".lj-calendar__day--today");
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0].attributes("data-date")).toBe(iso);
  });

  it("mês sem o dia de hoje não marca ninguém", () => {
    const w = montar({ modelValue: "1999-06-15" });

    expect(w.findAll(".lj-calendar__day--today")).toHaveLength(0);
  });
});

/*
 * Fora do alcance do jsdom:
 *
 * - Altura das células, corte por overflow e a rolagem da lista de eventos na
 *   semana: no jsdom todo elemento mede 0, então qualquer asserção de layout
 *   seria sobre o dublê. `maxEvents` é um teto declarado, não medido — é ele
 *   que os testes acima travam.
 * - `color-mix()` no fundo do chip: o jsdom não resolve a função, e o valor
 *   lido de volta seria a string crua. Contraste da cor da categoria só se
 *   verifica em navegador.
 */
