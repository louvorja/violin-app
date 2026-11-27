import { lerHorario } from "./agenda";

interface FoundTime {
  hora: string;
  start: number;
  end: number;
}

const INTERVAL_CONNECTOR = /^\s*(?:[-–—]|[àa]s?|at[ée])\s*$/iu;

/** Extrai um horário inequívoco sem alterar o título nem confundir João 3:16 com hora. */
export function horarioDoTitulo(value: unknown): string {
  if (typeof value !== "string") return "";

  const encontrados: FoundTime[] = [];
  let anteriorEraHorario = false;
  // Permite `:` como pontuação separadora (`18h55: Cronômetro`, `09:00: Abertura`),
  // rejeitando apenas `:` seguido de dígito (`08:30:99`).
  const tokens = value.matchAll(
    /(\d{1,2})(?::(\d{2})(hrs?|hs|h)?|h(\d{2})?(?:min|m)?|(hrs?|hs))(?![\p{L}\p{N}]|:\d)/giu
  );
  for (const token of tokens) {
    const start = token.index ?? 0;
    const end = start + token[0].length;
    const antes = value.slice(0, start);
    // Safari anterior ao 16.4 não compila lookbehind. Verifica o prefixo separado.
    // `[\p{N}]$` não reconhece dígitos astrais (𝟙) no motor do Chromium;
    // separar as alternativas cobre o caso sem perder a checagem normal.
    if (/\p{L}$/u.test(antes) || /\p{N}$/u.test(antes) || /[/:.]$/.test(antes)) continue;
    // Expressões de duração não são compromissos no relógio da liturgia.
    if (
      /(?:\b(?:dura[çc][ãa]o|durante|por|ap[óo]s|em)|\bdaqui\s+a)\s*[:\-–—]?\s*$/iu.test(antes)
    ) {
      anteriorEraHorario = false;
      continue;
    }
    const minutos = token[2] ?? token[4];
    const hora = lerHorario(`${token[1].padStart(2, "0")}:${minutos ?? "00"}`);
    if (!hora) {
      anteriorEraHorario = false;
      continue;
    }

    const prefixo = /^[\s([{\-–—]*$/.test(antes);
    const marcador = /(?:^|[^\p{L}\p{N}])(?:às|as|das|hor[áa]rio\s*:?)\s*$/iu.test(antes);
    const delimitadorComMinutos =
      minutos !== undefined && /(?:\s[-–—]\s+|[[(]\s*)$/.test(antes);
    const sequencia: boolean =
      anteriorEraHorario && /(?:[/,;\-–—]|\b(?:e|ou|[àa]s?|at[ée]))\s*$/iu.test(antes);
    // `8h30` ou `08:30h` distingue horário de capítulos/durações; `8h` sem minutos exige contexto.
    const explicitoComMinutos = token[4] !== undefined || token[3] !== undefined;
    anteriorEraHorario =
      prefixo || marcador || delimitadorComMinutos || sequencia || explicitoComMinutos;
    if (anteriorEraHorario) encontrados.push({ hora, start, end });
  }

  if (encontrados.length === 0) return "";
  const unicos = new Set(encontrados.map((e) => e.hora));
  if (unicos.size === 1) return encontrados[0].hora;
  // Intervalo contíguo de um único item (ex.: "08:30 - 09:00 Escola Sabatina", "8h30 às 9h Louvor").
  if (encontrados.length === 2) {
    const entre = value.slice(encontrados[0].end, encontrados[1].start);
    if (INTERVAL_CONNECTOR.test(entre)) return encontrados[0].hora;
  }
  return "";
}
