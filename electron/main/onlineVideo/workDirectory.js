"use strict";

const { canonical, overlaps } = require("../storageRoots.js");

/** O destino compartilhável nunca serve de fallback para trabalho privado. */
function assertPrivateWorkDir(videosDir, workDir) {
  if (typeof workDir !== "string" || !workDir || overlaps(canonical(videosDir), canonical(workDir))) {
    throw new Error("Os temporários de vídeo precisam de uma pasta privada separada dos vídeos prontos.");
  }
}

module.exports = { assertPrivateWorkDir };
