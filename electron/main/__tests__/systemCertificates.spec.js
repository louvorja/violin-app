// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { configureSystemCertificates } = require("../systemCertificates.js");

describe("systemCertificates", () => {
  it("não altera o runtime fora do Windows", () => {
    const tls = { getCACertificates: vi.fn(), setDefaultCACertificates: vi.fn() };

    expect(configureSystemCertificates({ platform: "linux", tls })).toEqual({
      enabled: false,
      supported: false,
      defaultCount: 0,
      systemCount: 0,
      addedCount: 0,
    });
    expect(tls.getCACertificates).not.toHaveBeenCalled();
    expect(tls.setDefaultCACertificates).not.toHaveBeenCalled();
  });

  it("mescla as CAs do Windows e remove duplicatas", () => {
    const tls = {
      getCACertificates: vi.fn((kind) =>
        kind === "default" ? ["MOZILLA", "SHARED"] : ["SHARED", "IGREJA"]
      ),
      setDefaultCACertificates: vi.fn(),
    };

    expect(configureSystemCertificates({ platform: "win32", tls })).toEqual({
      enabled: true,
      supported: true,
      defaultCount: 2,
      systemCount: 2,
      addedCount: 1,
    });
    expect(tls.setDefaultCACertificates).toHaveBeenCalledWith(["MOZILLA", "SHARED", "IGREJA"]);
  });

  it("degrada para no-op quando o runtime não expõe a API", () => {
    expect(configureSystemCertificates({ platform: "win32", tls: {} })).toMatchObject({
      enabled: false,
      supported: false,
      addedCount: 0,
    });
  });

  it("não deixa uma falha do trust store impedir o boot", () => {
    const tls = {
      getCACertificates: vi.fn(() => {
        throw new Error("cert store bloqueado");
      }),
      setDefaultCACertificates: vi.fn(),
    };

    expect(configureSystemCertificates({ platform: "win32", tls })).toMatchObject({
      enabled: false,
      supported: true,
      error: "cert store bloqueado",
    });
  });
});
