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
 * ordena e pagina (100 por vez via scroll ou RAF). Emite o estado via v-model.
 * Ver MusicMenuTable.vue para o widget de ações por linha — são componentes distintos.
 */
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { LjAlert, LjProgress, LjTable } from "@/components/ui";
import Database from "@/helpers/Database";
import Strings from "@/helpers/Strings";

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
const data = ref([]);
const limit = ref(0);
const error = ref(null);
const last_filter = ref({});
const loading = ref(true);
let _paginateRaf = null;
let _rafCycles = 0;
const _RAF_MAX_CYCLES = 3;

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
  all_data.value = [];
  filter_data.value = [];
  data.value = [];
  loading.value = true;

  all_data.value = await Database.get(props.file);

  if (all_data.value == null) {
    error.value = t("components.datatable.alerts.not_found");
    loading.value = false;
    return;
  }

  if (props.sort_by) {
    all_data.value.sort((a, b) => Strings.sort(a[props.sort_by], b[props.sort_by]));
  }
  filterData();
}

function filterData() {
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

  filter_data.value = all_data.value
    .filter((item) => {
      const searchableCondition =
        searchable.length === 0 ||
        value == "" ||
        searchable.some((key) => {
          if (key === "track" && item.albums) {
            return item.albums.some((album) => {
              const isHymnal = album.name && album.type == "hymnal";
              return isHymnal && album.pivot && Number(album.pivot.track) === Number(value);
            });
          }

          if (!isNaN(item[key]) && !isNaN(value)) {
            return Number(item[key]) === Number(value);
          } else if (isNaN(item[key])) {
            return Strings.clean(item[key]).includes(value);
          } else {
            return false;
          }
        });

      const filterCondition =
        filter.length === 0 || filter.some((key) => item[key] === true || item[key] === 1);

      const initialLetter =
        props.letter === "" ||
        (props.letter === "#"
          ? /^[^a-zA-Z]/.test(item.name.normalize("NFD").replace(/[̀-ͯ]/g, ""))
          : item.name.normalize("NFD").replace(/[̀-ͯ]/g, "").startsWith(props.letter));

      // Álbuns desativados: oculta a música se NÃO pertencer a nenhum álbum ativo.
      const disabled = props.disabled_albums || [];
      const albumActive =
        !Array.isArray(item.albums) ||
        item.albums.length === 0 ||
        item.albums.some((a) => !disabled.includes(a.id_album));

      return searchableCondition && filterCondition && initialLetter && albumActive;
    })
    .slice();

  paginateData();
}

function paginateData() {
  const PAGE_SIZE = 100;
  const searching = Strings.clean(props.search).length > 0;

  // Durante a busca, os resultados ficam limitados a no máximo 100.
  if (searching) {
    data.value = filter_data.value.slice(0, PAGE_SIZE);
    loading.value = false;
    return;
  }

  limit.value += PAGE_SIZE;
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
