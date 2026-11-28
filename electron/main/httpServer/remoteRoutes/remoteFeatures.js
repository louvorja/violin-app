"use strict";

/**
 * Módulos e funcionalidades do **controle remoto** implementados por esta
 * versão do desktop.
 *
 * O `/api/ping` publica esta lista em `features`, e o app remoto (KMP/iOS)
 * usa os mesmos ids para decidir quais cards exibir: sem a lista (ou sem
 * pareamento) ele mostra todos; com a lista, mostra só os anunciados.
 *
 * Regra de manutenção: ao adicionar um módulo novo ao controle remoto, inclua
 * o id aqui **e** marque o módulo correspondente no app (`RemoteTab.feature` /
 * `RemoteModule.feature`). Ao remover/desativar um módulo, retire-o daqui.
 *
 * `chat` também entra: é uma funcionalidade do app (aba Chat), não um card da
 * tela Módulos. O app continua decidindo a aba pela permissão `chat` e pelo
 * modo (no clássico não existe) — o id aqui só mantém o contrato completo.
 * O mesmo vale para as funcionalidades de teclado (aba Atalhos), que seguem
 * exclusivamente por permissão e por isso **não** entram nesta lista.
 *
 * O controle web (`RemoteControl.vue`) é servido por esta mesma versão e não
 * filtra por `features`.
 */
const REMOTE_FEATURES = [
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
  "stopwatch",
];

module.exports = { REMOTE_FEATURES: Object.freeze(REMOTE_FEATURES) };
