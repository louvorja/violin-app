# Variáveis de Ambiente — LouvorJA

Todas as variáveis prefixadas com `VITE_` são expostas ao código Vue via `import.meta.env.*`
(exceto `VITE_BASE_URL`, lida pelo Vite em `vite.config.js` antes do build).

Copie `.env.example` para `.env` e preencha os valores reais.
**Nunca commite `.env` no git.**

---

## Variáveis obrigatórias

### `VITE_URL_API`

| Campo       | Valor                                    |
|-------------|------------------------------------------|
| Tipo        | URL (string)                             |
| Exemplo     | `https://api.louvorja.workers.dev`       |
| Offline     | `http://localhost:7070`                  |
| Usado em    | `config/Api.ts`, `main.js`              |

URL base da API LouvorJA. Todas as URLs de banco de dados e arquivos são
derivadas desta variável + os paths configurados abaixo.

---

### `VITE_PATH_JSON_DB`

| Campo       | Valor                                    |
|-------------|------------------------------------------|
| Tipo        | path (string)                            |
| Exemplo     | `/json_db`                               |
| Padrão      | `/json_db`                               |
| Usado em    | `config/Api.ts`                          |

Path para JSONs do banco de dados. Anexado a `VITE_URL_API`.
URL resultante: `{VITE_URL_API}{VITE_PATH_JSON_DB}`

---

### `VITE_PATH_FILES`

| Campo       | Valor                                    |
|-------------|------------------------------------------|
| Tipo        | path (string)                            |
| Exemplo     | `/file`                                  |
| Padrão      | `/file`                                  |
| Usado em    | `config/Api.ts`                          |

Path para arquivos de mídia (MP3, imagens de slide). Anexado a `VITE_URL_API`.
URL resultante: `{VITE_URL_API}{VITE_PATH_FILES}`

---

### `VITE_API_TOKEN`

| Campo       | Valor                                    |
|-------------|------------------------------------------|
| Tipo        | string (token opaco)                     |
| Exemplo     | *(obtido com o administrador)*           |
| Usado em    | `config/Api.ts`, `main.js`              |

Token enviado como header `Api-Token` em todas as requisições ao servidor louvorja.
Obrigatório no servidor legado (`api.louvorja.com.br`), que responde 401 sem ele.
A API em `api.louvorja.workers.dev` é somente leitura e não exige token — o header
é enviado assim mesmo e simplesmente ignorado.
Em desenvolvimento com servidor local (`npm run files`), pode ser deixado vazio.

---

## Variáveis de fallback

### `VITE_URL_API_FALLBACK`

| Campo       | Valor                                          |
|-------------|------------------------------------------------|
| Tipo        | URL (string)                                   |
| Exemplo     | `https://api.louvorja.com.br`                  |
| Padrão      | *(vazio)*                                      |
| Usado em    | `config/Api.ts`, `main.js`                     |

URL da API de fallback. Quando a API principal (`VITE_URL_API`) falha,
as chamadas são repetidas automaticamente usando esta URL.
Se ambas falharem, o app usa cache stale quando disponível.

---

### `VITE_URL_API_FALLBACK_TOKEN`

| Campo       | Valor                                          |
|-------------|------------------------------------------------|
| Tipo        | string (token opaco)                           |
| Exemplo     | *(token da API de fallback)*                   |
| Padrão      | `VITE_API_TOKEN`                               |
| Usado em    | `config/Api.ts`, `main.js`                     |

Token de autenticação da API de fallback. Se vazio, herda o valor de `VITE_API_TOKEN`.

---

## Variáveis legadas (deprecated)

### `VITE_URL_DATABASE` / `VITE_URL_FILES`

| Campo       | Valor                                          |
|-------------|------------------------------------------------|
| Tipo        | URL (string)                                   |
| Status      | **DEPRECATED** — mantidas por compatibilidade   |

Variáveis antigas que são automaticamente convertidas para `VITE_URL_API`.
O `config/Api.ts` extrai a origem removendo o sufixo `/json_db` ou `/file`.
**Prefira usar `VITE_URL_API` + `VITE_PATH_JSON_DB` + `VITE_PATH_FILES`.**

---

## Variáveis opcionais

### `VITE_APP_MODE`

| Campo       | Valor                                          |
|-------------|------------------------------------------------|
| Tipo        | `"development"` \| `"production"`              |
| Padrão      | `"production"` (se não definida)               |
| Usado em    | `src/views/Shell.vue`                          |

