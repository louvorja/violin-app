import type { Module } from "@/types/Module"
import type { RibbonPage } from "@/types/Ribbon"
import { ModuleCategoryEnum } from "@/enums/ModuleCategoryEnum"
import { ModuleGroupEnum } from "@/enums/ModuleGroupEnum"
import { ICONS } from "@/config/Icons"
import { ModuleEnum } from "@/enums/ModuleEnum"
import { getModulePath } from "@/helpers/ModulePath"
import { KEYS } from "@/constants/UserDataKeys"
import { createTransitionButtons, createTransitionContext } from "@/config/Transitions"

const moduleId = ModuleEnum.ANNOUNCEMENTS;
const modulePath = getModulePath(moduleId);
const moduleCtxId = "ctx_" + moduleId;

/** Efeito, Duração, Curva, um select por efeito (filtrado por `dependsOnOption`
 * na ribbon) e a origem do zoom — mesma tabela usada pela projeção. */
const transitionButtons = createTransitionButtons(
  moduleId,
  createTransitionContext(KEYS.MODULES.ANNOUNCEMENTS),
);

export const module: Module = {
  id: moduleId,
  title: `${modulePath}.title`,
  name: "Anúncios",
  description: `${modulePath}.description`,
  icon: ICONS.MODULES.ANNOUNCEMENTS,
  color: "#f39c12",
  showInMainMenu: true,
  requiresProjectionWindow: true,
  category: ModuleCategoryEnum.WORSHIP,
  group: ModuleGroupEnum.CHURCH,
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
        id: moduleCtxId + "_transition",
        title: `${modulePath}.ribbon.transitions_group`,
        buttons: transitionButtons,
      },
    ],
  },
]
