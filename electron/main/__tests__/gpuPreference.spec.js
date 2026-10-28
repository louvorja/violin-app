import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import gpuPreference from "../gpuPreference.js";

const dirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lj-gpu-"));
  dirs.push(dir);
  return dir;
}
function fakeApp() {
  return { commandLine: { appendSwitch: vi.fn() } };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("gpuPreference", () => {
  it("classifica notebook pelo gabinete e trata o resto como computador de mesa", () => {
    expect(gpuPreference.classify([10])).toBe("laptop");
    expect(gpuPreference.classify([3, 9])).toBe("laptop");
    expect(gpuPreference.classify([3])).toBe("desktop");
    expect(gpuPreference.classify([35])).toBe("desktop");
    expect(gpuPreference.classify([])).toBeNull();
  });

  it("pede a placa dedicada só no Windows de mesa já detectado", () => {
    const dir = tempDir();
    const semDeteccao = fakeApp();
    expect(gpuPreference.apply(semDeteccao, dir, "win32").high_performance).toBe(false);
    expect(semDeteccao.commandLine.appendSwitch).not.toHaveBeenCalled();

    fs.writeFileSync(path.join(dir, gpuPreference.FILE), JSON.stringify({ device_class: "desktop" }));
    const mesa = fakeApp();
    expect(gpuPreference.apply(mesa, dir, "win32")).toEqual({ device_class: "desktop", high_performance: true });
    expect(mesa.commandLine.appendSwitch).toHaveBeenCalledWith("force_high_performance_gpu");

    const mac = fakeApp();
    gpuPreference.apply(mac, dir, "darwin");
    expect(mac.commandLine.appendSwitch).not.toHaveBeenCalled();

    fs.writeFileSync(path.join(dir, gpuPreference.FILE), JSON.stringify({ device_class: "laptop" }));
    const notebook = fakeApp();
    gpuPreference.apply(notebook, dir, "win32");
    expect(notebook.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it("detecta uma vez e grava o resultado para a próxima abertura", () => {
    const dir = tempDir();
    const run = vi.fn((_cmd, _args, _opts, done) => done(null, "3\r\n"));
    gpuPreference.detect(dir, { platform: "win32", run });
    expect(gpuPreference.readDeviceClass(dir)).toBe("desktop");

    gpuPreference.detect(dir, { platform: "win32", run });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("não grava nada quando a consulta falha ou fora do Windows", () => {
    const dir = tempDir();
    gpuPreference.detect(dir, { platform: "win32", run: (_c, _a, _o, done) => done(new Error("sem WMI"), "") });
    expect(gpuPreference.readDeviceClass(dir)).toBeNull();
    const run = vi.fn();
    gpuPreference.detect(dir, { platform: "linux", run });
    expect(run).not.toHaveBeenCalled();
  });
});
