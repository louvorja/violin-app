import { describe, expect, it } from "vitest";
import { shouldAutoInstallCatalog } from "../CatalogAutoInstall";

const nav = (connection?: object) => ({ connection }) as unknown as Navigator;
const pwa = { desktop: false, installed: true, online: true };

describe("download automático do catálogo", () => {
  it("o app instalado, com internet, baixa sozinho", () => {
    expect(shouldAutoInstallCatalog(pwa, nav())).toBe(true);
    expect(shouldAutoInstallCatalog(pwa, nav({ effectiveType: "4g" }))).toBe(true);
  });

  it("aba comum do navegador não baixa o catálogo sem pedir", () => {
    expect(shouldAutoInstallCatalog({ ...pwa, installed: false }, nav())).toBe(false);
  });

  it("desktop baixa automaticamente, independentemente da instalação do PWA", () => {
    expect(shouldAutoInstallCatalog({ ...pwa, desktop: true, installed: false }, nav())).toBe(true);
    expect(shouldAutoInstallCatalog({ ...pwa, desktop: true }, nav({ saveData: true }))).toBe(true);
  });

  it("desktop aguarda a conexão voltar", () => {
    expect(shouldAutoInstallCatalog({ ...pwa, desktop: true, online: false }, nav())).toBe(false);
  });

  it("sem internet não tenta", () => {
    expect(shouldAutoInstallCatalog({ ...pwa, online: false }, nav())).toBe(false);
  });

  it("respeita economia de dados e conexão 2G", () => {
    expect(shouldAutoInstallCatalog(pwa, nav({ saveData: true }))).toBe(false);
    expect(shouldAutoInstallCatalog(pwa, nav({ effectiveType: "2g" }))).toBe(false);
    expect(shouldAutoInstallCatalog(pwa, nav({ effectiveType: "slow-2g" }))).toBe(false);
  });
});
