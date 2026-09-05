<template>
  <span
    v-if="svgContent"
    class="lj-icon"
    :class="svgClassList"
    :style="svgStyle"
    role="img"
    :aria-label="icon"
    v-html="svgContent"
  />
</template>

<script setup lang="ts">
import { computed, useAttrs } from "vue";

interface IconProps {
  icon?: string;
  size?: string | number;
  color?: string;
  start?: boolean;
  end?: boolean;
  disabled?: boolean;
}

const props = withDefaults(defineProps<IconProps>(), {
  size: "default",
});

const attrs = useAttrs();

/**
 * Nomes de cor herdados do tema do Vuetify, que várias telas ainda passam em
 * `color="..."`.
 *
 * Sem tradução eles viram `color: primary` no style, que o browser descarta sem
 * avisar: o ícone herda a cor do pai e ninguém percebe que a cor sumiu. Por isso
 * o mapa fica aqui, e não numa varredura de templates.
 *
 * Só nomes entram no mapa: `#e74c3c`, `var(--x)` e `currentColor` passam direto.
 */
const CORES: Record<string, string> = {
  primary: "var(--lj-ui-accent)",
  secondary: "var(--lj-text-muted)",
  success: "var(--lj-success)",
  warning: "var(--lj-warning)",
  error: "var(--lj-danger)",
  info: "var(--lj-info)",
  white: "var(--lj-white)",
  black: "var(--lj-gray-900)",
  grey: "var(--lj-text-muted)",
  gray: "var(--lj-text-muted)",
};

const resolvedColor = computed(() =>
  props.color ? (CORES[props.color] ?? props.color) : undefined
);

const _svgModules = import.meta.glob("@/assets/icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const _svgNameMap = new Map<string, string>();
for (const [path, content] of Object.entries(_svgModules)) {
  const name = path
    .split("/")
    .pop()
    ?.replace(/\.svg$/, "");
  if (name) _svgNameMap.set(name, content);
}

const svgContent = computed(() => {
  if (!props.icon) return null;
  const raw = _svgNameMap.get(props.icon);
  if (!raw) return null;

  // Dois acervos convivem aqui. As marcas do projeto (ja.svg, hasd.svg…) trazem cor
  // fixa no arquivo e precisam ser repintadas para atender `color`. Os ícones de
  // interface já desenham em currentColor — repintá-los encheria de sólido todo
  // ícone de contorno, cujo traçado é currentColor mas o preenchimento é "none".
  const corFixa = !raw.includes("currentColor");

  let svg = raw;
  if (props.color && corFixa) {
    svg = svg.replace(/fill="(?!none")[^"]*"/g, 'fill="currentColor"');
  }

  // Sem width/height próprios, o SVG obedece ao tamanho pedido no invólucro.
  return svg.replace(
    /<svg([^>]*)>/,
    (_match, attrs: string) =>
      `<svg${attrs
        .replace(/\s*width="[^"]*"/, "")
        .replace(/\s*height="[^"]*"/, "")} style="width:100%;height:100%">`
  );
});

const sizeMap: Record<string, number> = {
  "x-small": 16,
  small: 20,
  default: 24,
  large: 28,
  "x-large": 32,
};

const resolvedSize = computed(() => {
  const s = props.size;
  if (s === undefined || s === null) return 24;
  if (typeof s === "number") return s;
  if (s in sizeMap) return sizeMap[s];
  const parsed = parseInt(s, 10);
  return isNaN(parsed) ? 24 : parsed;
});

const svgClassList = computed(() => [
  attrs.class,
  {
    "lj-icon--start": props.start,
    "lj-icon--end": props.end,
    "lj-icon--disabled": props.disabled,
  },
]);

const svgStyle = computed(() => {
  const px = `${resolvedSize.value}px`;
  const result: Record<string, string> = {
    width: px,
    height: px,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
  if (resolvedColor.value) {
    result.color = resolvedColor.value;
  }
  return result;
});
</script>

<style scoped>
.lj-icon {
  flex-shrink: 0;
  line-height: 0;
  filter: drop-shadow(0px 1px 1px rgba(0, 0, 0, 0.35));
}
.lj-icon svg {
  display: block;
  filter: drop-shadow(0px 1px 1px rgba(0, 0, 0, 0.35));
}
.lj-icon--start {
  margin-right: 0.5em;
}
.lj-icon--end {
  margin-left: 0.5em;
}
.lj-icon--disabled {
  opacity: 0.38;
  pointer-events: none;
}
</style>
