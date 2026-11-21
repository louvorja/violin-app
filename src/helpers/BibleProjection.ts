import $userdata from "@/helpers/UserData";
import ProjectionWindows from "@/helpers/ProjectionWindows";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import { KEYS } from "@/constants/UserDataKeys";
import type { BiblePassage } from "@/types/Bible";
import { nextVerseOf } from "@/modules/presentation_mode/program/bible";
import { useBibleLibrary } from "@/modules/presentation_mode/composables/useBibleLibrary";

/**
 * Põe um trecho bíblico no ar: o mesmo caminho do módulo Bíblia e do programa.
 * A liturgia e o programa compartilham esta função para o versículo projetar
 * igual, com o "próximo" do retorno de palco quando o capítulo já está em cache.
 */
export async function projectBiblePassage(ref: BiblePassage): Promise<void> {
  $userdata.set(KEYS.MODULES.BIBLE.IS_PLAYING, true);
  await ProjectionWindows.openBibleWindow();
  const bible = useBibleLibrary();
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
