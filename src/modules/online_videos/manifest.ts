import type { Module } from "@/types/Module"
import type { RibbonPage } from "@/types/Ribbon"
import { ModuleCategoryEnum } from "@/enums/ModuleCategoryEnum"
import { ModuleGroupEnum } from "@/enums/ModuleGroupEnum"
import { ICONS } from "@/config/Icons"
import { ModuleEnum } from "@/enums/ModuleEnum"
import $modules from "@/helpers/Modules"
import { KEYS } from "@/constants/UserDataKeys"

const moduleId = ModuleEnum.ONLINE_VIDEOS;
const modulePath = $modules.getPath(moduleId);
const moduleCtxId = "ctx_" + moduleId;

export const module: Module = {
  id: moduleId,
  title: `${modulePath}.title`,
  name: "Vídeos On-line",
  description: `${modulePath}.description`,
  icon: ICONS.MODULES.ONLINE_VIDEOS,
  color: "#e74c3c",
  showInMainMenu: true,
  category: ModuleCategoryEnum.COLLECTIONS,
  group: ModuleGroupEnum.ONLINE_VIDEOS,
  order: 1,
  dependencies: [],
  customization: {},
}

export const contextualPages: RibbonPage[] = [
  {
    id: moduleCtxId,
    title: `${modulePath}.ribbon.title_ctx`,
    contextual: true,
    activeOnModules: [moduleId],
    defaultModule: null,
    groups: [
      {
        id: `${moduleCtxId}_settings`,
        title: "ribbon.groups.settings",
        buttons: [
          {
            id: `${moduleId}_settings`,
            icon: ICONS.UI.OPTIONS,
            label: "ribbon.btn.settings",
            action: `${moduleId}_settings`,
          },
          {
            id: `${moduleId}_monitor`,
            type: "select",
            feature: "online_video",
            label: `${modulePath}.ribbon.monitor`,
          },
          {
            id: `${moduleId}_show_return`,
            type: "checkbox",
            optionKey: KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN,
            label: `${modulePath}.ribbon.show_return`,
          },
          {
            id: `${moduleId}_return_monitor`,
            type: "select",
            feature: "online_video_return",
            optionKey: KEYS.OPTIONS.DISPLAYS.ONLINE_VIDEO_RETURN,
            label: `${modulePath}.ribbon.return_monitor`,
            defaultValue: "",
            dependsOnOption: {
              path: KEYS.OPTIONS.ONLINE_VIDEO_PROJECTION.SHOW_RETURN,
              value: "true",
            },
          },
        ],
      },
      {
        id: "ctx_online_videos_actions",
        title: "ribbon.groups.actions",
        buttons: [
          {
            id: `${moduleId}_personal_url`,
            type: "action_input",
            icon: ICONS.UI.OPEN_IN_NEW,
            label: "ribbon.btn.online_videos_personal_url",
            placeholder: "ribbon.btn.online_videos_personal_url_placeholder",
            action: `${moduleId}_personal_url`,
            color: "#3498db",
          },
          {
            id: `${moduleId}_toggle`,
            icon: ICONS.PROJECTION.START,
            label: `${modulePath}.ribbon.project`,
            action: `${moduleId}_toggle`,
            color: "#27ae60",
            stateBinding: {
              watchPath: KEYS.MODULES.ONLINE_VIDEOS.IS_PROJECTING,
              iconOn: ICONS.PROJECTION.STOP,
              iconOff: ICONS.PROJECTION.START,
              colorOn: "#e74c3c",
              colorOff: "#27ae60",
              labelOn: `${modulePath}.ribbon.project_stop`,
              labelOff: `${modulePath}.ribbon.project`,
            },
          },
        ],
      },
    ],
  },
];
