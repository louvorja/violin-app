/**
 * Permissões que um dispositivo remoto pode ter.
 *
 * - root: acesso total (equivalente ao token global)
 * - music: abrir músicas, controlar player, navegar slides
 * - bible: projetar versículos, navegar bíblia
 * - liturgy: executar itens da liturgia
 * - announce: controlar anúncios
 * - chat: enviar/ler mensagens do chat
 * - online_videos: consultar e projetar vídeos online (catálogo + Meus Vídeos)
 * - background_sound: listar/tocar os sons de fundo pelo controle remoto
 * - volume: ajustar o volume dos players (projeção + som de fundo) — só app
 * - media_library: navegar/projetar a Biblioteca de Mídia (e o Canva
 *   integrado) e enviar arquivos do celular para o desktop pelo remoto
 * - keyboard: enviar teclas de atalho (módulo Atalhos do app)
 */
export type DevicePermission =
  | "root"
  | "announce"
  | "background_sound"
  | "bible"
  | "chat"
  | "keyboard"
  | "liturgy"
  | "media_library"
  | "music"
  | "online_videos"
  | "volume";

/** Lista completa de permissões disponíveis. */
export const DEVICE_PERMISSIONS: DevicePermission[] = [
  "root",
  "announce",
  "background_sound",
  "bible",
  "chat",
  "keyboard",
  "liturgy",
  "media_library",
  "music",
  "online_videos",
  "volume",
];

/** Mapa permissão → chave de tradução (para UI). */
export const DEVICE_PERMISSION_LABELS: Record<DevicePermission, string> = {
  root: "options.transmission.permission_root",
  music: "options.transmission.permission_music",
  bible: "options.transmission.permission_bible",
  liturgy: "options.transmission.permission_liturgy",
  announce: "options.transmission.permission_announce",
  chat: "options.transmission.permission_chat",
  online_videos: "options.transmission.permission_online_videos",
  background_sound: "options.transmission.permission_background_sound",
  volume: "options.transmission.permission_volume",
  media_library: "options.transmission.permission_media_library",
  keyboard: "options.transmission.permission_keyboard",
};

/**
 * Dispositivo autorizado a acessar o app remotamente.
 *
 * Cada device tem dois identificadores:
 *  - `id`: fingerprint enviado pelo app no `register-device`
 *    (`identifierForVendor` no iOS, `ANDROID_ID` no Android); índice da tabela
 *  - `token`: UUID gerado para o QR code, usado para autenticação HTTP
 *
 * O middleware de aceita token global (legado) ou par device-id + device-token.
 */
export interface Device {
  /**
   * Identificador do aparelho enviado no `fingerprint` do `register-device`
   * (UUID `identifierForVendor` no iOS, `ANDROID_ID` no Android).
   */
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
  /**
   * Aguardando o operador definir as permissões na tela de aprovação.
   *
   * É estado EXPLÍCITO de propósito: antes, "sem permissões" significava
   * "pendente", e aí salvar um dispositivo sem nenhuma permissão o devolvia
   * para a fila de aprovação — inclusive depois de reiniciar o app. Sem
   * permissão agora significa **inerte** (o servidor HTTP recusa), que é outra
   * coisa. Ausente = registro anterior a este campo: nesse caso a lista vazia
   * ainda conta como pendente, para o dispositivo que chegou antes da mudança
   * não ficar esperando aprovação para sempre.
   */
  status?: "pending" | "approved";
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
