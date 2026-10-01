import { computed, ref } from "vue";
import $docs from "@/helpers/DocStore";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";
import Telemetry from "@/helpers/Telemetry";
import { DB_TABLE } from "@/constants/DbTables";
import type { Program, ProgramItem, ProgramSession } from "@/types/Presentation";
import { flattenItems, minutesOfDate } from "../program/time";

/**
 * Programa do culto: um documento por data no DocStore, e o estado da
 * execução ao vivo ao lado dele.
 *
 * O documento é trabalho do operador — grava a cada mudança (o DocStore junta
 * as escritas). O estado ao vivo (item no ar, concluídos, seleção) é da
 * sessão: vale para o culto em andamento, não para o próximo sábado.
 *
 * Singleton: a lista, o ribbon e o rodapé do módulo falam do mesmo programa.
 */

const TABLE = DB_TABLE.PRESENTATION_PROGRAMS;

export function newId(): string {
  return crypto.randomUUID();
}

export function todayIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function emptyProgram(date: string): Program {
  const now = new Date().toISOString();
  return { id: date, date, plannedStart: "09:00", sessions: [], createdAt: now, updatedAt: now };
}

const _date = ref(todayIso());
const _program = ref<Program>(emptyProgram(_date.value));
const _loaded = ref(false);

const _selectedItemId = ref<string | null>(null);
const _liveItemId = ref<string | null>(null);
/** Minutos do dia em que o item ao vivo entrou no ar. */
const _liveStartedAt = ref<number | null>(null);
const _doneIds = ref<ReadonlySet<string>>(new Set());
const _openItems = ref<Record<string, boolean>>({});
/** Item que o operador mandou ao ar com a saída travada: vai quando destravar. */
const _preparedItemId = ref<string | null>(null);

const _outputLocked = computed(
  () => $userdata.get<boolean>(KEYS.MODULES.PRESENTATION_MODE.OUTPUT_LOCKED, false) === true
);

let _loadSeq = 0;

function _resetRuntime(): void {
  _selectedItemId.value = null;
  _liveItemId.value = null;
  _liveStartedAt.value = null;
  _doneIds.value = new Set();
  _openItems.value = {};
  _preparedItemId.value = null;
}

async function _load(date: string): Promise<void> {
  const seq = ++_loadSeq;
  try {
    const stored = await $docs.get<Program>(TABLE, date);
    if (seq !== _loadSeq) return;
    _program.value = stored ?? emptyProgram(date);
  } catch (e) {
    if (seq !== _loadSeq) return;
    Telemetry.captureException(e, { source: "presentation_program_load" });
    _program.value = emptyProgram(date);
  }
  _loaded.value = true;
}

async function _persist(program: Program): Promise<void> {
  try {
    await $docs.put(TABLE, JSON.parse(JSON.stringify(program)) as Program);
  } catch (e) {
    Telemetry.captureException(e, { source: "presentation_program_save" });
  }
}

/** Toda mudança no documento passa por aqui: carimba e grava. */
function _commit(next: Omit<Program, "updatedAt">): void {
  const program: Program = { ...next, updatedAt: new Date().toISOString() };
  _program.value = program;
  void _persist(program);
}

function _mapSessions(fn: (_sessions: ProgramSession[]) => ProgramSession[]): void {
  _commit({ ..._program.value, sessions: fn(_program.value.sessions) });
}

function _locate(itemId: string): { sessionIndex: number; itemIndex: number } | null {
  const sessions = _program.value.sessions;
  for (let s = 0; s < sessions.length; s++) {
    const i = sessions[s].items.findIndex((item) => item.id === itemId);
    if (i >= 0) return { sessionIndex: s, itemIndex: i };
  }
  return null;
}

const items = computed(() => flattenItems(_program.value));

const selectedItem = computed(() => items.value.find((i) => i.id === _selectedItemId.value) ?? null);

const nextItemId = computed(() => {
  if (!_liveItemId.value) return null;
  const list = items.value;
  const i = list.findIndex((item) => item.id === _liveItemId.value);
  return i >= 0 ? (list[i + 1]?.id ?? null) : null;
});

/**
 * "A seguir": o item na fila (saída travada); senão o que vem depois do que
 * está no ar; sem nada no ar, o primeiro ainda não concluído.
 */
const upNextItem = computed<ProgramItem | null>(() => {
  const list = items.value;
  if (_preparedItemId.value) return list.find((i) => i.id === _preparedItemId.value) ?? null;
  if (_liveItemId.value) {
    const i = list.findIndex((item) => item.id === _liveItemId.value);
    if (i >= 0) return list[i + 1] ?? null;
  }
  return list.find((item) => !_doneIds.value.has(item.id)) ?? null;
});

