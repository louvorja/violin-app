import { describe, expect, it } from "vitest";
import { parseJaImport } from "../useLiturgyLibrary";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";

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
});
