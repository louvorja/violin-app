<template>
  <div class="__table-data-wrap">
    <LjTable hover sticky class="__table-data">
      <slot />
    </LjTable>
    <LjProgress v-if="loading" indeterminate :height="2" />
    <LjAlert v-if="error" variant="danger" :text="error" class="__table-data-alert" />
  </div>
</template>

<script setup>
/**
 * Container genérico de tabela: carrega JSON via Database, filtra por busca/letra/filter,
 * ordena e pagina em lotes fixos via scroll. Emite o estado
 * via v-model.
 * Ver MusicMenuTable.vue para o widget de ações por linha — são componentes distintos.
 */
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { LjAlert, LjProgress, LjTable } from "@/components/ui";
import Database from "@/helpers/Database";
import Strings from "@/helpers/Strings";
import { isHymnalTrack } from "@/helpers/Hymnal";
import Fuse from "fuse.js";
import Telemetry from "@/helpers/Telemetry";

/** Campos onde o operador erra a digitação — nome da música e do álbum. */
const FUZZY_FIELDS = ["name", "albums_names"];
const FUZZY_MIN_LENGTH = 3;
const FUZZY_LIMIT = 100;

/**
 * Lote único para qualquer equipamento. Sessenta linhas já ultrapassam a
 * viewport típica em tabelas com chips e menus; o restante do catálogo entra
 * pelo mesmo scroll progressivo em todos os ambientes.
 */
const TABLE_PAGE_SIZE = 60;

/**
 * A camada Database devolve a mesma referência enquanto o dataset está no cache
 * de memória. Ao fechar e reabrir uma aba, reutilizamos a visão ordenada e o
 * índice estrutural já preparados, sem reordenar e percorrer milhares de itens.
 * Filtros e resultados continuam pertencendo a cada instância de DataTable.
 */
const _preparedDatasets = new WeakMap();

