/**
 * Permissões que um dispositivo remoto pode ter.
 *
 * - root: acesso total (equivalente ao token global)
 * - music: abrir músicas, controlar player, navegar slides
 * - bible: projetar versículos, navegar bíblia
 * - liturgy: executar itens da liturgia
 * - announce: controlar anúncios
 */
export type DevicePermission = "root" | "music" | "bible" | "liturgy" | "announce" | "chat";

/** Lista completa de permissões disponíveis. */
export const DEVICE_PERMISSIONS: DevicePermission[] = [
  "root",
  "music",
  "bible",
  "liturgy",
  "announce",
  "chat",
];

/** Mapa permissão → chave de tradução (para UI). */
export const DEVICE_PERMISSION_LABELS: Record<DevicePermission, string> = {
  root: "options.transmission.permission_root",
  music: "options.transmission.permission_music",
  bible: "options.transmission.permission_bible",
  liturgy: "options.transmission.permission_liturgy",
  announce: "options.transmission.permission_announce",
  chat: "options.transmission.permission_chat",
};

/**
 * Dispositivo autorizado a acessar o app remotamente.
 *
 * Cada device tem dois identificadores:
 *  - `id`: UUID criado pelo desktop, usado como índice da tabela
 *  - `token`: UUID gerado para o QR code, usado para autenticação HTTP
 *
 * O middleware de aceita token global (legado) ou par device-id + device-token.
 */
export interface Device {
  /** UUID — índice da tabela de dispositivos (criado pelo desktop). */
  id: string;
  /** Token de acesso HTTP (UUID do QR code). */
  token: string;
  /** Nome do dispositivo (detectado automaticamente ou definido pelo usuário). */
  name: string;
  /** Modelo do dispositivo (ex: "iPhone 15", "Samsung Galaxy S24"). */
  model?: string;
  /** Plataforma do dispositivo. */
  platform: "android" | "ios" | "web";
  /** Data/hora do cadastro (ISO 8601). */
  registeredAt: string;
  /** Permissões concedidas ao dispositivo. */
  permissions: DevicePermission[];
}

/**
 * Dados brutos recebidos do dispositivo ao escanear o QR code.
 * Usado internamente no fluxo de registro antes de criar o Device completo.
 */
export interface PendingDevice {
  /** Token UUID gerado pelo desktop (vem do QR code). */
  token: string;
  /** Nome detectado pelo dispositivo. */
  name: string;
  /** Modelo detectado pelo dispositivo. */
  model?: string;
  /** Plataforma detectada pelo dispositivo. */
  platform: "android" | "ios" | "web";
}
