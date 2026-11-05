import type { Module } from "@/types/Module";
import type { RibbonPage } from "@/types/Ribbon";
import { ModuleCategoryEnum } from "@/enums/ModuleCategoryEnum";
import { ModuleGroupEnum } from "@/enums/ModuleGroupEnum";
import { ICONS } from "@/config/Icons";
import { FONT } from "@/config/Fonts";
import { ModuleEnum } from "@/enums/ModuleEnum";
import { getModulePath } from "@/helpers/ModulePath";
import { KEYS } from "@/constants/UserDataKeys";

const moduleId = ModuleEnum.DRAW;
const modulePath = getModulePath(moduleId);
const moduleCtxId = "ctx_" + moduleId;

export const module: Module = {
  id: moduleId,
  name: "Sorteio",
  title: `${modulePath}.title`,
  description: `${modulePath}.description`,
  icon: ICONS.MODULES.DRAW,
  color: "#3498db",
  showInMainMenu: true,
  category: ModuleCategoryEnum.UTILITIES,
  group: ModuleGroupEnum.DRAWS,
  order: 0,
  customization: {
    font: { type: "font", default: FONT.PROJECTION.INHERIT },
    font_color: { type: "color", default: "#FFFFFF" },
    text_background_enabled: { type: "boolean", default: false },
    text_background_color: { type: "color", default: "transparent" },
    text_background_opacity: { type: "opacity", default: 100 },
    text_border_enabled: { type: "boolean", default: false },
    text_border_color: { type: "color", default: "#FFFFFF" },
    text_border_opacity: { type: "opacity", default: 100 },
    text_border_radius: { type: "radius", default: 0 },
    text_border_width: { type: "border-width", default: 2 },
    text_padding_x: { type: "padding", default: 0 },
    text_padding_y: { type: "padding", default: 0 },
    font_size: { type: "font-size", default: 50 },
    text_shadow: { type: "boolean", default: false },
    text_shadow_color: { type: "color", default: "#000000" },
    text_shadow_blur: { type: "font-size", default: 4 },
    background_color: { type: "color", default: "#000000" },
    border_spacing: { type: "border-spacing", default: 10 },
    vertical_align: { type: "v-align", default: "center" },
    horizontal_align: { type: "h-align", default: "center" },
    image: { type: "image", default: "" },
    image_opacity: { type: "opacity", default: 100 },
    image_fit: { type: "object-fit", default: "cover" },
  },
};

export const contextualPages: RibbonPage[] = [
  {
    id: moduleCtxId,
    title: `${modulePath}.ribbon.title_ctx`,
    contextual: true,
    activeOnModules: [moduleId],
    defaultModule: null,
    groups: [
      {
        id: moduleCtxId + "_actions",
        title: "ribbon.groups.actions",
        buttons: [
          {
            id: `${moduleId}_draw`,
            icon: ICONS.SORT.DICE,
            label: "ribbon.btn.draw_action",
            action: `${moduleId}_draw`,
            color: "#3498db",
          },
          {
            id: `${moduleId}_reset`,
            icon: ICONS.ACTIONS.RESTART,
            label: "ribbon.btn.draw_reset",
            action: `${moduleId}_reset`,
            color: "#7f8c8d",
          },
          {
            id: `${moduleId}_toggle`,
            icon: ICONS.PLAYER.PLAY_PAUSE,
            label: "",
            action: `${moduleId}_toggle`,
            color: "#3498db",
            stateBinding: {
              watchPath: KEYS.MODULES.DRAW.NAMES_RUNNING,
              iconOn: ICONS.PLAYER.STOP,
              iconOff: ICONS.PLAYER.PLAY,
              colorOn: "#e67e22",
              colorOff: "#27ae60",
              labelOn: `${modulePath}.actions.finish`,
              labelOff: `${modulePath}.actions.start`,
            },
          },
          {
            id: `${moduleId}_toggle_list`,
            icon: ICONS.FORMAT.LIST_BULLETED,
            label: `${modulePath}.ribbon.list`,
            action: `${moduleId}_toggle_list`,
            color: "#9c27b0",
            activePath: KEYS.MODULES.DRAW.LIST_OPEN,
          },
        ],
      },
      {
        id: moduleCtxId + "_mode",
        title: `${modulePath}.ribbon.type`,
        buttons: [
          {
            id: `${moduleId}_mode`,
            type: "select",
            optionKey: KEYS.MODULES.DRAW.MODE,
            label: `${modulePath}.ribbon.mode`,
            defaultValue: "number",
            options: [
              { value: "number", label: `${modulePath}.modes.numbers` },
              { value: "names", label: `${modulePath}.modes.names` },
            ],
          },
          {
            id: `${moduleId}_show_drawn_history`,
            type: "switch",
            optionKey: KEYS.MODULES.DRAW.SHOW_DRAWN_HISTORY,
            label: `${modulePath}.ribbon.show_drawn_history`,
            defaultValue: false,
          },
        ],
      },
      {
        id: moduleCtxId + "_effects",
        title: `${modulePath}.ribbon.effects`,
        buttons: [
          {
            id: `${moduleId}_effect_duration`,
            type: "slider",
            optionKey: KEYS.MODULES.DRAW.EFFECT_DURATION,
            label: `${modulePath}.ribbon.effect_duration`,
            defaultValue: 2000,
            min: 500,
            max: 10000,
            step: 100,
          },
        ],
      },
      {
        id: moduleCtxId + "_format",
        title: "ribbon.groups.format",
        buttons: [
          {
            id: `${moduleId}_toggle_format`,
            icon: ICONS.ACTIONS.FORMAT,
            label: "ribbon.btn.format",
            action: `${moduleId}_toggle_format`,
            color: "#1b4f8a",
          },
        ],
      },
      {
        id: moduleCtxId + "_screen",
        title: "ribbon.groups.projection",
        buttons: [
          {
            id: `${moduleId}_project`,
            type: "screen",
            feature: moduleId,
            route: `/projection/module?module=${moduleId}`,
            icon: ICONS.PROJECTION.SCREEN_OUTLINE,
            label: "ribbon.btn.project",
            color: "#1b4f8a",
          },
        ],
      },
    ],
  },
];
