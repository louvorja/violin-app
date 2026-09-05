<template>
  <Window
    v-model="module.show"
    :title="module?.data?.name"
    :image="module?.data?.url_image ? $path.file(module.data.url_image) : ''"
    closable
    compact
    :image-size="125"
    :color="module?.data?.color"
    slot-left-class="w-100"
    @close="closeAlbum()"
  >
    <template #left>
      <LjTable
        v-if="!loading"
        sticky
        hover
        class="w-100 lj-u-h-full"
        :style="{ backgroundColor: module.data.color, color: '#FFF' }"
      >
        <thead>
          <tr>
            <th
              class="lj-u-text-end"
              :style="{ backgroundColor: module.data.color, color: '#FFF' }"
            >
              {{ t("table.track") }}
            </th>
            <th
              class="lj-u-text-start"
              :style="{ backgroundColor: module.data.color, color: '#FFF' }"
            >
              {{ t("table.music_name") }}
            </th>
            <th
              class="lj-u-text-end"
              :style="{ backgroundColor: module.data.color, color: '#FFF' }"
            >
              {{ t("table.duration") }}
            </th>
            <th :style="{ backgroundColor: module.data.color, color: '#FFF' }" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in module.data.musics" :key="item.id_music">
            <td class="lj-u-text-end">
              {{ item.track }}
            </td>
            <td>{{ item.name }}</td>
            <td class="lj-u-text-end">{{ $datetime.shortTime(item.duration) }}</td>
            <td>
              <div class="lj-u-flex lj-u-justify-end">
                <MusicMenuTable
                  :id_music="item.id_music"
                  :name="item.name"
                  color="white"
                  :has_instrumental_music="item.has_instrumental_music"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </LjTable>

      <LjProgress v-if="loading" indeterminate class="album-progress" />
    </template>
  </Window>
</template>

<script setup>
import { module as manifest } from "../manifest";

import { useModule } from "@/composables/useModule";
import { useAlbum } from "@/composables/useAlbum";
import { LjProgress, LjTable } from "@/components/ui";
import Window from "@/components/Window.vue";
import MusicMenuTable from "@/components/MusicMenuTable.vue";

const { module, t, $path, $datetime } = useModule(manifest);
// Desestrutura `loading` do useAlbum() pra que vire um Ref top-level —
// Vue auto-unwrapa refs top-level no template. Acessar via `album.loading`
// retornaria o objeto Ref (sempre truthy), não o boolean.
const { loading, close: closeAlbum } = useAlbum();
</script>

<style scoped>
/* A janela do álbum pinta o fundo com a cor da capa e escreve em branco; a
   barra precisa seguir esse contraste, não o acento do tema. */
.album-progress {
  --lj-ui-accent: var(--lj-white);
}
</style>
