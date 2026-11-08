import { describe, expect, it } from "vitest";
import {
  attachPackedFiles,
  buildLlja,
  carriesFile,
  isLlja,
  readLlja,
  safeFileName,
  safePackagePath,
} from "../package";
import { LiturgyItemTypeEnum } from "@/enums/LiturgyItemTypeEnum";
import type { LiturgyItem } from "@/types/Liturgy";

function item(partial: Partial<LiturgyItem>): LiturgyItem {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    tipo: LiturgyItemTypeEnum.ANOTACAO,
    subtipo: "",
    musica: -1,
    item: "",
    subitem: "",
    cor: "#00004F",
    duration: 0,
    dir: "",
    dir_info: "E",
    url: "",
    escolha: false,
    has_instrumental_music: false,
    ...partial,
  };
}

const video = item({
  id: "video",
  tipo: LiturgyItemTypeEnum.ARQUIVO,
  item: "Vídeo de abertura",
  dir: "C:\\Users\\João\\Vídeos\\abertura.mp4",
});
const guardado = item({
  id: "foto",
  tipo: LiturgyItemTypeEnum.ARQUIVO,
  item: "Foto",
  dir: "foto.jpg",
  ref_id: "11111111-2222-3333-4444-555555555555",
});
const sumiu = item({
  id: "sumiu",
  tipo: LiturgyItemTypeEnum.ARQUIVO,
  item: "Arquivo apagado",
  dir: "/home/x/apagado.pdf",
});
const site = item({ id: "site", tipo: LiturgyItemTypeEnum.ARQUIVO, dir: "https://a.b/c.pdf" });
const nota = item({ id: "nota", item: "Boas-vindas" });
const personalizada = item({
  id: "minha",
  tipo: LiturgyItemTypeEnum.MUSICA,
  item: "Minha canção",
  ref_id: "abc",
});

const bytes: Record<string, string> = { video: "VIDEO-BYTES", foto: "FOTO-BYTES" };
const names: Record<string, string> = { video: "abertura.mp4", foto: "foto.jpg" };
async function readFile(i: LiturgyItem) {
  return bytes[i.id] ? { name: names[i.id], data: new Blob([bytes[i.id]]) } : null;
}

describe("safeFileName", () => {
  it("mantém acentos e troca só o que o Windows não aceita", () => {
    expect(safeFileName("Culto de Sábado — Missão")).toBe("Culto de Sábado — Missão");
    expect(safeFileName('Culto 13/12: "Natal"?')).toBe("Culto 13_12_ _Natal__");
    expect(safeFileName("  Fim.  ")).toBe("Fim");
    expect(safeFileName("")).toBe("Liturgia");
  });
});

describe("carriesFile", () => {
  it("arquivo do disco ou guardado no app vai no pacote; endereço da internet não", () => {
    expect(carriesFile(video)).toBe(true);
    expect(carriesFile(guardado)).toBe(true);
    expect(carriesFile(site)).toBe(false);
    expect(carriesFile(nota)).toBe(false);
  });
});

