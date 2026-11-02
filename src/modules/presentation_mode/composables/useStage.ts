import { ref } from "vue";
import { samePlayable, type LiveExpectation, type Playable } from "../program/playable";

/**
 * O palco central e o que foi mandado ao ar.
 *
 * Segue o FreeShow: um clique leva o item para a prévia, dois cliques o põem
 * no ar. O palco não é espelho da tela — isso são as miniaturas da coluna de
 * saídas. Quando o item em prévia é o que está no ar, o palco vira o controle
 * dele (grade ativa, barra do vídeo).
 */

interface Sent {
  playable: Playable;
  expected: LiveExpectation;
}

const _preview = ref<Playable | null>(null);
/** A camada visual: o que foi mandado às telas. */
const _sent = ref<Sent | null>(null);
/**
 * A camada de áudio: o som que toca por baixo da foto (música do momento da
 * família, fundo musical). Fica à parte para a foto continuar sendo "o que
 * está no ar" — a barra do centro e o passador andam por ela.
 */
const _sentAudio = ref<Sent | null>(null);

export function useStage() {
  return {
    preview: _preview,
    sent: _sent,
    sentAudio: _sentAudio,
    show(target: Playable | null): void {
      _preview.value = target;
    },
    /**
     * Registra o que foi ao ar. Se o palco mostrava o anterior, acompanha o
     * novo — Anterior/Próximo na pasta não deixam o palco para trás.
     */
    markSent(playable: Playable, expected: LiveExpectation): void {
      if (expected.kind === "audio") {
        _sentAudio.value = { playable, expected };
        if (!_preview.value) _preview.value = playable;
        return;
      }
      const previous = _sent.value?.playable;
      if (!_preview.value || (previous && samePlayable(_preview.value, previous)))
        _preview.value = playable;
      _sent.value = { playable, expected };
    },
    /** Saiu do ar; o que estava no palco fica nele, pronto para voltar. */
    clearSent(): void {
      _sent.value = null;
      _sentAudio.value = null;
    },
    /** Só o áudio parou: a foto continua no ar. */
    clearAudio(): void {
      _sentAudio.value = null;
    },
    reset(): void {
      _preview.value = null;
      _sent.value = null;
      _sentAudio.value = null;
    },
  };
}
