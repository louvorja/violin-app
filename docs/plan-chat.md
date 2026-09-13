# Plano: Sistema de Chat LouvorJA

## Visão Geral

Chat em tempo real entre todos os dispositivos conectados (web/desktop) e a aplicação local. Drawer híbrido (overlay ↔ fixo), persistência em IndexedDB via DocStore, atalho `Ctrl+I`/`Cmd+I`.

**Typing indicator** — feature planejada para implementação futura. Estrutura de dados e endpoints podem ser adicionados depois sem breaking changes.

---

## 1. Permissão `"chat"` no Device

**Arquivos:**
- `src/types/Device.ts` — adicionar `"chat"` ao union type, array e labels
- `src/lang/pt.json` / `src/lang/es.json` — chave `options.transmission.permission_chat`
- `src/components/DevicePermissionsDialog.vue` — já funciona automaticamente (filtra `DEVICE_PERMISSIONS`)

---

## 2. Tabela IndexedDB + Persistência

**Arquivos:**
- `src/constants/DbTables.ts` — nova tabela `CHAT_MESSAGES: "chat.messages"`
- `src/helpers/ChatStore.ts` — helper puro (sem Vue) seguindo padrão `CustomSongs.ts`:
  ```ts
  interface ChatMessage {
    id: string;           // crypto.randomUUID()
    sender: string;       // nome do dispositivo ou "App local"
    deviceId?: string;    // id do dispositivo (null = app local)
    text: string;
    timestamp: string;    // ISO
  }
  ```
  Métodos: `getAll()`, `put(msg)`, `clear()`, `getRecent(limit)` — via `DocStore` (IndexedIDB web, arquivo desktop)

---

## 3. BroadcastTypes + SSE Bridge

**Arquivos:**
- `src/helpers/BroadcastTypes.ts` — novo tipo:
  - `CHAT_MESSAGE` → `"chat_message"` (mensagem nova)
- `src/helpers/Broadcast.ts` — adicionar `CHAT_MESSAGE` a `STATEFUL_TYPES` (para SSE bridge)
- `electron/main/httpServer/events.js` — adicionar `"chat_message"` ao `REMOTE_RELAY_TYPES`

---

## 4. Endpoint HTTP — `POST /api/chat`

**Arquivo:** `electron/main/httpServer/routes.js`

```
POST /api/chat
Headers: X-Device-Id, X-Device-Token, Content-Type: application/json
Body: { text: string, sender: string }
Response: { ok: true, id: string }
```

- Validação: `text` obrigatório, max 2000 chars, rate limit simples (1 msg/seg por device)
- Cria objeto `ChatMessage` com `id`, `timestamp`
- Publica via `events.publish()` para SSE clients
- Envia IPC `transmission:chat-message` para renderer local (BroadcastChannel)

---

## 5. IPC Main → Renderer para Chat

**Arquivo:** `electron/main.cjs`
- Handler IPC `transmission:chat-message`: forward para `httpServer.publish()`

**Arquivo:** `electron/preload.cjs`
- `transmission.chatMessage(msg)` → `ipcRenderer.send("transmission:chat-message", msg)`

---

## 6. Composable `useChat.ts`

**Arquivo:** `src/composables/useChat.ts` (singleton)

Responsabilidades:
- Estado reativo: `messages: Ref<ChatMessage[]>`, `isOpen: Ref<boolean>`, `isPinned: Ref<boolean>`, `unreadCount: Ref<number>`
- Carregar histórico do `ChatStore` ao iniciar
- Enviar mensagem local (app) via `Broadcast.send(CHAT_MESSAGE, ...)` + persistir via `ChatStore.put()`
- Receber mensagens de dispositivos remotos: ouvir `CHAT_MESSAGE` via `useBroadcastListener`
- Auto-open: quando `autoOpenOnNew=true` e mensagem chega de dispositivo remoto, abrir drawer
- Persistir `autoOpenOnNew` e `isPinned` via `UserData`

---

## 7. UI — ShellTools Button

**Arquivo:** `src/layout/shell/ShellTools.vue`

Novo botão com badge de não lidas + animação pulse:

```vue
<LjTooltip :text="t('shell.chat')" side="bottom">
  <button type="button" class="shell-tool" :class="{ 'shell-tool--active': chatOpen }" @click="toggleChat">
    <LjIcon :icon="ICONS.UI.MESSAGE_BULLETED" :size="sizeIcon" />
    <span v-if="unreadCount > 0" class="shell-tool__badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
  </button>
</LjTooltip>
```

---

## 8. UI — ChatDrawer (componente principal)

**Arquivo:** `src/components/ChatDrawer.vue`

Drawer híbrido com `LjDrawer`:
- **Modo overlay** (temporary): abre por cima do conteúdo, fecha com Esc/clique fora
- **Modo fixo** (pinned): empurra o conteúdo, fecha com botão minimize ou Ctrl+I
- Toggle entre modos via botão pin/unpin no header

