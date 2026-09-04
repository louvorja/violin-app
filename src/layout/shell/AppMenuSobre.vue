<template>
  <div class="about">
    <div class="about-top">
      <div class="about-top__main">
        <LjCard>
          <div class="about-hero">
            <div class="about-logo">
              <LjLogo :size="72" />
            </div>
            <div class="about-hero-text">
              <h1 class="about-product">
                Louvor
                <b>JA</b>
              </h1>
              <p class="about-tagline">{{ $t("about.tagline") }}</p>
            </div>
          </div>
        </LjCard>
        <p class="about-credits">{{ $t("about.credits") }}</p>
      </div>

      <div class="about-top__aside">
        <LjCard>
          <div class="about-info">
            <div class="about-info-row">
              <span class="about-info-label">{{ $t("about.version") }}</span>
              <span class="about-info-value">{{ versionLabel }}</span>
            </div>
            <div class="about-info-row">
              <span class="about-info-label">{{ $t("about.build") }}</span>
              <span class="about-info-value">
                {{ buildInfo }}
              </span>
            </div>
            <div class="about-info-row">
              <span class="about-info-label">{{ $t("about.platform") }}</span>
              <span class="about-info-value">{{ platformLabel }}</span>
            </div>
          </div>
        </LjCard>
      </div>
    </div>

    <div class="about-actions">
      <a
        class="about-link"
        href="https://www.louvorja.com.br"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon :icon="ICONS.UI.WEB" :size="16" />
        {{ $t("about.links.website") }}
      </a>
      <a
        class="about-link"
        href="https://app.louvorja.com.br"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon :icon="ICONS.SOCIAL.CAST" :size="16" />
        {{ $t("about.links.online") }}
      </a>
      <a class="about-link" href="mailto:contato@louvorja.com.br" rel="noopener noreferrer">
        <Icon :icon="ICONS.SOCIAL.EMAIL" :size="16" />
        {{ $t("about.links.email") }}
      </a>
      <a
        class="about-link"
        href="https://www.facebook.com/louvorja"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon
          :icon="ICONS.SOCIAL.FACEBOOK"
          :size="16"
          class="about-link__icon about-link__icon--facebook"
        />
        {{ $t("about.links.facebook") }}
      </a>
      <a
        class="about-link"
        href="https://www.instagram.com/louvorja.app"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon
          :icon="ICONS.SOCIAL.INSTAGRAM"
          :size="16"
          class="about-link__icon about-link__icon--instagram"
        />
        {{ $t("about.links.instagram") }}
      </a>
      <a
        class="about-link"
        href="https://www.louvorja.com.br/whatsapp"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon
          :icon="ICONS.SOCIAL.WHATSAPP"
          :size="16"
          class="about-link__icon about-link__icon--whatsapp"
        />
        {{ $t("about.links.whatsapp") }}
      </a>
      <a
        class="about-link"
        href="https://louvorja.com.br/telegram"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon
          :icon="ICONS.SOCIAL.TELEGRAM"
          :size="16"
          class="about-link-icon--telegram about-link__icon about-link__icon--telegram"
        />
        {{ $t("about.links.telegram") }}
      </a>
      <a
        class="about-link"
        href="https://github.com/louvorja/violin-app/issues"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon :icon="ICONS.UI.BUG" :size="16" />
        {{ $t("shell.appmenu_items.feedback") }}
      </a>
    </div>

    <hr class="about-divider" />

    <h2 class="about-section-title">{{ $t("about.contributors.title") }}</h2>

    <template v-for="cat in contributors" :key="cat.name">
      <section v-if="cat.contributors.length > 0" class="about-category">
        <h3 class="about-category-title">{{ $t(cat.name) }}</h3>
        <div class="about-contributors">
          <ContributorCard
            v-for="contrib in cat.contributors"
            :key="contrib.name"
            :contributor="contrib"
          />
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import packageJson from "@root/package.json";
import Platform from "@/helpers/Platform";
import $database from "@/helpers/Database";
import Icon from "@/components/Icon.vue";
import { LjCard } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import LjLogo from "@/components/LjLogo.vue";
import ContributorCard from "@/components/ContributorCard.vue";
import { CONTRIBUTORS } from "@/config/Contributors";

const dbVersion = ref(0);

const versionLabel = computed(() => `${packageJson.version}-${dbVersion.value}`);

const buildInfo = computed(() => {
  const parts = [];
  if (Platform.isDesktop) {
    parts.push("Desktop");
    if (Platform.electronVersion) parts.push(`Electron ${Platform.electronVersion}`);
  } else {
    parts.push("Web/PWA");
  }
  return parts.join(" · ");
});

const platformLabel = computed(() => {
  const map = { darwin: "macOS", win32: "Windows", linux: "Linux" };
  return map[Platform.platform] || (Platform.isDesktop ? "Desktop" : "Browser");
});

