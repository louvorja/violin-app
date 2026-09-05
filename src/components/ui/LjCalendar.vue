<template>
  <div
    ref="raiz"
    class="lj-calendar"
    :class="`lj-calendar--${type}`"
    :style="{
      '--lj-calendar-event-h': `${eventHeight}px`,
      '--lj-calendar-rows': maxEvents,
    }"
    role="grid"
    :aria-label="ariaLabel"
  >
    <div class="lj-calendar__head" role="rowgroup">
      <div class="lj-calendar__weekdays" role="row">
        <span
          v-for="nome in nomesDosDias"
          :key="nome.dow"
          class="lj-calendar__weekday"
          :class="{ 'lj-calendar__weekday--weekend': fimDeSemana.includes(nome.dow) }"
          role="columnheader"
          :aria-label="nome.longo"
        >
          {{ nome.curto }}
        </span>
      </div>
    </div>

    <div class="lj-calendar__body" role="rowgroup">
      <div v-for="(semana, i) in semanas" :key="i" class="lj-calendar__week" role="row">
        <div
          v-for="dia in semana"
          :key="dia.date"
          class="lj-calendar__day"
          :class="{
            'lj-calendar__day--outside': dia.foraDoMes,
            'lj-calendar__day--today': dia.hoje,
            'lj-calendar__day--weekend': dia.fimDeSemana,
          }"
          :data-date="dia.date"
          role="gridcell"
          :aria-label="dia.rotulo"
          :tabindex="dia.date === diaTabulavel ? 0 : -1"
          @click="emitirDia(dia, $event)"
          @keydown="aoTeclar(dia, $event)"
        >
          <span class="lj-calendar__daynum">{{ dia.dia }}</span>

          <div v-if="dia.eventos.length || dia.ocultos.length" class="lj-calendar__events">
            <button
              v-for="(evento, j) in dia.eventos"
              :key="`${dia.date}#${j}`"
              type="button"
              class="lj-calendar__event"
              :style="estiloDoEvento(evento)"
              :title="rotuloDoEvento(evento)"
              tabindex="-1"
              @click.stop="emitirEvento(evento, dia, $event)"
            >
              <span class="lj-calendar__event-label">{{ rotuloDoEvento(evento) }}</span>
            </button>

            <button
              v-if="dia.ocultos.length"
              type="button"
              class="lj-calendar__more"
              tabindex="-1"
              @click.stop="emitirMais(dia, $event)"
            >
              {{ textoDeMais(dia.ocultos.length) }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<!-- Os tipos moram num bloco próprio porque `<script setup>` genérico não aceita
     `export`: para receber o `T`, o compilador embrulha o setup numa função, e
     o que está ali dentro deixa de ser topo de módulo. -->
<script lang="ts">
/** Dia civil em ISO curto — `YYYY-MM-DD`, sem hora e sem fuso. */
export type DiaIso = string;

export interface LjCalendarDay {
  /** Dia civil da célula, o mesmo valor do atributo `data-date`. */
  date: DiaIso;
  /** Dia do mês (1–31). */
  dayOfMonth: number;
  /** Dia da semana em numeração JS: 0 = domingo. */
  weekday: number;
  /** A célula pertence a outro mês (só acontece em `type="month"`). */
  outside: boolean;
  today: boolean;
}

export interface LjCalendarDayClick {
  day: LjCalendarDay;
  date: DiaIso;
  originalEvent: MouseEvent | KeyboardEvent;
}

export interface LjCalendarEventClick<E> {
  event: E;
  /** Dia da célula clicada — não necessariamente o início de um evento longo. */
  date: DiaIso;
  originalEvent: MouseEvent;
}

export interface LjCalendarMoreClick<E> {
  date: DiaIso;
  /** Os eventos que o corte escondeu, na ordem em que entraram. */
  hidden: E[];
  originalEvent: MouseEvent;
}
</script>

<script setup lang="ts" generic="T extends object">
import { computed, nextTick, ref } from "vue";

const props = withDefaults(
  defineProps<{
    /** Dia em foco: define o mês (`month`) ou a semana (`week`) desenhados. */
    modelValue?: DiaIso | Date;
    type?: "month" | "week";
    events?: readonly T[];
    /** Nome do campo com o dia inicial do evento. */
    eventStart?: string;
    /** Nome do campo com o dia final; ausente, o evento ocupa um dia só. */
    eventEnd?: string;
    /** Nome do campo com o texto exibido no chip. */
    eventLabel?: string;
    /** Nome do campo com a cor do evento (valor CSS livre, vindo do usuário). */
    eventColor?: string;
    /** Teto de linhas por célula no mês; a última vira o indicador "+N". */
    maxEvents?: number;
    eventHeight?: number;
    /** Texto do indicador de corte; `{0}` recebe a quantidade escondida. */
    eventMoreText?: string;
    locale?: string;
    /** 0 = domingo. Sobrepõe o primeiro dia que o locale define. */
    firstDayOfWeek?: number;
    ariaLabel?: string;
  }>(),
  {
    type: "month",
    events: () => [],
    eventStart: "start",
    eventEnd: "end",
    eventLabel: "name",
    eventColor: "color",
    maxEvents: 4,
    eventHeight: 18,
    eventMoreText: "+{0}",
    locale: "pt-BR",
  }
);

const emit = defineEmits<{
  dayClick: [payload: LjCalendarDayClick];
  eventClick: [payload: LjCalendarEventClick<T>];
  moreClick: [payload: LjCalendarMoreClick<T>];
}>();

const MS_POR_DIA = 86_400_000;

/**
 * Dia civil, nunca instante: `new Date("2026-03-05")` é meia-noite UTC e, em
 * qualquer fuso a oeste de Greenwich, volta um dia ao ser lido em hora local —
 * a agenda inteira andaria para trás no Brasil. Por isso a data literal é
 * quebrada à mão, e um `Date` recebido pronto é lido pelos componentes locais.
 */
function paraDiaCivil(valor: unknown): Date | null {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate());
  }
  if (typeof valor !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDoDia(d: Date): DiaIso {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * O `setHours` no fim não é redundante: `setDate` preserva a hora de parede, e
 * num fuso cuja virada de horário de verão acontece à meia-noite (Santiago,
 * Havana — e o Brasil até 2019) o dia da virada não existe às 00:00, então o
 * motor normaliza para 01:00. Sem reancorar, o cursor anda uma hora adiantado
 * de todos os dias seguintes, enquanto os limites da grade continuam à
 * meia-noite: a comparação `cursor <= fim` derruba o último dia e a grade sai
 * com um buraco.
 */
function somarDias(d: Date, n: number): Date {
  const saida = new Date(d);
  saida.setDate(saida.getDate() + n);
  saida.setHours(0, 0, 0, 0);
  return saida;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

interface SemanaDoLocale {
  primeiroDia: number;
  fimDeSemana: number[];
}

type InfoDeSemanaIntl = { firstDay?: number; weekend?: number[] };

/**
 * O CLDR numera os dias de 1 (segunda) a 7 (domingo); o JS, de 0 (domingo) a 6.
 * O resto por 7 traduz um no outro. A tabela de reserva cobre runtime sem
 * `weekInfo`: pt-BR começa no domingo, es começa na segunda.
 */
function semanaDoLocale(locale: string): SemanaDoLocale {
  try {
    const l = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => InfoDeSemanaIntl;
      weekInfo?: InfoDeSemanaIntl;
    };
    const info = typeof l.getWeekInfo === "function" ? l.getWeekInfo() : l.weekInfo;
    if (info?.firstDay) {
      return {
        primeiroDia: info.firstDay % 7,
        fimDeSemana: (info.weekend?.length ? info.weekend : [6, 7]).map((d) => d % 7),
      };
    }
  } catch {
    // Locale malformado — cai na tabela de reserva.
  }
  const idioma = locale.toLowerCase().split("-")[0];
  return { primeiroDia: idioma === "es" ? 1 : 0, fimDeSemana: [6, 0] };
}

function campo(evento: T, chave: string): unknown {
  return (evento as unknown as Record<string, unknown>)[chave];
}

function rotuloDoEvento(evento: T): string {
  const valor = campo(evento, props.eventLabel);
  return valor == null ? "" : String(valor);
}

function corDoEvento(evento: T): string {
  const valor = campo(evento, props.eventColor);
  return typeof valor === "string" ? valor : "";
}

function estiloDoEvento(evento: T): Record<string, string> {
  const cor = corDoEvento(evento);
  return cor ? { "--lj-calendar-event-color": cor } : {};
}

function textoDeMais(quantidade: number): string {
  return props.eventMoreText.replace("{0}", String(quantidade));
}

const raiz = ref<HTMLElement | null>(null);
const focoManual = ref<DiaIso | null>(null);

const infoDaSemana = computed(() => semanaDoLocale(props.locale));

const primeiroDia = computed(() => {
  const forcado = props.firstDayOfWeek;
  if (forcado == null || !Number.isFinite(forcado)) return infoDaSemana.value.primeiroDia;
  return ((Math.trunc(forcado) % 7) + 7) % 7;
});

const fimDeSemana = computed(() => infoDaSemana.value.fimDeSemana);

function hojeCivil(): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

const diaEmFoco = computed(() => paraDiaCivil(props.modelValue) ?? hojeCivil());

/** Recua até o primeiro dia da semana do locale. */
function inicioDaSemana(d: Date): Date {
  const recuo = (((d.getDay() - primeiroDia.value) % 7) + 7) % 7;
  return somarDias(d, -recuo);
}

const intervalo = computed(() => {
  const foco = diaEmFoco.value;
  if (props.type === "week") {
    const inicio = inicioDaSemana(foco);
    return { inicio, fim: somarDias(inicio, 6), mes: foco.getMonth() };
  }
  const primeiroDoMes = new Date(foco.getFullYear(), foco.getMonth(), 1);
  const ultimoDoMes = new Date(foco.getFullYear(), foco.getMonth() + 1, 0);
  const inicio = inicioDaSemana(primeiroDoMes);
  const fim = somarDias(inicioDaSemana(ultimoDoMes), 6);
  return { inicio, fim, mes: foco.getMonth() };
});

/**
 * Mapa dia → eventos. Um evento com fim posterior ao início aparece em todas as
 * células do intervalo; a varredura é recortada na grade visível para que um
 * evento antigo (ou de anos de duração) não custe uma volta por dia.
 */
const eventosPorDia = computed(() => {
  const mapa = new Map<DiaIso, T[]>();
  const { inicio: inicioGrade, fim: fimGrade } = intervalo.value;

  for (const evento of props.events) {
    const inicio = paraDiaCivil(campo(evento, props.eventStart));
    if (!inicio) continue;
    let fim = paraDiaCivil(campo(evento, props.eventEnd)) ?? inicio;
    if (fim < inicio) fim = inicio;
    if (fim < inicioGrade || inicio > fimGrade) continue;

    let cursor = inicio;
    if (cursor < inicioGrade) {
      cursor = somarDias(
        cursor,
        Math.round((inicioGrade.getTime() - cursor.getTime()) / MS_POR_DIA)
      );
    }
    while (cursor <= fim && cursor <= fimGrade) {
      const chave = isoDoDia(cursor);
      const lista = mapa.get(chave);
      if (lista) lista.push(evento);
      else mapa.set(chave, [evento]);
      cursor = somarDias(cursor, 1);
    }
  }
  return mapa;
});

const formatadorLongo = computed(
  () => new Intl.DateTimeFormat(props.locale, { dateStyle: "full" })
);

// Fixado na montagem: o app fica aberto durante o culto, e recalcular "hoje" a
// cada render não faria a virada da meia-noite chegar sozinha de todo modo.
const hojeIso = isoDoDia(hojeCivil());

interface CelulaDoDia {
  date: DiaIso;
  dia: number;
  dow: number;
  foraDoMes: boolean;
  hoje: boolean;
  fimDeSemana: boolean;
  rotulo: string;
  eventos: T[];
  ocultos: T[];
}

const dias = computed<CelulaDoDia[]>(() => {
  const { inicio, fim, mes } = intervalo.value;
  // Na semana as células são altas e rolam sozinhas; cortar ali só esconderia
  // eventos sem oferecer para onde ir depois.
  const limite = props.type === "week" ? Number.POSITIVE_INFINITY : Math.max(0, props.maxEvents);
  const saida: CelulaDoDia[] = [];

  for (let cursor = inicio; cursor <= fim; cursor = somarDias(cursor, 1)) {
    const date = isoDoDia(cursor);
    const todos = eventosPorDia.value.get(date) ?? [];
    const visiveis =
      todos.length > limite ? todos.slice(0, Math.max(0, limite - 1)) : todos.slice();

    saida.push({
      date,
      dia: cursor.getDate(),
      dow: cursor.getDay(),
      foraDoMes: props.type === "month" && cursor.getMonth() !== mes,
      hoje: date === hojeIso,
      fimDeSemana: fimDeSemana.value.includes(cursor.getDay()),
      // O rótulo carrega os eventos porque os chips saíram da fila do Tab: num
      // grid ARIA quem anda é a seta, e o caminho de teclado até o conteúdo do
      // dia é abrir a célula. Sem isto, um dia cheio e um dia vazio soam igual.
      rotulo: [
        capitalizar(formatadorLongo.value.format(cursor)),
        ...todos.map((e) => rotuloDoEvento(e)),
      ].join(" — "),
      eventos: visiveis,
      ocultos: todos.slice(visiveis.length),
    });
  }
  return saida;
});

const semanas = computed<CelulaDoDia[][]>(() => {
  const saida: CelulaDoDia[][] = [];
  for (let i = 0; i < dias.value.length; i += 7) saida.push(dias.value.slice(i, i + 7));
  return saida;
});

const nomesDosDias = computed(() => {
  const curto = new Intl.DateTimeFormat(props.locale, { weekday: "short" });
  const longo = new Intl.DateTimeFormat(props.locale, { weekday: "long" });
  // 7/1/2024 é domingo: somar o índice dá o dia da semana correspondente.
  return Array.from({ length: 7 }, (_, i) => {
    const dow = (primeiroDia.value + i) % 7;
    const amostra = new Date(2024, 0, 7 + dow);
    return {
      dow,
      curto: capitalizar(curto.format(amostra)),
      longo: capitalizar(longo.format(amostra)),
    };
  });
});

/** Célula que recebe o Tab — as outras ficam em -1 e se alcançam pelas setas. */
const diaTabulavel = computed(() => {
  const focada = focoManual.value;
  if (focada && dias.value.some((d) => d.date === focada)) return focada;
  const emFoco = isoDoDia(diaEmFoco.value);
  if (dias.value.some((d) => d.date === emFoco)) return emFoco;
  if (dias.value.some((d) => d.date === hojeIso)) return hojeIso;
  return dias.value[0]?.date ?? null;
});

function paraPublico(dia: CelulaDoDia): LjCalendarDay {
  return {
    date: dia.date,
    dayOfMonth: dia.dia,
    weekday: dia.dow,
    outside: dia.foraDoMes,
    today: dia.hoje,
  };
}

function emitirDia(dia: CelulaDoDia, originalEvent: MouseEvent | KeyboardEvent): void {
  emit("dayClick", { day: paraPublico(dia), date: dia.date, originalEvent });
}

function emitirEvento(evento: T, dia: CelulaDoDia, originalEvent: MouseEvent): void {
  emit("eventClick", { event: evento, date: dia.date, originalEvent });
}

function emitirMais(dia: CelulaDoDia, originalEvent: MouseEvent): void {
  emit("moreClick", { date: dia.date, hidden: dia.ocultos, originalEvent });
}

const PASSOS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

function aoTeclar(dia: CelulaDoDia, e: KeyboardEvent): void {
  // Enter num chip de evento dispara o clique dele e ainda sobe até a célula:
  // sem este corte, abrir um evento pelo teclado também abriria o dia vazio.
  if (e.target !== e.currentTarget) return;

  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    emitirDia(dia, e);
    return;
  }

  const atual = dias.value.findIndex((d) => d.date === dia.date);
  if (atual < 0) return;

  let destino: number;
  if (e.key in PASSOS) destino = atual + PASSOS[e.key];
  else if (e.key === "Home") destino = atual - (atual % 7);
  else if (e.key === "End") destino = atual - (atual % 7) + 6;
  else return;

  const alvo = dias.value[destino];
  if (!alvo) return;
  e.preventDefault();
  focoManual.value = alvo.date;
  void nextTick(() => {
    raiz.value?.querySelector<HTMLElement>(`[data-date="${alvo.date}"]`)?.focus();
  });
}
</script>

<style scoped>
.lj-calendar {
  /* Altura da pastilha do número do dia — entra no cálculo da célula. */
  --lj-calendar-daynum-h: 16px;

  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  background: var(--lj-surface-bg);
  border: var(--lj-ui-border);
  border-radius: var(--lj-radius-md);
  color: var(--lj-text);
  font-size: var(--lj-text-base);
  overflow: hidden;
}

.lj-calendar__weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  background: var(--lj-surface-bg-soft);
  border-bottom: 1px solid var(--lj-surface-border-strong);
}