// Debounce leve: aguarda `ms` ms de inatividade antes de executar `fn`.
function debounce(fn, ms = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

const props = defineProps({
  modelValue: Object,
  file: String,
  search: String,
  scroll: { type: Object, default: () => ({}) },
  has_scroll: Boolean,
  searchable_fields: Object,
  filter: Object,
  letter: String,
  sort_by: String,
  disabled_albums: { type: Array, default: () => [] },
  /**
   * Mínimo de caracteres para o filtro textual ser aplicado (scroll infinito
   * em listas grandes). Buscas numéricas exatas (nº do hino/track) escapam
   * do gate — são match exato e barato.
   */
  search_min_length: { type: Number, default: 0 },
});

const emit = defineEmits(["update:modelValue"]);

const { t } = useI18n();

const all_data = ref([]);
const filter_data = ref([]);
const is_fuzzy = ref(false);
const data = ref([]);
const limit = ref(0);
const error = ref(null);
const last_filter = ref({});
const loading = ref(true);

/**
 * Índice efêmero do dataset atual. A lista base só precisa do nome sem acento
 * para paginação por letra; os demais campos são normalizados sob demanda,
 * quando o operador realmente pesquisa neles. Assim abrir uma coleção grande
 * não processa letras e álbuns que ainda não são visíveis.
 */
let _indexedData = [];
let _baseCacheSignature = "";
let _baseCache = [];
let _fuseCache = null;

function clearIndexes() {
  _indexedData = [];
  _baseCacheSignature = "";
  _baseCache = [];
  _fuseCache = null;
}

function makeIndex(item) {
  const name = String(item?.name ?? "");
  return {
    item,
    letterName: name.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    clean: Object.create(null),
    fold: Object.create(null),
    albumIds: Array.isArray(item?.albums) ? item.albums.map((album) => album.id_album) : null,
  };
}

function cleanField(entry, key) {
  if (!(key in entry.clean)) entry.clean[key] = Strings.clean(String(entry.item?.[key] ?? ""));
  return entry.clean[key];
}

function foldField(entry, key) {
  if (!(key in entry.fold)) entry.fold[key] = Strings.fold(String(entry.item?.[key] ?? ""));
  return entry.fold[key];
}

function prepareDataset(source) {
  let viewsBySort = _preparedDatasets.get(source);
  if (!viewsBySort) {
    viewsBySort = new Map();
    _preparedDatasets.set(source, viewsBySort);
  }

  const sortKey = props.sort_by || "";
  const cached = viewsBySort.get(sortKey);
  if (cached) return cached;

  // Nunca reordena o array do Database. Além de preservar a ordem do cache
  // compartilhado, isso permite que outras tabelas escolham outro sort sem
  // invalidar esta visão preparada.
  const items = [...source];
  if (props.sort_by) {
    items.sort((a, b) => Strings.sort(a[props.sort_by], b[props.sort_by]));
  }

  const prepared = { items, indexed: items.map(makeIndex) };
  viewsBySort.set(sortKey, prepared);
  return prepared;
}

function getBaseEntries(filter, disabled) {
  const signature = JSON.stringify({
    filter,
    disabled,
    letter: props.letter,
  });
  if (signature === _baseCacheSignature) return _baseCache;

  _baseCacheSignature = signature;
  _fuseCache = null;
  _baseCache = _indexedData.filter((entry) => {
    const item = entry.item;
    const filterCondition =
      filter.length === 0 || filter.some((key) => item[key] === true || item[key] === 1);

    const initialLetter =
      props.letter === "" ||
      (props.letter === "#"
        ? /^[^a-zA-Z]/.test(entry.letterName)
        : entry.letterName.startsWith(props.letter));

    // Álbuns desativados: oculta a música se NÃO pertencer a nenhum álbum ativo.
    const albumActive =
      !entry.albumIds ||
      entry.albumIds.length === 0 ||
      entry.albumIds.some((albumId) => !disabled.includes(albumId));

    return filterCondition && initialLetter && albumActive;
  });
  return _baseCache;
}

let _paginateRaf = null;
let _rafCycles = 0;
// O contêiner do módulo agora informa o scroll real ao DataTable. Não fazer
// ciclos automáticos aqui: renderizar centenas de linhas antes do primeiro
// paint era o principal custo ao abrir Músicas. Tabelas grandes avançam pelo
// scroll; listas pequenas já cabem na primeira página.
const _RAF_MAX_CYCLES = 0;

// Versão com debounce de filterData para o watcher de search.
const debouncedFilterData = debounce(function () {
  filterData();
}, 300);

watch(
  () => props.file,
  async () => {
    await loadData();
  }
);

watch(
  () => props.search,
  () => {
    debouncedFilterData();
  }
);

watch(
  () => props.searchable_fields,
  () => compareFilterData()
);
watch(
  () => props.filter,
  () => compareFilterData()
);
watch(
  () => props.letter,
  () => compareFilterData()
);

watch(data, () => {
  emit("update:modelValue", {
    total_count: all_data.value.length,
    filter_count: filter_data.value.length,
    count: data.value.length,
    data: data.value,
    is_fuzzy: is_fuzzy.value,
  });
});

watch(
  () => props.scroll,
  () => {
    // Carrega +PAGE_SIZE ao se aproximar do fim do scroll (payload do
    // ModuleContainer/Window). Sem métricas (popup sem payload), não cresce.
    const sb = props.scroll?.scroll_bottom;
    if (typeof sb === "number" && sb <= 150 && data.value.length < filter_data.value.length) {
      paginateData();
    }
  }
);

onMounted(async () => {
  await loadData();
});

onBeforeUnmount(() => {
  if (_paginateRaf) cancelAnimationFrame(_paginateRaf);
});

async function loadData() {
  const LOAD_TIMEOUT_MS = 30_000;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const reportLoad = (outcome, extra = {}) => {
    const durationMs = Math.max(
      0,
      Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt)
    );
    Telemetry.track("data_table_loaded", {
      table_file: props.file || "unknown",
      outcome,
      duration_ms: durationMs,
      ...extra,
    });
    Telemetry.histogram("louvorja.data_table.load.duration", durationMs, {
      table_file: props.file || "unknown",
      outcome,
    });
  };

  all_data.value = [];
  filter_data.value = [];
  data.value = [];
  clearIndexes();
  error.value = null;
  loading.value = true;
  let loadTimeout;

  try {
    const timeout = new Promise((_, reject) => {
      loadTimeout = setTimeout(
        () => reject(new Error(`DataTable load timeout: ${props.file || "unknown"}`)),
        LOAD_TIMEOUT_MS
      );
    });
    const loadedData = await Promise.race([Database.get(props.file), timeout]);

    if (!Array.isArray(loadedData)) {
      error.value = t("components.datatable.alerts.not_found");
      reportLoad("not_found");
      return;
    }

    const prepared = prepareDataset(loadedData);
    all_data.value = prepared.items;
    _indexedData = prepared.indexed;
    // Watchers de filtros podem rodar enquanto o dataset ainda está vazio.
    // O índice acabou de ser preenchido, então o recorte anterior não é mais
    // válido mesmo que os filtros tenham a mesma assinatura.
    _baseCacheSignature = "";
    _baseCache = [];
    _fuseCache = null;
    filterData();
    await nextTick();
    reportLoad("ready", {
      total_rows: all_data.value.length,
      rendered_rows: data.value.length,
      filtered_rows: filter_data.value.length,
    });
  } catch (loadError) {
    error.value = t("components.datatable.alerts.not_found");
    const errorMessage = loadError instanceof Error ? loadError.message : String(loadError);
    const outcome = errorMessage.includes("load timeout") ? "timeout" : "error";
    reportLoad(outcome, {
      error: errorMessage,
    });
    Telemetry.captureException(loadError, {
      source: "data_table.load",
      table_file: props.file || "unknown",
    });
  } finally {
    if (loadTimeout) clearTimeout(loadTimeout);
    loading.value = false;
  }
}

