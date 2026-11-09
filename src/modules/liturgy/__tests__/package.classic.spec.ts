import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { pointsIntoPackage, readClassicPackage } from "../package/classic";

async function zipOf(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "blob" });
}

describe(".llja do Classic", () => {
  it("lê a liturgia e os arquivos: barra invertida, BOM e caixa diferente no nome", async () => {
    const blob = await zipOf({
      "liturgia.json":
        "\uFEFF" +
        JSON.stringify({
          schema: 1,
          name: "Domingo",
          color: "#00004F",
          exportedAt: "2026-11-05T23:07:04",
          items: [
            {
              id: "item_1_avulso",
              tipo: "arquivo",
              item: "Hino",
              dir: "arquivos\\Hino.MP3",
              dir_info: "L",
            },
            { id: "item_2_avulso", tipo: "musica", item: "Louvor", musica: 12, escolha: false },
          ],
        }),
      "arquivos/Hino.MP3": "AUDIO",
    });
    const pack = await readClassicPackage(blob);
    expect(pack).not.toBeNull();
    expect(JSON.parse(pack!.liturgyJson).name).toBe("Domingo");
    expect(pack!.files).toHaveLength(1);
    expect(pack!.files[0]).toMatchObject({
      source: "liturgy",
      sourceId: "item_1_avulso",
      name: "Hino.MP3",
    });
    expect(await pack!.files[0].data.text()).toBe("AUDIO");
  });

  it("aceita o nome antigo liturgia.lja", async () => {
    const pack = await readClassicPackage(
      await zipOf({ "liturgia.lja": JSON.stringify({ name: "x", items: [] }) })
    );
    expect(pack).not.toBeNull();
  });

  it("schema de versão que não conhece é recusado", async () => {
    const blob = await zipOf({
      "liturgia.json": JSON.stringify({ schema: 2, name: "x", items: [] }),
    });
    expect(await readClassicPackage(blob)).toBeNull();
  });

  it("não lê caminho fora de arquivos/, absoluto ou que sobe de pasta", async () => {
    const blob = await zipOf({
      "segredo.txt": "x",
      "liturgia.json": JSON.stringify({
        name: "x",
        items: [
          { id: "a", tipo: "arquivo", dir: "arquivos/../segredo.txt", dir_info: "L" },
          { id: "b", tipo: "arquivo", dir: "segredo.txt", dir_info: "L" },
          { id: "c", tipo: "arquivo", dir: "C:\\Windows\\win.ini", dir_info: "L" },
        ],
      }),
    });
    const pack = await readClassicPackage(blob);
    expect(pack!.files).toHaveLength(0);
  });

  it("não é ZIP, ou ZIP sem liturgia.json: não é do Classic", async () => {
    expect(await readClassicPackage(new Blob(["{}"]))).toBeNull();
    expect(await readClassicPackage(await zipOf({ "outra.txt": "x" }))).toBeNull();
  });

  it("pointsIntoPackage só vale para o 'L'", () => {
    expect(pointsIntoPackage({ dir_info: "L" })).toBe(true);
    expect(pointsIntoPackage({ dir_info: "l" })).toBe(true);
    expect(pointsIntoPackage({ dir_info: "E" })).toBe(false);
    expect(pointsIntoPackage({})).toBe(false);
  });
});
