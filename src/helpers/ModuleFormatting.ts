import { getModule } from "@/config/modules";

/**
 * Retorna o default declarado pelo manifesto do módulo.
 *
 * As telas de módulo e as janelas de projeção precisam usar a mesma fonte
 * para defaults. Sem isso, uma preferência ausente em instalações antigas
 * acabava como 50% no programa e 15% na projeção, por exemplo.
 */
export function moduleCustomizationDefault<T>(
  moduleId: string,
  key: string,
  fallback: T
): T {
  const value = getModule(moduleId)?.customization?.[key]?.default;
  return (value === undefined ? fallback : value) as T;
}

export function horizontalTextAlign(value: unknown): "left" | "center" | "right" {
  if (value === "start" || value === "left") return "left";
  if (value === "end" || value === "right") return "right";
  return "center";
}
