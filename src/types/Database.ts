/** Metadados de configuração do banco de dados remoto. */
export interface DbConfig {
  datetime: string;
  latest_updated: string;
  version: number;
  version_number: number;
}

/** Progresso de uma fase do download/injeção do bundle. */
export interface BundleProgress {
  phase: "download" | "extract" | "inject";
  current: number;
  total: number;
  detail?: string;
  bytesReceived?: number;
  bytesTotal?: number;
  bytesPerSecond?: number;
}
