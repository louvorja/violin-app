/**
 * Sanitização do HTML editável das Anotações da Liturgia.
 *
 * Usa `DOMParser` (documento inerte, sem executar scripts) para construir nós
 * seguros segundo uma lista restrita de tags e propriedades CSS de formatação.
 * Os nós sanitizados podem ser aplicados diretamente no container via
 * `replaceChildren(...)` para evitar re-serialização e mXSS.
 */

const ALLOWED_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "SPAN",
  "FONT",
  "DIV",
  "P",
  "BR",
  "UL",
  "OL",
  "LI",
  "SUB",
  "SUP",
]);

const DROP_WITH_CONTENT = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "SVG",
  "MATH",
  "TEMPLATE",
  "NOSCRIPT",
  "HEAD",
]);

const ALLOWED_STYLE_PROPS = new Set([
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-decoration-line",
  "text-align",
]);

const UNSAFE_CSS_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:/i;

function sanitizeStyle(raw: string): string {
  const safe: string[] = [];
  for (const decl of raw.split(";")) {
    const colon = decl.indexOf(":");
    if (colon <= 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop) || !val || UNSAFE_CSS_VALUE.test(val)) continue;
    safe.push(`${prop}: ${val}`);
  }
  return safe.join("; ");
}

function cloneSafeNode(node: Node, targetDoc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return targetDoc.createTextNode(node.textContent || "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (DROP_WITH_CONTENT.has(tag)) return null;

  if (!ALLOWED_TAGS.has(tag)) {
    const frag = targetDoc.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
      const safeChild = cloneSafeNode(child, targetDoc);
      if (safeChild) frag.appendChild(safeChild);
    }
    return frag;
  }

  const clean = targetDoc.createElement(tag.toLowerCase());
  const styleAttr = el.getAttribute("style");
  if (styleAttr) {
    const sanitized = sanitizeStyle(styleAttr);
    if (sanitized) clean.setAttribute("style", sanitized);
  }
  if (tag === "FONT") {
    const color = el.getAttribute("color");
    if (color && !UNSAFE_CSS_VALUE.test(color)) clean.setAttribute("color", color);
    const face = el.getAttribute("face");
    if (face && !UNSAFE_CSS_VALUE.test(face)) clean.setAttribute("face", face);
    const size = el.getAttribute("size");
    if (size && /^[1-7]$/.test(size.trim())) clean.setAttribute("size", size.trim());
  }

  for (const child of Array.from(el.childNodes)) {
    const safeChild = cloneSafeNode(child, targetDoc);
    if (safeChild) clean.appendChild(safeChild);
  }
  return clean;
}

/** Constrói um DocumentFragment com apenas nós e formatações permitidas. */
export function sanitizeNoteFragment(rawHtml: string, targetDoc: Document = document): DocumentFragment {
  const frag = targetDoc.createDocumentFragment();
  if (!rawHtml) return frag;
  const parsed = new DOMParser().parseFromString(rawHtml, "text/html");
  for (const child of Array.from(parsed.body.childNodes)) {
    const safe = cloneSafeNode(child, targetDoc);
    if (safe) frag.appendChild(safe);
  }
  return frag;
}

/** Aplica HTML sanitizado diretamente no elemento alvo sem passar por `innerHTML`. */
export function applySafeNoteHtml(target: HTMLElement, rawHtml: string): void {
  const frag = sanitizeNoteFragment(rawHtml, target.ownerDocument || document);
  target.replaceChildren(frag);
}

/** Serializa o HTML sanitizado (usado para normalizar conteúdo colado antes de persistir). */
export function sanitizeNoteHtml(rawHtml: string): string {
  if (!rawHtml) return "";
  const container = document.createElement("div");
  applySafeNoteHtml(container, rawHtml);
  return container.innerHTML;
}
