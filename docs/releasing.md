# Publicar uma versão

Este é o rito usado para publicar uma versão do LouvorJA Violin.

> A branch `dev` é a pré-`main` (integração contínua do dia a dia). A branch `main` fica bloqueada para alterações comuns e recebe código **apenas na publicação de uma versão estável**.
>
> **Betas ficam na `dev`.** Uma versão com sufixo (`-beta.N`, `-preview.N`…) é cortada inteira na `dev`: commit de versão, tag e release de prévia. Ela **não vai para a `main`**, porque todo push na `main` publica o site/PWA para todos os usuários, sem canal de prévia. O app desktop encontra a beta pela release do GitHub.

## Antes da tag

1. Versão estável: reúna em `main` o escopo validado vindo de `dev` (via PR/merge de release). Beta: fique na `dev`, com o escopo já integrado nela.
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
que cria um rascunho. Numa beta, o commit de versão vai para a `dev` (`git push origin dev`),
onde o CI o confere antes da tag. Numa versão estável, a versão nova só deve ser enviada para
`main` depois da publicação da release, para que o convite de download da PWA não aponte para
um instalador ausente.

## Depois do workflow

Confirme no GitHub:

- os três builds terminaram com sucesso;
- no rascunho, todos os arquivos `latest*.yml` têm versão, caminho, tamanho e SHA-512
  iguais aos instaladores baixados, e os formatos têm as assinaturas esperadas;
- as notas exibidas são as do arquivo versionado, sem mensagens de commit;
- Windows, macOS, Linux x64 e Linux ARM têm os instaladores esperados;
- o release está marcado como prévia quando a versão contém `-beta`, `-preview` ou outro sufixo.

Depois dessa conferência, publique o rascunho com `gh release edit v<versão> --draft=false`
e confira os links permanentes de todos os arquivos.

- **Beta:** termina aqui. Não envie nada para `main`; o site/PWA continua na última versão estável.
- **Versão estável:** envie o commit para `main` com `git push origin main`, sincronize a branch
  `dev` com `main` (`git checkout dev && git merge --ff-only main && git push origin dev`) e confira
  o HTML e o bundle servidos da PWA na nova versão.
