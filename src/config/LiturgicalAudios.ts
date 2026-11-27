/**
 * Áudios litúrgicos que vêm com o programa, na categoria "Litúrgicos" da
 * Biblioteca de Mídia. Os três da Escola Sabatina são os mesmos arquivos que o
 * Temporizador de Culto toca por padrão. Trocar um áudio é trocar o arquivo
 * (ver `src/assets/audio/liturgical/README.md`). Vozes e fundos musicais foram
 * gerados no ElevenLabs, e o crédito vai junto do nome na biblioteca. Os três
 * "(Clássico)" são os sons que o programa tocava antes, para quem preferir.
 */
import { SABBATH_SCHOOL_SOUNDS } from "@/config/SabbathSchool";

export interface LiturgicalAudio {
  /** Id fixo do registro na biblioteca. */
  id: string;
  names: { pt: string; es: string };
  url: string;
  /** Crédito da origem do áudio, mostrado junto do nome (ex.: "ElevenLabs"). */
  credit?: string;
}

export const LITURGICAL_CATEGORY = {
  id: "liturgical",
  names: { pt: "Litúrgicos", es: "Litúrgicos" },
  color: "#8e44ad",
} as const;

export const INTERCESSORY_PRAYER_ID = "liturgical-intercessory";

/** Vozes e fundos gerados no ElevenLabs: o crédito aparece junto do nome. */
const ELEVENLABS = "ElevenLabs";

export const LITURGICAL_AUDIOS: LiturgicalAudio[] = [
  {
    id: "liturgical-opening",
    names: { pt: "Abertura da Escola Sabatina", es: "Apertura de la Escuela Sabática" },
    url: SABBATH_SCHOOL_SOUNDS.OPENING.url,
    credit: ELEVENLABS,
  },
  {
    id: "liturgical-opening-classic",
    names: {
      pt: "Abertura da Escola Sabatina (Clássico)",
      es: "Apertura de la Escuela Sabática (Clásico)",
    },
    url: new URL("/src/assets/audio/liturgical/opening_classic.mp3", import.meta.url).href,
  },
  {
    id: "liturgical-five",
    names: { pt: "5 minutos para a Lição", es: "5 minutos para la Lección" },
    url: SABBATH_SCHOOL_SOUNDS.FIVE_MINUTES.url,
    credit: ELEVENLABS,
  },
  {
    id: "liturgical-five-classic",
    names: { pt: "5 minutos para a Lição (Clássico)", es: "5 minutos para la Lección (Clásico)" },
    url: new URL("/src/assets/audio/liturgical/five_minutes_classic.mp3", import.meta.url).href,
  },
  {
    id: "liturgical-one",
    names: { pt: "1 minuto para a Lição", es: "1 minuto para la Lección" },
    url: SABBATH_SCHOOL_SOUNDS.ONE_MINUTE.url,
    credit: ELEVENLABS,
  },
  {
    id: "liturgical-one-classic",
    names: { pt: "1 minuto para a Lição (Clássico)", es: "1 minuto para la Lección (Clásico)" },
    url: new URL("/src/assets/audio/liturgical/one_minute_classic.mp3", import.meta.url).href,
  },
  {
    id: "liturgical-announcements-1",
    names: { pt: "Anúncios v1", es: "Anuncios v1" },
    url: new URL("/src/assets/audio/liturgical/announcements_1.mp3", import.meta.url).href,
    credit: ELEVENLABS,
  },
  {
    id: "liturgical-announcements-2",
    names: { pt: "Anúncios v2", es: "Anuncios v2" },
    url: new URL("/src/assets/audio/liturgical/announcements_2.mp3", import.meta.url).href,
    credit: ELEVENLABS,
  },
  {
    id: INTERCESSORY_PRAYER_ID,
    names: { pt: "Oração Intercessória", es: "Oración Intercesora" },
    url: new URL("/src/assets/audio/liturgical/intercessory_prayer.mp3", import.meta.url).href,
    credit: ELEVENLABS,
  },
  {
    id: "liturgical-closing",
    names: { pt: "Encerramento do Culto (sábado)", es: "Cierre del Culto (sábado)" },
    url: new URL("/src/assets/audio/liturgical/closing.mp3", import.meta.url).href,
    credit: ELEVENLABS,
  },
  {
    id: "liturgical-closing-weekday",
    names: {
      pt: "Encerramento do Culto (quarta e domingo)",
      es: "Cierre del Culto (miércoles y domingo)",
    },
    url: new URL("/src/assets/audio/liturgical/closing_weekday.mp3", import.meta.url).href,
    credit: ELEVENLABS,
  },
];

export function isBundledLiturgicalId(id: string | undefined | null): boolean {
  return !!id && LITURGICAL_AUDIOS.some((a) => a.id === id);
}
