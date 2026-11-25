/**
 * Áudios litúrgicos que vêm com o programa, na categoria "Litúrgicos" da
 * Biblioteca de Mídia. Os três da Escola Sabatina são os mesmos arquivos que o
 * Temporizador de Culto toca por padrão. Trocar um áudio é trocar o arquivo
 * (ver `src/assets/audio/liturgical/README.md`).
 */
import { SABBATH_SCHOOL_SOUNDS } from "@/config/SabbathSchool";

export interface LiturgicalAudio {
  /** Id fixo do registro na biblioteca. */
  id: string;
  names: { pt: string; es: string };
  url: string;
  /** Crédito exigido pela origem da voz (ex.: "Vozes geradas com elevenlabs.io"). */
  credit?: string;
}

export const LITURGICAL_CATEGORY = {
  id: "liturgical",
  names: { pt: "Litúrgicos", es: "Litúrgicos" },
  color: "#8e44ad",
} as const;

export const INTERCESSORY_PRAYER_ID = "liturgical-intercessory";

export const LITURGICAL_AUDIOS: LiturgicalAudio[] = [
  {
    id: "liturgical-opening",
    names: { pt: "Abertura da Escola Sabatina", es: "Apertura de la Escuela Sabática" },
    url: SABBATH_SCHOOL_SOUNDS.OPENING.url,
  },
  {
    id: "liturgical-five",
    names: { pt: "5 minutos para a Lição", es: "5 minutos para la Lección" },
    url: SABBATH_SCHOOL_SOUNDS.FIVE_MINUTES.url,
  },
  {
    id: "liturgical-one",
    names: { pt: "1 minuto para a Lição", es: "1 minuto para la Lección" },
    url: SABBATH_SCHOOL_SOUNDS.ONE_MINUTE.url,
  },
  {
    id: INTERCESSORY_PRAYER_ID,
    names: { pt: "Oração Intercessória", es: "Oración Intercesora" },
    url: new URL("/src/assets/audio/liturgical/intercessory_prayer.mp3", import.meta.url).href,
  },
  {
    id: "liturgical-closing",
    names: { pt: "Encerramento do Culto", es: "Cierre del Culto" },
    url: new URL("/src/assets/audio/liturgical/closing.mp3", import.meta.url).href,
  },
];

export function isBundledLiturgicalId(id: string | undefined | null): boolean {
  return !!id && LITURGICAL_AUDIOS.some((a) => a.id === id);
}
