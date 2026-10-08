import { afterEach, describe, expect, it, vi } from "vitest";
import { parseJaImport, useLiturgyLibrary } from "../useLiturgyLibrary";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import { agendaParaPersistir, prepararAgenda } from "../../agenda";
import DocStore from "@/helpers/DocStore";
import type { LiturgyLibraryItem } from "@/types/LiturgyLibrary";

afterEach(() => vi.restoreAllMocks());

// Recorte fiel de um `liturgia.ja` real (formato Delphi/TIniFile), com dois
// grupos: um sem "categoria" (culto avulso) e um com ela (Escola Sabatina).
const JA_SAMPLE = `[Geral]
1=item_20250607165038648;item_20250607165348979;
7=item_20250607170541571;item_20250607170607989;
AlteraOrdem-1=07/06/2025 17:01:42
[item_20250607165038648]
tipo=arquivo
item=18h55: Cronometro
cor=$000099FF
subtipo=arq
subitem=Arquivo C:\\Users\\Sonoplastia\\Video.mp4
dir=C:\\Users\\Sonoplastia\\Video.mp4
dir_info=E
checked=
[item_20250607165348979]
tipo=musica
item=19h00: Louvor
cor=$000099FF
escolha=1
musica=-1
subtipo=escolha
subitem=Clique para escolher a m\xfasica
checked=
[item_20250607170541571]
tipo=categoria
item=Escola Sabatina
cor=$0000CCFF
[item_20250607170607989]
tipo=arquivo
item=08h50: Cron\xf4metro E.S.
cor=$0000CCFF
subtipo=arq
subitem=Arquivo C:\\Users\\Sonoplastia\\Cronometro.mp4
dir=C:\\Users\\Sonoplastia\\Cronometro.mp4
dir_info=E
checked=
`.replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

