<template>
  <LjCard class="contributor-card" flush>
    <div class="contributor-card__body">
      <div class="contributor-card__avatar">
        <img
          v-if="currentSrc && !showFallbackAvatar"
          class="contributor-card__photo"
          :src="currentSrc"
          alt=""
          @error="onAvatarError"
        />
        <Icon v-else :icon="ICONS.UI.ACCOUNT" :size="36" class="contributor-card__avatar-icon" />
      </div>

      <div class="contributor-card__info">
        <div class="contributor-card__name">{{ contributor.name }}</div>
        <div v-if="contributor.description" class="contributor-card__description">
          <template v-if="isRoleContribuitor(contributor.description)">
            <LjTooltip
              v-for="role in contributor.description"
              :key="role.name"
              :text="role.name"
              side="bottom"
              :delay="300"
            >
              <span class="contributor-card__role">
                <Icon :icon="role.icon" :color="role.color" :size="18" />
              </span>
            </LjTooltip>
          </template>
          <template v-else>{{ contributor.description }}</template>
        </div>
      </div>
    </div>

    <div v-if="hasLinks" class="contributor-card__links">
      <a
        v-for="link in links"
        :key="link.id"
        class="contributor-card__link"
        :href="link.href"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icon :icon="link.icon" :size="18" />
      </a>
    </div>
  </LjCard>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import Icon from "@/components/Icon.vue";
import { LjCard, LjTooltip } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { Contributors, RoleContribuitor } from "@/config/Contributors";

interface ContributorLink {
  id: string;
  href: string;
  icon: string;
}

const props = defineProps<{
  contributor: Contributors;
}>();

const avatarFallbackIndex = ref(0);
const showFallbackAvatar = ref(false);

function isRoleContribuitor(d: RoleContribuitor[] | string): d is RoleContribuitor[] {
  return Array.isArray(d) && d.length > 0 && typeof d[0] === "object";
}

const avatarSources = computed<string[]>(() => {
  const c = props.contributor;
  const sources: string[] = [];
  if (c.image) sources.push(c.image);
  if (c.github) sources.push(`https://github.com/${c.github}.png`);
  if (c.facebook) sources.push(`https://graph.facebook.com/${c.facebook}/picture?type=square`);
  if (c.website) {
    const domain = c.website.replace(/^https?:\/\//, "").split("/")[0];
    sources.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
  }
  return sources;
});

const currentSrc = computed<string | null>(() => {
  if (showFallbackAvatar.value) return null;
  return avatarSources.value[avatarFallbackIndex.value] ?? null;
});

function onAvatarError(): void {
  const next = avatarFallbackIndex.value + 1;
  if (next < avatarSources.value.length) {
    avatarFallbackIndex.value = next;
  } else {
    showFallbackAvatar.value = true;
  }
}

const hasLinks = computed<boolean>(() => {
  const c = props.contributor;
  return !!(c.github || c.linkedin || c.facebook || c.instagram || c.website || c.email);
});

/* Mesma ordem em que os botões apareciam antes da migração. */
const links = computed<ContributorLink[]>(() => {
  const c = props.contributor;
  const list: ContributorLink[] = [];
  if (c.github)
    list.push({ id: "github", href: `https://github.com/${c.github}`, icon: ICONS.SOCIAL.GITHUB });
  if (c.linkedin)
    list.push({
      id: "linkedin",
      href: `https://linkedin.com/in/${c.linkedin}`,
      icon: ICONS.SOCIAL.LINKEDIN,
    });
  if (c.facebook)
    list.push({
      id: "facebook",
      href: `https://facebook.com/${c.facebook}`,
      icon: ICONS.SOCIAL.FACEBOOK,
    });
  if (c.instagram)
    list.push({
      id: "instagram",
      href: `https://instagram.com/${c.instagram}`,
      icon: ICONS.SOCIAL.INSTAGRAM,
    });
  if (c.x) list.push({ id: "x", href: `https://x.com/${c.x}`, icon: ICONS.SOCIAL.X });
  if (c.website) list.push({ id: "website", href: c.website, icon: ICONS.UI.WEB });
  if (c.whatsapp)
    list.push({
      id: "whatsapp",
      href: `https://wa.me/${c.whatsapp}`,
      icon: ICONS.SOCIAL.WHATSAPP,
    });
  if (c.website2) list.push({ id: "website2", href: c.website2, icon: ICONS.UI.WEB });
  if (c.email)
    list.push({ id: "email", href: `mailto:${c.email}`, icon: ICONS.SOCIAL.EMAIL_OUTLINE });
  return list;
});
</script>

<style scoped>
.contributor-card {
  height: 100%;
  transition:
    box-shadow var(--lj-transition-normal),
    border-color var(--lj-transition-normal);
}

.contributor-card:hover {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-shadow-2);
}

/* O corpo do LjCard vem sem padding (`flush`); aqui ele vira a coluna que
   empurra a fileira de links para o rodapé do cartão. */
.contributor-card :deep(.lj-card__body) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

/* Icon.vue aplica drop-shadow por padrão — some sobre fundo de projeção,
   borra sobre superfície de UI. */
.contributor-card .lj-icon {
  filter: none;
}

.contributor-card__body {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 14px;
  padding: var(--lj-space-6) var(--lj-space-6) var(--lj-space-5);
}

.contributor-card__avatar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  overflow: hidden;
  background: var(--lj-surface-bg-soft);
  border: 2px solid var(--lj-surface-border);
  border-radius: 50%;
}

.contributor-card__photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.contributor-card__avatar-icon {
  color: var(--lj-text-subtle);
}

.contributor-card__info {
  min-width: 0;
  flex: 1;
}

.contributor-card__name {
  font-size: 15px;
  font-weight: var(--lj-weight-semibold);
  color: var(--lj-text);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contributor-card__description {
  font-size: var(--lj-text-md);
  color: var(--lj-text-muted);
  line-height: 1.4;
  margin-top: var(--lj-space-1);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.contributor-card__role {
  display: inline-flex;
  margin: var(--lj-space-2);
}

.contributor-card__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lj-space-1);
  padding: 0 var(--lj-space-4) var(--lj-space-4);
  justify-content: center;
}

/* Não é LjButton: precisa ser âncora de verdade (abrir em nova aba, copiar
   endereço, mailto). O visual segue o `ghost` do catálogo. */
.contributor-card__link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--lj-text-muted);
  border: 1px solid transparent;
  border-radius: var(--lj-ui-radius);
  outline: none;
  transition:
    background var(--lj-transition-fast),
    color var(--lj-transition-fast),
    box-shadow var(--lj-transition-fast);
}

.contributor-card__link:hover {
  background: var(--lj-surface-bg-hover);
  color: var(--lj-text);
}

.contributor-card__link:focus-visible {
  border-color: var(--lj-ui-accent);
  box-shadow: var(--lj-ui-focus);
}
</style>
