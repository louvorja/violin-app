<template>
  <section class="desktop-download" :aria-labelledby="titleId">
    <div class="desktop-download__mark" aria-hidden="true">
      <img src="/ico/favicon-180x180.png" alt="" />
    </div>

    <div class="desktop-download__content">
      <h1 :id="titleId" class="desktop-download__title">
        {{ t("shell.desktop_download.title") }}
      </h1>
      <p class="desktop-download__description">
        {{ t("shell.desktop_download.description") }}
      </p>

      <div class="desktop-download__actions">
        <a
          class="desktop-download__primary"
          :href="downloadUrl"
          :target="isDirectDownload ? undefined : '_blank'"
          :rel="isDirectDownload ? undefined : 'noopener noreferrer'"
        >
          <LjIcon :icon="ICONS.UI.INSTALL" :size="20" />
          <span>{{ primaryLabel }}</span>
        </a>

        <a
          v-if="isDirectDownload"
          class="desktop-download__secondary"
          :href="releaseUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{{ t("shell.desktop_download.all_systems") }}</span>
          <LjIcon :icon="ICONS.UI.OPEN_IN_NEW" :size="16" />
        </a>
      </div>

      <p class="desktop-download__meta">
        {{ t("shell.desktop_download.available_for") }}
        <span aria-hidden="true">·</span>
        {{ t("shell.desktop_download.version", { version }) }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LjIcon } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import packageJson from "@root/package.json";
import {
  desktopDownloadUrl,
  desktopReleaseUrl,
  detectDesktopDownloadPlatform,
} from "@/helpers/DesktopDownload";

const { t } = useI18n();
const titleId = "desktop-download-title";
const version = packageJson.version;
const platform = detectDesktopDownloadPlatform(navigator);
const isDirectDownload = platform === "windows" || platform === "macos";
const downloadUrl = desktopDownloadUrl(platform, version);
const releaseUrl = desktopReleaseUrl(version);

const primaryLabel = computed(() => {
  if (platform === "other") return t("shell.desktop_download.view_downloads");
  if (platform === "linux") {
    return t("shell.desktop_download.view_downloads_for", {
      platform: t("shell.desktop_download.platform.linux"),
    });
  }
  return t("shell.desktop_download.download_for", {
    platform: t(`shell.desktop_download.platform.${platform}`),
  });
});
</script>

<style scoped>
.desktop-download {
  position: absolute;
  z-index: 1;
  inset: 0;
  display: grid;
  grid-template-columns: 128px minmax(0, 1fr);
  align-items: center;
  width: min(680px, calc(100% - 48px));
  height: fit-content;
  margin: auto;
  padding: var(--lj-space-8);
  gap: var(--lj-space-8);
  border: 1px solid var(--lj-white-alpha-18);
  border-radius: var(--lj-radius-lg);
  background: var(--lj-black-alpha-18);
  box-shadow: var(--lj-shadow-3);
  color: var(--lj-text-on-navy);
}

.desktop-download__mark {
  display: grid;
  width: 128px;
  height: 128px;
  place-items: center;
}

.desktop-download__mark img {
  display: block;
  width: 112px;
  height: 112px;
}

.desktop-download__content {
  min-width: 0;
}

.desktop-download__title {
  margin: 0;
  color: var(--lj-text-on-navy);
  font-size: var(--lj-text-2xl);
  font-weight: var(--lj-weight-semibold);
  line-height: 1.2;
}

.desktop-download__description {
  max-width: 50ch;
  margin: var(--lj-space-4) 0 0;
  color: var(--lj-text-on-navy-muted);
  font-size: var(--lj-text-md);
  line-height: 1.55;
}

.desktop-download__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--lj-space-5);
  margin-top: var(--lj-space-7);
}

.desktop-download__primary,
.desktop-download__secondary {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: var(--lj-space-4);
  border-radius: var(--lj-radius-sm);
  font-size: var(--lj-text-md);
  font-weight: var(--lj-weight-semibold);
  text-decoration: none;
  transition:
    background-color 120ms var(--lj-ease-out),
    border-color 120ms var(--lj-ease-out);
}

.desktop-download__primary {
  padding: 0 var(--lj-space-6);
  border: 1px solid var(--lj-orange);
  background: var(--lj-orange);
  color: var(--lj-white);
}

.desktop-download__primary:hover {
  border-color: var(--lj-orange-dark);
  background: var(--lj-orange-dark);
}

.desktop-download__secondary {
  padding: 0 var(--lj-space-4);
  border: 1px solid transparent;
  color: var(--lj-text-on-navy);
}

.desktop-download__secondary:hover {
  border-color: var(--lj-white-alpha-18);
  background: var(--lj-white-alpha-08);
}

.desktop-download__primary:focus-visible,
.desktop-download__secondary:focus-visible {
  outline: 2px solid var(--lj-white);
  outline-offset: 2px;
}

.desktop-download__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-4);
  margin: var(--lj-space-5) 0 0;
  color: var(--lj-text-on-navy-muted);
  font-size: var(--lj-text-sm);
}

@media (max-width: 700px) {
  .desktop-download {
    grid-template-columns: 72px minmax(0, 1fr);
    width: calc(100% - 32px);
    padding: var(--lj-space-6);
    gap: var(--lj-space-6);
  }

  .desktop-download__mark {
    align-self: start;
    width: 72px;
    height: 72px;
  }

  .desktop-download__mark img {
    width: 72px;
    height: 72px;
  }
}

@media (max-width: 480px) {
  .desktop-download {
    grid-template-columns: 1fr;
    text-align: center;
  }

  .desktop-download__mark {
    margin-inline: auto;
  }

  .desktop-download__description {
    margin-inline: auto;
  }

  .desktop-download__actions,
  .desktop-download__meta {
    justify-content: center;
  }

  .desktop-download__primary {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .desktop-download__primary,
  .desktop-download__secondary {
    transition: none;
  }
}
</style>