.lj-calendar__weekday {
  padding: var(--lj-space-2) var(--lj-space-3);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-semibold);
  letter-spacing: 0.03em;
  text-align: center;
}

.lj-calendar__weekday--weekend {
  color: var(--lj-text-subtle);
}

.lj-calendar__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.lj-calendar__week {
  display: grid;
  flex: 1 1 0;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  min-height: 0;
}

.lj-calendar--month .lj-calendar__week {
  /* A altura acompanha o teto de linhas, não um número fixo. Com um valor
     cravado, uma célula cheia estourava a caixa e o `overflow: hidden` dos
     eventos cortava a última linha — que é justamente o indicador "+N", o único
     aviso de que o dia tem mais coisa. O somatório é o número do dia, a folga
     entre ele e a lista, os espaços de 1px entre as tarjas e o padding. */
  min-height: calc(
    var(--lj-calendar-rows) * var(--lj-calendar-event-h) + (var(--lj-calendar-rows) - 1) * 1px +
      var(--lj-calendar-daynum-h) + var(--lj-space-1) + 2 * var(--lj-space-2)
  );
}

.lj-calendar__day {
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-1);
  min-width: 0;
  min-height: 0;
  padding: var(--lj-space-2);
  border-right: 1px solid var(--lj-surface-divider);
  border-bottom: 1px solid var(--lj-surface-divider);
  cursor: pointer;
  outline: none;
  transition: background var(--lj-transition-fast);
}

