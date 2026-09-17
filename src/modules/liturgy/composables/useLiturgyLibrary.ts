import { ref } from "vue";
import $docs from "@/helpers/DocStore";
import $liturgy from "@/helpers/Liturgy";
import { DB_TABLE } from "@/constants/DbTables";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";
import type { LiturgyLibraryItem } from "@/types/LiturgyLibrary";

const TABLE = DB_TABLE.LITURGY_LIBRARY;
const DEFAULT_COLOR = "#00004F";
const JA_GROUP_KEY = /^\d+$/;

/**
 * Normaliza um item de liturgia importado (JSON externo) para um `LiturgyItem`
 * válido. Itens não-objeto são rejeitados (retorna null); itens com campos
 * faltando são preenchidos com valores padrão seguros. O `tipo` inválido cai
 * para ANOTACAO.
 */
function _normalizeLiturgyItem(raw: unknown): LiturgyItem | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const tipoRaw = typeof r.tipo === "string" ? r.tipo : "";
  const tipo = LiturgyItemTypeEnum.fromString(tipoRaw) ?? LiturgyItemTypeEnum.ANOTACAO;

  const id =
    typeof r.id === "string" && r.id !== ""
      ? r.id
      : crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  return {
    id,
    tipo,
    subtipo: typeof r.subtipo === "string" ? r.subtipo : "",
    item: typeof r.item === "string" ? r.item : "",
    subitem: typeof r.subitem === "string" ? r.subitem : "",
    cor: typeof r.cor === "string" && r.cor !== "" ? r.cor : DEFAULT_COLOR,
    duration: Number(r.duration) || 0,
    musica: Number(r.musica) || -1,
    dir: typeof r.dir === "string" ? r.dir : "",
    dir_info: typeof r.dir_info === "string" ? r.dir_info : "E",
    url: typeof r.url === "string" ? r.url : "",
    escolha: r.escolha === true,
    has_instrumental_music: r.has_instrumental_music === true,
    // Campos opcionais — preservados se presentes
    ...(typeof r.id_music === "number" && Number.isFinite(r.id_music)
      ? { id_music: r.id_music }
      : typeof r.id_music === "string" && r.id_music.trim() !== "" && Number.isFinite(Number(r.id_music))
        ? { id_music: Number(r.id_music) }
        : {}),
    ...(typeof r.time === "string" ? { time: r.time } : {}),
    ...(typeof r.checked === "string" ? { checked: r.checked } : {}),
    ...(typeof r.blocoId === "string" ? { blocoId: r.blocoId } : {}),
    ...(typeof r.ref_id === "string" ? { ref_id: r.ref_id } : {}),
    ...(Array.isArray(r.anuncios_ids)
      ? { anuncios_ids: r.anuncios_ids.filter((id): id is string => typeof id === "string") }
      : {}),
    ...(typeof r.overlay_id === "string" ? { overlay_id: r.overlay_id } : {}),
    ...(r.overlay_action === "activate" || r.overlay_action === "deactivate"
      ? { overlay_action: r.overlay_action }
      : {}),
    ...(typeof r.linked_overlay_id === "string" ? { linked_overlay_id: r.linked_overlay_id } : {}),
  };
}

/**
 * Parser mínimo do formato INI do Delphi (`TIniFile`): seções `[Nome]` e
 * pares `chave=valor`, uma seção corrente por vez. Split no primeiro `=`
 * apenas — caminhos de arquivo no `.ja` legado não contêm `=`.
 */
function _parseIniSections(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = {};
      sections[sectionMatch[1]] = current;
      continue;
    }
    if (!current) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    current[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return sections;
}

/**
 * Converte uma cor `TColor` do Delphi (`$00BBGGRR`, hex invertido, sem canal
 * alfa real) para `#RRGGBB`. Ex.: `$004F0000` (a cor padrão do LouvorJA
 * clássico) vira `#00004F` — mesmo valor já usado como `DEFAULT_COLOR` aqui.
 */
function _delphiColorToHex(value: string | undefined): string {
  if (!value || !value.startsWith("$")) return DEFAULT_COLOR;
  const hex = value.slice(1).padStart(8, "0");
  const bb = hex.slice(2, 4);
  const gg = hex.slice(4, 6);
  const rr = hex.slice(6, 8);
  return `#${rr}${gg}${bb}`.toUpperCase();
}

/** Mapeia os campos de uma seção `[item_<id>]` do `.ja` para o formato cru que `_normalizeLiturgyItem` espera. */
function _mapJaItemFields(id: string, fields: Record<string, string>): Record<string, unknown> {
  return {
    id,
    tipo: fields.tipo ?? "",
    subtipo: fields.subtipo ?? "",
    item: fields.item ?? "",
    subitem: fields.subitem ?? "",
    cor: _delphiColorToHex(fields.cor),
    duration: fields.duration ?? fields.duracao ?? 0,
    time: fields.time ?? fields.horario ?? undefined,
    dir: fields.dir ?? "",
    dir_info: fields.dir_info || "E",
    url: fields.url ?? "",
    musica: fields.musica !== undefined ? Number(fields.musica) : -1,
    id_music:
      fields.musica !== undefined && Number.isFinite(Number(fields.musica)) && Number(fields.musica) > 0
        ? Number(fields.musica)
        : undefined,
    escolha: fields.escolha === "1",
    has_instrumental_music: fields.has_instrumental_music === "1" || fields.instrumental === "1",
    checked: fields.checked || undefined,
  };
}

