import { computed, onMounted, ref, watch } from "vue";
import Platform from "@/helpers/Platform";
import { roleOfFeature } from "@/helpers/DisplayRoles";
import { useDisplays } from "@/composables/useDisplays";
import { PROJECTION_TYPE } from "@/constants/Projection";

/**
 * Arquivos e vídeos on-line não seguem a Tela principal do módulo: cada um
 * tem a sua opção de monitor ("Projetar arquivos em", "Abrir vídeos em"), e
 * por padrão ela herda o papel Projeção — o mesmo que a Tela principal
 * escolhe. Quando alguém mudou essa opção, o conteúdo vai para outro lugar
 * (ou, como no PowerPoint com animações, não acha telão nenhum) sem o
 * operador ver por quê. Aqui o módulo descobre isso e oferece voltar ao padrão.
 *
 * Confere nos momentos em que a resposta pode mudar, sem relógio: ao abrir,
 * quando um monitor entra ou sai, quando as Opções trocam o papel de uma
 * feature e quando um arquivo ou vídeo vai ao ar (`refresh`, chamado por quem
 * acompanha o conteúdo no ar).
 */

export const CONTENT_FEATURES = [
  { feature: PROJECTION_TYPE.FILE, label: "outputs.diverge_files" },
  { feature: PROJECTION_TYPE.ONLINE_VIDEO, label: "outputs.diverge_videos" },
] as const;

export type ContentFeature = (typeof CONTENT_FEATURES)[number];

/**
 * As features cujo papel não é a Projeção. `roles` traz `null` para "mesma
 * janela"; uma feature ainda não lida fica de fora.
 */
export function divergingFeatures(
  mainSet: boolean,
  roles: Record<string, string | null>
): ContentFeature[] {
  if (!mainSet) return [];
  return CONTENT_FEATURES.filter((f) => f.feature in roles && roles[f.feature] !== "projection");
}

export function useContentMonitors() {
  const { roles, getFeatureRole, setFeatureRole, featureRolesVersion } = useDisplays();
  const featureRoles = ref<Record<string, string | null>>({});

  async function refresh(): Promise<void> {
    const entries = await Promise.all(
      CONTENT_FEATURES.map(async ({ feature }) => {
        const role = await getFeatureRole(feature);
        // No navegador, a feature sem escolha volta `null`: vale o padrão dela.
        // No desktop, `null` é a "mesma janela" escolhida nas Opções.
        return [feature, Platform.isDesktop ? role : (role ?? roleOfFeature(feature))] as const;
      })
    );
    featureRoles.value = Object.fromEntries(entries);
  }

  const mainSet = computed(() =>
    roles.value.some((r) => r.role === "projection" && r.displayId != null)
  );
  const diverging = computed(() => divergingFeatures(mainSet.value, featureRoles.value));

  /** "Usar a Tela principal": a feature volta a seguir o papel Projeção. */
  async function followMainScreen(): Promise<void> {
    for (const { feature } of diverging.value) await setFeatureRole(feature, "projection");
    await refresh();
  }

  onMounted(() => void refresh());
  watch([roles, featureRolesVersion], () => void refresh());

  return { diverging, featureRoles, followMainScreen, refresh };
}
