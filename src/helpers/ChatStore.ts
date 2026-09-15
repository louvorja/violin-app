/**
 * @category helper-puro — Persistência de mensagens do chat.
 * Usa DocStore (IndexedDB web, arquivo desktop) seguindo o padrão de CustomSongs.ts.
 */
import DocStore from "@/helpers/DocStore";
import { DB_TABLE } from "@/constants/DbTables";

export interface ChatMessage {
  id: string;
  sender: string;
  deviceId?: string;
  platform?: "android" | "ios" | "web";
  text: string;
  timestamp: string;
}

const COLLECTION = DB_TABLE.CHAT_MESSAGES;

export default {
  async getAll(): Promise<ChatMessage[]> {
    const msgs = await DocStore.getAll<ChatMessage>(COLLECTION);
    return msgs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  },

  async getRecent(limit: number): Promise<ChatMessage[]> {
    const all = await this.getAll();
    return all.slice(-limit);
  },

  async put(msg: ChatMessage): Promise<void> {
    await DocStore.put(COLLECTION, msg);
  },

  async clear(): Promise<void> {
    await DocStore.clear(COLLECTION);
  },
};
