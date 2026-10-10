/**
 * @category helper-puro — monta o tile de uma categoria de Meus Vídeos.
 *
 * O ícone da categoria é um **nome tabler** (o mesmo que o `LjIcon` resolve no
 * desktop); web, Android e iOS não têm esse módulo. Em vez de espalhar um mapa
 * de ícones por plataforma, o renderer monta o tile — fundo com a cor da
 * categoria e o ícone branco centralizado, igual ao chip do desktop — e entrega
 * o PNG pronto em `/api/online-videos/image`.
 *
 * O ícone é resolvido pelo **nome** em `TABLER_ICONS` (os componentes já estão
 * no bundle) e serializado com `renderToString`: um caminho só para qualquer
 * nome de `ICONS.CATEGORY`, sem importar um SVG por ícone. O branco vai como
 * prop porque, dentro de um `<img>`, `currentColor` resolve para **preto**.
 */
import { h } from "vue";
import { renderToString } from "vue/server-renderer";
import { TABLER_ICONS } from "@/config/TablerIcons";

// Marcas do projeto (não são tabler) — mesmo glob do LjIcon.
const BRAND_SVG = import.meta.glob<string>("../assets/icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

const BRAND_BY_NAME: Record<string, string> = {};
for (const [path, svg] of Object.entries(BRAND_SVG)) {
  const name = path.split("/").pop()?.replace(/\.svg$/, "");
  if (name) BRAND_BY_NAME[name] = svg;
}

/**
 * SVG do ícone de uma categoria (`ICONS.CATEGORY`) ou `null`.
 *
 * Tabler primeiro (renderizado em runtime, já em branco); o que não for
 * tabler cai nas marcas de `src/assets/icons` (ex.: `ja`).
 */
export async function categoryIconSvg(name?: string | null): Promise<string | null> {
  if (!name) return null;

  const component = TABLER_ICONS[name];
  if (component) {
    return renderToString(h(component, { size: 24, color: "#ffffff" }));
  }

  return BRAND_BY_NAME[name] ?? null;
}

/** Tile 2× do tamanho exibido nos clientes (64×36 em web/Android/iOS). */
const TILE_WIDTH = 128;
const TILE_HEIGHT = 72;
const DEFAULT_COLOR = "#6b7280";

export interface CategoryTileSource {
  icon?: string | null;
  color?: string | null;
  iconType?: string | null;
  iconMime?: string | null;
  iconData?: ArrayBuffer | null;
}

/** Só hex puro entra no canvas — o dado vem do usuário. */
function safeColor(color?: string | null): string {
  return color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : DEFAULT_COLOR;
}

function loadImage(blob: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function drawTile(image: HTMLImageElement, color?: string | null): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = TILE_WIDTH;
    canvas.height = TILE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      resolve(null);
      return;
    }

    ctx.fillStyle = safeColor(color);
    ctx.fillRect(0, 0, TILE_WIDTH, TILE_HEIGHT);

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width > 0 && height > 0) {
      const box = TILE_HEIGHT - 16;
      const scale = Math.min(box / width, box / height);
      const w = width * scale;
      const h = height * scale;
      ctx.drawImage(image, (TILE_WIDTH - w) / 2, (TILE_HEIGHT - h) / 2, w, h);
    }

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        void blob.arrayBuffer().then(resolve, () => resolve(null));
      },
      "image/png"
    );
  });
}

/**
 * Tile da categoria como PNG.
 *
 * Tenta primeiro a imagem enviada pelo usuário (`iconType === "image"`) e, se
 * não houver/carregar, o SVG do ícone; sem nenhum dos dois → `null` (a rota
 * responde 404 e o card fica sem thumb).
 */
export async function renderCategoryTile(source: CategoryTileSource): Promise<ArrayBuffer | null> {
  const candidates: Blob[] = [];
  if (source.iconType === "image" && source.iconData) {
    candidates.push(new Blob([source.iconData], { type: source.iconMime || "image/png" }));
  }

  const svg = await categoryIconSvg(source.icon);
  if (svg) {
    candidates.push(new Blob([svg], { type: "image/svg+xml" }));
  }

  for (const blob of candidates) {
    const image = await loadImage(blob);
    if (!image) continue;
    const png = await drawTile(image, source.color);
    if (png) return png;
  }
  return null;
}
