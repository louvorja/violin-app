# Integração de servidores LouvorJA com o app de controle remoto

Este documento descreve o contrato HTTP/SSE que uma versão do **LouvorJA desktop**
precisa implementar para ser controlada pelo app **LouvorJA Violin Remote**
(Android/iOS).

> Última revisão: **2026-11-21**.

O app fala direto com o servidor HTTP do desktop na rede local — não existe backend
próprio, nuvem ou Firebase. Quem implementa o servidor precisa expor as rotas abaixo
na mesma máquina/rede em que o app vai se conectar.

> **Escopo deste guia**
>
> - **Operação dos módulos:** somente o protocolo **Violin** (Electron), que é a
>   referência e o mais completo.
> - **Protocolo clássico (Delphi):** a seção de autenticação/pareamento cobre as
>   diferenças (inclusive v1 × v2 e o `ping`). A operação dos módulos do clássico
>   não é detalhada aqui.
> - A implementação de referência fica em `electron/main/httpServer/` do repositório
>   `louvorja/violin-app`. Os nomes de rota, permissões e formatos abaixo foram
>   extraídos dela e dos clients do app.

> **Segurança:** o protocolo é HTTP **sem TLS**, pensado para a rede local. Não
> exponha a porta 7070 diretamente na internet; use VPN/firewall. O token é a
> autorização do controle remoto.

---

## Sumário

