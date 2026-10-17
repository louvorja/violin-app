import { getModule } from "@/config/modules";
import { corComAlfa, larguraDeBorda, raioDeBorda } from "@/helpers/ColorAlpha";

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

/** Entradas da "caixa de texto" — fundo com alfa e borda, dos módulos utilitários. */
export interface TextBoxStyleInput {
  enabled?: boolean;
  color?: string;
  opacity?: number;
  borderEnabled?: boolean;
  borderColor?: string;
  borderOpacity?: number;
  borderRadius?: number;
  borderWidth?: number;
}

export interface TextBoxStyle {
  backgroundColor: string;
  border?: string;
  borderRadius?: string;
  boxSizing: "border-box";
}

/**
 * Fundo do texto dos módulos utilitários: mesma ideia dos slides
 * (`useSlideStyle.textBoxStyle`), com a diferença de que aqui a COR também é
 * configurável — o seletor de cor do painel só devolve `#RRGGBB`, e a
 * transparência vem no controle ao lado.
 *
 * Fica aqui, e não duplicado em `useModuleBodyStyle` e `ModuleProjectionLayer`,
 * porque os dois precisam cair exatamente igual: o mesmo módulo aparece no
 * programa, na projeção e na camada da tela de fundo.
 */
export function textBoxStyle(input: TextBoxStyleInput): TextBoxStyle {
  const fundoAtivo = input.enabled === true;
  const bordaAtiva = fundoAtivo && input.borderEnabled === true;
  const cor = corComAlfa(input.color ?? "transparent", input.opacity ?? 100);

  const estilo: TextBoxStyle = {
    backgroundColor: fundoAtivo ? cor : "transparent",
    boxSizing: "border-box",
  };

  if (bordaAtiva) {
    const largura = larguraDeBorda(input.borderWidth ?? 2);
    estilo.border = `${largura}px solid ${corComAlfa(
      input.borderColor ?? "#FFFFFF",
      input.borderOpacity ?? 100
    )}`;
    const raio = raioDeBorda(input.borderRadius ?? 0);
    if (raio > 0) estilo.borderRadius = `${raio}px`;
  }

  return estilo;
}