const contributors = CONTRIBUTORS;

async function loadDBVersion() {
  try {
    const config = await $database.get("config");
    dbVersion.value = config?.version_number ?? "?";
  } catch {
    dbVersion.value = "?";
  }
}

onMounted(loadDBVersion);
</script>

<style scoped>
/* Cada rede tem a própria cor — era assim antes da migração, e o ícone
   monocromático perde o reconhecimento imediato. */
.about-link__icon--facebook {
  color: var(--lj-brand-facebook);
}
.about-link__icon--instagram {
  color: var(--lj-brand-instagram);
}
.about-link__icon--whatsapp {
  color: var(--lj-brand-whatsapp);
}
.about-link__icon--telegram {
  color: var(--lj-brand-telegram);
}

.about {
  font-family: var(--lj-font-shell);
  color: var(--lj-text);
}

/* Grade do topo — substitui v-row/v-col (8/4 colunas de 12). */
.about-top {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--lj-space-8);
  margin-bottom: var(--lj-space-8);
}

.about-hero {
  display: flex;
  align-items: center;
  gap: var(--lj-space-6);
  padding-bottom: var(--lj-space-7);
  border-bottom: 1px solid var(--lj-surface-border);
  margin-bottom: var(--lj-space-7);
}

.about-logo {
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

/* Display do hero: a escala tipográfica dos tokens para em 22px
   (--lj-text-2xl), então o tamanho da marca fica explícito aqui. */
.about-product {
  font-size: 36px;
  font-weight: var(--lj-weight-regular);
  margin: 0;
  letter-spacing: -0.01em;
}

.about-product b {
  color: var(--lj-color-cover-gold);
  font-weight: var(--lj-weight-bold);
}

.about-tagline {
  font-size: var(--lj-text-base);
  color: var(--lj-text-muted);
  margin: var(--lj-space-2) 0 0;
}

.about-info {
  margin-bottom: var(--lj-space-7);
}

.about-info-row {
  display: flex;
  align-items: center;
  padding: var(--lj-space-3) 0;
  border-bottom: 1px solid var(--lj-surface-divider);
  font-size: var(--lj-text-base);
}

.about-info-row:last-child {
  border-bottom: none;
}

.about-info-label {
  flex: 0 0 auto;
  min-width: 140px;
  color: var(--lj-text-muted);
}

.about-info-value {
  font-weight: var(--lj-weight-medium);
  font-variant-numeric: tabular-nums;
}

.about-actions {
  display: flex;
  gap: var(--lj-space-5);
  margin-bottom: var(--lj-space-7);
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: var(--lj-space-2);
  text-decoration: none;
  color: var(--lj-link-color);
  font-size: var(--lj-text-base);
  font-weight: var(--lj-weight-medium);
  padding: var(--lj-space-2) var(--lj-space-2);
  background: var(--lj-surface-bg-soft);
  border: var(--lj-ui-border);
  border-radius: var(--lj-ui-radius);
  transition:
    background var(--lj-transition-fast),
    border-color var(--lj-transition-fast);
}

.about-link:hover {
  background: var(--lj-surface-bg-hover);
  border-color: var(--lj-ui-accent);
}

.about-link:focus-visible {
  outline: none;
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}

/* O avião de papel do Telegram vinha girado pela classe utilitária do
   @mdi/font; aqui a rotação é do próprio ícone. */
.about-link-icon--telegram {
  transform: rotate(-45deg);
}

.about-credits {
  font-size: var(--lj-text-sm);
  color: var(--lj-text-subtle);
  font-style: italic;
  margin: var(--lj-space-5) 0 0;
}

/* Divisor — substitui v-divider. */
.about-divider {
  border: none;
  border-top: 1px solid var(--lj-surface-border);
  margin: var(--lj-space-6) 0;
}

.about-section-title {
  font-size: var(--lj-text-2xl);
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-text);
  margin: 0 0 var(--lj-space-4);
}

.about-category {
  margin-top: var(--lj-space-8);
}

.about-category-title {
  font-size: var(--lj-text-lg);
  font-weight: var(--lj-weight-medium);
  color: var(--lj-text-muted);
  margin: 0 0 var(--lj-space-2);
  padding-bottom: var(--lj-space-2);
  border-bottom: 1px solid var(--lj-surface-divider);
}

/* Grade de contribuidores — mesmos pontos de quebra do grid do Vuetify
   (sm 600 / md 960 / lg 1280) que os cartões usavam via v-col. */
.about-contributors {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--lj-space-8);
}

@media (min-width: 600px) {
  .about-contributors {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 960px) {
  .about-contributors {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (min-width: 1280px) {
  .about-contributors {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
