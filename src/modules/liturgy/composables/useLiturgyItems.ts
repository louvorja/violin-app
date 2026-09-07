import { useLiturgyI18n, chaveLiturgia } from "../i18n";
import { agruparPorBloco, prepararAgenda } from "../agenda";
import { useLiturgyExecution } from "./useLiturgyExecution";
import { ref, computed, type Ref, type WritableComputedRef } from "vue";
import $liturgy from "@/helpers/Liturgy";
import $database from "@/helpers/Database";
import { ICONS } from "@/config/Icons";
import $alert from "@/helpers/Alert";
import $idb from "@/helpers/IndexedDB";
import { DB_TABLE } from "@/constants/DbTables";
import Platform from "@/helpers/Platform";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { readAllSlots as readAllOverlaySlots } from "@/helpers/Overlay";
import type { OverlaySlot } from "@/types/Overlay";
import { useBroadcastListener } from "@/composables/useBroadcastListener";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import type { LiturgyItem, ScheduledCategory, LiturgyMusicItem } from "@/types/Liturgy";
import { AUDIO_EXT, VIDEO_EXT } from "@constants/FileTypes";

interface VideoItem {
  id: string;
  name: string;
  url: string;
  createdAt?: string;
  source?: "custom" | "online";
  origin?: string;
  originIcon?: string;
}

interface OnlineVideoDefaultItem {
  title: string;
  url: string;
}

interface OnlineApiVideo {
  video_id: string;
  playlist_id: string;
  title: string;
}

interface OnlineApiData {
  channels?: { channel_id: string; default_image: string }[];
  playlists?: { playlist_id: string; channel_id: string; title: string }[];
  videos?: OnlineApiVideo[];
}

export const COLORS = [
  "#00004F",
  "#1e40af",
  "#0891b2",
  "#059669",
  "#65a30d",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#475569",
  "#000000",
  "#ffffff",
];
export const DEFAULT_COLOR = "#00004F";

export const DEFAULT_FORM = (): LiturgyItem => ({
  id: "",
  tipo: LiturgyItemTypeEnum.ANOTACAO,
  item: "",
  subitem: "",
  cor: DEFAULT_COLOR,
  duration: 0,
  time: "",
  dir: "",
  dir_info: "E",
  url: "",
  musica: -1,
  escolha: false,
  has_instrumental_music: false,
  subtipo: "",
  blocoId: "",
  overlay_id: "",
  overlay_action: "activate",
  linked_overlay_id: "",
});

