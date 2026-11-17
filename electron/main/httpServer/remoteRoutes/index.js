"use strict";

/**
 * Rotas do controle remoto, separadas por domínio.
 *
 * Cada módulo registra apenas os endpoints da sua feature e recebe o mesmo
 * `ctx` montado por `routes.js` (renderer, validadores e permissões).
 * `rendererState.js` é fiação interna do Player/Cronômetro (não registra rotas).
 */
const keyboard = require("./keyboard.js");
const liturgy = require("./liturgy.js");
const music = require("./music.js");
const onlineVideos = require("./onlineVideos.js");
const backgroundSound = require("./backgroundSound.js");
const draw = require("./draw.js");
const volume = require("./volume.js");
const chat = require("./chat.js");
const mediaLibrary = require("./mediaLibrary.js");
const player = require("./player.js");
const stopwatch = require("./stopwatch.js");

function register(app, ctx) {
  keyboard.register(app, ctx);
  liturgy.register(app, ctx);
  music.register(app, ctx);
  onlineVideos.register(app, ctx);
  backgroundSound.register(app, ctx);
  draw.register(app, ctx);
  volume.register(app, ctx);
  chat.register(app, ctx);
  mediaLibrary.register(app, ctx);
  player.register(app, ctx);
  stopwatch.register(app, ctx);
}

module.exports = {
  register,
  normalizeKeyName: keyboard.normalizeKeyName,
  extractYoutubeVideoId: onlineVideos.extractYoutubeVideoId,
};
