import type { Module } from "@/types/Module"
import type { RibbonPage } from "@/types/Ribbon"
import { ModuleCategoryEnum } from "@/enums/ModuleCategoryEnum"
import { ModuleGroupEnum } from "@/enums/ModuleGroupEnum"
import { ICONS } from "@/config/Icons"
import { ModuleEnum } from "@/enums/ModuleEnum"
import $modules from "@/helpers/Modules"
import { KEYS } from "@/constants/UserDataKeys"

const moduleId = ModuleEnum.SLIDE_EDITOR;
const modulePath = $modules.getPath(moduleId);
const moduleCtxId = "ctx_" + moduleId;

export const module: Module = {
  id: moduleId,
  title: `${modulePath}.title`,
  name: "Editor de Slides",
  description: `${modulePath}.description`,
  icon: ICONS.MODULES.SLIDE_EDITOR,
  color: "#1b4f8a",
  showInMainMenu: true,
  category: ModuleCategoryEnum.COLLECTIONS,
  group: ModuleGroupEnum.USER,
  order: 1,
}

export const contextualPages: RibbonPage[] = [
  {
    id: `${moduleCtxId}_file`,
    title: `${modulePath}.ribbon.title_ctx_file`,
    contextual: true,
    activeOnModules: [`${moduleId}`],
    defaultModule: null,
    groups: [
      {
        id: "ctx_se_file",
        title: "ribbon.groups.actions",
        buttons: [
          { id: "editor_new", icon: ICONS.UI.FILE_PLUS, label: "ribbon.btn.editor_new", action: "editor_new", color: "#1b4f8a" },
          { id: "editor_open", icon: ICONS.UI.FOLDER_OPEN, label: "ribbon.btn.editor_open", action: "editor_open", color: "#16a085" },
          { id: "editor_save", icon: ICONS.ACTIONS.SAVE, label: "ribbon.btn.editor_save", action: "editor_save", color: "#27ae60" },
          { id: "editor_save_as", icon: ICONS.ACTIONS.SAVE_EDIT, label: "ribbon.btn.editor_save_as", action: "editor_save_as", color: "#27ae60" },
          { id: "editor_export", icon: ICONS.ACTIONS.EXPORT_FILE, label: "ribbon.btn.editor_export", action: "editor_export", color: "#27ae60" },
          { id: "editor_import_txt", icon: ICONS.ACTIONS.FILE_IMPORT, label: "ribbon.btn.editor_import_txt", action: "editor_import_txt", color: "#7f8c8d" },
        ],
      },
    ],
  },
  {
    id: `${moduleCtxId}_slides`,
    title: `${modulePath}.ribbon.title_ctx_slides`,
    contextual: true,
    activeOnModules: [`${moduleId}`],
    defaultModule: null,
    groups: [
      {
        id: "ctx_se_slides_actions",
        title: "ribbon.groups.actions",
        buttons: [
          {
            id: "editor_project",
            icon: ICONS.PROJECTION.START,
            label: "ribbon.btn.editor_project",
            action: "editor_project",
            color: "#9b59b6",
            stateBinding: {
              watchPath: KEYS.MODULES.SLIDE_EDITOR.PROJECTING,
              iconOn: ICONS.PROJECTION.STOP,
              iconOff: ICONS.PROJECTION.START,
              colorOn: "#e74c3c",
              colorOff: "#9b59b6",
              labelOn: "ribbon.btn.editor_stop_projection",
              labelOff: "ribbon.btn.editor_project",
            },
          },
          { id: "editor_new_slide", icon: ICONS.ACTIONS.IMAGE_PLUS_OUTLINE, label: "ribbon.btn.editor_new_slide", action: "editor_new_slide", color: "#1b4f8a" },
          { id: "editor_duplicate_slide", icon: ICONS.ACTIONS.DUPLICATE, label: "ribbon.btn.editor_duplicate_slide", action: "editor_duplicate_slide", color: "#3498db" },
          { id: "editor_remove_slide", icon: ICONS.ACTIONS.IMAGE_REMOVE, label: "ribbon.btn.editor_remove_slide", action: "editor_remove_slide", color: "#e74c3c" },
          { id: "editor_split_slide", icon: ICONS.ACTIONS.SPLIT, label: "ribbon.btn.editor_split_slide", action: "editor_split_slide", color: "#16a085" },
          { id: "editor_merge_next", icon: ICONS.TIMER.CALL_MERGE, label: "ribbon.btn.editor_merge_next", action: "editor_merge_next", color: "#16a085" },
        ],
      },
      {
        id: "ctx_se_slides_nav",
        title: "ribbon.groups.slide_controls",
        buttons: [
          { id: "editor_first", icon: ICONS.PLAYER.SKIP_BACKWARD, label: "ribbon.btn.editor_first", action: "editor_first", color: "#e74c3c" },
          { id: "editor_prev", icon: ICONS.ACTIONS.PREVIOUS_BOLD, label: "ribbon.btn.editor_prev", action: "editor_prev", color: "#16a085" },
          { id: "editor_next", icon: ICONS.ACTIONS.NEXT_BOLD, label: "ribbon.btn.editor_next", action: "editor_next", color: "#16a085" },
          { id: "editor_last", icon: ICONS.PLAYER.SKIP_FORWARD, label: "ribbon.btn.editor_last", action: "editor_last", color: "#e74c3c" },
        ],
      },
    ],
  },
  {
    id: `${moduleCtxId}_audio`,
    title: `${modulePath}.ribbon.title_ctx_audio`,
    contextual: true,
    activeOnModules: [`${moduleId}`],
    defaultModule: null,
    groups: [
      {
        id: "ctx_se_audio",
        title: "ribbon.groups.audio_file",
        buttons: [
          { id: "editor_audio_attach", icon: ICONS.MEDIA.ADD, label: "ribbon.btn.editor_audio_attach", action: "editor_audio_attach", color: "#1b4f8a" },
          { id: "editor_audio_remove", icon: ICONS.MUSIC.NO_AUDIO, label: "ribbon.btn.editor_audio_remove", action: "editor_audio_remove", color: "#7f8c8d" },
          { id: "editor_play_pause", icon: ICONS.PLAYER.PLAY_PAUSE, label: "ribbon.btn.editor_play_pause", action: "editor_play_pause", color: "#27ae60" },
        ],
      },
      {
        id: "ctx_se_recording",
        title: "ribbon.groups.recording",
        buttons: [
          { id: "editor_record_advance", icon: ICONS.PLAYER.RECORD, label: "ribbon.btn.editor_record_advance", action: "editor_record_advance", color: "#e74c3c" },
          { id: "editor_record_start", icon: ICONS.PLAYER.PREV, label: "ribbon.btn.editor_record_start", action: "editor_record_start", color: "#7f8c8d" },
          { id: "editor_record_retroactive", icon: ICONS.PLAYER.REWIND, label: "ribbon.btn.editor_record_retroactive", action: "editor_record_retroactive", color: "#7f8c8d" },
          { id: "editor_record_clear", icon: ICONS.ACTIONS.CLEAN, label: "ribbon.btn.editor_record_clear", action: "editor_record_clear", color: "#7f8c8d" },
        ],
      },
    ],
  },
  {
    id: `${moduleCtxId}_view`,
    title: `${modulePath}.ribbon.title_ctx_view`,
    contextual: true,
    activeOnModules: [`${moduleId}`],
    defaultModule: null,
    groups: [
      {
        id: "ctx_se_view",
        title: "ribbon.groups.actions",
        buttons: [
          { id: "editor_view_full", icon: ICONS.PROJECTION.START, label: "ribbon.btn.editor_view_full", action: "editor_view_full", color: "#1b4f8a" },
          { id: "editor_view_4_3", icon: ICONS.FORMAT.ASPECT_RATIO, label: "ribbon.btn.editor_view_4_3", action: "editor_view_4_3", color: "#1b4f8a" },
          { id: "editor_view_16_9", icon: ICONS.PROJECTION.TELEVISION, label: "ribbon.btn.editor_view_16_9", action: "editor_view_16_9", color: "#1b4f8a" },
        ],
      },
    ],
  },
]
