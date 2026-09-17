# Publicar uma versão

Este é o rito usado para publicar uma versão do LouvorJA Violin.

## Antes da tag

1. Atualize `package.json` e `package-lock.json` para a mesma versão.
2. Crie as notas em `.github/release-notes/v<versão>.md`, escritas para quem usa o programa.
3. Rode as verificações locais:

   ```bash
   npm run validate:agent-context
   npm run validate:manifests
   npm run validate:release-version
   npm run typecheck
   npm test
   npm run lint
   npx playwright install chromium
   npm run test:e2e
   npm run build
   ```

4. Para reproduzir o empacotamento Linux, use `npm run electron:build:linux -- --publish never`. O CI instala `rpm` no Ubuntu; sem essa ferramenta o pacote `.rpm` não pode ser criado localmente.
5. Confirme que os arquivos `latest*.yml` apontam para arquivos que existem:

   ```bash
   npm run validate:release-artifacts
   ```

6. Confira manualmente o fluxo principal da versão: abrir o app, tocar uma música, projetar, trocar a faixa, verificar atualização e abrir as notas da versão.

## Commit e tag

Faça um commit de versão, sem misturar mudanças paralelas:

```bash
git add <arquivos do escopo validado desta versão>
git diff --cached --check
git commit -m "release: atualizar versão para <versão>"
npm run git:tag
git push origin main
git push origin v<versão>
```

A tag deve ser anotada e não deve ser forçada. O push da tag dispara o workflow de release.

## Depois do workflow

Confirme no GitHub:

- os três builds terminaram com sucesso;
- o release está marcado como prévia quando a versão contém `-beta`, `-preview` ou outro sufixo;
- as notas exibidas são as do arquivo versionado, sem mensagens de commit;
- Windows, macOS, Linux x64 e Linux ARM têm os instaladores esperados;
- cada `latest*.yml` aponta para um arquivo publicado com o mesmo nome;
- os links de download e a atualização automática funcionam.
