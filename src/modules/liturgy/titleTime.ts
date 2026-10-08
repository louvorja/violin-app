import { lerHorario } from "./agenda";

/** Extrai um horário inequívoco sem alterar o título nem confundir João 3:16 com hora. */
export function horarioDoTitulo(value: unknown): string {
  if (typeof value !== "string") return "";

  const horarios = new Set<string>();
  let anteriorEraHorario = false;
  const tokens = value.matchAll(
    /(?<![\p{L}\p{N}/:.])(\d{1,2})(?::(\d{2})|h(\d{2})?)(?![\p{L}\p{N}:])/giu
  );
  for (const token of tokens) {
    const antes = value.slice(0, token.index);
    // Expressões de duração não são compromissos no relógio da liturgia.
    if (/(?:\b(?:dura[çc][ãa]o|durante|por|ap[óo]s|em)|\bdaqui\s+a)\s*:?\s*$/iu.test(antes)) {
      anteriorEraHorario = false;
      continue;
    }
    const hora = lerHorario(`${token[1].padStart(2, "0")}:${token[2] ?? token[3] ?? "00"}`);
    if (!hora) {
      anteriorEraHorario = false;
      continue;
    }

    const prefixo = /^[\s([{\-–—]*$/.test(antes);
    const marcador = /(?:^|[^\p{L}\p{N}])(?:às|as|das|hor[áa]rio\s*:?)\s*$/iu.test(antes);
    const sequencia: boolean =
      anteriorEraHorario && /(?:[/,;\-–—]|\b(?:e|ou|at[ée]))\s*$/iu.test(antes);
    // h com minutos distingue horário de capítulos; h sem minutos exige contexto.
    anteriorEraHorario = prefixo || marcador || sequencia || token[3] !== undefined;
    if (anteriorEraHorario) horarios.add(hora);
  }
  return horarios.size === 1 ? [...horarios][0] : "";
}
