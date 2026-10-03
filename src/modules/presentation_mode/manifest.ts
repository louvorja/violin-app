import { defineAsyncComponent } from "vue"
import type { Module } from "@/types/Module"
import type { RibbonPage } from "@/types/Ribbon"
import { ModuleCategoryEnum } from "@/enums/ModuleCategoryEnum"
import { ModuleGroupEnum } from "@/enums/ModuleGroupEnum"
import { ICONS } from "@/config/Icons"
import { ModuleEnum } from "@/enums/ModuleEnum"
import { getModulePath } from "@/helpers/ModulePath"
import { KEYS } from "@/constants/UserDataKeys"

const MonitorRolesGroup = defineAsyncComponent(() => import("./components/MonitorRolesGroup.vue"));

const moduleId = ModuleEnum.PRESENTATION_MODE;
const modulePath = getModulePath(moduleId);
const moduleCtxId = "ctx_" + moduleId;
const btn = `${modulePath}.ribbon.btn`;

export const module: Module = {
  id: moduleId,
  name: "Modo apresentação",
  title: `${modulePath}.title`,
  description: `${modulePath}.description`,
  icon: ICONS.MODULES.PRESENTATION_MODE,
  color: "#00897b",
  showInMainMenu: true,
  shell: {
    expandedKey: KEYS.MODULES.PRESENTATION_MODE.EXPANDED,
    hidesLiturgySidebar: true,
    hidesFooterPlayer: true,
    immediateEscape: true,
  },
  category: ModuleCategoryEnum.WORSHIP,
  group: ModuleGroupEnum.CHURCH,
  order: 3,
}

