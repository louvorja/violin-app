import { defineAsyncComponent } from "vue";
import type { Module } from "@/types/Module"
import type { RibbonPage } from "@/types/Ribbon"
import { ModuleCategoryEnum } from "@/enums/ModuleCategoryEnum"
import { ModuleGroupEnum } from "@/enums/ModuleGroupEnum"
import { ICONS } from "@/config/Icons"
import { ModuleEnum } from "@/enums/ModuleEnum";
import { KEYS } from "@/constants/UserDataKeys";
import { getModulePath } from "@/helpers/ModulePath"
import { RIBBON_ACTION } from "./ribbonActions";
const RibbonSettings = defineAsyncComponent(
  () => import("@/modules/background_sound/components/RibbonSettings.vue")
);

const moduleId = ModuleEnum.BACKGROUND_SOUND;
const modulePath = getModulePath(moduleId);
const moduleCtxId = "ctx_" + moduleId;

export const module: Module = {
  id: moduleId,
  name: "Background Sound",
  description: `${modulePath}.description`,
  title: `${modulePath}.title`,
  icon: ICONS.MODULES.BACKGROUND_SOUND,
  color: "#00154d",
  showInMainMenu: true,
  category: ModuleCategoryEnum.WORSHIP,
  group: ModuleGroupEnum.MEDIA,
  order: 4,
  dependencies: [],
};

export const contextualPages: RibbonPage[] = [
  {
    id: `${moduleCtxId}`,
    title: `${modulePath}.ribbon.title_ctx`,
    contextual: true,
    activeOnModules: [moduleId],
    defaultModule: null,
    groups: [
      {
        id: `${moduleCtxId}_actions`,
        title: "ribbon.groups.actions",
        buttons: [
          {
            id: `${moduleId}_play`,
            icon: ICONS.PLAYER.PLAY_PAUSE,
            label: `${modulePath}.play`,
            action: `${moduleId}_${RIBBON_ACTION.PLAY}`,
            color: "#27ae60",
            stateBinding: {
              watchPath: KEYS.MODULES.BACKGROUND_SOUND.IS_PLAYING,
              iconOn: ICONS.PLAYER.PAUSE,
              iconOff: ICONS.PLAYER.PLAY,
              colorOn: "#e67e22",
              colorOff: "#27ae60",
              labelOn: `${modulePath}.pause`,
              labelOff: `${modulePath}.play`,
            },
          },
          {
            id: `${moduleId}_stop`,
            icon: ICONS.PLAYER.STOP,
            label: `${modulePath}.stop`,
            action: `${moduleId}_${RIBBON_ACTION.STOP}`,
            color: "#e74c3c",
          },
          {
            id: `${moduleId}_stop_immediately`,
            icon: ICONS.PLAYER.STOP_NOW,
            label: `${modulePath}.stop_immediately`,
            action: `${moduleId}_${RIBBON_ACTION.STOP_IMMEDIATELY}`,
            color: "#e74c3c",
          },
          {
            id: `${moduleId}_random`,
            icon: ICONS.PLAYER.SHUFFLE,
            label: `${modulePath}.play_random`,
            action: `${moduleId}_${RIBBON_ACTION.PLAY_RANDOM}`,
            color: "#1976d2",
          },
        ],
      },
      {
        id: `${moduleCtxId}_manage`,
        title: "ribbon.groups.manage",
        buttons: [
          {
            id: `${moduleId}_add_audio`,
            icon: ICONS.MEDIA.ADD,
            label: `${modulePath}.add_audio`,
            action: `${moduleId}_${RIBBON_ACTION.ADD_AUDIO}`,
            color: "#1976d2",
          },
          {
            id: `${moduleId}_manage_categories`,
            icon: ICONS.UI.TUNE,
            label: `shell.category.manage_categories`,
            action: `${moduleId}_${RIBBON_ACTION.MANAGE_CATEGORIES}`,
            color: "#1976d2",
          },
        ],
      },
      {
        id: `${moduleCtxId}_settings`,
        title: "ribbon.groups.settings",
        customCategory: RibbonSettings,
        modules: [moduleId],
      },
    ],
  },
];
