# Segurança — Headers HTTP recomendados

Este documento lista os headers HTTP que devem ser configurados no servidor de hospedagem
da versão web/PWA do LouvorJA. Para o Electron, o CSP é aplicado via
`session.defaultSession.webRequest.onHeadersReceived` em `electron/main.cjs`
usando a configuração central de `electron/main/csp.js`.

---

## Content-Security-Policy (CSP)

A CSP é gerenciada centralmente em `electron/main/csp.js` (desktop) e `vite.config.js` (web).
Domínios de terceiros estão definidos no objeto `DOMAINS` e compartilhados entre contextos.

O `index.html` já inclui um `<meta http-equiv="Content-Security-Policy">` como fallback.
No servidor, defina o header HTTP para que a política também cubra recursos não-HTML:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' blob: vlibras.gov.br cdn.jsdelivr.net *.doubleclick.net *.google.com *.googleapis.com fonts.gstatic.com www.gstatic.com 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' data: fonts.gstatic.com vlibras.gov.br cdn.jsdelivr.net;
  img-src 'self' data: https:;
  media-src 'self' blob: https:;
  connect-src 'self' blob: https://api.louvorja.workers.dev https://api.louvorja.com.br https://*.louvorja.com.br vlibras.gov.br traducao2.vlibras.gov.br dicionario2.vlibras.gov.br https://*.youtube.com https://*.ytimg.com https://*.googlevideo.com https://*.googleapis.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com;
  frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com vlibras.gov.br;
  worker-src 'self' blob:;
```

**Notas:**

- `style-src 'unsafe-inline'` continua necessário depois da saída do Vuetify: a Reka UI
  escreve a posição do conteúdo flutuante em `style` inline, e as telas de projeção montam
  fonte, cor e alinhamento por `:style` a partir das preferências do usuário.
- `fonts.googleapis.com` e `fonts.gstatic.com` são necessários para o Roboto (via webfontloader).
  Se o Roboto for removido do webfontloader e servido localmente, essas origens podem ser removidas.
- `connect-src` inclui `ws://localhost:*` apenas no meta tag (para HMR do Vite em dev).
  No servidor de produção, a diretiva acima, sem `ws://localhost:*`, é suficiente.
- Se no futuro for necessário remover `'unsafe-inline'` de styles, a alternativa é usar
  `'nonce-<valor>'` ou hashes SHA — exige integração com o servidor (geração do nonce por request).

---

## Outros headers recomendados

Configure estes headers no servidor (Nginx, Apache, Vercel, Netlify, Cloudflare, etc.):

### X-Content-Type-Options

Impede que o browser "cheire" o tipo MIME de respostas.

```
X-Content-Type-Options: nosniff
```

### X-Frame-Options

Impede que o app seja embarcado em um `<iframe>` de outro domínio (clickjacking).

```
X-Frame-Options: DENY
```

### Referrer-Policy

Limita as informações de referência enviadas nas requests de navegação.

```
Referrer-Policy: strict-origin-when-cross-origin
```

### Strict-Transport-Security (HSTS)

Força HTTPS por 1 ano. Aplicar **apenas** quando o domínio opera exclusivamente via HTTPS.

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### Permissions-Policy

Bloqueia APIs do browser não utilizadas pelo app.

```
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

---

## Exemplo — Nginx

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' blob: vlibras.gov.br cdn.jsdelivr.net *.doubleclick.net *.google.com *.googleapis.com fonts.gstatic.com www.gstatic.com 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: fonts.gstatic.com vlibras.gov.br cdn.jsdelivr.net; img-src 'self' data: https:; media-src 'self' blob: https:; connect-src 'self' blob: https://api.louvorja.workers.dev https://api.louvorja.com.br https://*.louvorja.com.br vlibras.gov.br traducao2.vlibras.gov.br dicionario2.vlibras.gov.br https://*.youtube.com https://*.ytimg.com https://*.googlevideo.com https://*.googleapis.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com vlibras.gov.br; worker-src 'self' blob:;" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
```

## Exemplo — Vercel (`vercel.json`)

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" }
      ]
    }
  ]
}
```

> **Por que o CSP não está no `vercel.json`?** O valor do CSP é longo e pode variar por ambiente.
> Prefira configurá-lo separadamente ou via variável de ambiente no painel do host.

---

## Electron

O Electron aplica CSP via `session.defaultSession.webRequest.onHeadersReceived` em
`electron/main.cjs`, usando `buildCsp("dev-desktop")` de `electron/main/csp.js`.

Em produção, o protocolo `louvorja://` aplica CSP via header HTTP usando
`buildCsp("prod-desktop")` de `electron/main/csp.js`.

Para janelas secundárias abertas via `windowFactory.js` (Projection, Operator, etc.),
a mesma session padrão aplica a política automaticamente.