describe(".llja — ida e volta", () => {
  it("leva os arquivos, o nome, a cor e a ordem dos itens", async () => {
    const result = await buildLlja(
      { name: "Culto de Sábado", color: "#AA0000", items: [nota, video, guardado, site] },
      readFile
    );
    expect(result.missing).toEqual([]);
    expect(await isLlja(result.blob)).toBe(true);

    const pack = await readLlja(result.blob);
    expect(pack).not.toBeNull();
    const manifest = JSON.parse(pack!.json);
    // O mesmo envelope do JSON de troca do Classic.
    expect(manifest).toMatchObject({ schema: 1, name: "Culto de Sábado", color: "#AA0000" });
    expect(manifest.items.map((i: LiturgyItem) => i.id)).toEqual(["nota", "video", "foto", "site"]);
    // No outro computador o caminho daqui não vale: o item aponta para dentro do pacote.
    const v = manifest.items.find((i: LiturgyItem) => i.id === "video");
    expect(v).toMatchObject({ dir: "arquivos/abertura.mp4", dir_info: "L" });
    const f = manifest.items.find((i: LiturgyItem) => i.id === "foto");
    expect(f.ref_id).toBeUndefined();
    expect(manifest.items.find((i: LiturgyItem) => i.id === "site").dir).toBe("https://a.b/c.pdf");

    expect([...pack!.files.keys()].sort()).toEqual(["foto", "video"]);
    expect(await pack!.files.get("video")!.data.text()).toBe("VIDEO-BYTES");

    const stored: string[] = [];
    const { items, failed } = await attachPackedFiles(manifest.items, pack!.files, async (file) => {
      stored.push(`${file.name}:${await file.text()}`);
      return { dir: file.name, ref_id: `ref-${file.name}` };
    });
    expect(failed).toEqual([]);
    expect(stored.sort()).toEqual(["abertura.mp4:VIDEO-BYTES", "foto.jpg:FOTO-BYTES"]);
    expect(items.find((i) => i.id === "video")).toMatchObject({
      ref_id: "ref-abertura.mp4",
      dir: "abertura.mp4",
      dir_info: "E",
    });
    expect(items.find((i) => i.id === "nota")).toEqual(nota);
  });

  it("arquivo que não existe mais vai sem ele, e é avisado", async () => {
    const result = await buildLlja({ name: "x", items: [sumiu, video] }, readFile);
    expect(result.missing).toEqual(["Arquivo apagado"]);
  });

  it("avisa o que depende deste computador (música personalizada)", async () => {
    const result = await buildLlja({ name: "x", items: [personalizada, nota] }, readFile);
    expect(result.localOnly).toEqual(["Minha canção"]);
  });

  it("dois arquivos com o mesmo nome não se sobrescrevem", async () => {
    const outro = item({ ...video, id: "video2" });
    const r = await buildLlja({ name: "x", items: [video, outro] }, async () => ({
      name: "abertura.mp4",
      data: new Blob(["x"]),
    }));
    const manifest = JSON.parse((await readLlja(r.blob))!.json);
    expect(manifest.items.map((i: LiturgyItem) => i.dir)).toEqual([
      "arquivos/abertura.mp4",
      "arquivos/abertura (2).mp4",
    ]);
  });

  it("arquivo que não pôde ser guardado fica com o nome e entra em `failed`", async () => {
    const r = await buildLlja({ name: "x", items: [video] }, readFile);
    const pack = (await readLlja(r.blob))!;
    const { items, failed } = await attachPackedFiles(
      JSON.parse(pack.json).items,
      pack.files,
      async () => {
        throw new Error("sem espaço");
      }
    );
    expect(failed).toEqual(["Vídeo de abertura"]);
    expect(items[0]).toMatchObject({ dir: "arquivos/abertura.mp4", dir_info: "E" });
  });

  it("não é ZIP, ou ZIP sem liturgia.json: inválido", async () => {
    expect(await readLlja(new Blob(["{}"]))).toBeNull();
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("outra.txt", "x");
    expect(await readLlja(await zip.generateAsync({ type: "blob" }))).toBeNull();
  });

  it("abre o .llja do Classic: barra invertida, BOM e caixa diferente no nome", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "liturgia.json",
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
        })
    );
    zip.file("arquivos/Hino.MP3", "AUDIO");
    const pack = await readLlja(await zip.generateAsync({ type: "blob" }));
    expect(pack).not.toBeNull();
    expect(await pack!.files.get("item_1_avulso")!.data.text()).toBe("AUDIO");
    expect(pack!.files.get("item_1_avulso")!.name).toBe("Hino.MP3");
  });

  it("schema de versão que não conhece é recusado", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("liturgia.json", JSON.stringify({ schema: 2, name: "x", items: [] }));
    expect(await readLlja(await zip.generateAsync({ type: "blob" }))).toBeNull();
  });

  it("não lê caminho fora de arquivos/, absoluto ou que sobe de pasta", async () => {
    expect(safePackagePath("arquivos\\foto.jpg")).toBe("arquivos/foto.jpg");
    expect(safePackagePath("segredo.txt")).toBeNull();
    expect(safePackagePath("arquivos/../segredo.txt")).toBeNull();
    expect(safePackagePath("C:\\Windows\\win.ini")).toBeNull();
    expect(safePackagePath("/etc/passwd")).toBeNull();

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("segredo.txt", "x");
    zip.file(
      "liturgia.json",
      JSON.stringify({
        name: "x",
        items: [{ id: "a", tipo: "arquivo", dir: "arquivos/../segredo.txt", dir_info: "L" }],
      })
    );
    const pack = await readLlja(await zip.generateAsync({ type: "blob" }));
    expect(pack!.files.size).toBe(0);
  });
});
