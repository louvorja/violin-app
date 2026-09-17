// @vitest-environment node
import { describe, expect, it } from "vitest";
import { setupAuth } from "../auth.js";

const PING = "/api/ping";
const OPEN_SONG = "/api/open-song";

/** Device recém-pareado: cadastrado, mas ainda sem permissões. */
const pendingDevice = {
  id: "dev-1",
  token: "pending-uuid-1234",
  name: "iPhone",
  platform: "ios",
  permissions: [],
};

/** Device já aprovado pelo host. */
const approvedDevice = {
  ...pendingDevice,
  permissions: ["remote"],
};

function buildMiddleware(deviceList, { onlyAuthorized = false } = {}) {
  const byToken = (token) => deviceList.find((d) => d.token === token) || null;
  const byId = (id) => deviceList.find((d) => d.id === id) || null;
  return setupAuth(
    () => "ABC1D",
    byToken,
    byId,
    () => onlyAuthorized,
    { allowUnapprovedPaths: [PING] },
  );
}

function makeRequest({ path, ip = "192.168.7.187", headers = {}, query = {}, body = {}, method = "GET" }) {
  return { path, ip, headers, query, body, method };
}

/** Executa o middleware e resolve com o status/body/authInfo resultantes. */
function run(middleware, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload, authInfo: req.authInfo });
        return this;
      },
    };
    middleware(req, res, () => resolve({ status: 200, body: null, authInfo: req.authInfo }));
  });
}

describe("setupAuth — localhost", () => {
  it("libera localhost com authorized=true", async () => {
    const out = await run(buildMiddleware([pendingDevice]), makeRequest({ path: PING, ip: "127.0.0.1" }));
    expect(out.status).toBe(200);
    expect(out.authInfo.kind).toBe("localhost");
    expect(out.authInfo.authorized).toBe(true);
  });
});

describe("setupAuth — par X-Device-Id + X-Device-Token", () => {
  it("aceita device pendente via par id+token no /api/ping", async () => {
    const out = await run(
      buildMiddleware([pendingDevice]),
      makeRequest({
        path: PING,
        headers: { "x-device-id": pendingDevice.id, "x-device-token": pendingDevice.token },
      }),
    );
    expect(out.status).toBe(200);
    expect(out.authInfo.kind).toBe("device-pending");
    expect(out.authInfo.authorized).toBe(false);
  });

  it("bloqueia device pendente fora do /api/ping via par id+token", async () => {
    const out = await run(
      buildMiddleware([pendingDevice]),
      makeRequest({
        path: OPEN_SONG,
        headers: { "x-device-id": pendingDevice.id, "x-device-token": pendingDevice.token },
      }),
    );
    expect(out.status).toBe(401);
    expect(out.body.code).toBe("MISSING_TOKEN");
  });

  it("device aprovado acessa qualquer rota via par id+token", async () => {
    const out = await run(
      buildMiddleware([approvedDevice]),
      makeRequest({
        path: OPEN_SONG,
        headers: { "x-device-id": approvedDevice.id, "x-device-token": approvedDevice.token },
      }),
    );
    expect(out.status).toBe(200);
    expect(out.authInfo.kind).toBe("device");
    expect(out.authInfo.authorized).toBe(true);
    expect(out.authInfo.permissions).toContain("remote");
  });
});

describe("setupAuth — token via query/body (apenas token global)", () => {
  it("token global no /api/ping resolve como authorized", async () => {
    const out = await run(
      buildMiddleware([pendingDevice]),
      makeRequest({ path: PING, query: { token: "abc1d" } }),
    );
    expect(out.status).toBe(200);
    expect(out.authInfo.kind).toBe("global");
    expect(out.authInfo.authorized).toBe(true);
  });

  it("device token via ?token é rejeitado (não busca device)", async () => {
    const out = await run(
      buildMiddleware([approvedDevice]),
      makeRequest({ path: OPEN_SONG, query: { token: approvedDevice.token } }),
    );
    expect(out.status).toBe(401);
    expect(out.body.code).toBe("INVALID_TOKEN");
  });

  it("device pendente via ?token é rejeitado", async () => {
    const out = await run(
      buildMiddleware([pendingDevice]),
      makeRequest({ path: PING, query: { token: pendingDevice.token } }),
    );
    expect(out.status).toBe(401);
    expect(out.body.code).toBe("INVALID_TOKEN");
  });

  it("sem token retorna 401", async () => {
    const out = await run(
      buildMiddleware([]),
      makeRequest({ path: PING }),
    );
    expect(out.status).toBe(401);
    expect(out.body.code).toBe("MISSING_TOKEN");
  });
});

describe("setupAuth — only_authorized_devices", () => {
  it("device pendente via par id+token é bloqueado com 403", async () => {
    const out = await run(
      buildMiddleware([pendingDevice], { onlyAuthorized: true }),
      makeRequest({
        path: PING,
        headers: { "x-device-id": pendingDevice.id, "x-device-token": pendingDevice.token },
      }),
    );
    expect(out.status).toBe(403);
    expect(out.body.code).toBe("DEVICE_NOT_AUTHORIZED");
  });

  it("device token via ?token é rejeitado no modo restrito", async () => {
    const out = await run(
      buildMiddleware([pendingDevice], { onlyAuthorized: true }),
      makeRequest({ path: PING, query: { token: pendingDevice.token } }),
    );
    expect(out.status).toBe(403);
    expect(out.body.code).toBe("DEVICE_NOT_AUTHORIZED");
  });

  it("token global é aceito no modo restrito", async () => {
    const out = await run(
      buildMiddleware([], { onlyAuthorized: true }),
      makeRequest({ path: OPEN_SONG, query: { token: "abc1d" } }),
    );
    expect(out.status).toBe(200);
    expect(out.authInfo.kind).toBe("global");
    expect(out.authInfo.authorized).toBe(true);
  });
});
