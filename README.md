# LouvorJA

Sistema de apresentação de letras de música e conteúdo bíblico para cultos e eventos religiosos. Roda no navegador (web/PWA) e como programa de computador (Windows, Mac e Linux, via Electron) — é a versão alternativa ao LouvorJA Classic, que antes só existia em Delphi. Site: [louvorja.com.br](https://louvorja.com.br).

---

## Como rodar o projeto

**Pré-requisitos:** Node.js 20.19+ (ou 22.12+) e npm 10+

```bash
git clone https://github.com/louvorja/violin-app
cd violin-app
npm install
cp .env.example .env     # preencha VITE_API_TOKEN — o resto já tem valor padrão
npm run dev              # → http://localhost:5002
```

- Testar em celular na mesma rede: `npm run host`
- Build de produção (web): `npm run build`
- Versão desktop (Electron): `npm run electron:dev`

Quer contribuir com código? Veja o [guia de contribuição](CONTRIBUTING.md).

---

## Funcionalidades

### Músicas e coletâneas

- Busca por título ou por trecho da letra
- Player de áudio com os slides da letra sincronizados
- Favoritos e histórico das últimas músicas abertas
- Playlists — criar, reordenar, importar/exportar e tocar em sequência
- Coletâneas prontas (hinário adventista, hinário 1996, doxologia, infantil) e coletâneas próprias
- Editor de slides — cria apresentações do zero, com cor, fonte e sombra personalizadas
- Vídeos do YouTube — catálogo pronto ou lista pessoal, sem anúncio (o vídeo fica salvo no computador)
- Biblioteca de mídia — imagens e vídeos próprios para projetar em sequência

### Bíblia

- Leitura e projeção de versículos, com busca por palavra-chave ou referência
- Múltiplas versões, em português e espanhol

### Culto e liturgia

- Planejador de culto — monta a ordem do culto arrastando músicas, anotações, sites e arquivos
- Cronômetro e temporizador com alarme sonoro, inclusive vinculados a um item da liturgia
- Painel de recados e slides de anúncios
- Sorteio de números e de nomes, com animação em tela cheia
- Contador simples e relógio digital

### Projeção e transmissão

- Projeção em tela cheia num segundo monitor, com uma tela de retorno (música atual + próxima)
- Visão do operador — todos os slides numa grade, navegável pelo teclado
- Captura para OBS/vMix, para transmitir o culto ao vivo com o texto por cima do vídeo
- Controle remoto pelo celular, sem precisar voltar ao computador
- Projeção e som de fundo, independentes do resto da apresentação
- Sobreposições — textos ou imagens por cima de qualquer projeção

### Acessibilidade

- Tradução automática para Libras, com avatar 3D traduzindo letras e versículos em tempo real

### Funciona offline

Depois do primeiro carregamento, o que foi baixado (músicas, bíblia, coletâneas) fica salvo
no computador — sem internet, o app continua funcionando com os últimos dados.

### Atualização automática (desktop)

O app avisa quando sai uma versão nova e pode baixar sozinho, se você deixar habilitado.

Detalhes técnicos de cada funcionalidade estão em [docs/architecture.md](docs/architecture.md).

---

## Tecnologias principais

| Tecnologia | Para que serve                                                                         |
| ---------- | -------------------------------------------------------------------------------------- |
| Vue 3      | Framework da interface                                                                 |
| TypeScript | Tipagem do código                                                                      |
| Pinia      | Estado global da aplicação                                                             |
| Vue Router | Navegação entre telas                                                                  |
| Vue I18n   | Traduções (português e espanhol)                                                       |
| Vite       | Build e servidor de desenvolvimento                                                    |
| Electron   | Empacota o app como programa de computador                                             |
| Reka UI    | Base sem estilo próprio dos componentes de interface (a aparência visual é toda nossa) |

Lista completa de dependências em [package.json](package.json).

---

## Scripts

```bash
npm run dev                  # Servidor web/PWA → http://localhost:5002
npm run host                 # Dev exposto na rede local
npm run build                # Build de produção
npm run typecheck            # Verifica os tipos TypeScript
npm run lint                 # Lint (ESLint)
npm run format               # Formata o código (Prettier)
npm run electron:dev         # Roda a versão desktop (Electron)
npm run electron:build       # Gera instalável (Windows/Mac/Linux)
npm run test                 # Testes unitários (Vitest)
npm run test:e2e             # Testes de ponta a ponta (Playwright)
```

---

## Documentação

| Documento                                            | Conteúdo                                                 |
| ---------------------------------------------------- | -------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)         | Arquitetura, módulos, estado, comunicação entre janelas  |
| [docs/creating-modules.md](docs/creating-modules.md) | Como criar um módulo novo                                |
| [docs/design-system.md](docs/design-system.md)       | Componentes de interface, cores, tipografia, espaçamento |
| [docs/broadcast.md](docs/broadcast.md)               | Comunicação entre janelas (BroadcastChannel)             |
| [docs/setup.md](docs/setup.md)                       | Configuração do ambiente e variáveis                     |
| [docs/security.md](docs/security.md)                 | Segurança e autenticação do servidor local               |
| [docs/env.md](docs/env.md)                           | Variáveis de ambiente                                    |
| [CONTRIBUTING.md](CONTRIBUTING.md)                   | Como contribuir com o projeto                            |

---

## Licença

Distribuído sob a licença MIT.
