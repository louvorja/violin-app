/**
 * Busca de livros bíblicos por nome ou abreviação, com ordinal.
 *
 * Os dados usam numeral romano no nome ("I Samuel", "II Pedro", "III João") e
 * arábico na abreviação ("1Sm", "2Pe", "3Jo"). O operador precisa achar o
 * mesmo livro digitando "i samuel", "1 samuel", "isamuel", "1sm" — e "samuel"
 * sozinho tem de achar os dois, mesmo o nome começando com "I ".
 */

export interface BibleBookSearchable {
  name: string;
  abbreviation?: string;
  /**
   * Palavras extras dos dados ("cantares salomao canticos"). Usadas só como
   * último critério, para nomes compostos.
   */
  keywords?: string;
}

const ROMANOS: Record<string, number> = { i: 1, ii: 2, iii: 3 };

/** Minúsculas, sem acentos, sem espaços nas pontas. */
export function normalizarBusca(texto: string): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Forma de comparação: sem acentos, sem espaços, pontos ou hífens. */
export function compactarBusca(texto: string): string {
  return normalizarBusca(texto).replace(/[\s.-]+/g, "");
}

export interface OrdinalDividido {
  ordinal: number | null;
  resto: string;
}

/**
 * Separa o ordinal do começo ("I ", "II ", "1 ") do resto.
 *
 * `exigirSeparador` é o que distingue "I Samuel" de "Isaías": no NOME o
 * numeral só conta quando termina ali ou vem seguido de espaço/ponto. Na
 * CONSULTA o operador digita colado ("isamuel"), então o separador é opcional.
 */
export function dividirOrdinal(texto: string, exigirSeparador = false): OrdinalDividido {
  const normalizado = normalizarBusca(texto);
  const prefixo = normalizado.match(/^(\d{1,2}|i{1,3})/);
  if (prefixo) {
    const token = prefixo[1];
    const depois = normalizado.slice(token.length);
    const separado = !depois || /^[\s.-]/.test(depois);
    if (!exigirSeparador || separado) {
      const ordinal = /^\d+$/.test(token) ? Number(token) : ROMANOS[token];
      if (ordinal >= 1 && ordinal <= 3) {
        return { ordinal, resto: depois.replace(/^[\s.-]+/, "") };
      }
    }
  }
  /*
   * Depois de ver a lista, digitar o número no FIM é natural: "samuel1" para
   * I Samuel. Só na consulta — em nome de livro o numeral é sempre prefixo.
   */
  if (!exigirSeparador) {
    const sufixo = normalizado.match(/^(.*[a-z])[\s.-]*([1-3])$/);
    if (sufixo) return { ordinal: Number(sufixo[2]), resto: sufixo[1] };
  }
  return { ordinal: null, resto: normalizado };
}

interface LivroIndexado<T> {
  book: T;
  /** Nome compacto, do jeito que está nos dados ("isamuel"). */
  nome: string;
  /** Abreviação compacta ("1sm"). */
  abrev: string;
  /** Ordinal do livro, do nome ou da abreviação. */
  ordinal: number | null;
  /** Nome compacto sem o ordinal ("samuel"); o nome inteiro quando não há. */
  resto: string;
  /** Abreviação compacta sem o dígito ("sm"). */
  abrevResto: string;
  /** Palavras do nome, normalizadas. */
  palavras: string[];
  /** Palavras extras compactas. */
  chaves: string[];
}

function indexar<T extends BibleBookSearchable>(book: T): LivroIndexado<T> {
  const normalizado = normalizarBusca(book.name || "");
  const { ordinal, resto } = dividirOrdinal(normalizado, true);
  const abrev = compactarBusca(book.abbreviation || "");
  const abrevOrdinal = /^[1-3]/.test(abrev) ? Number(abrev[0]) : null;
  return {
    book,
    nome: compactarBusca(normalizado),
    abrev,
    /* O nome manda; a abreviação só completa quando o nome não traz o numeral. */
    ordinal: ordinal ?? abrevOrdinal,
    resto: ordinal ? compactarBusca(resto) : compactarBusca(normalizado),
    abrevResto: abrevOrdinal ? abrev.slice(1) : abrev,
    palavras: normalizado.split(/\s+/).filter(Boolean),
    chaves: normalizarBusca(book.keywords || "").split(/\s+/).filter(Boolean).map(compactarBusca),
  };
}

const PONTOS = {
  abrevExata: 0,
  nomeExato: 1,
  grupoOrdinal: 2,
  ordinalExato: 3,
  ordinalAbrev: 4,
  ordinalNome: 5,
  abrevPrefixo: 6,
  nomePrefixo: 7,
  semOrdinalPrefixo: 8,
  palavraPrefixo: 9,
  chavePrefixo: 10,
} as const;