// As ações seguem `presentation_mode_<acao>`: o RibbonBar só repassa ao módulo
// os prefixos que conhece, e o Index.vue despacha pelo sufixo.
export const contextualPages: RibbonPage[] = [
  {
    id: moduleCtxId,
    title: `${modulePath}.ribbon.title_ctx`,
    contextual: true,
    activeOnModules: [moduleId],
    defaultModule: null,
    groups: [
      {
        id: `${moduleCtxId}_presentation`,
        title: "ribbon.groups.presentation",
        buttons: [
          { id: `${moduleId}_start`, icon: ICONS.PROJECTION.START, label: `${btn}.start`, action: `${moduleId}_start`, color: "#27ae60", enabledWhen: KEYS.MODULES.PRESENTATION_MODE.CAN_START },
          { id: `${moduleId}_stop`, icon: ICONS.PROJECTION.STOP, label: `${btn}.stop`, action: `${moduleId}_stop`, color: "#e74c3c", enabledWhen: KEYS.MODULES.PRESENTATION_MODE.CAN_STOP },
          { id: `${moduleId}_take_off`, icon: ICONS.PLAYER.STOP_CIRCLE, label: `${btn}.take_off`, action: `${moduleId}_take_off`, color: "#e67e22", enabledWhen: KEYS.MODULES.PRESENTATION_MODE.CAN_TAKE_OFF },
          { id: `${moduleId}_clear`, icon: ICONS.PROJECTION.CLEAN, label: `${btn}.clear`, action: `${moduleId}_clear`, color: "#f39c12", enabledWhen: KEYS.MODULES.PRESENTATION_MODE.CAN_CLEAR },
        ],
      },
      {
        id: `${moduleCtxId}_program`,
        title: "ribbon.groups.program",
        buttons: [
          { id: `${moduleId}_new_session`, icon: ICONS.ACTIONS.ADD_BOX, label: `${btn}.new_session`, action: `${moduleId}_new_session`, color: "#1b4f8a", size: "small" },
          { id: `${moduleId}_new_item`, icon: ICONS.ACTIONS.ADD, label: `${btn}.new_item`, action: `${moduleId}_new_item`, color: "#1b4f8a", size: "small" },
          { id: `${moduleId}_duplicate`, icon: ICONS.ACTIONS.DUPLICATE, label: `${btn}.duplicate`, action: `${moduleId}_duplicate`, color: "#1b4f8a", size: "small" },
          { id: `${moduleId}_import_liturgy`, icon: ICONS.ACTIONS.IMPORT, label: `${btn}.import_liturgy`, action: `${moduleId}_import_liturgy`, color: "#27ae60", size: "small" },
          { id: `${moduleId}_save_program`, icon: ICONS.ACTIONS.SAVE, label: `${btn}.save_program`, action: `${moduleId}_save_program`, color: "#16a085", size: "small" },
          { id: `${moduleId}_delete_item`, icon: ICONS.ACTIONS.DELETE, label: `${btn}.delete_item`, action: `${moduleId}_delete_item`, color: "#e74c3c", size: "small" },
        ],
      },
      {
        id: `${moduleCtxId}_navigation`,
        title: "ribbon.groups.navigation",
        buttons: [
          { id: `${moduleId}_previous`, icon: ICONS.ACTIONS.PREVIOUS, label: `${btn}.previous`, action: `${moduleId}_previous`, color: "#3498db", size: "small" },
          { id: `${moduleId}_next`, icon: ICONS.ACTIONS.NEXT, label: `${btn}.next`, action: `${moduleId}_next`, color: "#3498db", size: "small" },
          { id: `${moduleId}_go_to_slide`, icon: ICONS.PROJECTION.PRESENT, label: `${btn}.go_to_slide`, action: `${moduleId}_go_to_slide`, color: "#3498db", size: "small" },
          { id: `${moduleId}_lock_output`, label: `${btn}.lock_output`, action: `${moduleId}_lock_output`, color: "#7f8c8d", size: "small", stateBinding: {
            watchPath: KEYS.MODULES.PRESENTATION_MODE.OUTPUT_LOCKED,
            iconOn: ICONS.ACTIONS.LOCK,
            iconOff: ICONS.ACTIONS.LOCK_OPEN,
            colorOn: "#e74c3c",
            labelOn: `${btn}.unlock_output`,
            labelOff: `${btn}.lock_output`,
          } },
        ],
      },
      {
        id: `${moduleCtxId}_outputs`,
        title: "ribbon.groups.outputs",
        // Opção (qual monitor é cada tela), não estado: ligar e desligar é o Iniciar/Parar.
        customCategory: MonitorRolesGroup,
        buttons: [],
      },
      {
        id: `${moduleCtxId}_library`,
        title: "ribbon.groups.library",
        buttons: [
          { id: `${moduleId}_library_files`, icon: ICONS.UI.FOLDER_OPEN, label: `${btn}.library_files`, action: `${moduleId}_library_files`, color: "#f39c12", size: "small" },
          { id: `${moduleId}_library_musics`, icon: ICONS.MUSIC.MUSIC, label: `${btn}.library_musics`, action: `${moduleId}_library_musics`, color: "#1b4f8a", size: "small" },
          { id: `${moduleId}_library_bible`, icon: ICONS.MODULES.BIBLE, label: `${btn}.library_bible`, action: `${moduleId}_library_bible`, color: "#8e5a2b", size: "small" },
          { id: `${moduleId}_library_videos`, icon: ICONS.MEDIA.YOUTUBE, label: `${btn}.library_videos`, action: `${moduleId}_library_videos`, color: "#e74c3c", size: "small" },
          { id: `${moduleId}_library_media`, icon: ICONS.MODULES.MEDIA_LIBRARY, label: `${btn}.library_media`, action: `${moduleId}_library_media`, color: "#9b59b6", size: "small", disabled: true },
        ],
      },
      {
        id: `${moduleCtxId}_display`,
        title: "ribbon.groups.display",
        buttons: [
          { id: `${moduleId}_toggle_expand`, label: `${btn}.expand`, action: `${moduleId}_toggle_expand`, color: "#1b4f8a", size: "small", stateBinding: {
            watchPath: KEYS.MODULES.PRESENTATION_MODE.EXPANDED,
            iconOn: ICONS.PLAYER.FULLSCREEN_EXIT,
            iconOff: ICONS.PLAYER.FULLSCREEN,
            labelOn: `${btn}.collapse`,
            labelOff: `${btn}.expand`,
          } },
          { id: `${moduleId}_slide_grid`, icon: ICONS.UI.VIEW_GRID_OUTLINE, label: `${btn}.slide_grid`, action: `${moduleId}_slide_grid`, color: "#1b4f8a", size: "small" },
          // Fora do escopo por enquanto (ver handoff): o botão aparece, desabilitado.
          { id: `${moduleId}_operator_notes`, icon: ICONS.UI.NOTE_TEXT, label: `${btn}.operator_notes`, action: `${moduleId}_operator_notes`, color: "#7f8c8d", size: "small", disabled: true },
        ],
      },
    ],
  },
]
