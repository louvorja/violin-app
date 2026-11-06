import { ModuleEnum } from "@/enums/ModuleEnum";
import { ICONS } from "@/config/Icons";

export interface StartupShortcutDefinition {
  descriptionKey: string;
  detailKey: string;
}

/** Atalhos do cheatsheet que fazem sentido como dica de abertura. */
export const STARTUP_SHORTCUT_TIPS: readonly StartupShortcutDefinition[] = [
  { descriptionKey: "hotkeys.f1", detailKey: "startup_tips.shortcut_details.f1" },
  { descriptionKey: "hotkeys.ctrl_k", detailKey: "startup_tips.shortcut_details.ctrl_k" },
  { descriptionKey: "hotkeys.ctrl_space", detailKey: "startup_tips.shortcut_details.ctrl_space" },
  { descriptionKey: "hotkeys.ctrl_b", detailKey: "startup_tips.shortcut_details.ctrl_b" },
  { descriptionKey: "hotkeys.ctrl_m", detailKey: "startup_tips.shortcut_details.ctrl_m" },
  { descriptionKey: "hotkeys.ctrl_o", detailKey: "startup_tips.shortcut_details.ctrl_o" },
  { descriptionKey: "hotkeys.ctrl_p", detailKey: "startup_tips.shortcut_details.ctrl_p" },
  { descriptionKey: "hotkeys.ctrl_tab", detailKey: "startup_tips.shortcut_details.ctrl_tab" },
  { descriptionKey: "hotkeys.ctrl_n", detailKey: "startup_tips.shortcut_details.ctrl_n" },
  {
    descriptionKey: "hotkeys.ctrl_shift_n",
    detailKey: "startup_tips.shortcut_details.ctrl_shift_n",
  },
  { descriptionKey: "hotkeys.ctrl_left", detailKey: "startup_tips.shortcut_details.ctrl_left" },
  { descriptionKey: "hotkeys.ctrl_right", detailKey: "startup_tips.shortcut_details.ctrl_right" },
  { descriptionKey: "hotkeys.space", detailKey: "startup_tips.shortcut_details.space" },
];

export const STARTUP_SHORTCUT_DESCRIPTIONS = STARTUP_SHORTCUT_TIPS.map((tip) => tip.descriptionKey);

export interface StartupFeatureTipDefinition {
  /** Chave em `startup_tips.features.<id>`. */
  id: string;
  icon: string;
}

export const STARTUP_FEATURE_TIPS: readonly StartupFeatureTipDefinition[] = [
  { id: "canva", icon: ICONS.UI.IMAGE_OUTLINE },
  { id: "libras", icon: ICONS.UI.LIBRAS_ON },
  { id: "multi_monitor", icon: ICONS.UI.MONITORS },
  { id: "remote_control", icon: ICONS.MODULES.REMOTE_CONTROL },
  { id: "network_projection", icon: ICONS.UI.IP_NETWORK },
  { id: "obs", icon: ICONS.SOCIAL.CAST },
  { id: "liturgy_transfer", icon: ICONS.UI.IMPORT_EXPORT },
  { id: "web_version", icon: ICONS.UI.WEB },
  { id: "storage_locations", icon: ICONS.UI.HARDDISK },
  { id: "custom_collections", icon: ICONS.MODULES.MUSICS },
  { id: "return_screen", icon: ICONS.PROJECTION.RETURN },
  { id: "scheduled_items", icon: ICONS.MODULES.SCHEDULED_ITEMS },
];

export interface StartupModuleTipDefinition {
  /** Chave em `startup_tips.items.<id>`. */
  id: string;
  moduleId: ModuleEnum;
}

export const STARTUP_MODULE_TIPS: readonly StartupModuleTipDefinition[] = [
  { id: "musics", moduleId: ModuleEnum.MUSICS },
  { id: "bible", moduleId: ModuleEnum.BIBLE },
  { id: "liturgy", moduleId: ModuleEnum.LITURGY },
  { id: "overlay", moduleId: ModuleEnum.OVERLAY },
  { id: "background_projection", moduleId: ModuleEnum.BACKGROUND_PROJECTION },
  { id: "background_sound", moduleId: ModuleEnum.BACKGROUND_SOUND },
  { id: "draw", moduleId: ModuleEnum.DRAW },
  { id: "media_library", moduleId: ModuleEnum.MEDIA_LIBRARY },
  { id: "slide_editor", moduleId: ModuleEnum.SLIDE_EDITOR },
  { id: "announcements", moduleId: ModuleEnum.ANNOUNCEMENTS },
  { id: "timer_worship", moduleId: ModuleEnum.TIMER_WORSHIP },
];