/**
 * Nome para um grupo sem item "categoria" — usa o prefixo de horário do
 * primeiro item (ex.: "18h55: Cronometro" → "Liturgia importada — 18h55"),
 * já que "Liturgia importada 1/2/3" não ajuda a diferenciar duas liturgias
 * de dias distintos no mesmo arquivo.
 */
function _jaFallbackName(firstItem: LiturgyItem | undefined, index: number): string {
  const timeMatch = firstItem?.item.match(/^(\d{1,2}h\d{2})/);
  return timeMatch ? `Liturgia importada — ${timeMatch[1]}` : `Liturgia importada ${index + 1}`;
}

/**
 * Faz o parse de um `liturgia.ja` (formato Delphi, INI em Windows-1252 — o
 * chamador precisa decodificar o arquivo com esse charset antes de passar o
 * texto aqui). Um `.ja` pode conter mais de uma liturgia salva: a seção
 * `[Geral]` lista uma chave numérica por liturgia, cujo valor é a ordem dos
 * itens (`item_id;item_id;...`). O nome de cada uma vem do primeiro item do
 * tipo "categoria" no grupo, quando existir.
 */
export function parseJaImport(text: string): { name: string; items: LiturgyItem[] }[] | null {
  const sections = _parseIniSections(text);
  const geral = sections["Geral"];
  if (!geral) return null;

  const groupKeys = Object.keys(geral)
    .filter((k) => JA_GROUP_KEY.test(k))
    .sort((a, b) => Number(a) - Number(b));
  if (groupKeys.length === 0) return null;

  const liturgies: { name: string; items: LiturgyItem[] }[] = [];
  groupKeys.forEach((key, index) => {
    const ids = geral[key]
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    const rawItems = ids
      .map((id) => (sections[id] ? _mapJaItemFields(id, sections[id]) : null))
      .filter((i): i is Record<string, unknown> => i !== null);
    const items = rawItems.map(_normalizeLiturgyItem).filter((i): i is LiturgyItem => i !== null);
    if (items.length === 0) return;

    const firstBloco = items.find((i) => i.tipo === LiturgyItemTypeEnum.BLOCO);
    const name = firstBloco?.item.trim() || _jaFallbackName(items[0], index);
    liturgies.push({ name, items });
  });

  return liturgies.length > 0 ? liturgies : null;
}

export function useLiturgyLibrary() {
  const loading = ref(false);

  async function list(filter?: string): Promise<LiturgyLibraryItem[]> {
    loading.value = true;
    try {
      const all = await $docs.getAll<LiturgyLibraryItem>(TABLE);
      if (filter) {
        const q = filter.toLowerCase();
        return all.filter((i) => i.name.toLowerCase().includes(q));
      }
      return all.sort((a, b) => a.name.localeCompare(b.name));
    } finally {
      loading.value = false;
    }
  }

  async function get(id: string): Promise<LiturgyLibraryItem | undefined> {
    return $docs.get<LiturgyLibraryItem>(TABLE, id);
  }

  async function getByName(name: string): Promise<LiturgyLibraryItem | undefined> {
    const all = await $docs.getAll<LiturgyLibraryItem>(TABLE);
    return all.find((i) => i.name.toLowerCase() === name.toLowerCase());
  }

  async function save(
    data: Partial<LiturgyLibraryItem> & { name: string; items: LiturgyLibraryItem["items"] }
  ): Promise<LiturgyLibraryItem> {
    const cleanData = JSON.parse(JSON.stringify(data)) as typeof data;
    const now = new Date().toISOString();

    if (cleanData.id) {
      const existing = await get(cleanData.id);
      if (!existing) throw new Error(`Liturgia #${cleanData.id} não encontrada`);
      const updated: LiturgyLibraryItem = {
        ...existing,
        name: cleanData.name,
        color: cleanData.color ?? existing.color,
        items: cleanData.items,
        binding: cleanData.binding !== undefined ? cleanData.binding : existing.binding,
        updatedAt: now,
      };
      await $docs.put(TABLE, updated);
      return updated;
    }

    const item: LiturgyLibraryItem = {
      id: crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name: cleanData.name,
      color: cleanData.color ?? "#00004F",
      items: cleanData.items,
      binding: cleanData.binding ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await $docs.put(TABLE, item);
    return item;
  }

  async function remove(id: string): Promise<void> {
    await $docs.del(TABLE, id);
  }

  function exportToJson(items: LiturgyLibraryItem["items"], name: string): void {
    const payload = {
      name,
      exportedAt: new Date().toISOString(),
      items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseImport(json: string): { name: string; items: LiturgyItem[] } | null {
    try {
      const data = JSON.parse(json);
      if (data && typeof data.name === "string" && Array.isArray(data.items)) {
        const rawItems = data.items as unknown[];
        const items = rawItems
          .map(_normalizeLiturgyItem)
          .filter((i): i is LiturgyItem => i !== null);
        // Se o arquivo tinha itens mas nenhum foi válido, rejeita o import inteiro.
        if (rawItems.length > 0 && items.length === 0) return null;
        return { name: data.name, items };
      }
      return null;
    } catch {
      return null;
    }
  }

  async function bindingMatches(item: LiturgyLibraryItem, date: Date): Promise<boolean> {
    if (!item.binding) return false;
    const { type, value } = item.binding;
    if (type === "day_of_week") {
      return String(date.getDay()) === value;
    }
    if (type === "date") {
      return date.toISOString().slice(0, 10) === value;
    }
    if (type === "thirteenth_sabbath") {
      return $liturgy.isDecimoTerceiroSabado(date);
    }
    return false;
  }

  return {
    loading,
    list,
    get,
    getByName,
    save,
    remove,
    exportToJson,
    parseImport,
    bindingMatches,
  };
}
