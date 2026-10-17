# Contrato de trabalho para agentes

Leia este arquivo antes de alterar o LouvorJA. Ele é o contexto operacional curto e atual para humanos e agentes com pouca janela de contexto.

## Fonte de verdade

Em caso de conflito, siga esta ordem:

1. Código, tipos e `package.json` atuais.
2. `docs/architecture.md`.
3. A documentação específica da tarefa em `docs/`.
4. `CLAUDE.md`, que preserva detalhes e histórico, mas não prevalece sobre os itens acima.

## Mapa atual

- Renderer: Vue 3, TypeScript progressivo e **Pinia 3**. O Pinia é instalado em `src/main.js`; os stores ficam em `src/stores/`.
- Produtos: web/PWA e desktop Electron já implementado. Não trate Electron como uma migração futura.
- Módulos: `src/modules/<id>/manifest.ts` exporta `module` e, opcionalmente, `contextualPages`; `index.ts` registra o runtime. `src/types/Module.ts` é o contrato e `src/config/modules/index.ts` descobre manifests.
- Dados remotos: use `src/helpers/Http.ts` e `src/helpers/Database.ts`; eles concentram timeout, cache e fallback. Não introduza `fetch` avulso para dados do produto. Vale para o renderer: no processo main não existe `Http.ts`, e lá o `fetch` do Node é aceito com timeout e validação de fronteira no próprio módulo (ex.: `electron/main/canva/`).
- Estado e preferências: use `AppData`/`UserData` e as chaves de `src/constants/UserDataKeys.ts`; não crie chaves literais novas. Exceção: segredo de terceiro não entra no `user_data` (que é sincronizado entre janelas) — vai para um arquivo próprio do `userStore`, cifrado.
- Janelas: envie eventos semânticos por `Broadcast`; não acople componentes a `BroadcastChannel` diretamente.
- Armazenamento desktop: todos os dados usam `paths.dataDir()` (Documentos/LouvorJA Violin ou a pasta escolhida); vídeos em `Videos/`, perfil Electron em `.electron/`. O endereço do sistema guarda apenas a âncora e o lock. Mudança do perfil termina no próximo boot.

## Guardrails de alteração

- Preserve mudanças não relacionadas já presentes no worktree.
- Valide entradas e respostas de fronteira antes de usá-las. Para novos formatos de dados, defina um tipo, valide em runtime quando vier de rede/IPC/arquivo e mantenha um fallback seguro.
- No Electron, exponha uma operação IPC específica e tipada. Não amplie APIs genéricas de canal/argumentos nem passe dados não confiáveis ao processo principal.
- Variáveis `VITE_*` chegam ao renderer: nunca ponha segredos de provedor, tokens de IA ou credenciais nelas.
- Não entregue conteúdo externo ou gerado por modelo a `v-html`. Uma futura integração de IA deve ter gateway no servidor, saída estruturada validada, ferramentas mínimas e confirmação humana para ações destrutivas.

## Verificação mínima

Execute, conforme o escopo:

```bash
npm run validate:agent-context
npm run validate:manifests
npm run typecheck
npm test
npm run lint
```

`validate:agent-context` protege este contrato contra documentação obsoleta. Atualize-o no mesmo change quando uma decisão arquitetural aqui mudar de fato.