export function useProgram() {
  return {
    date: _date,
    program: _program,
    loaded: _loaded,
    items,
    selectedItemId: _selectedItemId,
    selectedItem,
    liveItemId: _liveItemId,
    liveStartedAt: _liveStartedAt,
    doneIds: _doneIds,
    openItems: _openItems,
    nextItemId,
    preparedItemId: _preparedItemId,
    upNextItem,
    outputLocked: _outputLocked,

    setOutputLocked(locked: boolean): void {
      $userdata.set(KEYS.MODULES.PRESENTATION_MODE.OUTPUT_LOCKED, locked);
    },

    /** Com a saída travada, o duplo clique só enfileira. `null` esvazia a fila. */
    prepare(itemId: string | null): void {
      _preparedItemId.value = itemId;
      if (itemId) _selectedItemId.value = itemId;
    },

    async ensureLoaded(): Promise<void> {
      if (!_loaded.value) await _load(_date.value);
    },

    async setDate(date: string): Promise<void> {
      if (date === _date.value && _loaded.value) return;
      _date.value = date;
      _resetRuntime();
      await _load(date);
    },

    setPlannedStart(plannedStart: string): void {
      _commit({ ..._program.value, plannedStart });
    },

    /** Troca todas as sessões — usado ao importar e ao arrastar itens. */
    setSessions(sessions: ProgramSession[]): void {
      _mapSessions(() => sessions);
    },

    addSession(label: string): ProgramSession {
      const session: ProgramSession = { id: newId(), label, items: [] };
      // Entra depois da sessão do item selecionado; sem seleção, no fim.
      const at = _selectedItemId.value ? _locate(_selectedItemId.value) : null;
      _mapSessions((sessions) => {
        const next = [...sessions];
        next.splice(at ? at.sessionIndex + 1 : next.length, 0, session);
        return next;
      });
      return session;
    },

    updateSession(sessionId: string, patch: Partial<Omit<ProgramSession, "id" | "items">>): void {
      _mapSessions((sessions) => sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)));
    },

    removeSession(sessionId: string): void {
      const removed = _program.value.sessions.find((s) => s.id === sessionId);
      if (removed?.items.some((i) => i.id === _selectedItemId.value)) _selectedItemId.value = null;
      _mapSessions((sessions) => sessions.filter((s) => s.id !== sessionId));
    },

    /**
     * Novo item logo depois do selecionado, se ele estiver na sessão de
     * destino; senão, no fim da sessão.
     */
    addItem(item: ProgramItem, sessionId: string): void {
      const at = _selectedItemId.value ? _locate(_selectedItemId.value) : null;
      _mapSessions((sessions) =>
        sessions.map((s, index) => {
          if (s.id !== sessionId) return s;
          const next = [...s.items];
          const pos = at && at.sessionIndex === index ? at.itemIndex + 1 : next.length;
          next.splice(pos, 0, item);
          return { ...s, items: next };
        })
      );
      _selectedItemId.value = item.id;
    },

    /** Atualiza o item; com `sessionId` diferente, move-o para o fim da outra sessão. */
    updateItem(itemId: string, patch: Partial<Omit<ProgramItem, "id">>, sessionId?: string): void {
      const at = _locate(itemId);
      if (!at) return;
      const current = _program.value.sessions[at.sessionIndex];
      const updated: ProgramItem = { ...current.items[at.itemIndex], ...patch };
      if (!sessionId || sessionId === current.id) {
        _mapSessions((sessions) =>
          sessions.map((s) =>
            s.id === current.id ? { ...s, items: s.items.map((i) => (i.id === itemId ? updated : i)) } : s
          )
        );
        return;
      }
      _mapSessions((sessions) =>
        sessions.map((s) => {
          if (s.id === current.id) return { ...s, items: s.items.filter((i) => i.id !== itemId) };
          if (s.id === sessionId) return { ...s, items: [...s.items, updated] };
          return s;
        })
      );
    },

    duplicateItem(itemId: string): ProgramItem | null {
      const at = _locate(itemId);
      if (!at) return null;
      const original = _program.value.sessions[at.sessionIndex].items[at.itemIndex];
      const copy: ProgramItem = {
        ...(JSON.parse(JSON.stringify(original)) as ProgramItem),
        id: newId(),
      };
      copy.children = copy.children?.map((c) => ({ ...c, id: newId() }));
      _mapSessions((sessions) =>
        sessions.map((s, index) => {
          if (index !== at.sessionIndex) return s;
          const next = [...s.items];
          next.splice(at.itemIndex + 1, 0, copy);
          return { ...s, items: next };
        })
      );
      _selectedItemId.value = copy.id;
      return copy;
    },

    removeItem(itemId: string): void {
      if (_selectedItemId.value === itemId) _selectedItemId.value = null;
      if (_preparedItemId.value === itemId) _preparedItemId.value = null;
      if (_liveItemId.value === itemId) {
        _liveItemId.value = null;
        _liveStartedAt.value = null;
      }
      _mapSessions((sessions) =>
        sessions.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== itemId) }))
      );
    },

    sessionOf(itemId: string): ProgramSession | null {
      const at = _locate(itemId);
      return at ? _program.value.sessions[at.sessionIndex] : null;
    },

    select(itemId: string | null): void {
      _selectedItemId.value = itemId;
    },

    toggleOpen(itemId: string, open?: boolean): void {
      _openItems.value = { ..._openItems.value, [itemId]: open ?? !_openItems.value[itemId] };
    },

    /**
     * Põe o item no ar. O que estava no ar passa a concluído — é assim que o
     * relógio sabe o que já foi. Voltar a um item concluído o tira da lista.
     */
    goLive(itemId: string, now = new Date()): void {
      if (_liveItemId.value === itemId) return;
      const done = new Set(_doneIds.value);
      if (_liveItemId.value) done.add(_liveItemId.value);
      done.delete(itemId);
      _doneIds.value = done;
      _liveItemId.value = itemId;
      _liveStartedAt.value = minutesOfDate(now);
      _selectedItemId.value = itemId;
    },
  };
}