function filterData() {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const reportFilter = () => {
    const durationMs = Math.max(
      0,
      Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt)
    );
    Telemetry.track("data_table_filter_completed", {
      table_file: props.file || "unknown",
      duration_ms: durationMs,
      query_length: Strings.clean(props.search).length,
      result_count: filter_data.value.length,
      rendered_count: data.value.length,
      fuzzy: is_fuzzy.value,
    });
    Telemetry.histogram("louvorja.data_table.filter.duration", durationMs, {
      table_file: props.file || "unknown",
    });
  };

  try {
    limit.value = 0;
    _rafCycles = 0;
    let value = Strings.clean(props.search);

    // Gate de performance: com search_min_length configurado, só filtra a partir
    // do mínimo de caracteres (buscas curtas mostram a lista base). Buscas
    // numéricas escapam do gate — match exato por nº do hino/track.
    const belowMin =
      props.search_min_length > 0 &&
      value.length > 0 &&
      value.length < props.search_min_length &&
      !/^\d+$/.test(value);
    if (belowMin) value = "";

    const searchable = props.searchable_fields
      ? Object.keys(props.searchable_fields).filter((key) => props.searchable_fields[key] === true)
      : [];
    const filter = props.filter
      ? Object.keys(props.filter).filter((key) => props.filter[key] === true)
      : [];

    // Recorte que não depende do texto digitado: é cacheado entre teclas e
    // preserva a mesma ordem do catálogo. A busca exata e a fuzzy trabalham
    // apenas sobre esse subconjunto.
    const disabled = props.disabled_albums || [];
    const baseEntries = getBaseEntries(filter, disabled);

    is_fuzzy.value = false;

    if (searchable.length === 0 || value === "") {
      filter_data.value = baseEntries.map((entry) => entry.item);
      paginateData();
      return;
    }

    const exact = baseEntries
      .filter((entry) =>
        searchable.some((key) => {
          const item = entry.item;
          if (key === "track" && item.albums) {
            return isHymnalTrack(item, value);
          }

          if (!isNaN(item[key]) && !isNaN(value)) {
            return Number(item[key]) === Number(value);
          } else if (isNaN(item[key])) {
            return cleanField(entry, key).includes(value);
          } else {
            return false;
          }
        })
      )
      .map((entry) => entry.item);

    if (exact.length > 0) {
      filter_data.value = exact;
      paginateData();
      return;
    }

    const approximate = fuzzySearch(baseEntries, searchable);
    is_fuzzy.value = approximate.length > 0;
    filter_data.value = approximate;

    paginateData();
  } finally {
    reportFilter();
  }
}

