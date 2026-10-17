/** Snapshot nativo restrito a versões, sem caminhos ou identificadores da máquina. */
export interface DesktopSystemInfo {
  platform: "darwin" | "win32" | "linux";
  systemVersion?: string;
  kernelRelease?: string;
  processArch?: string;
  windowsName?: string;
  linux?: {
    id?: string;
    name?: string;
    version?: string;
    source: "/etc/os-release" | "/usr/lib/os-release";
  };
}

export type EnvironmentProperties = Record<string, string>;