Controla exibição de ferramentas de debug na Shell (atalho `Ctrl+Alt+D`).
Definir como `"development"` habilita o menu de depuração. Em produção, o menu é ocultado
independente do `mode` do Vite.

---

### `VITE_APP_VERSION`

| Campo       | Valor                                          |
|-------------|------------------------------------------------|
| Tipo        | string semver                                  |
| Exemplo     | `1.27.0`                                       |
| Padrão      | `"—"` (fallback no display)                   |
| Usado em    | legado — substituído por `app.getVersion()`    |

> **Legado.** No desktop (Electron) a versão exibida na tela **Atualizações**
> (`layout/shell/AppMenuAtualizacoes.vue`) vem de `app.getVersion()`
> (package.json via `electron/main/updater.js`), não desta variável.
> Mantida para compatibilidade com o build web/PWA.

Se não definida, o display usa `"—"` como fallback.

---

### `VITE_DB_VERSION`

| Campo       | Valor                                          |
|-------------|------------------------------------------------|
| Tipo        | string (ex: data `20260101` ou hash curto)     |
| Exemplo     | `20260501`                                     |
| Padrão      | `""` (cache só expira por TTL)                 |
| Usado em    | `helpers/Database.ts`                          |

Chave de versionamento do banco de dados. `Database.ts` usa essa string para compor a chave
do sessionStorage. Alterar o valor descarta todos os JSONs em cache e força nova busca
do servidor — útil quando o banco é atualizado sem reiniciar o navegador.

Quando não definida (ou vazia), o cache expira apenas pelo TTL de 1 hora definido em `Database.ts`.

---

### `VITE_BASE_URL`

| Campo       | Valor                                          |
|-------------|------------------------------------------------|
| Tipo        | string (path com `/` final)                    |
| Exemplo     | `/app/`                                        |
| Padrão      | `"/"` (raiz do domínio)                        |
| Usado em    | `vite.config.js` (via `process.env`)           |

Define o `base` do Vite e o `start_url` do manifesto PWA. Necessário apenas quando o app
é servido em subpath (ex: `https://meusite.com/app/`). Lida antes do build pelo Vite
via `process.env`, não exposta ao código Vue via `import.meta.env`.

---

### `VITE_TARGET`

| Campo       | Valor                                          |
|-------------|------------------------------------------------|
| Tipo        | `"desktop"` \| `""` (vazio = web/PWA)          |
| Exemplo     | `VITE_TARGET=desktop npm run build`            |
| Padrão      | `""` (build web/PWA)                           |
| Usado em    | `vite.config.js`                               |

Alvo do build. Quando `"desktop"`, desativa o plugin PWA/Service Worker e configura `base: "./"`.
O script `npm run electron:build` injetará essa variável automaticamente.

---

## Resumo

| Variável                | Obrigatória | Fallback                     | Contexto           |
|-------------------------|-------------|------------------------------|--------------------|
| `VITE_URL_API`          | Sim         | —                            | `import.meta.env`  |
| `VITE_PATH_JSON_DB`     | Não         | `/json_db`                   | `import.meta.env`  |
| `VITE_PATH_FILES`       | Não         | `/file`                      | `import.meta.env`  |
| `VITE_API_TOKEN`        | Sim (prod)  | *(sem auth em dev local)*    | `import.meta.env`  |
| `VITE_URL_API_FALLBACK` | Não         | *(vazio)*                    | `import.meta.env`  |
| `VITE_URL_API_FALLBACK_TOKEN` | Não  | herda `VITE_API_TOKEN`       | `import.meta.env`  |
| `VITE_APP_MODE`         | Não         | `"production"`               | `import.meta.env`  |
| `VITE_APP_VERSION`      | Não         | `"—"`                        | `import.meta.env`  |
| `VITE_DB_VERSION`       | Não         | `""` (TTL only)              | `import.meta.env`  |
| `VITE_BASE_URL`         | Não         | `"/"`                        | `process.env`      |
| `VITE_TARGET`           | Não         | `""` (web/PWA)               | `process.env`      |

> `PERCY_TOKEN` (em `.env.example`) não é variável Vite — é usada exclusivamente pelo
> CLI do Percy durante testes de regressão visual (`npm run test:visual`).