.lj-calendar__day:nth-child(7n) {
  border-right: none;
}

.lj-calendar__week:last-child .lj-calendar__day {
  border-bottom: none;
}

.lj-calendar__day:hover {
  background: var(--lj-surface-bg-hover);
}

.lj-calendar__day:focus-visible {
  box-shadow: inset var(--lj-ui-focus);
}

.lj-calendar__day--weekend {
  background: var(--lj-surface-bg-soft);
}

.lj-calendar__day--outside {
  background: var(--lj-surface-bg-soft);
}

.lj-calendar__day--outside .lj-calendar__daynum {
  color: var(--lj-text-subtle);
}

.lj-calendar__daynum {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
  min-width: 18px;
  height: var(--lj-calendar-daynum-h);
  padding-inline: var(--lj-space-1);
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-medium);
  font-variant-numeric: tabular-nums;
}

.lj-calendar__day--today .lj-calendar__daynum {
  background: var(--lj-ui-accent);
  color: var(--lj-ui-accent-fg);
  font-weight: var(--lj-weight-semibold);
}

.lj-calendar__events {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
  overflow: hidden;
}

.lj-calendar--month .lj-calendar__events {
  flex: 0 0 auto;
}

.lj-calendar--week .lj-calendar__events {
  overflow-y: auto;
}