export function useLiturgyItems(
  activeDay: Ref<number>,
  scheduledCategories: Ref<ScheduledCategory[]>
) {
  const { t, locale } = useLiturgyI18n();
  /** Prefixo de idioma das tabelas do banco (`pt_musics`, `es_musics`). */
  const idioma = (): string => (typeof locale.value === "string" ? locale.value : "pt");

  const dialog = ref(false);
  const editIndex = ref(-1);
  const form = ref<LiturgyItem>(DEFAULT_FORM());
  const musicsCache = ref<LiturgyMusicItem[] | null>(null);
  const isDraggingOver = ref(false);
  const menuOpen = ref(false);
  const overlaySlots = ref<OverlaySlot[]>([]);
  const overlaySlotsLoaded = ref(false);

  const { executeItem, playMusic, openLyric, openUrl, openFile, isYoutube } =
    useLiturgyExecution();

  async function loadOverlaySlots(): Promise<void> {
    if (overlaySlotsLoaded.value) return;
    overlaySlots.value = await readAllOverlaySlots();
    overlaySlotsLoaded.value = true;
  }

  useBroadcastListener(BROADCAST_TYPE.OVERLAY_CONFIG_CHANGED, () => {
    overlaySlotsLoaded.value = false;
    overlaySlots.value = [];
  });

  const items: WritableComputedRef<LiturgyItem[]> = computed({
    get() {
      return prepararAgenda($liturgy.list(activeDay.value));
    },
    set(val: LiturgyItem[]) {
      $liturgy.set(prepararAgenda(val), activeDay.value);
    },
  });

  const totalDuration = computed(() =>
    items.value.reduce((s, i) => s + (Number(i.duration) || 0), 0)
  );

  const musicsList = computed<LiturgyMusicItem[]>(() => musicsCache.value || []);

  /* ============== Listing ============== */
  function isChecked(item: LiturgyItem): boolean {
    return $liturgy.isCheckedToday(item);
  }

  function toggleChecked(item: LiturgyItem): void {
    $liturgy.toggleChecked(item.id, activeDay.value);
    items.value = [...items.value];
  }

  function onReorder(value: LiturgyItem[]): void {
    const oldMap = new Map(items.value.map((item, i) => [item.id, i]));

    const movedBlocoIds = new Set<string>();
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item.tipo === LiturgyItemTypeEnum.BLOCO) {
        const oldIdx = oldMap.get(item.id);
        if (oldIdx !== undefined && oldIdx !== i) {
          movedBlocoIds.add(item.id);
        }
      }
    }

    const childrenByBloco = new Map<string, LiturgyItem[]>();
    const childIds = new Set<string>();
    for (const item of value) {
      if (item.tipo !== LiturgyItemTypeEnum.BLOCO && item.blocoId && movedBlocoIds.has(item.blocoId)) {
        childIds.add(item.id);
        if (!childrenByBloco.has(item.blocoId)) childrenByBloco.set(item.blocoId, []);
        childrenByBloco.get(item.blocoId)!.push(item);
      }
    }

    const withoutChildren = value.filter((x) => !childIds.has(x.id));
    const repositioned: LiturgyItem[] = [];
    for (const item of withoutChildren) {
      repositioned.push(item);
      if (childrenByBloco.has(item.id)) {
        repositioned.push(...childrenByBloco.get(item.id)!);
      }
    }

    items.value = agruparPorBloco(repositioned);
  }

  function adjustBlocoAssignment(itemId: string): void {
    const list = items.value;
    const idx = list.findIndex((i) => i.id === itemId);
    if (idx < 0) return;

    const item = list[idx];

    let nearestBloco: LiturgyItem | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (list[i].tipo === LiturgyItemTypeEnum.BLOCO) {
        nearestBloco = list[i];
        break;
      }
    }
    const currBlocoId = nearestBloco?.id;

    const prev = list[idx - 1];
    const next = list[idx + 1];
    const prevInBloco =
      (prev?.tipo === LiturgyItemTypeEnum.BLOCO && prev.id === currBlocoId) ||
      prev?.blocoId === currBlocoId;
    const nextInBloco = next?.blocoId === currBlocoId;

    if (item.blocoId && item.blocoId === currBlocoId) {
      if (!prevInBloco && !nextInBloco) {
        $liturgy.update(itemId, { blocoId: undefined }, activeDay.value);
        items.value = [...items.value];
      }
      return;
    }

    if (currBlocoId && prevInBloco && nextInBloco) {
      $liturgy.update(itemId, { blocoId: currBlocoId }, activeDay.value);
      items.value = [...items.value];
    }
  }

  function subtitleFor(item: LiturgyItem): string {
    if (item.tipo === LiturgyItemTypeEnum.MUSICA && item.escolha)
      return t("placeholders.music_choose");
    return item.subitem || "";
  }

  /* ============== Color ============== */
  function changeColor(index: number): void {
    const current = items.value[index]?.cor || DEFAULT_COLOR;
    const idx = COLORS.findIndex((c) => c.toLowerCase() === current.toLowerCase());
    const next = COLORS[(idx + 1) % COLORS.length];
    $liturgy.update(items.value[index].id, { cor: next }, activeDay.value);
    items.value = [...items.value];
  }

  /* ============== Bulk actions ============== */
  function markAll(checked: boolean): void {
    menuOpen.value = false;
    items.value.forEach((item) => {
      if (item.tipo === LiturgyItemTypeEnum.BLOCO) return;
      const isCheckedNow = $liturgy.isCheckedToday(item);
      if (checked !== isCheckedNow) {
        $liturgy.toggleChecked(item.id, activeDay.value);
      }
    });
    items.value = [...items.value];
  }

  function invertSelection(): void {
    menuOpen.value = false;
    items.value.forEach((item) => {
      if (item.tipo === LiturgyItemTypeEnum.BLOCO) return;
      $liturgy.toggleChecked(item.id, activeDay.value);
    });
    items.value = [...items.value];
  }

  function removeDone(): void {
    menuOpen.value = false;
    $alert.yesno({ text: chaveLiturgia("dialog.remove_done_confirm") }, (btn?: string) => {
      if (btn !== "yes") return;
      const toRemove = items.value
        .filter((i) => i.tipo !== LiturgyItemTypeEnum.BLOCO && $liturgy.isCheckedToday(i))
        .map((i) => i.id);
      toRemove.forEach((id) => $liturgy.remove(id, activeDay.value));
      items.value = [...items.value];
    });
  }

  /* ============== Dialog ============== */
  function openItemDialog(index = -1): void {
    editIndex.value = index;
    form.value = index >= 0 ? { ...DEFAULT_FORM(), ...items.value[index] } : DEFAULT_FORM();
    if (form.value.subtipo === "ja" || form.value.subtipo === "div") {
      form.value.subtipo = "sung";
    }
    dialog.value = true;
    void loadOverlaySlots();
  }

  function quickAdd(tipo: LiturgyItemTypeEnum): void {
    openItemDialog();
    form.value.tipo = tipo;
  }

  function onTypeChange(): void {
    if (form.value.tipo !== LiturgyItemTypeEnum.MUSICA) {
      form.value.musica = -1;
      form.value.escolha = false;
    }
    if (form.value.tipo !== LiturgyItemTypeEnum.VIDEO_ONLINE) {
      form.value.url = "";
      form.value.subitem = "";
    }
    if (form.value.tipo !== LiturgyItemTypeEnum.OVERLAY) {
      form.value.overlay_id = "";
      form.value.overlay_action = "activate";
    }
    // Arquivo selecionado pertence ao tipo anterior — limpa ao trocar.
    form.value.dir = "";
    form.value.ref_id = undefined;
    form.value.subtipo = "";
    if (form.value.tipo === LiturgyItemTypeEnum.MUSICA && form.value.musica === -1) {
      form.value.escolha = true;
    }
    if (form.value.tipo === LiturgyItemTypeEnum.BLOCO) {
      form.value.blocoId = undefined;
    }
  }

  function setMusicChoice(later: boolean | string): void {
    form.value.escolha = !!later;
    if (later) form.value.musica = -1;
  }

  function onMusicChange(): void {
    const m = musicsList.value.find((x) => x.id_music === form.value.musica);
    if (m) {
      form.value.has_instrumental_music = !!m.has_instrumental_music;
      form.value.escolha = false;
    }
  }

  function onScheduledCategoryChange(): void {
    const c = scheduledCategories.value.find((x) => x.id === form.value.id);
    if (c) form.value.item = c.nome;
    // Atualiza a duração com base no item agendado do dia ativo.
    const activeDate = $liturgy.getActiveDate();
    const sched = $liturgy.findScheduledForToday(form.value.id, activeDate);
    const arquivo = sched ? String((sched as Record<string, unknown>).arquivo || "") : "";
    const ext = arquivo.split(".").pop()?.toLowerCase() || "";
    const isMedia = [...VIDEO_EXT, ...AUDIO_EXT].includes(ext);
    if (isMedia) {
      const dur = (sched as Record<string, unknown>).duracao;
      form.value.duration = typeof dur === "number" && dur > 0 ? Math.round(dur / 60) : 0;
    } else {
      form.value.duration = 0;
    }
  }

  function saveItem(): void {
    const f = form.value;

    if (!f.tipo) {
      ($alert as unknown as { warning?: (data: Record<string, unknown>) => void }).warning?.({ text: t("dialog.choose_type") });
      return;
    }
    if (f.tipo !== LiturgyItemTypeEnum.ITENS_AGENDADOS && !String(f.item || "").trim()) {
      ($alert as unknown as { warning?: (data: Record<string, unknown>) => void }).warning?.({ text: t("dialog.set_name") });
      return;
    }
    if (f.tipo === LiturgyItemTypeEnum.ITENS_AGENDADOS && !f.id) {
      ($alert as unknown as { warning?: (data: Record<string, unknown>) => void }).warning?.({ text: t("dialog.choose_scheduled") });
      return;
    }

    const built: Partial<LiturgyItem> = { ...f };
    switch (f.tipo) {
      case LiturgyItemTypeEnum.ANOTACAO:
        built.subitem = f.subitem || "";
        break;
      case LiturgyItemTypeEnum.SITE:
        built.url = $liturgy.validateUrl(f.url);
        built.subitem = "Site " + built.url;
        break;
      case LiturgyItemTypeEnum.ARQUIVO: {
        const isDir = f.dir.endsWith("/") || f.dir.endsWith("\\");
        built.subtipo = isDir ? "dir" : "arq";
        built.subitem = (isDir ? "Pasta " : "Arquivo ") + f.dir;
        break;
      }
      case LiturgyItemTypeEnum.MUSICA: {
        if (f.escolha || Number(f.musica) === -1) {
          built.escolha = true;
          built.musica = -1;
          built.subtipo = "escolha";
          built.subitem = t("placeholders.music_choose");
        } else {
          const m = musicsList.value.find((x) => x.id_music === Number(f.musica));
          built.escolha = false;
          built.subtipo = f.subtipo || MusicActionEnum.SUNG;
          built.subitem = t("data.music_prefix") + " " + (m?.name || `#${f.musica}`);
          built.id_music = Number(f.musica);
        }
        break;
      }
      case LiturgyItemTypeEnum.ITENS_AGENDADOS: {
        const c = scheduledCategories.value.find((x) => x.id === f.id);
        built.item = c?.nome || "";
        // Resolve o item agendado do dia ativo para extrair ícone + nome do arquivo.
        const activeDate = $liturgy.getActiveDate();
        const sched = $liturgy.findScheduledForToday(f.id, activeDate);
        const arquivo = sched ? String((sched as Record<string, unknown>).arquivo || "") : "";
        if (arquivo) {
          const ext = arquivo.split(".").pop()?.toLowerCase() || "";
          const ICON_MAP: Record<string, string> = {
            mp4: ICONS.MEDIA.VIDEO, webm: ICONS.MEDIA.VIDEO, mkv: ICONS.MEDIA.VIDEO,
            mov: ICONS.MEDIA.VIDEO, avi: ICONS.MEDIA.VIDEO, m4v: ICONS.MEDIA.VIDEO,
            mp3: ICONS.MEDIA.AUDIO, wav: ICONS.MEDIA.AUDIO, ogg: ICONS.MEDIA.AUDIO,
            flac: ICONS.MEDIA.AUDIO, aac: ICONS.MEDIA.AUDIO, m4a: ICONS.MEDIA.AUDIO,
            opus: ICONS.MEDIA.AUDIO, wma: ICONS.MEDIA.AUDIO,
            jpg: ICONS.MEDIA.IMAGE, jpeg: ICONS.MEDIA.IMAGE, png: ICONS.MEDIA.IMAGE,
            webp: ICONS.MEDIA.IMAGE, gif: ICONS.MEDIA.IMAGE, bmp: ICONS.MEDIA.IMAGE,
            heic: ICONS.MEDIA.IMAGE, heif: ICONS.MEDIA.IMAGE,
            pdf: ICONS.UI.FILE,
          };
          const icon = ICON_MAP[ext] || ICONS.UI.FILE;
          const filename = arquivo.split(/[\\/]/).pop() || arquivo;
          built.subitem = `${icon}|||${filename}`;
        } else {
          built.subitem = "";
        }
        break;
      }
      case LiturgyItemTypeEnum.VIDEO_ONLINE:
        console.log(built);
        built.url = f.url || "";
        built.subitem = "URL: " + built.url;
        break;
      case LiturgyItemTypeEnum.MEDIA_LIBRARY:
        built.ref_id = f.ref_id;
        built.dir = f.dir || "";
        built.subtipo = f.subtipo || "";
        built.item = f.item || f.subitem || "";
        built.subitem = f.subitem || "";
        break;
      case LiturgyItemTypeEnum.BG_SOUND:
        built.ref_id = f.ref_id;
        built.dir = f.dir || "";
        built.subtipo = "audio";
        built.item = f.item || f.subitem || "";
        built.subitem = f.subitem || "";
        break;
      case LiturgyItemTypeEnum.ANUNCIOS: {
        const ids = Array.isArray(f.anuncios_ids) ? f.anuncios_ids : [];
        built.anuncios_ids = ids;
        built.item = f.item || t("types.anuncios");
        built.subitem = ids.length
          ? `${ids.length} ${ids.length === 1 ? "anúncio" : "anúncios"}`
          : "";
        break;
      }
      case LiturgyItemTypeEnum.OVERLAY: {
        const slot = overlaySlots.value.find((s) => s.id === f.overlay_id);
        built.overlay_id = f.overlay_id || "";
        built.overlay_action = f.overlay_action || "activate";
        built.item = (f.overlay_action === "activate"
          ? t("overlay.activate")
          : t("overlay.deactivate")) + ": " + (slot?.name || built.overlay_id);
        built.subitem = slot?.name || built.overlay_id;
        break;
      }
      case LiturgyItemTypeEnum.BLOCO:
        built.subitem = "";
        built.blocoId = undefined;
        break;
    }

    if (editIndex.value >= 0) {
      const id = items.value[editIndex.value].id;
      $liturgy.update(id, built, activeDay.value);
    } else {
      $liturgy.add(built, activeDay.value);
    }
    items.value = [...items.value];
    dialog.value = false;
  }

  function confirmRemove(index?: number, fromDialog = false): void {
    if (index === undefined || index < 0 || index >= items.value.length) return;
    const item = items.value[index];
    const id = item.id;

    $alert.yesno({ text: chaveLiturgia("dialog.remove_confirm") }, (btn?: string) => {
      if (btn !== "yes") return;

      if (item.tipo === LiturgyItemTypeEnum.BLOCO) {
        const list = $liturgy.list(activeDay.value);
        for (const child of list) {
          if (child.blocoId === id) {
            $liturgy.update(child.id, { blocoId: undefined }, activeDay.value);
          }
        }
      }

      $liturgy.remove(id, activeDay.value);
      items.value = [...items.value];
      if (fromDialog) dialog.value = false;
    });
  }

  function cloneItem(index: number): void {
    if (index < 0 || index >= items.value.length) return;

    const itemToClone = items.value[index];

    const { id, checked_days: _, ...cloned } = itemToClone as LiturgyItem & { checked_days?: string };

    $liturgy.insert(cloned, activeDay.value, index + 1);

    items.value = $liturgy.list(activeDay.value);
  }

  function confirmClear(stopTimer?: () => void): void {
    if (!items.value.length) return;
    $alert.yesno({ text: chaveLiturgia("dialog.clear_confirm") }, (btn?: string) => {
      if (btn !== "yes") return;
      $liturgy.clear(activeDay.value);
      items.value = [];
      if (stopTimer) stopTimer();
    });
  }

  function openSite(): void {
    openUrl(form.value.url);
  }

  /* ============== Browse file ============== */
  async function chooseFile(): Promise<void> {
    const api = Platform.api;
    if (Platform.isDesktop && api?.storage?.chooseFile) {
      const file = await api.storage.chooseFile();
      if (file) form.value.dir = file;
    } else if (Platform.isDesktop && (api as unknown as Record<string, unknown>)?.chooseFile) {
      const file = await (api as unknown as { chooseFile: () => Promise<string | null> }).chooseFile();
      if (file) form.value.dir = file;
    } else {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const f = target.files?.[0];
        if (f) form.value.dir = (f as unknown as { path?: string }).path || f.name;
      };
      inp.click();
    }
  }

  /* ============== External file drag-and-drop ============== */
  function onDragOver(e: DragEvent): void {
    if (
      e.dataTransfer?.types.includes("Files") ||
      e.dataTransfer?.types.includes("application/x-moz-file")
    ) {
      isDraggingOver.value = true;
    }
  }

  function onDragLeave(el: HTMLElement | null, e: DragEvent): void {
    if (!el?.contains(e.relatedTarget as Node | null)) {
      isDraggingOver.value = false;
    }
  }

  async function onDrop(e: DragEvent): Promise<void> {
    isDraggingOver.value = false;
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    for (const file of files) {
      await _addDroppedFile(file, e);
    }
    items.value = [...items.value];
  }

  async function _addDroppedFile(file: File, e: DragEvent): Promise<void> {
    const name = file.name;
    const filePath = (file as unknown as { path?: string }).path || name;
    const ext = name.split(".").pop()?.toLowerCase() || "";
    const textExts = ["txt", "rtf"];

    if (e.dataTransfer?.items) {
      const entries = Array.from(e.dataTransfer.items);
      for (const dtItem of entries) {
        if ((dtItem as unknown as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry) {
          const entry = (dtItem as unknown as { webkitGetAsEntry: () => FileSystemEntry | null }).webkitGetAsEntry();
          if (entry && entry.isDirectory) {
            const dirPath = (file as unknown as { path?: string }).path
              ? (file as unknown as { path: string }).path + "/"
              : entry.name + "/";
            $liturgy.add(
              {
                tipo: LiturgyItemTypeEnum.ARQUIVO,
                item: entry.name,
                subitem: "Pasta " + ((file as unknown as { path?: string }).path || entry.name),
                subtipo: "dir",
                dir: dirPath,
                dir_info: "E",
                cor: DEFAULT_COLOR,
              },
              activeDay.value
            );
            return;
          }
        }
      }
    }

    if (textExts.includes(ext)) {
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve((ev.target?.result as string) || "");
        reader.onerror = () => resolve("");
        reader.readAsText(file);
      });
      $liturgy.add(
        {
          tipo: LiturgyItemTypeEnum.ANOTACAO,
          item: name.replace(/\.[^.]+$/, ""),
          subitem: text.slice(0, 2000),
          cor: DEFAULT_COLOR,
        },
        activeDay.value
      );
    } else {
      $liturgy.add(
        {
          tipo: LiturgyItemTypeEnum.ARQUIVO,
          item: name.replace(/\.[^.]+$/, ""),
          subitem: "Arquivo " + (filePath !== name ? filePath : name),
          subtipo: "arq",
          dir: filePath,
          dir_info: "E",
          cor: DEFAULT_COLOR,
        },
        activeDay.value
      );
    }
  }

  /* ============== Music list ============== */
  async function loadMusicsList(): Promise<void> {
    try {
      const data = await $database.get<LiturgyMusicItem[] | { data: LiturgyMusicItem[] }>(
        `${idioma()}_musics`
      );
      musicsCache.value = Array.isArray(data) ? data : data?.data || [];
    } catch {
      musicsCache.value = [];
    }
  }

  const videosCache = ref<VideoItem[]>([]);

  // ─── Biblioteca de Mídia / Som de fundo (itens por ref_id) ───

  interface MediaLibraryEntry {
    id: string;
    name: string;
    path: string;
    type: "image" | "video" | "pdf";
  }

  interface BgSoundEntry {
    id: string;
    name: string;
    path: string;
    mime?: string;
  }

  async function loadMediaLibraryEntries(): Promise<MediaLibraryEntry[]> {
    return $idb.getAll<MediaLibraryEntry>(DB_TABLE.MEDIA_LIBRARY);
  }

  async function loadBgSoundEntries(): Promise<BgSoundEntry[]> {
    return $idb.getAll<BgSoundEntry>(DB_TABLE.BACKGROUND_SOUND_LIBRARY);
  }

  const ONLINE_VIDEO_DEFAULTS: OnlineVideoDefaultItem[] = [
    {
      title: "Vitória (Adoradores 5) [Ao Vivo]",
      url: "https://www.youtube.com/watch?v=nlNluQp7cFI",
    },
    { title: "Além do Rio - Arautos do Rei", url: "https://www.youtube.com/watch?v=AmcX_HLy6b0" },
    { title: "Só o Começo - Vocal Livre", url: "https://www.youtube.com/watch?v=XktoQTwHSK4" },
  ];

  function apiChannelImages(data: Partial<OnlineApiData>): Map<string, string> {
    const chImg = new Map(
      (data.channels ?? []).map((c) => [c.channel_id, c.default_image || ""])
    );
    return new Map(
      (data.playlists ?? []).map((p) => [p.playlist_id, chImg.get(p.channel_id) || ""])
    );
  }

  /** Cache em camadas (memória → tabelas online_* no IDB → rede) via Database. */
  async function loadOnlineApiVideos(): Promise<OnlineApiData | null> {
    return $database.get<OnlineApiData>(`${idioma()}_collections_online`, {
      silent: true,
    });
  }

  async function loadVideosList(): Promise<void> {
    let all: VideoItem[] = [];
    try {
      const customs = await $idb.getAll<VideoItem>(DB_TABLE.CUSTOM_ONLINE_VIDEOS);
      customs.sort((a, b) => ((a.createdAt || "") > (b.createdAt || "") ? -1 : 1));
      all = customs.map((v) => ({ ...v, source: "custom" as const }));
    } catch {
      all = [];
    }

    const seen = new Set(all.map((v) => v.url));
    const api = await loadOnlineApiVideos();
    const titles = new Map(
      (api?.playlists ?? []).map((p) => [p.playlist_id, p.title])
    );
    const images = apiChannelImages(api ?? {});
    for (const av of api?.videos ?? []) {
      const url = `https://www.youtube.com/watch?v=${av.video_id}`;
      if (seen.has(url)) continue;
      seen.add(url);
      all.push({
        id: av.video_id,
        name: av.title,
        url,
        source: "online",
        origin: titles.get(av.playlist_id) || "",
        originIcon: images.get(av.playlist_id) || "",
      });
    }

    if (!all.length) {
      for (const def of ONLINE_VIDEO_DEFAULTS) {
        all.push({ id: def.url, name: def.title, url: def.url, source: "custom" });
      }
    }

    all.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    videosCache.value = all;
  }

  function setFormField(field: string, value: unknown): void {
    (form.value as Record<string, unknown>)[field] = value;
  }

  function toggleMenuOpen(): void {
    menuOpen.value = !menuOpen.value;
  }

  function closeMenu(): void {
    menuOpen.value = false;
  }

  return {
    dialog,
    editIndex,
    form,
    musicsCache,
    videosCache,
    isDraggingOver,
    menuOpen,
    overlaySlots,
    items,
    totalDuration,
    musicsList,
    isChecked,
    toggleChecked,
    onReorder,
    adjustBlocoAssignment,
    isYoutube,
    subtitleFor,
    changeColor,
    markAll,
    invertSelection,
    removeDone,
    openItemDialog,
    quickAdd,
    onTypeChange,
    setMusicChoice,
    onMusicChange,
    onScheduledCategoryChange,
    saveItem,
    confirmRemove,
    cloneItem,
    confirmClear,
    executeItem,
    playMusic,
    openLyric,
    openUrl,
    openFile,
    openSite,
    chooseFile,
    onDragOver,
    onDragLeave,
    onDrop,
    loadMusicsList,
    loadVideosList,
    loadMediaLibraryEntries,
    loadBgSoundEntries,
    loadOverlaySlots,
    setFormField,
    toggleMenuOpen,
    closeMenu,
  };
}
