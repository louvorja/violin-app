# Publicar uma versão

Este é o rito usado para publicar uma versão do LouvorJA Violin.

> A branch `dev` é a pré-`main` (integração contínua do dia a dia). A branch `main` fica bloqueada para alterações comuns e recebe código **apenas na publicação de uma versão**.

## Antes da tag

1. Reúna em `main` o escopo validado vindo de `dev` (via PR/merge de release).
2. Atualize `package.json` e `package-lock.json` para a mesma versão.
3. Crie as notas em `.github/release-notes/v<versão>.md`, escritas para quem usa o programa.
4. Rode as verificações locais:

   ```bash
   npm run validate:agent-context
   npm run validate:manifests
   npm run validate:release-version
   npm run typecheck
   npm test
   npm run lint
   npx playwright install chromium
   npm run test:e2e
   npm run test:e2e:build
   npm run test:e2e:mobile:build
   npm run build
   ```

5. Para reproduzir o empacotamento Linux, use `npm run electron:build:linux -- --publish never`. O CI instala `rpm` no Ubuntu; sem essa ferramenta o pacote `.rpm` não pode ser criado localmente.
6. Confirme que os arquivos `latest*.yml` apontam para arquivos que existem:

   ```bash
   npm run validate:release-artifacts
   ```

7. Confira manualmente o fluxo principal da versão: abrir o app, tocar uma música, projetar, trocar a faixa, verificar atualização e abrir as notas da versão.

## Commit e tag

Faça um commit de versão, sem misturar mudanças paralelas:

```bash
git add <arquivos do escopo validado desta versão>
git diff --cached --check
git commit -m "release: atualizar versão para <versão>"
npm run git:tag
git push origin v<versão>
```

A tag deve ser anotada e não deve ser forçada. O push da tag dispara o workflow de release,
que cria um rascunho. A versão nova só deve ser enviada para `main` depois da publicação
da release, para que o convite de download da PWA não aponte para um instalador ausente.

## Depois do workflow

Confirme no GitHub:

- os três builds terminaram com sucesso;
- no rascunho, todos os arquivos `latest*.yml` têm versão, caminho, tamanho e SHA-512
  iguais aos instaladores baixados, e os formatos têm as assinaturas esperadas;
- as notas exibidas são as do arquivo versionado, sem mensagens de commit;
- Windows, macOS, Linux x64 e Linux ARM têm os instaladores esperados;
- o release está marcado como prévia quando a versão contém `-beta`, `-preview` ou outro sufixo.

Depois dessa conferência, publique o rascunho com `gh release edit v<versão> --draft=false`,
envie o commit para `main` com `git push origin main` e sincronize a branch `dev` com `main`
(`git checkout dev && git merge --ff-only main && git push origin dev`). Confira os links permanentes de
todos os arquivos e o HTML e bundle servidos da PWA na nova versão.