describe("parseJaImport", () => {
  it("retorna null para texto que não é um .ja de liturgia", () => {
    expect(parseJaImport("não é ini")).toBeNull();
    expect(parseJaImport("[Geral]\nAlteraOrdem-1=07/06/2025")).toBeNull();
  });

  it("separa cada chave numérica de [Geral] em uma liturgia distinta", () => {
    const result = parseJaImport(JA_SAMPLE);
    expect(result).toHaveLength(2);
  });

  it("usa o item tipo categoria como nome, quando existe", () => {
    const result = parseJaImport(JA_SAMPLE)!;
    const escolaSabatina = result.find((l) => l.name === "Escola Sabatina");
    expect(escolaSabatina).toBeDefined();
    expect(escolaSabatina!.items[0].tipo).toBe(LiturgyItemTypeEnum.BLOCO);
  });

  it("usa o horário do primeiro item como nome, quando não há categoria", () => {
    const result = parseJaImport(JA_SAMPLE)!;
    const culto = result.find((l) => l.name.includes("18h55"));
    expect(culto).toBeDefined();
    expect(culto!.items).toHaveLength(2);
  });

  it("converte a cor TColor do Delphi ($00BBGGRR) para #RRGGBB", () => {
    const result = parseJaImport(JA_SAMPLE)!;
    const culto = result.find((l) => l.name.includes("18h55"))!;
    // $000099FF → BB=00 GG=99 RR=FF → #FF9900
    expect(culto.items[0].cor).toBe("#FF9900");
  });

  it("converte escolha e musica para os tipos esperados pelo schema Vue", () => {
    const result = parseJaImport(JA_SAMPLE)!;
    const culto = result.find((l) => l.name.includes("18h55"))!;
    const musicaItem = culto.items.find((i) => i.tipo === LiturgyItemTypeEnum.MUSICA)!;
    expect(musicaItem.escolha).toBe(true);
    expect(musicaItem.musica).toBe(-1);
  });

  it("preserva o id da música selecionada no formato legado", () => {
    const result = parseJaImport(
      `[Geral]\n1=item_music\n[item_music]\ntipo=musica\nmusica=42\nsubtipo=ja\nitem=Louvor\n`
    )!;
    expect(result[0].items[0].id_music).toBe(42);
    expect(result[0].items[0].musica).toBe(42);
  });

  it("preserva acentos (o chamador decodifica o arquivo como windows-1252)", () => {
    const result = parseJaImport(JA_SAMPLE)!;
    const musicaItem = result
      .find((l) => l.name.includes("18h55"))!
      .items.find((i) => i.tipo === LiturgyItemTypeEnum.MUSICA)!;
    expect(musicaItem.subitem).toBe("Clique para escolher a música");

    const cronometro = result
      .find((l) => l.name === "Escola Sabatina")!
      .items.find((i) => i.item.includes("Cronômetro"));
    expect(cronometro).toBeDefined();
  });

  it("preserva referências de mídia e overlay no import JSON", () => {
    const library = useLiturgyLibrary();
    const parsed = library.parseImport(
      JSON.stringify({
        name: "Culto",
        items: [
          {
            id: "media-1",
            tipo: "biblioteca-midia",
            item: "Vídeo",
            ref_id: "media-42",
            anuncios_ids: ["a1", 7, "a2"],
            linked_overlay_id: "overlay-1",
            overlay_action: "activate",
          },
        ],
      })
    );
    expect(parsed?.items[0]).toMatchObject({
      ref_id: "media-42",
      anuncios_ids: ["a1", "a2"],
      linked_overlay_id: "overlay-1",
      overlay_action: "activate",
    });
  });

  it("preserva o modo do horário no roundtrip JSON e recalcula a continuação", () => {
    const library = useLiturgyLibrary();
    const parsed = library.parseImport(
      JSON.stringify({
        name: "Culto",
        items: [
          {
            id: "manual",
            tipo: "anotacao",
            item: "Início",
            time: "09:00",
            time_mode: "manual",
            duration: 5,
          },
          { id: "auto", tipo: "anotacao", item: "Continuação", time: "09:05", time_mode: "auto" },
        ],
      })
    )!;
    const persisted = agendaParaPersistir(parsed.items);
    const reimported = library.parseImport(
      JSON.stringify({ name: parsed.name, items: persisted })
    )!;
    expect(reimported.items[0]).toMatchObject({ time: "09:00", time_mode: "manual" });
    expect(reimported.items[1]).toMatchObject({ time: "", time_mode: "auto" });
    reimported.items[0].duration = 15;
    expect(prepararAgenda(reimported.items)[1].time).toBe("09:15");
  });

  it("salva na biblioteca somente a hora manual e recupera os modos", async () => {
    const library = useLiturgyLibrary();
    const parsed = library.parseImport(
      JSON.stringify({
        name: "Culto",
        items: [
          { id: "manual", time: "09:00", time_mode: "manual", duration: 5 },
          { id: "auto", time_mode: "auto" },
        ],
      })
    )!;
    const put = vi.spyOn(DocStore, "put").mockResolvedValue(undefined);
    const document = await library.save({ name: parsed.name, items: prepararAgenda(parsed.items) });
    expect(put).toHaveBeenCalledOnce();
    expect(document.items[0]).toMatchObject({ time: "09:00", time_mode: "manual" });
    expect(document.items[1]).toMatchObject({ time: "", time_mode: "auto" });
    vi.spyOn(DocStore, "get").mockResolvedValue(
      JSON.parse(JSON.stringify(document)) as LiturgyLibraryItem
    );
    const loaded = (await library.get(document.id))!;
    loaded.items[0].duration = 10;
    expect(prepararAgenda(loaded.items)[1].time).toBe("09:10");
  });

  it("valida modo e hora externos sem apagar uma âncora legada válida", () => {
    const library = useLiturgyLibrary();
    const parsed = library.parseImport(
      JSON.stringify({
        name: "Culto",
        items: [
          { id: "legacy", time: "19:00" },
          { id: "invalid", time: "25:00", time_mode: { manual: true } },
        ],
      })
    )!;
    expect(parsed.items[0].time).toBe("19:00");
    expect(parsed.items[0].time_mode).toBeUndefined();
    expect(parsed.items[1].time).toBe("");
    expect(parsed.items[1].time_mode).toBeUndefined();
    expect(prepararAgenda(parsed.items)[0]).toMatchObject({ time: "19:00", time_mode: "manual" });
  });
});
