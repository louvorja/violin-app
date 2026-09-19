// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const require = createRequire(import.meta.url);
const { CHANNEL, extractSljaPaths, createQueue } = require("../fileOpen.js");

describe("extractSljaPaths", () => {
  let dir;
  let hino;
  let comEspaco;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "slja-"));
    hino = path.join(dir, "hino.slja");
    comEspaco = path.join(dir, "Hino Novo 1.SLJA");
    fs.writeFileSync(hino, "x");
    fs.writeFileSync(comEspaco, "x");
    fs.writeFileSync(path.join(dir, "leia.txt"), "x");
    fs.mkdirSync(path.join(dir, "pasta.slja"));
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("acha o .slja no argv do app empacotado", () => {
    expect(extractSljaPaths(["C:\\app\\LouvorJA.exe", hino])).toEqual([hino]);
  });

  it("ignora flags, o executável, o diretório do dev e outras extensões", () => {
    const argv = ["/usr/bin/electron", ".", "--ozone-platform=x11", path.join(dir, "leia.txt")];
    expect(extractSljaPaths(argv)).toEqual([]);
  });

  it("reconhece a extensão em qualquer caixa e com espaços no nome", () => {
    expect(extractSljaPaths([comEspaco])).toEqual([comEspaco]);
  });

  it("aceita file:// — é o que o %U do .desktop entrega no Linux", () => {
    expect(extractSljaPaths([pathToFileURL(comEspaco).href])).toEqual([comEspaco]);
  });

  it("resolve caminho relativo contra o diretório de quem chamou", () => {
    expect(extractSljaPaths(["hino.slja"], dir)).toEqual([hino]);
  });

  it("descarta o que não existe e o que é pasta com nome de .slja", () => {
    expect(extractSljaPaths([path.join(dir, "sumiu.slja"), path.join(dir, "pasta.slja")])).toEqual(
      []
    );
  });

  it("não repete o mesmo arquivo", () => {
    expect(extractSljaPaths([hino, hino, pathToFileURL(hino).href])).toEqual([hino]);
  });

  it("tolera argv inválido", () => {
    expect(extractSljaPaths(undefined)).toEqual([]);
    expect(extractSljaPaths([null, 42, ""])).toEqual([]);
  });
});

describe("createQueue", () => {
  const fakeTarget = () => ({ isDestroyed: vi.fn(() => false), send: vi.fn() });

  it("guarda o que chega antes do renderer e entrega no ready", () => {
    const queue = createQueue();
    queue.push(["/a.slja"]);
    queue.push(["/b.slja", "/c.slja"]);

    expect(queue.ready(fakeTarget())).toEqual(["/a.slja", "/b.slja", "/c.slja"]);
  });

  it("entrega cada arquivo uma vez só", () => {
    const queue = createQueue();
    queue.push(["/a.slja"]);
    queue.ready(fakeTarget());

    expect(queue.ready(fakeTarget())).toEqual([]);
  });

  it("depois do ready manda direto ao renderer, sem acumular", () => {
    const queue = createQueue();
    const target = fakeTarget();
    queue.ready(target);

    queue.push(["/a.slja"]);

    expect(target.send).toHaveBeenCalledWith(CHANNEL, ["/a.slja"]);
    expect(queue.ready(fakeTarget())).toEqual([]);
  });

  it("volta a acumular quando o renderer recarrega", () => {
    const queue = createQueue();
    const target = fakeTarget();
    queue.ready(target);
    queue.reset();

    queue.push(["/a.slja"]);

    expect(target.send).not.toHaveBeenCalled();
    expect(queue.ready(fakeTarget())).toEqual(["/a.slja"]);
  });

  it("não envia para janela destruída — acumula até a próxima", () => {
    const queue = createQueue();
    const target = fakeTarget();
    queue.ready(target);
    target.isDestroyed.mockReturnValue(true);

    queue.push(["/a.slja"]);

    expect(target.send).not.toHaveBeenCalled();
    expect(queue.ready(fakeTarget())).toEqual(["/a.slja"]);
  });

  it("ignora entrega vazia", () => {
    const queue = createQueue();
    const target = fakeTarget();
    queue.ready(target);

    queue.push([]);

    expect(target.send).not.toHaveBeenCalled();
  });
});