- [1. Visão geral](#1-visão-geral)
  - [1.1 Escolha do protocolo](#11-escolha-do-protocolo)
- [2. Convenções](#2-convenções)
  - [2.1 URL base](#21-url-base)
  - [2.2 Envelopes e erros](#22-envelopes-e-erros)
  - [2.3 Códigos HTTP usados pelo app](#23-códigos-http-usados-pelo-app)
  - [2.4 Timeouts do app](#24-timeouts-do-app)
  - [2.5 Semântica de polling](#25-semântica-de-polling)
- [3. Autenticação e pareamento](#3-autenticação-e-pareamento)
  - [3.1 Violin (recomendado)](#31-violin-recomendado)
    - [3.1.1 QR de pareamento](#311-qr-de-pareamento)
    - [3.1.2 Registro do dispositivo](#312-registro-do-dispositivo)
    - [3.1.3 Chamadas autenticadas](#313-chamadas-autenticadas)
    - [3.1.4 Ping e negociação de módulos](#314-ping-e-negociação-de-módulos)
    - [3.1.5 SSE](#315-sse)
    - [3.1.6 Fluxo completo (exemplo)](#316-fluxo-completo-exemplo)
  - [3.2 Clássico (Delphi)](#32-clássico-delphi)
    - [3.2.1 QR do clássico](#321-qr-do-clássico)
    - [3.2.2 Ping v1](#322-ping-v1)
    - [3.2.3 Detecção v1 × v2](#323-detecção-v1--v2)
    - [3.2.4 Autenticação por versão](#324-autenticação-por-versão)
    - [3.2.5 Módulos por versão](#325-módulos-por-versão)
    - [3.2.6 Comparativo rápido](#326-comparativo-rápido)
- [4. Núcleo (comum a todos os módulos Violin)](#4-núcleo-comum-a-todos-os-módulos-violin)
  - [4.1 `GET /api/ping`](#41-get-apiping)
  - [4.2 `GET /api/clock`](#42-get-apiclock)
  - [4.3 `POST /api/register-device`](#43-post-apiregister-device)
  - [4.4 `GET /events` (SSE)](#44-get-events-sse)
  - [4.5 `POST /api/projections/close`](#45-post-apiprojectionsclose)
  - [4.6 `GET /api/db/:path`](#46-get-apidbpath)
- [5. Módulos (protocolo Violin)](#5-módulos-protocolo-violin)
  - [5.1 Música](#51-música)
    - [5.1.1 Busca](#511-busca)
    - [5.1.2 Catálogo (álbuns e faixas)](#512-catálogo-álbuns-e-faixas)
    - [5.1.3 Executar música](#513-executar-música)
    - [5.1.4 Faixa anterior/próxima](#514-faixa-anteriorpróxima)
  - [5.2 Slides](#52-slides)
    - [5.2.1 Consultar estado (`playing-check`)](#521-consultar-estado-playing-check)
    - [5.2.2 Comandos](#522-comandos)
    - [5.2.3 Ações de Bíblia no mesmo endpoint](#523-ações-de-bíblia-no-mesmo-endpoint)
    - [5.2.4 SSE de slides](#524-sse-de-slides)
  - [5.3 Bíblia](#53-bíblia)
    - [5.3.1 Projetar versículo](#531-projetar-versículo)
    - [5.3.2 Próximo / anterior / fechar](#532-próximo--anterior--fechar)
    - [5.3.3 Dados da Bíblia](#533-dados-da-bíblia)
    - [5.3.4 Fechar](#534-fechar)
  - [5.4 Liturgia](#54-liturgia)
    - [5.4.1 Listar itens do dia](#541-listar-itens-do-dia)
    - [5.4.2 Executar item](#542-executar-item)
  - [5.5 Anúncios](#55-anúncios)
    - [5.5.1 Listar](#551-listar)
    - [5.5.2 Projetar / navegar / parar](#552-projetar--navegar--parar)
  - [5.6 Biblioteca de Mídia](#56-biblioteca-de-mídia)
    - [5.6.1 Acervo](#561-acervo)
    - [5.6.2 Canva (opcional)](#562-canva-opcional)
    - [5.6.3 Playlist](#563-playlist)
    - [5.6.4 Comandos](#564-comandos)
    - [5.6.5 Upload do celular](#565-upload-do-celular)
  - [5.7 Som de fundo e volume](#57-som-de-fundo-e-volume)
    - [5.7.1 Estado](#571-estado)
    - [5.7.2 Comandos](#572-comandos)
    - [5.7.3 Volume](#573-volume)
  - [5.8 Vídeos Online](#58-vídeos-online)
    - [5.8.1 Álbuns](#581-álbuns)
    - [5.8.2 Vídeos e busca](#582-vídeos-e-busca)
    - [5.8.3 Projetar / encerrar](#583-projetar--encerrar)
    - [5.8.4 Miniaturas de Meus Vídeos](#584-miniaturas-de-meus-vídeos)
  - [5.9 Player](#59-player)
    - [5.9.1 Estado](#591-estado)
    - [5.9.2 Comandos](#592-comandos)
  - [5.10 Cronômetro](#510-cronômetro)
    - [5.10.1 Estado](#5101-estado)
    - [5.10.2 Comandos](#5102-comandos)
  - [5.11 Sorteio](#511-sorteio)
    - [5.11.1 Estado](#5111-estado)
    - [5.11.2 Comandos](#5112-comandos)
  - [5.12 Apresentador](#512-apresentador)
  - [5.13 Projeções](#513-projeções)
  - [5.14 Teclado / Atalhos](#514-teclado--atalhos)
  - [5.15 Chat](#515-chat)
    - [5.15.1 Enviar](#5151-enviar)
    - [5.15.2 Histórico](#5152-histórico)
- [6. SSE — eventos](#6-sse--eventos)
  - [6.1 `slides_data`](#61-slides_data)
  - [6.2 `music_presentation_snapshot`](#62-music_presentation_snapshot)
  - [6.3 `slide_change`](#63-slide_change)
  - [6.4 `media_close`](#64-media_close)
  - [6.5 `media_state`](#65-media_state)
  - [6.6 `stopwatch_state`](#66-stopwatch_state)
  - [6.7 `chat_message`](#67-chat_message)
  - [6.8 Replay e keepalive](#68-replay-e-keepalive)
- [7. Negociação de features e permissões](#7-negociação-de-features-e-permissões)
  - [7.1 `features`](#71-features)
  - [7.2 `permissions` (roles)](#72-permissions-roles)
- [8. Checklist de implementação](#8-checklist-de-implementação)
  - [8.1 Mínimo para o app conectar](#81-mínimo-para-o-app-conectar)
  - [8.2 Se anunciar um módulo, implemente](#82-se-anunciar-um-módulo-implemente)
  - [8.3 Testes manuais rápidos](#83-testes-manuais-rápidos)
  - [8.4 Compatibilidade](#84-compatibilidade)
- [9. Referência rápida de rotas](#9-referência-rápida-de-rotas)
- [10. Exemplos rápidos de curl (Violin)](#10-exemplos-rápidos-de-curl-violin)
  - [Música](#música)
  - [Bíblia](#bíblia)
  - [Liturgia](#liturgia)
  - [Anúncios](#anúncios)
  - [Som de fundo / volume](#som-de-fundo--volume)
  - [Player](#player)
  - [Cronômetro](#cronômetro)
  - [Sorteio](#sorteio)
  - [Teclado / Chat](#teclado--chat)
  - [SSE](#sse)

---

## 1. Visão geral

```
┌──────────────────────┐        HTTP + SSE         ┌───────────────────────────┐
│  App Android/iOS     │  ──────────────────────▶  │  LouvorJA desktop         │
│  (controle remoto)   │  ◀──────────────────────  │  http://<host>:<porta>    │
└──────────────────────┘                           └───────────────────────────┘
```

- Transporte: **HTTP** (o app usa `http://`; URLs `https` não são aceitas no
  pareamento clássico).
- Porta padrão: **7070**.
- Formato: **JSON** em quase tudo; uploads de mídia usam bytes crus.
- Autenticação: token na query (`?token=`) **ou** par de headers de dispositivo
  (`X-Device-Id` + `X-Device-Token`) no Violin; `Authorization: Bearer` no clássico v2.
- Tempo real: **SSE** em `GET /events` no Violin. O clássico não tem SSE; o app faz
  polling.

### 1.1 Escolha do protocolo

O app tem dois modos, escolhidos pelo **conteúdo do QR code** (ou pela tela de
configurações):

| Modo | QR | Como o app identifica |
|---|---|---|
| **Violin** | `violin-remote://register?token=...&host=...&port=...` | prefixo `violin-remote://` |
| **Clássico** | `http://<host>:<porta>/?token=...` | URL HTTP com `token=` |

O modo clássico ainda se divide em **v1** e **v2**, detectados em runtime (veja
[3.2](#32-clássico-delphi)).

---

## 2. Convenções

### 2.1 URL base

```
http://<host>:<porta>
```

As rotas ficam na **raiz** do servidor (sem prefixo de aplicação): `/api/...` e
`/events`.

O app guarda host, porta e token por perfil (Violin e clássico separados). O host
pode ser IP, hostname ou `nome.local`; o app resolve o IP para o WebView das
projeções.

> Os valores iniciais `192.168.0.1`, `7070` e `ABC1D` são apenas placeholders do
> app; o par real vem do QR ou da tela de configurações.

### 2.2 Envelopes e erros

**Violin** — rotas antigas e novas convivem:

```json
{ "status": "ok", "...": "..." }
```

```json
{ "status": "error", "code": "INVALID_ACTION", "message": "action inválida", "error": "action inválida" }
```

- Rotas legadas podem devolver só `{ "error": "..." }`.
- O app mostra `message` (quando existe) ou `error`; **403** vira o aviso amigável
  de permissão.

**Clássico v2** — envelope com `action` e `code`:

```json
{ "status": "ok", "action": "song-slides", "code": "SONG_PLAYING", "playing": true }
```

```json
{ "status": "error", "action": "song-slides", "code": "INVALID_TOKEN", "message": "Token ausente ou inválido" }
```

**Clássico v1** — legado:

```json
{ "status": "error", "message": "...", "code": "..." }
```

### 2.3 Códigos HTTP usados pelo app

| Código | Significado |
|---|---|
| `200` | sucesso (o envelope ainda pode dizer `status: "error"` no clássico v2) |
| `400` | corpo/parâmetro inválido |
| `401` | token ausente/inválido |
| `403` | dispositivo sem a permissão da rota |
| `404` | rota/recurso inexistente (também usado na detecção v1 × v2) |
| `405` | método errado (também usado na detecção v1 × v2) |
| `409` | estado do programa impede o comando |
| `413` | upload acima do limite |
| `415` | tipo de arquivo recusado |
| `429` | rate limit (chat) |
| `500` | falha interna |
| `503` | janela/renderer do desktop indisponível |
| `504` | timeout aguardando o renderer |

### 2.4 Timeouts do app

| Operação | Timeout |
|---|---|
| Requisições normais (ping, GET/POST comuns) | 5 s |
| Catálogo de música (`/api/music-library`) | 15 s |
| Comando do clássico (POST v2) | 20 s |
| Projeção SSE — conexão / leitura | 5 s / 30 s |

O desktop deve responder rápido; o app desiste e mostra aviso de conexão.

### 2.5 Semântica de polling

- **Violin:** SSE é o caminho principal para slides, player, cronômetro e chat.
  Ainda assim, o app consulta estado ao abrir telas e no pull-to-refresh.
- **Player / Cronômetro:** o app também faz polling de 1 s enquanto a tela está
  aberta (fallback quando o SSE cai).
- **Sorteio:** o app consulta o estado a cada ~2 s para refletir projeção/animação.
- **Clássico:** sem SSE; slides a cada 2,5 s, player/cronômetro a cada 1 s
  (dependendo da tela).

---

## 3. Autenticação e pareamento

### 3.1 Violin (recomendado)

O Violin tem **dois tipos de token**:

| Token | Formato | Uso |
|---|---|---|
| **Token global** | 5 caracteres `A-Z0-9` (ex.: `ABC12`) | Acesso administrativo/web; pode ser digitado manualmente no app. Vai na query `?token=`. |
| **Token do dispositivo** | UUID (ex.: `550e8400-e29b-41d4-a716-446655440000`) | Gerado no QR de pareamento; vira o `X-Device-Token` do aparelho. |

> **Não confunda:** o `token` do QR Violin é o **token do dispositivo** (UUID), não
> o token global de 5 caracteres. O endpoint `POST /api/register-device` exige
> token com pelo menos 8 caracteres.

#### 3.1.1 QR de pareamento

O desktop gera um QR com:

```
violin-remote://register?token=<token-do-dispositivo>&host=<ip-ou-host>&port=<porta>
```

Exemplo:

```
violin-remote://register?token=550e8400-e29b-41d4-a716-446655440000&host=192.168.0.10&port=7070
```

O app:

1. valida token (≥ 8 caracteres, sem espaços/controles), host e porta;
2. salva **host/porta/token** no perfil Violin;
3. apaga o device-id anterior daquele perfil;
4. chama `POST /api/register-device`;
5. guarda o `device.id` retornado;
6. passa a mandar `X-Device-Id` + `X-Device-Token` em todas as chamadas.

#### 3.1.2 Registro do dispositivo

```http
POST /api/register-device
Content-Type: application/json
```

```json
{
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "name": "iPhone do Diego",
  "model": "iPhone17,1",
  "platform": "ios",
  "fingerprint": "6F1C2A9E-..."
}
```

| Campo | Obrigatório | Observação |
|---|---|---|
| `token` | sim | string com **≥ 8 caracteres** |
| `fingerprint` | sim | identificador estável do aparelho; vira o `id` do device |
| `name` | não | nome amigável; padrão `"Dispositivo"` |
| `model` | não | modelo do aparelho |
| `platform` | não | `android`, `ios` ou `web` (inválido vira `web`) |

Resposta `200`:

```json
{
  "status": "pending",
  "message": "Aguardando aprovação do host",
  "device": {
    "id": "6F1C2A9E-...",
    "token": "550e8400-e29b-41d4-a716-446655440000",
    "name": "iPhone do Diego",
    "model": "iPhone17,1",
    "platform": "ios",
    "registeredAt": "2026-11-21T12:00:00.000Z",
    "permissions": [],
    "status": "pending"
  }
}
```

Regras importantes:

- A rota é **isenta de autenticação** (o aparelho ainda não tem permissões).
- O desktop deve avisar o operador e abrir a tela de aprovação.
- O device nasce **pendente** (`permissions: []`).
- Um device com **zero permissões continua pendente**; para liberar, atribua pelo
  menos uma role (ou `root`).
- Re-registrar o mesmo `fingerprint` atualiza o device e **não** remove permissões
  já concedidas.

O app, na tela de configurações, faz polling em `/api/ping` a cada **2 s**
por até **60 s** até `authorized` virar `true`. Enquanto pendente, a resposta é
`200` com `authorized: false` e `permissions: []`.

Modelo mínimo para persistir o device:

```json
{
  "id": "6F1C2A9E-...",
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "name": "iPhone do Diego",
  "model": "iPhone17,1",
  "platform": "ios",
  "permissions": [],
  "status": "pending",
  "registeredAt": "2026-11-21T12:00:00.000Z"
}
```

- `id` = `fingerprint` enviado no registro.
- Aprovar = preencher `permissions` (ao menos uma role) e marcar `status` como
  autorizado (o campo `status` é descritivo; a autorização real é
  `permissions.length > 0`).
- Re-registrar o mesmo `id` atualiza os dados e **preserva** `permissions`.

#### 3.1.3 Chamadas autenticadas

**Dispositivo pareado (recomendado):**

```http
GET /api/ping
X-Device-Id: 6F1C2A9E-...
X-Device-Token: 550e8400-e29b-41d4-a716-446655440000
```

**Token global (ou dispositivo legado via query):**

```http
GET /api/ping?token=ABC12
```

Regras de autenticação (implementação de referência):

- `127.0.0.1` / `::1` / `localhost` têm bypass (útil para a própria máquina).
- Rotas `/api/*` e `/events` são protegidas.
- O par `X-Device-Id` + `X-Device-Token` é validado contra o device salvo; o
  token do device é comparado **exatamente** (diferente do token global, que é
  case-insensitive).
- Device **pendente** só pode chamar `/api/ping` (para acompanhar a aprovação).
- Token global compara sem diferenciar maiúsculas/minúsculas.
- Se `only_authorized_devices` estiver ativo, só token global ou device aprovado
  passam; pendentes recebem `403 DEVICE_NOT_AUTHORIZED` nas demais rotas.

#### 3.1.4 Ping e negociação de módulos

```http
GET /api/ping
```

Resposta com device aprovado:

```json
{
  "status": "ok",
  "app": "LouvorJA",
  "version": "2.1.0",
  "authorized": true,
  "permissions": [
    "music",
    "bible",
    "liturgy",
    "announce",
    "keyboard",
    "media_library",
    "online_videos",
    "background_sound",
    "volume",
    "player",
    "stopwatch",
    "draw",
    "chat"
  ],
  "features": [
    "announcements",
    "background_sound",
    "bible",
    "chat",
    "draw",
    "liturgy",
    "media_library",
    "music",
    "online_videos",
    "player",
    "presenter",
    "projection",
    "slides",
    "stopwatch"
  ]
}
```

- `authorized`: o host já aprovou este dispositivo.
- `permissions`: roles do device (`root` libera tudo).
- `features`: módulos que **esta versão** implementa. O app esconde os cards que
  não estão na lista.

> **Atenção:** se `features` vier **ausente ou vazia**, o app mostra **todos** os
> módulos (compatibilidade com desktops antigos). Um servidor parcial deve
> **sempre** mandar uma lista não vazia, senão o usuário verá módulos quebrados.

Sem token / token inválido:

```json
{ "status": "error", "message": "Token ausente", "code": "MISSING_TOKEN" }
```

```json
{ "status": "error", "message": "Token inválido", "code": "INVALID_TOKEN" }
```

#### 3.1.5 SSE

```http
GET /events
X-Device-Id: 6F1C2A9E-...
X-Device-Token: 550e8400-...
Accept-Encoding: identity
```

Alternativa sem headers (WebView/EventSource):

```http
GET /events?token=ABC12
```

O app usa headers quando tem `deviceId`; senão, query. O desktop deve:

- manter a conexão aberta;
- enviar `:keepalive\n\n` pelo menos a cada **25 s** (o app usa leitura de 30 s);
- enviar eventos como `data: {"type":"...","payload":{...}}\n\n`;
- no connect, reenviar o último estado conhecido de cada tipo (replay), quando
  fizer sentido — o app depende disso para não ficar sem deck após reconectar.

#### 3.1.6 Fluxo completo (exemplo)

```bash
BASE=http://192.168.0.10:7070
DEVICE_TOKEN=550e8400-e29b-41d4-a716-446655440000
DEVICE_ID=6F1C2A9E-...

# 1) pareamento
curl -s -X POST "$BASE/api/register-device" \
  -H 'Content-Type: application/json' \
  -d '{
    "token":"'"$DEVICE_TOKEN"'",
    "name":"iPhone do Diego",
    "model":"iPhone17,1",
    "platform":"ios",
    "fingerprint":"6F1C2A9E-..."
  }'

# 2) aguardar aprovação (o app repete isso)
curl -s "$BASE/api/ping" \
  -H "X-Device-Id: $DEVICE_ID" \
  -H "X-Device-Token: $DEVICE_TOKEN"

# 3) a partir daqui, todas as chamadas levam o par de headers
curl -s "$BASE/api/song-slides" \
  -X POST \
  -H "X-Device-Id: $DEVICE_ID" \
  -H "X-Device-Token: $DEVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"playing-check"}'
```

---

### 3.2 Clássico (Delphi)

O modo clássico **não tem** cadastro de dispositivo, roles, `features` nem SSE.
O token é único do servidor e vai na query string (ou `Authorization: Bearer` na v2).

#### 3.2.1 QR do clássico

```
http://<host>:<porta>/?token=<token>
```

Exemplo real (pode vir com **BOM** — `\uFEFF` — antes do `http`):

```
\uFEFFhttp://192.168.7.50:7070/?token=HvMFY
```

O app remove BOM (`U+FEFF`) e zero-width space (`U+200B`) antes de parsear.
O token do clássico é curto (ex.: `HvMFY`) e não precisa ser UUID; o app aceita
qualquer token não vazio, sem espaços/controles, de até 256 caracteres.

#### 3.2.2 Ping v1

```http
GET /api/ping?token=HvMFY
```

```bash
curl -s "$BASE/api/ping?token=$TOKEN"
```

Resposta do Delphi v1:

```json
{ "status": "ok", "app": "LouvorJA" }
```

Não há `authorized`, `permissions` nem `features`. O app trata o clássico como
“sem roles”: todos os módulos suportados pela versão detectada ficam liberados.

> O `/api/ping` é a chamada de conectividade do app também no clássico. Responder
> `status: "ok"` é necessário para o app considerar o servidor acessível e
> disparar a detecção v1 × v2.

#### 3.2.3 Detecção v1 × v2

O app faz um probe curto (3 s) em:

```http
GET /api/v2/ping
Authorization: Bearer HvMFY
```

```bash
curl -s "$BASE/api/v2/ping" -H "Authorization: Bearer $TOKEN"
```

- `200` com `code: "PONG"` → **v2**;
- `404` ou `405` → **v1**;
- `401/403`, timeout, 5xx ou corpo inválido → mantém o último valor conhecido
  (uma falha transitória não rebaixa para v1).

O resultado fica em cache por **30 s** e é forçado ao trocar servidor/modo, no QR,
no pull-to-refresh e em “Testar conexão”.

Resposta v2:

```json
{
  "status": "ok",
  "action": "ping",
  "code": "PONG",
  "app": "LouvorJA",
  "version": "27.0.9789.35429"
}
```

#### 3.2.4 Autenticação por versão

**v1** — token na query em todas as chamadas:

```http
GET /api/song-slides?action=next&token=HvMFY
GET /api/open-song?id=1451&tag=1&token=HvMFY
GET /api/keyboard?key=39&token=HvMFY
```

**v2** — `Authorization: Bearer` (ou `?token=`):

```http
GET /api/v2/song-slides?action=status
Authorization: Bearer HvMFY
```

Erro de token na v2:

```json
{ "status": "error", "action": "song-slides", "code": "INVALID_TOKEN", "message": "Token ausente ou inválido" }
```

#### 3.2.5 Módulos por versão

| Recurso | v1 | v2 |
|---|---|---|
| Música | ✅ | ✅ |
| Projeções (WebView) | ✅ | ✅ |
| Slides (status/deck) | ❌ | ✅ |
| Bíblia | ❌ | ✅ |
| Liturgia | ❌ | ✅ |
| Sorteio | ❌ | ✅ |
| Vídeos Online | ❌ | ✅ |
| Player | ❌ | ✅ |
| Cronômetro | ❌ | ✅ |
| Chat | ❌ | ❌ |
| SSE | ❌ | ❌ |

Na v1 o app expõe apenas **Música** e **Projeções**; os demais cards aparecem
desativados com o aviso de que o desktop precisa ser atualizado.

#### 3.2.6 Comparativo rápido

| | Violin | Clássico |
|---|---|---|
| Token | global (5 chars) + device (UUID) | global curto |
| Pareamento | `register-device` + aprovação | só token no QR |
| Auth nas chamadas | headers do device ou `?token=` | `?token=` (v1) / Bearer (v2) |
| Roles | sim | não |
| `features` | sim | não |
| SSE | sim (`/events`) | não (polling) |
| Detecção de versão | não se aplica | probe `/api/v2/ping` |
| Operação de módulos | **detalhada neste guia** | fora do escopo deste guia |

---

## 4. Núcleo (comum a todos os módulos Violin)

### 4.1 `GET /api/ping`

Já detalhado em [3.1.4](#314-ping-e-negociação-de-módulos). É a primeira chamada
do app e a fonte de `permissions` + `features`.

### 4.2 `GET /api/clock`

Hora do servidor (usada por relógios/projeções e diagnóstico).

```json
{ "time": "14:32:07", "date": "2026-11-21", "timestamp": 1763731927000 }
```

### 4.3 `POST /api/register-device`

Já detalhado em [3.1.2](#312-registro-do-dispositivo). Sem autenticação.

### 4.4 `GET /events` (SSE)

Já detalhado em [3.1.5](#315-sse) e com os payloads em [6](#6-sse--eventos).

### 4.5 `POST /api/projections/close`

Encerra todas as projeções ativas. Usado pelo botão “Fechar projeções” da aba
Atalhos. Não exige role específica (basta estar autenticado).

```json
{ "status": "ok", "action": "projections-close" }
```

### 4.6 `GET /api/db/:path`

Cache JSON somente leitura usado pela Bíblia (versões, livros e capítulos).
Também serve para dados auxiliares. O servidor pode ler do disco ou buscar de um
upstream; se não existir, responde `404`.

Exemplos:

```http
GET /api/db/pt_bible_version
GET /api/db/pt_bible_book
GET /api/db/bible_1_43_3
```

---

## 5. Módulos (protocolo Violin)

> **Permissões:** todas as rotas de módulo conferem uma role do dispositivo
> (`root` libera tudo). Sem a role, responda `403` com uma mensagem clara — o app
> mostra o aviso de permissão.
>
> **Nomenclatura:** ids de módulo/feature estão em `snake_case`
> (`online_videos`, `background_sound`, `media_library`).

### 5.1 Música

**Permissão:** `music`

**Feature:** `music`

**Roles do app:** Música; Slides usa a mesma role.

#### 5.1.1 Busca

```http
GET /api/music-search?q=santo&lang=pt
```

- `q`: mínimo 2 caracteres (ou só dígitos para número de hino).
- `lang`: `pt` ou `es`.

```json
{
  "status": "ok",
  "results": [
    {
      "id_music": 1451,
      "name": "Santo, Santo, Santo",
      "has_instrumental_music": 1,
      "duration": "03:45",
      "albums_names": "Hinário Adventista",
      "custom_song_id": null,
      "has_audio": 1
    }
  ],
  "total": 1
}
```

`custom_song_id` (UUID) aparece em músicas pessoais/coletâneas; o `id_music`
delas é um negativo sintético usado só em lista.

#### 5.1.2 Catálogo (álbuns e faixas)

```http
GET /api/music-library?action=albums&lang=pt
```

```json
{
  "status": "ok",
  "albums": [
    {
      "id": "album:12",
      "title": "Hinário Adventista",
      "subtitle": null,
      "count": 120,
      "source": "official",
      "module_id": "hymnal",
      "color": "#1B4F8A",
      "image": "/api/music-library/image?path=icons/hymnal.png"
    }
  ]
}
```

```http
GET /api/music-library?action=songs&album=album:12&lang=pt
```

```json
{
  "status": "ok",
  "songs": [
    {
      "id_music": 1451,
      "name": "Santo, Santo, Santo",
      "has_instrumental_music": 1,
      "duration": "03:45",
      "albums_names": "Hinário Adventista",
      "custom_song_id": null,
      "has_audio": 1
    }
  ]
}
```

Formatos de `album`:

- `album:<id>` — álbum oficial;
- `collection:<uuid>` — coletânea pessoal.

`count: 0` significa contagem indisponível (ou álbum sem faixas); o card não
mostra badge nesse caso.

Miniatura/capa:

```http
GET /api/music-library/image?path=icons/hymnal.png
GET /api/music-library/image?path=album_12/capa.jpg
```

Resposta: bytes da imagem (`Content-Type` de imagem), com `Cache-Control`.

#### 5.1.3 Executar música

```http
POST /api/open-song
Content-Type: application/json
```

```json
{
  "id": 1451,
  "tag": 1,
  "mode": "audio",
  "id_liturgy": null,
  "custom_song_id": null
}
```

Modos (`mode`):

| `mode` | Efeito | `tag` legado |
|---|---|---|
| `audio` | slides + faixa cantada | `1` |
| `instrumental` | slides + playback | `2` |
| `no_audio` | só slides | `3` |
| `audio-only` | só áudio cantado, sem slides | `1` |
| `playback-only` | só playback, sem slides | `2` |

Prioridade no desktop: `mode` válido > `tag` > `audio`.

- `id_liturgy`: quando a execução veio de um item da liturgia.
- `custom_song_id`: UUID da música pessoal; a execução **sempre** usa ele, e o
  `id` negativo serve só para a lista.

Resposta:

```json
{ "status": "ok", "id": 1451, "mode": "audio" }
```

O app só exige `status: "ok"`.

#### 5.1.4 Faixa anterior/próxima

Não têm rota própria: usam a tecla **Ctrl+←** / **Ctrl+→** via `/api/keyboard`
(veja [5.14](#514-teclado--atalhos)). No clássico são `Home`/`End`.

---

### 5.2 Slides

**Permissão:** `music` nos comandos (as ações `bible-*` também aceitam `bible`).
A consulta `playing-check` é **leitura** e a implementação de referência não
exige role para ela.

**Feature:** `slides`

O estado da apresentação de música vive no desktop. O app pode recebê-lo por SSE
(`slides_data` / `music_presentation_snapshot` / `slide_change`) e também consulta
sob demanda.

#### 5.2.1 Consultar estado (`playing-check`)

```http
POST /api/song-slides
Content-Type: application/json

{ "action": "playing-check" }
```

Resposta:

```json
{
  "status": "ok",
  "supported": true,
  "playing": true,
  "slides": [
    { "lyric": "ANDEI TÃO CEGO", "name": "Estrofe 1" }
  ],
  "currentSlideIndex": 0,
  "title": "Santo, Santo, Santo",
  "presentation_session": "3f0c9a2e-..."
}
```

Sem apresentação:

```json
{
  "status": "ok",
  "supported": true,
  "playing": false,
  "slides": [],
  "currentSlideIndex": 0,
  "title": "",
  "presentation_session": null
}
```

- `supported: true` diz que o desktop respondeu de verdade.
- `presentation_session` é obrigatório para os comandos quando há música no ar.
- `slides[].lyric` pode conter `<br>`/tags; o app limpa para exibir.

Existe também a forma GET (`?action=playing-check`), usada por clientes que só
fazem GET; o app usa POST.

#### 5.2.2 Comandos

```http
POST /api/song-slides
Content-Type: application/json
```

```json
{ "action": "next", "presentation_session": "3f0c9a2e-..." }
```

```json
{ "action": "previous", "presentation_session": "3f0c9a2e-..." }
```

```json
{ "action": "close", "presentation_session": "3f0c9a2e-..." }
```

```json
{ "action": "go-to-slide", "index": 4, "presentation_session": "3f0c9a2e-..." }
```

Regras:

- `index` deve ser inteiro `>= 0`.
- `presentation_session` (quando enviada) deve ser string de 1..128 caracteres.
- Se houver música no ar e a sessão **não** vier (ou for de outra música), o
  desktop **descarta o comando silenciosamente**. O app só envia a sessão quando
  a conhece — por isso o `playing-check`/SSE são importantes.
- Se **não** houver apresentação, um comando **com** sessão também é descartado.

Resposta:

```json
{ "status": "ok", "action": "next", "payload": { "action": "next" } }
```

O app só exige `status: "ok"`.

#### 5.2.3 Ações de Bíblia no mesmo endpoint

O desktop também aceita `bible-next`, `bible-prev` e `bible-close` em
`/api/song-slides`, mas o app usa `POST /api/bible` (veja 5.3).

#### 5.2.4 SSE de slides

- `slides_data` — deck novo;
- `music_presentation_snapshot` — snapshot canônico a cada avanço;
- `slide_change` — troca de slide (fontes não-musicais, ex.: editor);
- `media_close` — apresentação encerrada.

Formato em [6](#6-sse--eventos).

---

### 5.3 Bíblia

**Permissão:** `bible`

**Feature:** `bible`

#### 5.3.1 Projetar versículo

```http
POST /api/bible
Content-Type: application/json
```

```json
{
  "text": "Porque Deus amou o mundo de tal maneira...",
  "reference": "João 3:16",
  "bookId": "43",
  "chapter": 3,
  "verse": 16
}
```

A versão projetada é a **atual do desktop**; o app não envia `version` no
protocolo Violin (isso é específico da v2 do clássico).

Resposta:

```json
{ "status": "ok", "action": "bible-verse", "payload": { "...": "..." } }
```

#### 5.3.2 Próximo / anterior / fechar

```json
{ "action": "next" }
```

```json
{ "action": "prev" }
```

```json
{ "action": "close" }
```

Respostas com `action` `bible-next`, `bible-prev` e `bible-close`.

#### 5.3.3 Dados da Bíblia

O app monta a árvore (versões → livros → capítulos) via `/api/db`:

```http
GET /api/db/pt_bible_version
```

```json
[
  { "id_bible_version": 1, "name": "Almeida Corrigida Fiel", "abbreviation": "ACF" }
]
```

```http
GET /api/db/pt_bible_book
```

```json
[
  { "id_bible_book": 43, "name": "João", "abbreviation": "Jo", "chapters": 21 }
]
```

```http
GET /api/db/bible_1_43_3
```

```json
{ "1": "ORA, havia um homem...", "2": "Este veio de noite...", "16": "Porque Deus amou..." }
```

- As chaves de capítulo são strings numéricas.
- `lang` pode ser `pt` ou `es` (`es_bible_version`, etc.).
- Sem o arquivo, responda `404` — o app mostra lista vazia.

#### 5.3.4 Fechar

O app também pode fechar a projeção com a tecla `Escape` em alguns fluxos; a rota
`{ "action": "close" }` é o caminho principal.

---

### 5.4 Liturgia

**Permissão:** `liturgy`

**Feature:** `liturgy`

#### 5.4.1 Listar itens do dia

```http
GET /api/liturgy?day=6
```

- `day`: `0..6` (0 = domingo). Sem o parâmetro, o desktop usa o dia atual.

```json
{
  "status": "ok",
  "day": 6,
  "items": [
    {
      "id": "item_1",
      "tipo": "musica",
      "subtipo": "sung",
      "id_music": 1300,
      "musica": 1300,
      "item": "Momento de Louvor",
      "subitem": "Música Ao Olhar pra Cruz",
      "cor": "#1B4F8A",
      "duration": 0,
      "time": "19:00",
      "dir": "",
      "dir_info": "",
      "url": "",
      "escolha": false,
      "has_instrumental_music": true,
      "checked": null
    }
  ]
}
```

- `is_active_day: true` pode aparecer quando o dia pedido está vazio e o desktop
  devolve o dia ativo.
- `tipo` direciona a UI: `musica`, `biblia`, `arquivo`, `video`, `site`, etc.

#### 5.4.2 Executar item

```http
POST /api/liturgy-execute
Content-Type: application/json
```

```json
{ "id": "item_1", "tag": "audio", "day": 6 }
```

- `day` deve ser **o mesmo** que o app exibiu — o desktop procura o item nele.
- `tag`: `audio` para músicas, ou o `tipo` do item (ex.: `arquivo`).
- Resposta: `{ "status": "ok", "action": "liturgy-execute", "payload": { ... } }`.

---

### 5.5 Anúncios

**Permissão:** `announce` (o app usa `announce`, não `announcements`)

**Feature:** `announcements`

#### 5.5.1 Listar

```http
GET /api/announcements?action=list
```

```json
{
  "status": "ok",
  "announcements": [
    {
      "id": "17",
      "nome": "Aviso da semana",
      "ordem": 1,
      "hasImage": true,
      "hasVideo": false
    }
  ]
}
```

#### 5.5.2 Projetar / navegar / parar

```http
POST /api/announcements
Content-Type: application/json
```

```json
{ "action": "project", "ids": ["17"] }
```

```json
{ "action": "next" }
```

```json
{ "action": "prev" }
```

```json
{ "action": "stop" }
```

Resposta: `{ "status": "ok", "action": "announcements-project" }` (ou o nome da
ação correspondente).

---

### 5.6 Biblioteca de Mídia

**Permissão:** `media_library`

**Feature:** `media_library`

O acervo fica no desktop; o app só recebe metadados e miniaturas.

#### 5.6.1 Acervo

```http
GET /api/media-library?action=library&lang=pt
```

```json
{
  "status": "ok",
  "items": [
    {
      "id": "upl_123",
      "name": "foto.jpg",
      "type": "image",
      "thumb": "louvorja://local/...",
      "categoryId": "cat_1",
      "addedAt": 1763731927000
    }
  ],
  "categories": [
    { "id": "cat_1", "name": "Culto", "color": "#1B4F8A" }
  ]
}
```

Miniatura:

```http
GET /api/media-library/image?url=louvorja%3A%2F%2Flocal%2F...
```

- `http(s)` → `302` para a URL;
- caminho local → bytes da imagem.

#### 5.6.2 Canva (opcional)

```http
GET /api/media-library?action=canva&lang=pt&view=designs&folderId=...&continuation=...
```

```json
{
  "status": "ok",
  "available": true,
  "reason": null,
  "items": [
    {
      "type": "design",
      "id": "DAF...",
      "name": "Culto 21/11",
      "thumb": "https://...",
      "url": null,
      "pageCount": 4,
      "updatedAt": 1763731927000
    }
  ],
  "continuation": null,
  "cached": { "DAF...": 1763731927000 }
}
```

- `available: false` desabilita a aba Canva; `reason` pode ser
  `no_credentials` ou `not_connected`.
- `continuation` é o token da próxima página (`null` = fim).

#### 5.6.3 Playlist

```http
GET /api/media-library?action=playlist
```

```json
{ "status": "ok", "items": [ { "id": "upl_123", "name": "foto.jpg", "type": "image" } ] }
```

#### 5.6.4 Comandos

```http
POST /api/media-library
Content-Type: application/json
```

| `action` | Corpo | Resposta |
|---|---|---|
| `project` | `{ "action":"project", "id":"upl_123" }` | `{ "status":"ok" }` |
| `canva-export` | `{ "action":"canva-export", "designId":"DAF...", "format":"pdf" }` | `{ "status":"ok", "cached":false, "title":"...", "pageCount":4 }` |

> Em `canva-export`, `format` é `pdf` para designs e `jpg` para imagens (o app
> escolhe conforme o tipo do item).
| `canva-clear-cache` | `{ "action":"canva-clear-cache", "designId":"DAF..." }` | `{ "status":"ok" }` |
| `canva-project` | `{ "action":"canva-project", "designId":"DAF...", "kind":"design" }` | `{ "status":"ok" }` |
| `playlist` | `{ "action":"playlist", "command":"add", "id":"upl_123" }` | `{ "status":"ok" }` |
| `playlist` | `{ "action":"playlist", "command":"remove", "index":0 }` | `{ "status":"ok" }` |
| `playlist` | `{ "action":"playlist", "command":"goto", "index":0 }` | `{ "status":"ok" }` |
| `playlist` | `{ "action":"playlist", "command":"play|next|prev|stop" }` | `{ "status":"ok" }` |
| `playlist` | `{ "action":"playlist", "command":"add-canva", "designId":"...", "name":"...", "kind":"design" }` | `{ "status":"ok", "item":{...} }` |

#### 5.6.5 Upload do celular

```http
POST /api/media-library/upload
Content-Type: <mime do arquivo>
X-File-Name: <nome percent-encoded>
X-Mime-Type: <mime>
X-Category-Id: <opcional>

<bytes crus>
```

- Limite do app: **250 MB**; o desktop recusa acima de **300 MB** com `413`.
- Extensões suportadas dependem do desktop; PowerPoint com macro é recusado com
  `415`.
- Resposta `201`:

```json
{
  "status": "ok",
  "item": {
    "id": "upl_123",
    "name": "foto.jpg",
    "type": "image",
    "path": "<caminho interno do desktop>",
    "addedAt": 1763731927000,
    "categoryId": "cat_1"
  }
}
```

- PowerPoint pode responder `202`:

```json
{ "status": "converting", "name": "slides.pptx", "uploadId": "pu_..." }
```

O app considera o envio concluído; a conversão termina no desktop.

```bash
curl -X POST "$BASE/api/media-library/upload" \
  -H "X-Device-Id: $DEVICE_ID" \
  -H "X-Device-Token: $DEVICE_TOKEN" \
  -H "X-File-Name: foto.jpg" \
  -H "X-Mime-Type: image/jpeg" \
  --data-binary @foto.jpg
```

---

### 5.7 Som de fundo e volume

**Permissões:** `background_sound` e `volume`

**Features:** `background_sound` (o volume não tem feature própria; é usado pelo
Som de fundo, pelo Apresentador e pelas teclas físicas)

#### 5.7.1 Estado

```http
GET /api/background-sound
```

```json
{
  "status": "ok",
  "playing": true,
  "volume": 65,
  "currentId": "bg_1",
  "files": [
    { "id": "bg_1", "name": "Chuva suave", "fileName": "chuva.mp3", "categoryId": "cat_1" }
  ],
  "categories": [
    { "id": "cat_1", "name": "Natureza", "color": "#077568" }
  ]
}
```

#### 5.7.2 Comandos

```http
POST /api/background-sound
Content-Type: application/json
```

```json
{ "action": "play", "id": "bg_1" }
```

```json
{ "action": "pause" }
```

```json
{ "action": "resume" }
```

```json
{ "action": "stop" }
```

```json
{ "action": "play-default" }
```

- `play-default` é idempotente; sem som padrão configurado responde `404`.
- Resposta: `{ "status": "ok", "action": "..." }`.

#### 5.7.3 Volume

```http
POST /api/volume
Content-Type: application/json
```

```json
{ "action": "up", "step": 1 }
```

```json
{ "action": "down", "step": 1 }
```

```json
{ "action": "set", "value": 70 }
```

```json
{ "status": "ok", "value": 70 }
```

- `step`: inteiro `1..100`; omisso = 1.
- `value`: inteiro `0..100` (só em `set`).
- É o volume “geral” (projeção + som de fundo).
- **Somente Violin**; o clássico não serve esta rota.

---

### 5.8 Vídeos Online

**Permissão:** `online_videos`

**Feature:** `online_videos`

#### 5.8.1 Álbuns

```http
GET /api/online-videos?action=albums&lang=pt
```

```json
{
  "status": "ok",
  "albums": [
    {
      "id": "online:PL123",
      "title": "Canal oficial",
      "subtitle": "YouTube",
      "count": 42,
      "source": "online",
      "image": "https://i.ytimg.com/..."
    }
  ]
}
```

`source`: `online` (catálogo remoto) ou `custom` (Meus Vídeos).

#### 5.8.2 Vídeos e busca

```http
GET /api/online-videos?action=videos&album=online:PL123&lang=pt
GET /api/online-videos?action=search&q=louvores&lang=pt
```

```json
{
  "status": "ok",
  "videos": [
    {
      "id": "dQw4w9WgXcQ",
      "title": "Vídeo",
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "source": "online",
      "image": "https://i.ytimg.com/...",
      "channel": "Canal"
    }
  ]
}
```

#### 5.8.3 Projetar / encerrar

```http
POST /api/online-videos
Content-Type: application/json
```

```json
{ "action": "play", "url": "https://youtu.be/dQw4w9WgXcQ", "title": "Vídeo" }
```

```json
{ "action": "close" }
```

- `play` valida/extrai o id do YouTube; link inválido = `400`.
- Resposta: `{ "status": "ok", "action": "play" }`.

#### 5.8.4 Miniaturas de Meus Vídeos

```http
GET /api/online-videos/image?kind=video|category&id=...
```

Resposta: bytes da imagem. No catálogo remoto, a `image` já é uma URL pública
(`ytimg`), então o app não chama esta rota.

---

### 5.9 Player

**Permissão:** `player`

**Feature:** `player`

Controla o que estiver em reprodução: arquivo local, música, Biblioteca, YouTube.

#### 5.9.1 Estado

```http
GET /api/media
```

```json
{
  "status": "ok",
  "state": {
    "active": true,
    "playing": true,
    "loading": false,
    "minimized": false,
    "source": "file",
    "title": "Música",
    "subtitle": "Álbum",
    "fileName": "musica.mp4",
    "position": 42.5,
    "duration": 240.0,
    "canPlay": true,
    "canPause": true,
    "canSeek": true,
    "canPrevious": false,
    "canNext": true,
    "seq": 128
  }
}
```

- Posições em **segundos**.
- `fileName` vazio em músicas do acervo; `title`/`subtitle` identificam.
- `seq` é monotônico: o app ignora snapshot com `seq` menor que o último.

#### 5.9.2 Comandos

```http
POST /api/media
Content-Type: application/json
```

```json
{ "action": "play" }
```

```json
{ "action": "pause" }
```

```json
{ "action": "seek", "position": 90.0 }
```

```json
{ "action": "seek-relative", "seconds": 10.0 }
```

```json
{ "action": "next" }
```

```json
{ "action": "previous" }
```

```json
{ "action": "close" }
```

- `seek`: `position >= 0`.
- `seek-relative`: `seconds != 0`, máximo 1 h por passo.
- Resposta: `{ "status": "ok", "state": { ... } }` — o comando já devolve o
  estado atualizado.
- Em `close`, o SSE emite `media_close` para as outras telas.

Erros:

```json
{ "status": "error", "code": "INVALID_ACTION", "message": "action inválida", "error": "action inválida" }
```

---

### 5.10 Cronômetro

**Permissão:** `stopwatch`

**Feature:** `stopwatch`

#### 5.10.1 Estado

```http
GET /api/stopwatch
```

```json
{
  "status": "ok",
  "state": {
    "running": true,
    "mode": "countdown",
    "elapsed": 12.0,
    "target": 300.0,
    "remaining": 288.0,
    "alert": "",
    "overtime": true,
    "showSeconds": true,
    "warningSeconds": 60,
    "laps": [ { "index": 1, "elapsed": 10.0, "shown": 290.0 } ],
    "projecting": true,
    "seq": 44
  }
}
```

- `mode`: `countup` ou `countdown`.
- `remaining` pode ser negativo em overtime.
- `seq` tem a mesma regra do Player.

#### 5.10.2 Comandos

```http
POST /api/stopwatch
Content-Type: application/json
```

```json
{ "action": "start" }
```

```json
{ "action": "pause" }
```

```json
{ "action": "reset" }
```

```json
{ "action": "lap" }
```

```json
{ "action": "clear-laps" }
```

```json
{ "action": "set-mode", "mode": "countdown", "target": 300.0 }
```

```json
{ "action": "set-target", "target": 600.0 }
```

```json
{ "action": "extend-target", "seconds": 60.0 }
```

```json
{ "action": "project" }
```

```json
{ "action": "unproject" }
```

- `reset` zera o tempo **e** as voltas; `clear-laps` limpa só as voltas.
- `set-mode` com `countdown` exige `target > 0` (máx. 99 h).
- `set-target` aceita `0` (limpa a meta).
- Resposta: `{ "status": "ok", "state": { ... } }`.

---

### 5.11 Sorteio

**Permissão:** `draw`

**Feature:** `draw`

O estado vive no renderer do desktop; o `draw` responde antes da animação
terminar.

#### 5.11.1 Estado

```http
GET /api/draw
```

```json
{
  "status": "ok",
  "state": {
    "status": "ok",
    "mode": "number",
    "names": [],
    "range": { "min": 1, "max": 100 },
    "current": "0032",
    "drawn": ["0032"],
    "total": 100,
    "remaining": 99,
    "animating": false,
    "running": false,
    "canDraw": true,
    "projecting": false
  }
}
```

#### 5.11.2 Comandos

```http
POST /api/draw
Content-Type: application/json
```

```json
{ "action": "draw" }
```

```json
{ "action": "reset" }
```

- `reset` zera o resultado e o histórico de sorteados, **mantendo** os
  participantes/intervalo configurados.

```json
{ "action": "set-mode", "mode": "number" }
```

```json
{ "action": "set-range", "min": 1, "max": 200 }
```

```json
{ "action": "add-name", "name": "Maria" }
```

```json
{ "action": "remove-name", "name": "Maria" }
```

```json
{ "action": "set-projection", "active": true }
```

- `mode`: `number` ou `names`.
- Intervalo máximo: **100.000** números.
- Nomes: até **10.000**, cada um até 200 caracteres.
- `draw` responde imediatamente com `animating: true`; o app consulta o estado até
  `animating: false`.
- `set-projection` abre/fecha a janela do sorteio no telão.
- Resposta: `{ "status": "ok", "state": { ... } }`.

---

### 5.12 Apresentador

**Permissões:** `keyboard` + `background_sound`

**Feature:** `presenter`

Não tem endpoint próprio no app: é um atalho para:

- `POST /api/keyboard` com `ArrowRight` / `ArrowLeft`;
- `POST /api/background-sound` com `{ "action": "play-default" }`.

(O desktop de referência também tem rotas `/api/presenter/*` para o modo
apresentador completo, mas o app não as usa.)

---

### 5.13 Projeções

**Permissão:** nenhuma (basta autenticar)

**Feature:** `projection`

O módulo abre uma **WebView em tela cheia** apontando para páginas HTML servidas
pelo desktop, com `?token=` anexado:

| Opção no app | URL |
|---|---|
| Relógio | `/relogio` |
| Projeção principal | `/projecao` |
| Música (transmissão/OBS) | `/musica?transmissao` |
| Música (retorno/palco) | `/musica?retorno` |
| Bíblia (transmissão/OBS) | `/biblia?transmissao` |
| Bíblia (retorno/palco) | `/biblia?retorno` |

O servidor deve servir HTML/JS para essas rotas (a versão Electron usa SPA
própria). Sem essas páginas, remova `projection` de `features` — o app esconde o
card.

`POST /api/projections/close` encerra todas as projeções ativas (usado pela aba
Atalhos).

---

### 5.14 Teclado / Atalhos

**Permissão:** `keyboard`

**Feature:** não tem card próprio; a aba **Atalhos** é gateada pela role.

```http
POST /api/keyboard
Content-Type: application/json
```

```json
{ "key": "ArrowRight", "modifiers": [] }
```

```json
{ "key": "ArrowLeft", "modifiers": [] }
```

```json
{ "key": "Space", "modifiers": [] }
```

```json
{ "key": "Escape", "modifiers": [] }
```

```json
{ "key": "o", "modifiers": ["control"] }
```

```json
{ "key": "p", "modifiers": ["control"] }
```

```json
{ "key": "Home", "modifiers": [] }
```

```json
{ "key": "End", "modifiers": [] }
```

- `key`: nome DOM (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`,
  `End`, `Space`, `Escape`, `Enter`, letras).
- `modifiers`: `control`/`ctrl`, `meta`/`cmd`/`command`, `alt`, `shift`.
- Resposta: `{ "status": "ok", "key": "ArrowRight", "modifiers": [] }`.

O desktop deve injetar um `keydown` no app (não um evento de SO), para funcionar
mesmo com a janela em segundo plano.

Teclas usadas pelo app:

| Contexto | Tecla |
|---|---|
| Faixa anterior/próxima (Violin) | `Ctrl+ArrowLeft` / `Ctrl+ArrowRight` |
| Apresentador | `ArrowLeft` / `ArrowRight` |
| Atalhos — navegação | `Home`, `End`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` |
| Atalhos — mídia | `Space` |
| Atalhos — geral | `Escape`, `Ctrl+O` (overlay), `Ctrl+P` (fundo) |

No clássico, o app remapeia para VK codes e usa `GET /api/keyboard?key=<VK>`.

---

### 5.15 Chat

**Permissão:** `chat`

**Feature:** `chat` (a aba Chat também depende da role)

#### 5.15.1 Enviar

```http
POST /api/chat
Content-Type: application/json
```

```json
{ "text": "Bom dia!", "sender": "Dispositivo", "id": "uuid-gerado-no-app" }
```

- `text`: obrigatório, até **2000** caracteres.
- `id`: opcional (≤ 64); o desktop usa o mesmo id no eco SSE para o app não
  duplicar a mensagem.
- Rate limit: **1 mensagem/segundo** por device/IP (`429`).
- O `sender` pode ser substituído pelo nome do device aprovado.

Resposta:

```json
{ "ok": true, "id": "uuid-gerado-no-app" }
```

> O campo é `ok`, não `status`. O app lê o `id`.

#### 5.15.2 Histórico

```http
GET /api/chat/history
```

```json
{
  "status": "ok",
  "messages": [
    {
      "id": "uuid",
      "sender": "Diego",
      "text": "Bom dia!",
      "timestamp": "2026-11-21T14:32:07.000Z",
      "deviceId": "6F1C2A9E-..."
    }
  ]
}
```

- Até o limite configurado no desktop (ex.: 100), da mensagem mais antiga para a
  mais recente.
- O app usa isso ao (re)conectar o SSE para preencher lacunas.

Mensagens em tempo real chegam por SSE (`chat_message`), veja [6](#6-sse--eventos).

---

## 6. SSE — eventos

Endpoint: `GET /events` (Violin apenas).

Formato exato de cada mensagem:

```
data: {"type":"<tipo>","payload":{...}}

```

O app consome estes tipos:

### 6.1 `slides_data`

Deck novo (música ou editor):

```json
{
  "type": "slides_data",
  "payload": {
    "slides": [
      { "lyric": "ANDEI TÃO CEGO", "name": "Estrofe 1" }
    ],
    "slide_index": 0,
    "title": "Santo, Santo, Santo",
    "presentation_session": "3f0c9a2e-..."
  }
}
```

### 6.2 `music_presentation_snapshot`

Snapshot canônico a cada avanço da música. O app só lê `snapshot`:

```json
{
  "type": "music_presentation_snapshot",
  "payload": {
    "schema": 1,
    "snapshot": {
      "sessionId": "3f0c9a2e-...",
      "revision": 12,
      "active": true,
      "title": "Santo, Santo, Santo",
      "slideIndex": 3,
      "totalSlides": 31
    }
  }
}
```

- `revision` é monotônica **dentro** da sessão; o app descarta replay antigo.
- `active: false` encerra a apresentação no app.

### 6.3 `slide_change`

Troca de slide de fonte não-musical (editor):

```json
{ "type": "slide_change", "payload": { "slide_index": 4, "title": "..." } }
```

### 6.4 `media_close`

Mídia/apresentação encerrada. Sem payload relevante:

```json
{ "type": "media_close", "payload": {} }
```

O app limpa o deck e fecha o estado do Player.

### 6.5 `media_state`

Estado do Player (mesmo shape de `GET /api/media`):

```json
{
  "type": "media_state",
  "payload": {
    "active": true,
    "playing": true,
    "loading": false,
    "minimized": false,
    "source": "file",
    "title": "Música",
    "subtitle": "Álbum",
    "fileName": "musica.mp4",
    "position": 42.5,
    "duration": 240.0,
    "canPlay": true,
    "canPause": true,
    "canSeek": true,
    "canPrevious": false,
    "canNext": true,
    "seq": 128
  }
}
```

### 6.6 `stopwatch_state`

Mesmo shape de `GET /api/stopwatch`:

```json
{
  "type": "stopwatch_state",
  "payload": {
    "running": true,
    "mode": "countup",
    "elapsed": 12.0,
    "target": null,
    "remaining": null,
    "alert": "",
    "overtime": true,
    "showSeconds": true,
    "warningSeconds": 60,
    "laps": [],
    "projecting": false,
    "seq": 44
  }
}
```

### 6.7 `chat_message`

```json
{
  "type": "chat_message",
  "payload": {
    "id": "uuid",
    "sender": "Diego",
    "text": "Bom dia!",
    "timestamp": "2026-11-21T14:32:07.000Z",
    "deviceId": "6F1C2A9E-..."
  }
}
```

O app ignora o eco da própria mensagem comparando `deviceId`.

### 6.8 Replay e keepalive

- No connect, envie o último estado de cada tipo (pelo menos `slides_data`,
  `music_presentation_snapshot`, `media_state` e `stopwatch_state`).
- `media_close` deve limpar o cache de slides antes de propagar: quem conectar
  depois não pode receber replay da música anterior.
- Keepalive: `:keepalive\n\n` a cada **25 s**.

```bash
curl -N "$BASE/events" \
  -H "X-Device-Id: $DEVICE_ID" \
  -H "X-Device-Token: $DEVICE_TOKEN" \
  -H 'Accept-Encoding: identity'
```

---

## 7. Negociação de features e permissões

### 7.1 `features`

Lista publicada em `GET /api/ping` (`features`). O app esconde os cards que não
estão nela.

| Feature | Módulo no app |
|---|---|
| `announcements` | Anúncios |
| `background_sound` | Som de fundo |
| `bible` | Bíblia |
| `chat` | Aba Chat (não é card) |
| `draw` | Sorteio |
| `liturgy` | Liturgia |
| `media_library` | Biblioteca de Mídia |
| `music` | Música |
| `online_videos` | Vídeos Online |
| `player` | Player |
| `presenter` | Apresentador |
| `projection` | Projeções |
| `slides` | Slides |
| `stopwatch` | Cronômetro |

Regras:

- **Sempre** envie uma lista não vazia se o servidor implementa um subconjunto.
- Desconhecido/ausente = o app mostra todos (compatibilidade).
- `keyboard` **não** entra em `features`; a aba Atalhos é gateada só pela role.

### 7.2 `permissions` (roles)

| Role | Libera |
|---|---|
| `root` | tudo |
| `music` | Música + Slides |
| `bible` | Bíblia |
| `liturgy` | Liturgia |
| `announce` | Anúncios |
| `keyboard` | Atalhos e teclas do Apresentador |
| `media_library` | Biblioteca de Mídia |
| `online_videos` | Vídeos Online |
| `background_sound` | Som de fundo (e `play-default` do Apresentador) |
| `volume` | `POST /api/volume` e teclas físicas de volume |
| `player` | Player |
| `stopwatch` | Cronômetro |
| `draw` | Sorteio |
| `chat` | Chat |

- Projeções não exigem role (só autenticação).
- Device com **zero roles** continua pendente; atribua ao menos uma.
- Sem a role, a rota deve responder `403` — o app mostra o aviso e mantém o card
  bloqueado.

---

## 8. Checklist de implementação

### 8.1 Mínimo para o app conectar

- [ ] Servidor HTTP em `0.0.0.0:7070` (ou porta configurada).
- [ ] `GET /api/ping` com `status`, `authorized`, `permissions` e `features`.
- [ ] `POST /api/register-device` (Violin) + armazenamento dos devices.
- [ ] Aprovação do device pelo operador (mesmo que seja automática).
- [ ] Autenticação por `X-Device-Id`/`X-Device-Token` ou `?token=`.
- [ ] `GET /events` (SSE) com keepalive e replay — recomendado; sem ele, slides,
  player, cronômetro e chat ficam só no polling/consulta.
- [ ] Rotas dos módulos que você anunciar em `features`.

### 8.2 Se anunciar um módulo, implemente

| Módulo | Rotas mínimas |
|---|---|
| Música | `music-search`, `music-library` (albums/songs/image), `open-song`, `song-slides` |
| Slides | `song-slides` (`playing-check` + next/previous/close/go-to-slide) e eventos SSE |
| Bíblia | `bible`, `/api/db/*` |
| Liturgia | `liturgy`, `liturgy-execute` |
| Anúncios | `announcements` GET/POST |
| Biblioteca de Mídia | `media-library` GET/POST, upload, image |
| Som de fundo | `background-sound`, `volume` |
| Vídeos Online | `online-videos` GET/POST, image |
| Player | `media` GET/POST |
| Cronômetro | `stopwatch` GET/POST |
| Sorteio | `draw` GET/POST |
| Apresentador | `keyboard` + `background-sound` (`play-default`) |
| Projeções | páginas HTML das rotas de projeção |
| Chat | `chat`, `chat/history` + `chat_message` no SSE |
| Atalhos | `keyboard` |

### 8.3 Testes manuais rápidos

```bash
BASE=http://192.168.0.10:7070
DEVICE_ID=...
DEVICE_TOKEN=...
AUTH=(-H "X-Device-Id: $DEVICE_ID" -H "X-Device-Token: $DEVICE_TOKEN")

# conectividade + features
curl -s "${AUTH[@]}" "$BASE/api/ping" | jq

# música
curl -s "${AUTH[@]}" "$BASE/api/music-search?q=santo&lang=pt" | jq
curl -s "${AUTH[@]}" -X POST "$BASE/api/open-song" \
  -H 'Content-Type: application/json' \
  -d '{"id":1451,"mode":"audio"}' | jq

# slides
curl -s "${AUTH[@]}" -X POST "$BASE/api/song-slides" \
  -H 'Content-Type: application/json' \
  -d '{"action":"playing-check"}' | jq
curl -s "${AUTH[@]}" -X POST "$BASE/api/song-slides" \
  -H 'Content-Type: application/json' \
  -d '{"action":"next"}' | jq

# SSE
curl -N "${AUTH[@]}" "$BASE/events"
```

### 8.4 Compatibilidade

- O app não exige todas as rotas: ele esconde o que não estiver em `features`.
- Campos desconhecidos no JSON são ignorados (`ignoreUnknownKeys`).
- Campos ausentes assumem os defaults documentados nos DTOs.
- O servidor pode responder campos extras; o app ignora.
- Mantenha os nomes em `snake_case` e os ids exatamente como neste documento.

---

## 9. Referência rápida de rotas

| Método | Rota | Role | Uso |
|---|---|---|---|
| GET | `/api/ping` | — | saúde, `authorized`, `permissions`, `features` |
| GET | `/api/clock` | — | hora do servidor |
| POST | `/api/register-device` | — | pareamento |
| GET | `/events` | — | SSE |
| POST | `/api/projections/close` | — | fecha projeções |
| GET | `/api/db/:path` | — | cache JSON (Bíblia) |
| GET | `/api/music-search` | music | busca |
| GET | `/api/music-library` | music | álbuns/faixas |
| GET | `/api/music-library/image` | music | capa |
| POST | `/api/open-song` | music | executa música |
| POST | `/api/song-slides` | music/bible | slides |
| POST | `/api/bible` | bible | projeta Bíblia |
| GET | `/api/liturgy` | liturgy | lista liturgia |
| POST | `/api/liturgy-execute` | liturgy | executa item |
| GET | `/api/announcements` | announce | lista anúncios |
| POST | `/api/announcements` | announce | projeta/navega |
| GET | `/api/media-library` | media_library | acervo/Canva/playlist |
| POST | `/api/media-library` | media_library | comandos |
| POST | `/api/media-library/upload` | media_library | upload |
| GET | `/api/media-library/image` | media_library | miniatura |
| GET | `/api/background-sound` | background_sound | estado |
| POST | `/api/background-sound` | background_sound | play/pause/… |
| POST | `/api/volume` | volume | volume geral |
| GET | `/api/online-videos` | online_videos | álbuns/vídeos/busca |
| POST | `/api/online-videos` | online_videos | play/close |
| GET | `/api/online-videos/image` | online_videos | miniatura |
| GET | `/api/media` | player | estado do player |
| POST | `/api/media` | player | comandos do player |
| GET | `/api/stopwatch` | stopwatch | estado |
| POST | `/api/stopwatch` | stopwatch | comandos |
| GET | `/api/draw` | draw | estado do sorteio |
| POST | `/api/draw` | draw | comandos |
| POST | `/api/keyboard` | keyboard | teclas |
| POST | `/api/chat` | chat | envia mensagem |
| GET | `/api/chat/history` | chat | histórico |

---

## 10. Exemplos rápidos de curl (Violin)

Defina as variáveis uma vez:

```bash
BASE=http://192.168.0.10:7070
DEVICE_ID=6F1C2A9E-...
DEVICE_TOKEN=550e8400-e29b-41d4-a716-446655440000
AUTH=(-H "X-Device-Id: $DEVICE_ID" -H "X-Device-Token: $DEVICE_TOKEN")
JSON=(-H "Content-Type: application/json")
```

> Sem device pareado, troque `"${AUTH[@]}"` por `?token=ABC12` na URL.

### Música

```bash
# busca
curl -s "${AUTH[@]}" "$BASE/api/music-search?q=santo&lang=pt"

# abre a música em modo cantado
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/open-song" \
  -d '{"id":1451,"tag":1,"mode":"audio"}'

# estado dos slides
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/song-slides" \
  -d '{"action":"playing-check"}'

# próximo slide (com a sessão devolvida pelo playing-check)
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/song-slides" \
  -d '{"action":"next","presentation_session":"3f0c9a2e-..."}'
```

### Bíblia

```bash
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/bible" \
  -d '{"text":"Porque Deus amou o mundo...","reference":"João 3:16","bookId":"43","chapter":3,"verse":16}'
```

### Liturgia

```bash
curl -s "${AUTH[@]}" "$BASE/api/liturgy?day=6"
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/liturgy-execute" \
  -d '{"id":"item_1","tag":"audio","day":6}'
```

### Anúncios

```bash
curl -s "${AUTH[@]}" "$BASE/api/announcements?action=list"
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/announcements" \
  -d '{"action":"project","ids":["17"]}'
```

### Som de fundo / volume

```bash
curl -s "${AUTH[@]}" "$BASE/api/background-sound"
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/background-sound" \
  -d '{"action":"play-default"}'
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/volume" \
  -d '{"action":"set","value":70}'
```

### Player

```bash
curl -s "${AUTH[@]}" "$BASE/api/media"
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/media" \
  -d '{"action":"seek","position":90.0}'
```

### Cronômetro

```bash
curl -s "${AUTH[@]}" "$BASE/api/stopwatch"
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/stopwatch" \
  -d '{"action":"set-mode","mode":"countdown","target":300.0}'
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/stopwatch" \
  -d '{"action":"start"}'
```

### Sorteio

```bash
curl -s "${AUTH[@]}" "$BASE/api/draw"
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/draw" \
  -d '{"action":"set-range","min":1,"max":100}'
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/draw" \
  -d '{"action":"draw"}'
```

### Teclado / Chat

```bash
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/keyboard" \
  -d '{"key":"ArrowRight","modifiers":[]}'

curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$BASE/api/chat" \
  -d '{"text":"Bom dia!","sender":"Dispositivo","id":"uuid-local"}'

curl -s "${AUTH[@]}" "$BASE/api/chat/history"
```

### SSE

```bash
curl -N "${AUTH[@]}" -H 'Accept-Encoding: identity' "$BASE/events"
```
