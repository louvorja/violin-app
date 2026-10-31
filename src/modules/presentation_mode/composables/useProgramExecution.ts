import $userdata from "@/helpers/UserData";
import $snackbar from "@/helpers/Snackbar";
import { i18nAtual } from "@/i18n";
import Broadcast from "@/helpers/Broadcast";
import ProjectionWindows from "@/helpers/ProjectionWindows";
import Telemetry from "@/helpers/Telemetry";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { MusicActionEnum } from "@/enums/MusicActionEnum";
import { LITURGY_VERSION_ACTION } from "@/config/MusicAction";
import { openCustomMusic } from "@/helpers/CustomMusicCatalog";
import Media from "@/composables/useMedia";
import type { LiturgyItem } from "@/types/Liturgy";
import { useLiturgyExecution } from "@/modules/liturgy/composables/useLiturgyExecution";
import type { ProgramBibleRef, ProgramItem } from "@/types/Presentation";
import { liturgyItem } from "../program/liturgy";
import { applyOverride, isMusicMode, type MusicMode } from "../program/musicModes";
import { currentMusicOverride } from "./useMusicOverride";
import { nextVerseOf } from "../program/bible";
import { useBibleLibrary } from "./useBibleLibrary";
import { isPowerPoint, powerPointAsPdf } from "./usePowerPoint";
import { useCloudFiles } from "./useCloudFiles";
import { isUrl } from "../program/paths";
import { canvaDesignOf } from "../program/items";

/**
 * A versão escolhida no topo do módulo vence a pedida. Playback imposto a uma
 * música sem playback cai no cantado, em vez de não tocar nada.
 */
function effectiveMode(mode: MusicMode | string): { mode: MusicMode | string; forcedPb: boolean } {
  if (!isMusicMode(mode)) return { mode, forcedPb: false };
  const override = currentMusicOverride();
  const effective = applyOverride(mode, override);
  return { mode: effective, forcedPb: effective === "pb" && mode !== "pb" };
}

/**
 * Toca uma música no formato pedido. Com letra, ela vai minimizada — os
 * slides aparecem na grade do palco do módulo, não na janela do player por
 * cima dele. "Só áudio" toca sem mandar nada às telas e aparece no palco
 * com o player.
 */
export function playMusicInMode(idMusic: number, requested: MusicMode | string = "sung"): void {
  const { mode, forcedPb } = effectiveMode(requested);
  if (mode === "audio" || mode === "audio_pb") {
    Media.stop();
    void Media.openAudio({
      id_music: idMusic,
      mode: mode === "audio_pb" ? MusicActionEnum.INSTRUMENTAL : MusicActionEnum.AUDIO,
    });
    return;
  }
  const open = (m: MusicMode | string) =>
    Media.open({ id_music: idMusic, mode: LITURGY_VERSION_ACTION[m] ?? MusicActionEnum.AUDIO, minimized: true });
  void open(mode).then((ok) => {
    if (!ok && forcedPb) void open("sung");
  });
}

/**
 * Música personalizada no formato pedido, também minimizada. O caminho é o
 * mesmo das listas e da liturgia (`openCustomMusic`), que relê o documento.
 */
export function playCustomMusicInMode(customId: string, requested: MusicMode | string = "sung"): void {
  const { mode, forcedPb } = effectiveMode(requested);
  const open = (m: MusicMode | string) =>
    openCustomMusic(customId, LITURGY_VERSION_ACTION[m] ?? MusicActionEnum.AUDIO, { minimized: true });
  void open(mode).then((ok) => {
    if (!ok && forcedPb) void open("sung");
  });
}

/**
 * Música a escolher na hora segue o caminho da liturgia, que pede a escolha.
 * `chosen`: a versão escolhida agora, para o item que deixou a versão em aberto.
 */
function playMusicOnStage(source: LiturgyItem, chosen?: MusicMode): boolean {
  if (source.escolha || !source.id_music) return false;
  const mode = isMusicMode(source.subtipo) ? source.subtipo : (chosen ?? "sung");
  if (source.id_music > 0) playMusicInMode(source.id_music, mode);
  else if (source.ref_id) playCustomMusicInMode(source.ref_id, mode);
  else return false;
  return true;
}

/**
 * Executar um item do programa.
 *
 * Música com letra vai para a grade do palco (F3). O resto, até o palco saber
 * mostrar (F4), é o motor da liturgia: arquivo vai para a projeção, e assim
 * por diante.
 * O versículo, que a liturgia não conhece, segue o caminho do BibleSpotlight —
 * a autoridade da Bíblia no shell transforma a intenção no versículo projetado.
 */