function pontuarPrefixos(b: LivroIndexado<BibleBookSearchable>, q: string): number {
  if (b.abrev.startsWith(q)) return PONTOS.abrevPrefixo;
  if (b.nome.startsWith(q)) return PONTOS.nomePrefixo;
  /* "samuel" acha I e II Samuel: o numeral do nome não separa a busca. */
  if (b.resto.startsWith(q)) return PONTOS.semOrdinalPrefixo;
  if (q.length >= 2 && b.abrevResto.startsWith(q)) return PONTOS.semOrdinalPrefixo;
  if (q.length >= 3 && b.palavras.some((palavra) => palavra.length >= 3 && palavra.startsWith(q)))
    return PONTOS.palavraPrefixo;
  if (q.length >= 2 && b.chaves.some((chave) => chave.startsWith(q))) return PONTOS.chavePrefixo;
  return Infinity;
}

/**
 * Livros que combinam com a consulta, do melhor para o pior.
 *
 * Ordinal sozinho ("i", "1") devolve o grupo inteiro, na ordem canônica; os
 * demais prefixos vêm depois (Isaías só aparece depois de "i" se nada mais
 * casar, conforme a escolha do produto). Abreviação/nome exatos encerram a
 * busca — "is" continua sendo Isaías, não "I S...".
 */
export function buscarLivros<T extends BibleBookSearchable>(
  consulta: string,
  livros: readonly T[]
): T[] {
  const texto = normalizarBusca(consulta);
  if (!texto) return [];
  const compacta = compactarBusca(texto);
  const { ordinal, resto } = dividirOrdinal(texto, false);
  const restoCompacto = compactarBusca(resto);
  const temOrdinal = ordinal != null;

  const pontuados: { book: T; score: number }[] = [];
  for (const book of livros) {
    const indexado = indexar(book);
    let score = Infinity;
    if (indexado.abrev === compacta) score = PONTOS.abrevExata;
    else if (indexado.nome === compacta) score = PONTOS.nomeExato;
    else if (temOrdinal) {
      if (indexado.ordinal === ordinal) {
        if (!restoCompacto) score = PONTOS.grupoOrdinal;
        else if (indexado.abrevResto === restoCompacto || indexado.resto === restoCompacto)
          score = PONTOS.ordinalExato;
        else if (indexado.abrevResto.startsWith(restoCompacto)) score = PONTOS.ordinalAbrev;
        else if (indexado.resto.startsWith(restoCompacto)) score = PONTOS.ordinalNome;
        else if (indexado.palavras.some((palavra) => palavra.startsWith(restoCompacto)))
          score = PONTOS.ordinalNome;
      } else if (indexado.ordinal === null) {
        /*
         * Livro sem ordinal ainda pode ser "isaias" digitado como "i...".
         * Livro de OUTRO ordinal fica de fora: "ii" não lista III João.
         */
        score = pontuarPrefixos(indexado, compacta);
      }
    } else {
      score = pontuarPrefixos(indexado, compacta);
    }
    if (score < Infinity) pontuados.push({ book, score });
  }

  const exatos = pontuados.filter((p) => p.score <= PONTOS.nomeExato);
  const lista = exatos.length ? exatos : pontuados;
  /* Sort estável: empate mantém a ordem canônica em que os livros chegaram. */
  return lista.sort((a, b) => a.score - b.score).map((p) => p.book);
}

export interface ReferenciaBiblica<T> {
  book: T;
  chapter: number;
  verse: number | null;
}

/**
 * Interpreta "livro capítulo[:versículo]" ("1 samuel 3:16", "ii pedro 1",
 * "joão 3 16"). Devolve `null` quando não é referência — aí a busca por texto
 * segue normalmente.
 */
export function interpretarReferencia<T extends BibleBookSearchable>(
  texto: string,
  livros: readonly T[]
): ReferenciaBiblica<T> | null {
  const match = String(texto || "")
    .trim()
    .match(/^(.+?)\s+(\d+)(?:\s*[:.]?\s*(\d+))?$/);
  if (!match || !/[a-z]/i.test(match[1])) return null;
  const chapter = parseInt(match[2], 10);
  if (!Number.isSafeInteger(chapter) || chapter < 1) return null;
  const book = buscarLivros(match[1], livros)[0];
  if (!book) return null;
  const verse = match[3] ? parseInt(match[3], 10) : null;
  return {
    book,
    chapter,
    verse: verse != null && Number.isSafeInteger(verse) && verse > 0 ? verse : null,
  };
}
