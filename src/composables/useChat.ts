import { ref, computed } from "vue";
import ChatStore, { type ChatMessage } from "@/helpers/ChatStore";
import Broadcast from "@/helpers/Broadcast";
import { BROADCAST_TYPE } from "@/helpers/BroadcastTypes";
import Platform from "@/helpers/Platform";
import $userdata from "@/helpers/UserData";
import { KEYS } from "@/constants/UserDataKeys";

const messages = ref<ChatMessage[]>([]);
const isOpen = ref(false);
const isPinned = ref(false);
const autoOpenOnNew = ref(true);
const unreadCount = ref(0);
let _historyLoaded = false;
let _listening = false;
let _loadingHistory = false;
const _pendingDuringLoad: ChatMessage[] = [];

function _onMessage(msg: ChatMessage, remote = false): void {
  if (messages.value.some((m) => m.id === msg.id)) return;

  if (_loadingHistory) {
    _pendingDuringLoad.push(msg);
    return;
  }

  messages.value = [...messages.value, msg];

  if (msg.deviceId) {
    ChatStore.put(msg);
  }

  if (!isOpen.value) {
    unreadCount.value++;
  }

  if (autoOpenOnNew.value && remote) {
    isOpen.value = true;
  }
}

function _startListening(): void {
  if (_listening) return;
  _listening = true;

  Broadcast.listen((bcMsg) => {
    if (bcMsg.type === BROADCAST_TYPE.CHAT_MESSAGE) {
      _onMessage(bcMsg.payload as ChatMessage);
    }
  });

  if (Platform.transmission?.onChatMessage) {
    Platform.transmission.onChatMessage((msg: ChatMessage) => {
      _onMessage(msg, true);
    });
  }
}

async function loadHistory(): Promise<void> {
  if (_historyLoaded) return;
  _historyLoaded = true;
  _loadingHistory = true;

  const stored = await ChatStore.getAll();
  messages.value = stored;

  _loadingHistory = false;

  if (_pendingDuringLoad.length > 0) {
    const existing = new Set(messages.value.map((m) => m.id));
    const newMsgs = _pendingDuringLoad.filter((m) => !existing.has(m.id));
    if (newMsgs.length > 0) {
      messages.value = [...messages.value, ...newMsgs];
      for (const msg of newMsgs) {
        if (msg.deviceId) ChatStore.put(msg);
      }
    }
    _pendingDuringLoad.length = 0;
  }
}

export function useChat() {
  if (!_listening) {
    autoOpenOnNew.value = $userdata.get<boolean>(KEYS.CHAT.AUTO_OPEN, true) !== false;
    isPinned.value = $userdata.get<boolean>(KEYS.CHAT.IS_PINNED, false) === true;
    _startListening();
  }

  const recentMessages = computed(() => messages.value.slice(-100));

  function sendMessage(text: string): void {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: "Operador",
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };

    ChatStore.put(msg);
    Broadcast.send(BROADCAST_TYPE.CHAT_MESSAGE, msg);
    _onMessage(msg);

    if (Platform.transmission?.broadcast) {
      Platform.transmission.broadcast({ type: BROADCAST_TYPE.CHAT_MESSAGE, payload: msg });
    }
  }

  function toggleOpen(): void {
    isOpen.value = !isOpen.value;
    if (isOpen.value) {
      unreadCount.value = 0;
    }
  }

  function setOpen(value: boolean): void {
    isOpen.value = value;
    if (value) {
      unreadCount.value = 0;
    }
  }

  function togglePin(): void {
    isPinned.value = !isPinned.value;
    $userdata.set(KEYS.CHAT.IS_PINNED, isPinned.value);
  }

  function setAutoOpen(value: boolean): void {
    autoOpenOnNew.value = value;
    $userdata.set(KEYS.CHAT.AUTO_OPEN, value);
  }

  async function clearHistory(): Promise<void> {
    await ChatStore.clear();
    messages.value = [];
  }

  return {
    messages: recentMessages,
    allMessages: messages,
    isOpen,
    isPinned,
    autoOpenOnNew,
    unreadCount,
    sendMessage,
    toggleOpen,
    setOpen,
    togglePin,
    setAutoOpen,
    loadHistory,
    clearHistory,
  };
}