Header com:
- Título "Chat"
- Botão auto-open (bell on/off)
- Botão pin/unpin

Layout messenger:
- Mensagens do app local: alinhadas à direita, cor diferenciada
- Mensagens de dispositivos: alinhadas à esquerda, nome do remetente destacado
- Timestamp em cada mensagem
- Scroll automático para baixo em nova mensagem

Input na parte inferior com Enter para enviar.

---

## 9. Atalho de Teclado

**Arquivo:** `src/views/Shell.vue` (no `onMounted`)

```ts
hotkeys.register(["ctrl+i", "meta+i"], () => {
  chatStore.toggleOpen();
}, { description: "chat.toggle", label: "Chat", group: "ui" });
```

---

## 10. Integração no Shell.vue

**Arquivo:** `src/views/Shell.vue`

- Importar e renderizar `<ChatDrawer />` como sibling dos dialogs existentes (após `<AppFooter />`)
- O drawer controla a si mesmo via `useChat().isOpen`

---

## 11. Traduções

**Arquivos:** `src/lang/pt.json`, `src/lang/es.json`

```json
{
  "chat": {
    "title": "Chat",
    "placeholder": "Digite sua mensagem...",
    "send": "Enviar",
    "auto_open": "Abrir automaticamente com novas mensagens",
    "pin": "Fixar painel",
    "unpin": "Desfixar painel",
    "empty": "Nenhuma mensagem ainda",
    "toggle": "Chat"
  },
  "options.transmission.permission_chat": "Chat"
}
```

---

## 12. Ícone

`ICONS.UI.MESSAGE_BULLETED` (`"message-2"`) já existe — usar para o botão e drawer.
Pin/unpin: verificar se `ICONS.UI.PIN` / `ICONS.UI.PIN_OFF` existem no Tabler.

---

## Resumo de Arquivos

| Arquivo | Ação |
|---------|------|
| `src/types/Device.ts` | Adicionar `"chat"` permission |
| `src/constants/DbTables.ts` | Adicionar `CHAT_MESSAGES` |
| `src/constants/UserDataKeys.ts` | Adicionar chaves `CHAT.AUTO_OPEN`, `CHAT.IS_PINNED` |
| `src/helpers/ChatStore.ts` | **Novo** — persistência IndexedDB |
| `src/helpers/BroadcastTypes.ts` | Adicionar `CHAT_MESSAGE` |
| `src/helpers/Broadcast.ts` | Adicionar aos `STATEFUL_TYPES` |
| `src/composables/useChat.ts` | **Novo** — singleton chat state |
| `src/components/ChatDrawer.vue` | **Novo** — UI do chat |
| `src/layout/shell/ShellTools.vue` | Adicionar botão chat com badge |
| `src/views/Shell.vue` | Importar ChatDrawer + hotkey Ctrl+I |
| `electron/main/httpServer/routes.js` | `POST /api/chat` |
| `electron/main/httpServer/events.js` | Adicionar `chat_message` ao relay |
| `electron/main.cjs` | IPC handler para chat |
| `electron/preload.cjs` | Bridge chatMessage |
| `src/lang/pt.json` | Traduções chat |
| `src/lang/es.json` | Traduções chat |
| `src/config/Icons.ts` | Verificar/adicionar ícones pin |

---

## Fluxo de Dados

```
App local digita mensagem
  → useChat.sendMessage()
    → ChatStore.put(msg)           — persiste no IndexedDB
    → Broadcast.send(CHAT_MESSAGE) — entrega local (outros BrowserWindows)
    → IPC → main.cjs → events.publish() — entrega via SSE (devices remotos)

Device remoto digita mensagem
  → POST /api/chat { text, sender }
    → routes.js valida auth + permission "chat"
    → ChatMessage criado
    → events.publish(CHAT_MESSAGE) — entrega via SSE
    → SSE bridge no browser → CustomEvent("louvorja-sse")
    → Broadcast.ts listener → ChatStore.put() + UI atualiza
```

---

## Ordem de Implementação

1. Types/Device.ts + DbTables.ts + UserDataKeys.ts (fundação)
2. ChatStore.ts (persistência)
3. BroadcastTypes.ts + Broadcast.ts + events.js (canal de comunicação)
4. routes.js + main.cjs + preload.cjs (endpoint HTTP + IPC)
5. useChat.ts (lógica central)
6. ChatDrawer.vue (UI)
7. ShellTools.vue (botão)
8. Shell.vue (integração + hotkey)
9. i18n + Icons

---

## Typing Indicator (Futuro)

Feature removida deste plano para simplificação inicial. Pode ser adicionada depois com:
- Endpoint `POST /api/chat/typing` → `{ sender, typing: boolean }`
- BroadcastType `CHAT_TYPING`
- Estado `typingDevices: Ref<Map<string, {sender, timeout}>>` no composable
- UI indicator "X está digitando..." com animação
