export interface DisplayInfo {
  /** Número no Electron; "screen-N" no navegador; null quando não há telas listáveis. */
  id: number | string | null;
  label: string;
  primary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface NativeDisplay {
  id: number;
  label?: string;
  primary?: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface OpenOptions {
  route: string;
  feature: string;
  monitorId?: number | string | null;
  fullscreen?: boolean;
  alwaysOnTop?: boolean;
  frame?: boolean;
}

export interface CategorizedDisplays {
  primaryDisplay: DisplayInfo | undefined;
  secondaryDisplay: DisplayInfo | undefined;
  primaryLabel: string | null;
  secondaryLabel: string | null;
  otherDisplays: DisplayInfo[];
}
