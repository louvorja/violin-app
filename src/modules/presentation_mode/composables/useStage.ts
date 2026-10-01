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
const _sent = ref<Sent | null>(null);

export function useStage() {
  return {
    preview: _preview,
    sent: _sent,
    show(target: Playable | null): void {
      _preview.value = target;
    },
    /**
     * Registra o que foi ao ar. Se o palco mostrava o anterior, acompanha o
     * novo — Anterior/Próximo na pasta não deixam o palco para trás.
     */
    markSent(playable: Playable, expected: LiveExpectation): void {
      const previous = _sent.value?.playable;
      if (!_preview.value || (previous && samePlayable(_preview.value, previous))) _preview.value = playable;
      _sent.value = { playable, expected };
    },
    reset(): void {
      _preview.value = null;
      _sent.value = null;
    },
  };
}
