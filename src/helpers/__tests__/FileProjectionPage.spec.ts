import { describe, expect, it } from "vitest";
import {
  adotarProjecaoExterna,
  fileProjectionPageFor,
  moverPaginaPdf,
} from "@/helpers/FileProjectionPage";

describe("fileProjectionPageFor", () => {
  it("rejects a delayed page from a previous PDF", () => {
    expect(fileProjectionPageFor({ playback_id: "old", page: 8 }, "new")).toBeNull();
    expect(fileProjectionPageFor({ page: 8 }, "new")).toBeNull();
    expect(fileProjectionPageFor({ playback_id: "new", page: 2 }, "new")).toEqual({ page: 2 });
    expect(fileProjectionPageFor({ playback_id: "new", page: 2, source: "operator" }, "new"))
      .toEqual({ page: 2, source: "operator" });
  });

  it("rejects malformed page metadata", () => {
    expect(fileProjectionPageFor({ playback_id: "pdf", page: 0 }, "pdf")).toBeNull();
    expect(fileProjectionPageFor({ playback_id: "pdf", page: 2.5 }, "pdf")).toBeNull();
    expect(fileProjectionPageFor({ playback_id: "pdf", page: 2, totalPages: -1 }, "pdf")).toBeNull();
    expect(fileProjectionPageFor({ playback_id: "pdf", page: 2, source: "unknown" }, "pdf")).toBeNull();
  });
});

describe("moverPaginaPdf", () => {
  const PDF = JSON.stringify({ url: "louvorja://local/x.pdf", type: "pdf", playback_id: "P1", page: 3 });

  it("avança e volta gravando a página no cache de reabertura", () => {
    const avanca = moverPaginaPdf(PDF, 1)!;
    expect(avanca.comando).toEqual({ playback_id: "P1", page: 4, source: "operator" });
    expect(JSON.parse(avanca.storage).page).toBe(4);

    const volta = moverPaginaPdf(avanca.storage, -1)!;
    expect(volta.comando).toMatchObject({ page: 3 });
    expect(volta.storage).toBe(PDF);
  });

  it("na página 1 não manda comando nenhum — mas também não cai nos slides", () => {
    const primeira = JSON.stringify({ type: "pdf", playback_id: "P1", page: 1 });

    const r = moverPaginaPdf(primeira, -1);

    expect(r).not.toBeNull();
    expect(r!.comando).toBeNull();
    expect(r!.storage).toBe(primeira);
  });

  it("sem PDF no palco devolve null (é o sinal para os slides de música)", () => {
    expect(moverPaginaPdf(null, 1)).toBeNull();
    expect(moverPaginaPdf(JSON.stringify({ type: "image", url: "x.png" }), 1)).toBeNull();
    expect(moverPaginaPdf("não é json", 1)).toBeNull();
    expect(moverPaginaPdf(JSON.stringify({ type: "pdf" }), 1)).toBeNull();
  });

  it("página ausente ou inválida começa em 1", () => {
    const semPagina = JSON.stringify({ type: "pdf", playback_id: "P1" });
    expect(moverPaginaPdf(semPagina, 1)!.comando).toMatchObject({ page: 2 });

    const invalida = JSON.stringify({ type: "pdf", playback_id: "P1", page: -4 });
    expect(moverPaginaPdf(invalida, 1)!.comando).toMatchObject({ page: 2 });
  });

  it("guarda o resto do payload — é o mesmo cache que a janela retoma", () => {
    const bruto = JSON.stringify({ type: "pdf", playback_id: "P1", page: 1, title: "Deck", backward: true });

    const r = moverPaginaPdf(bruto, 1)!;

    expect(JSON.parse(r.storage)).toMatchObject({
      type: "pdf",
      playback_id: "P1",
      title: "Deck",
      backward: true,
      page: 2,
    });
  });
});

describe("adotarProjecaoExterna", () => {
  const PDF_FORA = { type: "pdf", playback_id: "X1", title: "Slide Páscoa", pageCount: 6 };

  it("adota o PDF que veio de fora (aba Canva, liturgia)", () => {
    expect(adotarProjecaoExterna(PDF_FORA, undefined)).toEqual({
      acao: "adotar",
      playback_id: "X1",
      title: "Slide Páscoa",
      page: 1,
      declaredPageCount: 6,
    });
  });

  it("o nosso próprio PDF não é adotado — seria loop", () => {
    expect(adotarProjecaoExterna(PDF_FORA, "X1")).toEqual({ acao: "ignorar" });
  });

  it("outro PDF entrando no lugar do nosso É adotado", () => {
    expect(adotarProjecaoExterna({ type: "pdf", playback_id: "N1" }, "X1")).toMatchObject({
      acao: "adotar",
      playback_id: "N1",
    });
  });

  it("projeção encerrada limpa E desfaz o playback da lista", () => {
    expect(adotarProjecaoExterna({ action: "clear" }, "X1")).toEqual({
      acao: "limpar",
      encerrada: true,
    });
    expect(adotarProjecaoExterna(null, undefined)).toEqual({ acao: "limpar", encerrada: true });
  });

  it("outra mídia no palco limpa sem desfazer a lista", () => {
    expect(adotarProjecaoExterna({ type: "image", url: "x.png" }, "X1")).toEqual({
      acao: "limpar",
      encerrada: false,
    });
    expect(adotarProjecaoExterna({ type: "video", url: "x.mp4" }, undefined)).toEqual({
      acao: "limpar",
      encerrada: false,
    });
  });

  it("payload sem tipo não é nada projetável", () => {
    expect(adotarProjecaoExterna({ action: "something" }, undefined)).toEqual({ acao: "ignorar" });
  });

  it("campos ruins não contaminam a barra", () => {
    const r = adotarProjecaoExterna(
      { type: "pdf", playback_id: "X1", title: 42, page: -3, pageCount: "6" },
      undefined
    );
    expect(r).toEqual({ acao: "adotar", playback_id: "X1", title: "", page: 1 });
  });
});
