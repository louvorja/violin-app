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
 * Dois caminhos de autenticação:
 *  1. Token global (5 chars A-Z0-9) — aceito via query (?token=), body ou
 *     header X-Token. Valida apenas o token (sem id de device).
 *  2. Device com X-Device-Id + X-Device-Token — par id+token (recomendado).
 *     Busca o device pelo id e valida que o token bate.
 *
 * Devices devem usar o par de headers X-Device-Id + X-Device-Token quando
 * possível (API calls). Para conexões SSE via browser/WebView (EventSource
 * não suporta headers customizados), o device token é aceito via query string.
 *
 * Quando `only_authorized_devices` está ativo, apenas o token global é
 * aceito via query/body. Devices devem usar o par de headers.
 *
 * Devices pendentes (sem permissões) só passam nos `allowUnapprovedPaths`
 * (ex.: /api/ping) — inclusive no modo restrito —, para conseguirem
 * acompanhar a aprovação do pareamento.
 *
 * `req.authInfo` é anexado a cada request autenticado:
 *   { kind, authorized, permissions, deviceId? }
 * — consumido por `/api/ping` para informar se o device já foi autorizado.
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

/** Um device tem permissões atribuídas pelo host? */
function _hasPermissions(device) {
  return !!device && Array.isArray(device.permissions) && device.permissions.length > 0;
}

/**
 * Verifica se um device com o token informado existe e tem permissões.
 * Busca pelo campo `token` (legado/retrocompatível).
 */
function _isDeviceTokenValid(token, findDeviceByToken) {
  if (!token || typeof findDeviceByToken !== "function") return false;
  return _hasPermissions(findDeviceByToken(token));
}

/**
 * Verifica par X-Device-Id + X-Device-Token.
 * Busca device pelo id e valida que o token bate.
 */
function _isDevicePairValid(deviceId, deviceToken, findDeviceById) {
  if (!deviceId || !deviceToken || typeof findDeviceById !== "function") return false;
  const device = findDeviceById(deviceId);
  return !!device && device.token === deviceToken && _hasPermissions(device);
}

/**
 * Retorna o device do par id+token, independente de ter permissões.
 * Usado pela exceção de paths que aceitam devices pendentes.
 */
function _findDevicePair(deviceId, deviceToken, findDeviceById) {
  if (!deviceId || !deviceToken || typeof findDeviceById !== "function") return null;
  const device = findDeviceById(deviceId);
  return device && device.token === deviceToken ? device : null;
}

/**
 * @param {() => string | null} getToken  Função que retorna o token global atual.
 * @param {Function} [findDeviceByToken]  Busca device pelo token (legado).
 * @param {Function} [findDeviceById]     Busca device pelo id (novo).
 * @param {() => boolean} [isOnlyAuthorized]  Retorna true se only_authorized_devices está ativo.
 * @param {{ allowUnapprovedPaths?: string[] }} [opts]  Paths liberados para devices sem permissões.
 */
function setupAuth(getToken, findDeviceByToken, findDeviceById, isOnlyAuthorized, opts) {
  const resolve =
    typeof getToken === "function" ? getToken : () => getToken;

  const checkOnlyAuthorized =
    typeof isOnlyAuthorized === "function" ? isOnlyAuthorized : () => false;

  const allowUnapprovedPaths = new Set((opts && opts.allowUnapprovedPaths) || []);

  return (req, res, next) => {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || "";

    if (_isLocalhost(ip)) {
      req.authInfo = { kind: "localhost", authorized: true, permissions: ["root"] };
      return next();
    }
    if (!_isProtectedPath(req.path)) {
      req.authInfo = { kind: "public", authorized: true, permissions: [] };
      return next();
    }

    const onlyAuthorized = checkOnlyAuthorized();
    const isUnapprovedAllowed = allowUnapprovedPaths.has(req.path);

    // --- Device com X-Device-Id + X-Device-Token (novo) ---
    const deviceId = req.headers && req.headers["x-device-id"];
    const deviceToken = req.headers && req.headers["x-device-token"];
    if (deviceId && deviceToken) {
      const pairDevice = _findDevicePair(String(deviceId), String(deviceToken), findDeviceById);
      if (_hasPermissions(pairDevice)) {
        req.authInfo = {
          kind: "device",
          authorized: true,
          permissions: pairDevice.permissions,
          deviceId: pairDevice.id,
        };
        return next();
      }
      // Device cadastrado mas ainda sem permissões: libera os paths de exceção
      // (ex.: /api/ping), para o app conseguir acompanhar a aprovação do
      // pareamento — inclusive no modo restrito (`only_authorized_devices`).
      if (pairDevice && isUnapprovedAllowed) {
        req.authInfo = {
          kind: "device-pending",
          authorized: false,
          permissions: [],
          deviceId: pairDevice.id,
        };
        return next();
      }
      // Gate restrito bloqueia o pendente nos demais paths.
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
      (req.headers && req.headers["x-device-token"]);

    if (!provided) {
      console.log(`[auth] ${req.method} ${req.path} de ${ip} — token ausente (onlyAuthorized=${onlyAuthorized})`);
      return res.status(401).json({
        status: "error",
        message: "Token ausente",
        code: "MISSING_TOKEN",
      });
    }

    const expectedToken = resolve();
    const tokenMatch = expectedToken && String(provided).toUpperCase() === String(expectedToken).toUpperCase();

    // --- Modo restrito: token global ou device via query/body ---
    if (onlyAuthorized) {
      if (tokenMatch) {
        req.authInfo = { kind: "global", authorized: true, permissions: ["root"] };
        return next();
      }
      // Device token via query (browser/WebView — EventSource não aceita headers customizados).
      if (findDeviceByToken) {
        const device = findDeviceByToken(String(provided));
        const hasPerms = device && _hasPermissions(device);
        console.log(`[auth] ${req.method} ${req.path} — device-by-token lookup: found=${!!device} hasPerms=${hasPerms}`);
        if (hasPerms) {
          req.authInfo = {
            kind: "device",
            authorized: true,
            permissions: device.permissions,
            deviceId: device.id,
          };
          return next();
        }
      }
      console.log(`[auth] ${req.method} ${req.path} de ${ip} — BLOQUEADO (onlyAuthorized, token não bateu)`);
      return res.status(403).json({
        status: "error",
        message: "Dispositivo não autorizado",
        code: "DEVICE_NOT_AUTHORIZED",
      });
    }

    // --- Modo aberto (padrão): token global ou device via query/body ---
    if (tokenMatch) {
      req.authInfo = { kind: "global", authorized: true, permissions: ["root"] };
      return next();
    }

    // Device token via query (browser/WebView — EventSource não aceita headers customizados).
    if (findDeviceByToken) {
      const device = findDeviceByToken(String(provided));
      const hasPerms = device && _hasPermissions(device);
      console.log(`[auth] ${req.method} ${req.path} — device-by-token lookup: found=${!!device} hasPerms=${hasPerms}`);
      if (hasPerms) {
        req.authInfo = {
          kind: "device",
          authorized: true,
          permissions: device.permissions,
          deviceId: device.id,
        };
        return next();
      }
    }

    console.log(`[auth] ${req.method} ${req.path} de ${ip} — REJEITADO (provided="${String(provided).slice(0, 8)}…")`);
    return res.status(401).json({
      status: "error",
      message: "Token inválido",
      code: "INVALID_TOKEN",
    });
  };
}

module.exports = { setupAuth };