/**
 * Rede de segurança para quem errou a digitação: só roda quando a busca por
 * trecho não achou nada, e só nos campos curtos — a letra é texto longo, onde
 * a aproximação custa caro e acerta qualquer coisa.
 */
function fuzzySearch(baseEntries, searchable) {
  const fields = FUZZY_FIELDS.filter((key) => searchable.includes(key));
  const query = Strings.fold(props.search);
  if (!fields.length || query.length < FUZZY_MIN_LENGTH || /^\d+$/.test(query)) return [];

  const fieldsSignature = fields.join(",");
  if (!_fuseCache || _fuseCache.fieldsSignature !== fieldsSignature) {
    const entries = baseEntries.map((indexed) => {
      const entry = { item: indexed.item };
      fields.forEach((key) => {
        entry[key] = foldField(indexed, key);
      });
      return entry;
    });

    _fuseCache = {
      fieldsSignature,
      fuse: new Fuse(entries, {
        keys: fields,
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: FUZZY_MIN_LENGTH,
      }),
    };
  }

  return _fuseCache.fuse.search(query, { limit: FUZZY_LIMIT }).map((hit) => hit.item.item);
}

function paginateData() {
  const searching = Strings.clean(props.search).length > 0;

  // Durante a busca, os resultados ficam limitados a no máximo 100.
  if (searching) {
    data.value = filter_data.value.slice(0, TABLE_PAGE_SIZE);
    loading.value = false;
    return;
  }

  limit.value += TABLE_PAGE_SIZE;
  data.value = filter_data.value.slice(0, limit.value);
  loading.value = false;

  // Fallback: sem barra de rolagem, segue paginando até completar,
  // mas limita a _RAF_MAX_CYCLES iterações para não renderizar tudo de uma vez.
  if (!props.has_scroll && data.value.length < filter_data.value.length) {
    _rafCycles++;
    if (_rafCycles <= _RAF_MAX_CYCLES) {
      if (_paginateRaf) cancelAnimationFrame(_paginateRaf);
      _paginateRaf = requestAnimationFrame(() => {
        paginateData();
      });
    }
  }
}

function compareFilterData() {
  const filter = {
    searchable_fields: props.searchable_fields,
    filter: props.filter,
    letter: props.letter,
  };

  if (JSON.stringify(filter) === JSON.stringify(last_filter.value)) {
    return;
  }

  last_filter.value = filter;
  filterData();
}
</script>

<style>
/* Sem escopo de propósito: o conteúdo da tabela (thead/tbody) vem por slot e é
   compilado no escopo de quem chama — regra com escopo daqui não o alcançaria.
   Duplicar a classe garante especificidade acima do primitivo sem !important. */

/* A rolagem própria do LjTable fica desligada: quem rola é o módulo, e é o
   scroll dele que alimenta a paginação. Com a tabela rolando por dentro, a
   lista pararia nos primeiros 100 registros. É também o que faz o cabeçalho
   grudar no topo do módulo. */
.__table-data.__table-data.__table-data {
  overflow: visible;
  font-family: var(--lj-font-shell);
}

.__table-data.__table-data tbody tr:hover {
  cursor: default;
}

.__table-data-alert {
  margin: var(--lj-space-4);
}
</style>