.lj-calendar__event {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  height: var(--lj-calendar-event-h);
  padding-inline: var(--lj-space-2);
  /* A cor vem do usuário (categoria da agenda) e pode cair em qualquer lugar do
     espectro: tingir só o fundo, sem inverter o texto, mantém o chip legível
     nos dez temas sem depender do contraste da cor escolhida. */
  background: color-mix(
    in srgb,
    var(--lj-calendar-event-color, var(--lj-ui-accent)) 16%,
    transparent
  );
  border: none;
  border-left: 3px solid var(--lj-calendar-event-color, var(--lj-ui-accent));
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text);
  font: inherit;
  font-size: var(--lj-text-sm);
  text-align: left;
  cursor: pointer;
  outline: none;
}

.lj-calendar__event:hover {
  background: color-mix(
    in srgb,
    var(--lj-calendar-event-color, var(--lj-ui-accent)) 28%,
    transparent
  );
}

.lj-calendar__event:focus-visible {
  /* O contêiner dos eventos tem overflow hidden; um anel de fora seria
     recortado nos quatro lados e não apareceria. */
  box-shadow: inset var(--lj-ui-focus);
}

.lj-calendar__event-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.lj-calendar__more {
  flex: 0 0 auto;
  height: var(--lj-calendar-event-h);
  padding-inline: var(--lj-space-2);
  background: transparent;
  border: none;
  border-radius: var(--lj-radius-xs);
  color: var(--lj-text-muted);
  font: inherit;
  font-size: var(--lj-text-xs);
  font-weight: var(--lj-weight-semibold);
  text-align: left;
  cursor: pointer;
  outline: none;
}

.lj-calendar__more:hover {
  color: var(--lj-ui-accent-text);
}

.lj-calendar__more:focus-visible {
  /* O contêiner dos eventos tem overflow hidden; um anel de fora seria
     recortado nos quatro lados e não apareceria. */
  box-shadow: inset var(--lj-ui-focus);
}
</style>
