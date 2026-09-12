"use strict";

/**
 * Middleware de autenticação por token.
 *
 * Comportamento alinhado com o `fmTransmitir.pas` do Delphi:
 *  - Páginas estáticas (SPA, aliases /musica e /biblia, assets) são livres
 *    — o conteúdo exibido é só o estado já público da projeção.
 *  - APIs de controle (`/api/*`) e o canal SSE de eventos (`/events`)
 *    exigem token quando o cliente é remoto.
 *  - Localhost (127.0.0.1, ::1) bypassa sempre — a segurança nesse caso
 *    vem do firewall do SO (apenas processos da mesma máquina alcançam).
 *
 * Três caminhos de autenticação:
 *  1. Token global (5 chars A-Z0-9) — o mesmo para todos os clients legados
 *  2. Device com X-Device-Id + X-Device-Token — par id+token (novo)
 *  3. Device com token only (legado/retrocompatível) — busca por token
 *
 * Quando `only_authorized_devices` está ativo, apenas dispositivos
 * cadastrados com permissões são aceitos (além de localhost).
 *
 * IMPORTANTE — o token é resolvido DINAMICAMENTE em cada request via
 * `getToken()`. Antes recebíamos a string e congelávamos na closure: ao
 * clicar em "Gerar novo" no menu Transmissão, `_token` mudava na memória
 * mas o middleware continuava validando o antigo, gerando 401 nos clients
 * que já tinham recarregado a página com o token novo.
 */

function _isLocalhost(ip) {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip === "localhost"
  );
}

function _isProtectedPath(reqPath) {
  if (typeof reqPath !== "string") return false;
  if (reqPath.startsWith("/api/")) return true;
  if (reqPath === "/events") return true;
  return false;
}

/**
 * Verifica se um device com o token informado existe e tem permissões.
 * Busca pelo campo `token` (legado/retrocompatível).
 */
function _isDeviceTokenValid(token, findDeviceByToken) {
  if (!token || typeof findDeviceByToken !== "function") return false;
  const device = findDeviceByToken(token);
  return !!device && device.permissions && device.permissions.length > 0;
}

/**
 * Verifica par X-Device-Id + X-Device-Token.
 * Busca device pelo id e valida que o token bate.
 */
function _isDevicePairValid(deviceId, deviceToken, findDeviceById) {
  if (!deviceId || !deviceToken || typeof findDeviceById !== "function") return false;
  const device = findDeviceById(deviceId);
  return !!device && device.token === deviceToken && device.permissions && device.permissions.length > 0;
}

/**
 * @param {() => string | null} getToken  Função que retorna o token global atual.
 * @param {Function} [findDeviceByToken]  Busca device pelo token (legado).
 * @param {Function} [findDeviceById]     Busca device pelo id (novo).
 * @param {() => boolean} [isOnlyAuthorized]  Retorna true se only_authorized_devices está ativo.
 */
function setupAuth(getToken, findDeviceByToken, findDeviceById, isOnlyAuthorized) {
  const resolve =
    typeof getToken === "function" ? getToken : () => getToken;

  const checkOnlyAuthorized =
    typeof isOnlyAuthorized === "function" ? isOnlyAuthorized : () => false;

  return (req, res, next) => {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || "";

    if (_isLocalhost(ip)) return next();
    if (!_isProtectedPath(req.path)) return next();

    const onlyAuthorized = checkOnlyAuthorized();

    // --- Device com X-Device-Id + X-Device-Token (novo) ---
    const deviceId = req.headers && req.headers["x-device-id"];
    const deviceToken = req.headers && req.headers["x-device-token"];
    if (deviceId && deviceToken) {
      if (_isDevicePairValid(String(deviceId), String(deviceToken), findDeviceById)) {
        return next();
      }
      // Device pair inválido — se onlyAuthorized, rejeita
      if (onlyAuthorized) {
        return res.status(403).json({
          status: "error",
          message: "Dispositivo não autorizado",
          code: "DEVICE_NOT_AUTHORIZED",
        });
      }
    }

    // --- Token via query/body/header (global ou legado) ---
    const provided =
      (req.query && req.query.token) ||
      (req.body && req.body.token) ||
      (req.headers && req.headers["x-token"]);

    if (!provided) {
      return res.status(401).json({
        status: "error",
        message: "Token ausente",
        code: "MISSING_TOKEN",
      });
    }

    // --- Modo restrito: apenas devices autorizados ---
    if (onlyAuthorized) {
      // Token global legado — bloqueado quando onlyAuthorized
      // Token de device válido — permitido
      if (_isDeviceTokenValid(String(provided), findDeviceByToken)) {
        return next();
      }
      return res.status(403).json({
        status: "error",
        message: "Dispositivo não autorizado",
        code: "DEVICE_NOT_AUTHORIZED",
      });
    }

    // --- Modo aberto (padrão) ---
    const expected = resolve();

    // Token global — mantém compatibilidade com clients legados
    if (expected && String(provided).toUpperCase() === String(expected).toUpperCase()) {
      return next();
    }

    // Token de device (legado — busca por token sem id)
    if (_isDeviceTokenValid(String(provided), findDeviceByToken)) {
      return next();
    }

    return res.status(401).json({
      status: "error",
      message: "Token inválido",
      code: "INVALID_TOKEN",
    });
  };
}

module.exports = { setupAuth };