export function useProgramExecution() {
  const { executeItem, executeAnnouncements } = useLiturgyExecution();
  const bible = useBibleLibrary();
  const cloud = useCloudFiles();

  /**
   * O versículo vai ao ar na hora. O retorno de palco mostra o seguinte quando o
   * capítulo já foi lido — esperar o banco atrasaria a projeção; o capítulo é
   * lido em seguida, para os próximos passos.
   */
  async function projectBible(ref: ProgramBibleRef): Promise<void> {
    $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, true);
    await ProjectionWindows.openBibleWindow();
    const chapter = bible.cachedChapterOf(ref);
    const next = chapter ? nextVerseOf(chapter, ref.verses) : null;
    Broadcast.send(BROADCAST_TYPE.BIBLE_VERSE_INTENT, {
      text: ref.text,
      reference: ref.reference,
      book_id: ref.book_id,
      chapter: ref.chapter,
      verses: ref.verses,
      version_id: ref.version_id,
      next_text: next?.text ?? "",
      next_reference: next?.reference ?? "",
      active: true,
    });
    if (!chapter) void bible.chapterOf(ref);
  }

  function sendBible(ref: ProgramBibleRef): void {
    void projectBible(ref).catch((error: unknown) => {
      Telemetry.captureException(error, { source: "presentation_mode.execute.bible" });
    });
  }

  /**
   * Item com sub-itens (anúncios) não projeta: o operador escolhe o sub-item.
   * Devolve se algo foi enviado para execução.
   */
  function execute(item: ProgramItem, mode?: MusicMode): boolean {
    if (item.children?.length) return false;
    if (item.bible) {
      sendBible(item.bible);
      return true;
    }
    if (item.source) {
      if (item.source.tipo === LiturgyItemTypeEnum.MUSICA && playMusicOnStage(item.source, mode)) return true;
      const design = canvaDesignOf(item);
      if (design) {
        projectCanva(design, item.title, item.source.url);
        return true;
      }
      // Arquivo do disco segue o caminho da biblioteca: nuvem e PowerPoint são tratados lá.
      const dir = item.source.dir ?? "";
      if (item.source.tipo === LiturgyItemTypeEnum.ARQUIVO && dir && !isUrl(dir)) {
        projectPath(dir, item.title);
        return true;
      }
      executeItem(item.source);
      return true;
    }
    return false;
  }

  /**
   * Um arquivo solto (biblioteca) vai para a tela principal como um item de
   * arquivo da liturgia. PowerPoint vai como o PDF convertido.
   */
  function projectPath(path: string, name: string): void {
    const send = (dir: string) =>
      executeItem(liturgyItem({ id: crypto.randomUUID(), tipo: LiturgyItemTypeEnum.ARQUIVO, dir, item: name }));
    void (async () => {
      // Só na nuvem, o vídeo tocaria aos trancos enquanto baixa: o operador decide.
      if (!(await cloud.ensureLocal(path, name))) return;
      if (!isPowerPoint(path)) return void send(path);
      const pdf = await powerPointAsPdf(path, name);
      if (pdf) void send(pdf);
    })();
  }

  /**
   * Design do Canva no navegador: a página ao vivo na janela de site, pelo
   * mesmo caminho do item Site da liturgia (o main aperta "Apresentar em tela
   * cheia" em toda página do canva.com). O `view_url` expira, então cada envio
   * pede um novo; sem conexão, vale o guardado no item.
   */
  function projectCanva(designId: string, title: string, storedUrl = ""): void {
    void (async () => {
      let url = storedUrl;
      try {
        const fresh = await window.louvorjaApi?.canva?.designUrl(designId);
        if (fresh?.ok && fresh.url) url = fresh.url;
      } catch {
        // Fica o link guardado.
      }
      if (!url) {
        const t = i18nAtual()?.global?.t as ((_key: string) => string) | undefined;
        $snackbar.error(t?.("modules.presentation_mode.canva.site_failed") ?? "Canva");
        return;
      }
      executeItem(liturgyItem({ id: crypto.randomUUID(), tipo: LiturgyItemTypeEnum.SITE, url, item: title }));
    })();
  }

  /**
   * O PowerPoint gerado de novo ("Gerar de novo", fonte instalada): o PDF novo
   * entra no lugar do antigo, sem mudar o que o módulo considera no ar.
   */
  function projectPdf(pdf: string, name: string): void {
    executeItem(liturgyItem({ id: crypto.randomUUID(), tipo: LiturgyItemTypeEnum.ARQUIVO, dir: pdf, item: name }));
  }

  /**
   * Um filho de momento: o arquivo vai como qualquer arquivo da biblioteca; o
   * anúncio abre a projeção de anúncios naquele ponto.
   */
  function executeChild(item: ProgramItem, childId: string): boolean {
    const index = item.children?.findIndex((c) => c.id === childId) ?? -1;
    const child = item.children?.[index];
    if (!child) return false;
    if (child.path) {
      projectPath(child.path, child.title);
      return true;
    }
    if (child.ref && item.source) {
      void executeAnnouncements(item.source, index);
      return true;
    }
    return false;
  }

  return { execute, executeChild, projectPath, projectCanva, projectPdf, sendBible };
}
