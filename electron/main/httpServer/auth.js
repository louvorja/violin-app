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
 * Exceção controlada por `opts.allowUnapprovedPaths`: um device cadastrado
 * porém ainda SEM permissões (recém-pareado) pode acessar apenas esses paths
 * — na prática só `/api/ping`, para o app conferir a conexão antes da
 * aprovação do host. O gate de `only_authorized_devices` roda ANTES dessa
 * exceção: no modo restrito, o device pendente continua bloqueado.
 *
 * IMPORTANTE — o token é resolvido DINAMICAMENTE em cada request via
 * `getToken()`. Antes recebíamos a string e congelávamos na closure: ao
 * clicar em "Gerar novo" no menu Transmissão, `_token` mudava na memória
 * mas o middleware continuava validando o antigo, gerando 401 nos clients
 * que já tinham recarregado a página com o token novo.
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
      // Gate restrito roda ANTES da exceção do ping.
      if (onlyAuthorized) {
        return res.status(403).json({
          status: "error",
          message: "Dispositivo não autorizado",
          code: "DEVICE_NOT_AUTHORIZED",
        });
      }
      // Modo aberto: device cadastrado sem permissões só passa nos paths de exceção.
      if (pairDevice && isUnapprovedAllowed) {
        req.authInfo = {
          kind: "device-pending",
          authorized: false,
          permissions: [],
          deviceId: pairDevice.id,
        };
        return next();
      }
    }

    // --- Token via query/body/header (global ou legado) ---
    const provided =
      (req.query && req.query.token) ||
      (req.body && req.body.token) ||
      (req.headers && req.headers["x-token"]);

    if (!provided) {
      console.log(`[auth] ${req.method} ${req.path} de ${ip} — token ausente`);
      return res.status(401).json({
        status: "error",
        message: "Token ausente",
        code: "MISSING_TOKEN",
      });
    }

    // --- Modo restrito: apenas devices autorizados ---
    if (onlyAuthorized) {
      const dev = typeof findDeviceByToken === "function" ? findDeviceByToken(String(provided)) : null;
      if (_hasPermissions(dev)) {
        req.authInfo = {
          kind: "device",
          authorized: true,
          permissions: dev.permissions,
          deviceId: dev.id,
        };
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
      req.authInfo = { kind: "global", authorized: true, permissions: ["root"] };
      return next();
    }

    const dev = typeof findDeviceByToken === "function" ? findDeviceByToken(String(provided)) : null;
    if (_hasPermissions(dev)) {
      req.authInfo = {
        kind: "device",
        authorized: true,
        permissions: dev.permissions,
        deviceId: dev.id,
      };
      return next();
    }
    // Device cadastrado, porém ainda sem permissões: libera apenas os paths
    // de exceção (ex.: /api/ping) para o app conferir a conexão antes da
    // aprovação do host.
    if (dev && isUnapprovedAllowed) {
      req.authInfo = {
        kind: "device-pending",
        authorized: false,
        permissions: [],
        deviceId: dev.id,
      };
      return next();
    }

    console.log(`[auth] ${req.method} ${req.path} de ${ip} — token inválido (provided="${String(provided).slice(0, 8)}...")`);
    return res.status(401).json({
      status: "error",
      message: "Token inválido",
      code: "INVALID_TOKEN",
    });
  };
}

module.exports = { setupAuth };
