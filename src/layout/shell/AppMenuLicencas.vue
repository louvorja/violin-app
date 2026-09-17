<template>
  <div class="licenses">
    <div class="licenses-hero">
      <div class="licenses-logo">
        <LjLogo :size="72" />
      </div>
      <div class="licenses-hero-text">
        <h1 class="licenses-product">
          Louvor
          <b>JA</b>
        </h1>
        <p class="licenses-tagline">{{ $t("licenses.intro") }}</p>
      </div>
    </div>

    <h4 class="licenses-subtitle">{{ $t("licenses.libraries") }}</h4>
    <div class="licenses-grid">
      <div v-for="lib in libraries" :key="lib.name" class="licenses-card">
        <div class="licenses-card-header">
          <span class="licenses-card-name">{{ lib.name }}</span>
          <span class="licenses-card-version">{{ lib.version }}</span>
        </div>
        <div class="licenses-card-footer">
          <span class="licenses-badge" :class="`licenses-badge--${badgeType(lib.license)}`">
            {{ lib.license }}
          </span>
          <a
            v-if="lib.url"
            :href="lib.url"
            class="licenses-card-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ domain(lib.url) }}
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import LjLogo from "@/components/LjLogo.vue";

const libraries = [
  { name: "Vue", version: "3.5", license: "MIT", url: "https://vuejs.org" },
  { name: "Vue Router", version: "5.0", license: "MIT", url: "https://router.vuejs.org" },
  { name: "Vue I18n", version: "11.2", license: "MIT", url: "https://vue-i18n.intlify.dev" },
  { name: "Pinia", version: "3.0", license: "MIT", url: "https://pinia.vuejs.org" },
  { name: "Reka UI", version: "2.10", license: "MIT", url: "https://reka-ui.com" },
  { name: "Tabler Icons", version: "3.46", license: "MIT", url: "https://tabler.io/icons" },
  {
    name: "Vuedraggable",
    version: "4.1",
    license: "MIT",
    url: "https://sortablejs.github.io/vue.draggable.next",
  },
  {
    name: "Vue Fullscreen",
    version: "3.1",
    license: "MIT",
    url: "https://github.com/mirari/vue-fullscreen",
  },
  { name: "VLibras", version: "2.3", license: "MIT", url: "https://vlibras.gov.br" },
  { name: "Fuse.js", version: "7.3", license: "Apache-2.0", url: "https://www.fusejs.io" },
  { name: "idb", version: "8.0", license: "ISC", url: "https://github.com/jakearchibald/idb" },
  { name: "JSZip", version: "3.10", license: "MIT / GPL-3.0", url: "https://stuk.github.io/jszip" },
  {
    name: "PDF.js",
    version: "6.1",
    license: "Apache-2.0",
    url: "https://mozilla.github.io/pdf.js",
  },
  { name: "PostHog", version: "1.427", license: "MIT / Apache-2.0", url: "https://posthog.com" },
  {
    name: "qr-code-styling",
    version: "1.5",
    license: "MIT",
    url: "https://github.com/nicedoc/qr-code-styling",
  },
  {
    name: "HEIC to",
    version: "1.5",
    license: "LGPL-3.0",
    url: "https://github.com/nickmessing/heic-to",
  },
  { name: "Express", version: "4.22", license: "MIT", url: "https://expressjs.com" },
  { name: "Electron", version: "41.4", license: "MIT", url: "https://www.electronjs.org" },
  { name: "Vite", version: "7.3", license: "MIT", url: "https://vitejs.dev" },
  { name: "Anime.js", version: "3.2", license: "MIT", url: "https://animejs.com" },
];

function badgeType(license) {
  if (license.includes("LGPL")) return "copyleft";
  if (license.includes("GPL")) return "copyleft";
  if (license.includes("Apache")) return "apache";
  return "mit";
}

function domain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
</script>

<style scoped>
.licenses-hero {
  display: flex;
  align-items: center;
  gap: var(--lj-space-6);
  padding-bottom: var(--lj-space-7);
  border-bottom: 1px solid var(--lj-surface-border);
  margin-bottom: var(--lj-space-7);
}

.licenses-logo {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--lj-navy-darker) 0%, var(--lj-navy) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 16px var(--lj-navy-alpha-30);
  padding: var(--lj-space-5);
}

.licenses-product {
  font-size: 36px;
  font-weight: var(--lj-weight-regular);
  margin: 0;
  letter-spacing: -0.01em;
}

.licenses-product b {
  color: var(--lj-color-cover-gold);
  font-weight: var(--lj-weight-bold);
}

.licenses-tagline {
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
  margin: var(--lj-space-2) 0 0;
  line-height: 1.5;
}

.licenses-subtitle {
  font-size: var(--lj-text-sm);
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 var(--lj-space-4);
}

.licenses-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--lj-space-3);
}

.licenses-card {
  padding: var(--lj-space-4);
  border-radius: var(--lj-radius-sm);
  border: 1px solid var(--lj-surface-border);
  background: var(--lj-surface);
  display: flex;
  flex-direction: column;
  gap: var(--lj-space-3);
  transition: border-color var(--lj-transition-fast);
}

.licenses-card:hover {
  border-color: var(--lj-accent);
}

.licenses-card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--lj-space-2);
}

.licenses-card-name {
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-text);
  font-size: var(--lj-text-sm);
}

.licenses-card-version {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-muted);
  font-variant-numeric: tabular-nums;
}

.licenses-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lj-space-2);
}

.licenses-badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: var(--lj-weight-semibold);
  letter-spacing: 0.3px;
  padding: 2px 6px;
  border-radius: var(--lj-radius-xs);
  line-height: 1.4;
  white-space: nowrap;
}

.licenses-badge--mit {
  background: rgba(var(--lj-color-success-rgb, 34, 139, 34), 0.12);
  color: var(--lj-color-success, #228b22);
}

.licenses-badge--apache {
  background: rgba(var(--lj-color-info-rgb, 70, 130, 180), 0.12);
  color: var(--lj-color-info, #4682b4);
}

.licenses-badge--copyleft {
  background: rgba(var(--lj-color-warning-rgb, 210, 105, 30), 0.12);
  color: var(--lj-color-warning, #d2691e);
}

.licenses-card-link {
  font-size: var(--lj-text-xs);
  color: var(--lj-accent);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.licenses-card-link:hover {
  text-decoration: underline;
}
</style>
