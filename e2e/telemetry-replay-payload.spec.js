import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { resolve, extname, basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Buffer } from "node:buffer";
import process from "node:process";
import csp from "../electron/main/csp.js";

for (const trigger of ["exception", "functional"]) {
  test(`${trigger}: rajada preserva incidente e Replay íntegro com inputs mascarados`, async ({
    browser,
  }) => {
    const mocks = {
      "@/helpers/Platform": "export default {isDesktop:false,isDev:false};",
      "@/helpers/Broadcast": "export default {send:()=>{},listen:()=>()=>{}};",
      "@/helpers/UserData":
        "const state={};export default {get:(k,f)=>state[k]??f,set:(k,v)=>{state[k]=v}};",
      "@/helpers/Http": "export const setNetworkTimingReporter=()=>{};",
      "@/helpers/Database": "export const setDatabaseTimingReporter=()=>{};",
    };
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import Telemetry from '@/helpers/Telemetry';
        import posthog from 'posthog-js';
        const originalInit=posthog.init.bind(posthog);
        // O SDK ignora navegadores headless por padrão; só a fixture permite capturá-los.
        posthog.init=(key,config)=>originalInit(key,{...config,opt_out_useragent_filter:true});
        const fragment=document.createDocumentFragment();
        for(let i=0;i<1200;i++){
          const p=document.createElement('p');
          p.textContent=Array.from(crypto.getRandomValues(new Uint32Array(12)),v=>v.toString(36)).join('-');
          fragment.append(p);
        }
        document.querySelector('main').append(fragment);
        await Telemetry.init();
        window.fixture={Telemetry,posthog};`,
      },
      bundle: true,
      write: false,
      format: "esm",
      define: {
        "import.meta.env": JSON.stringify({
          VITE_POSTHOG_KEY: "phc_local_fixture",
          VITE_APP_VERSION: "2.0.0-beta.18",
        }),
        "import.meta.env.VITE_POSTHOG_HOST": "window.location.origin",
        "process.env.NODE_ENV": '"production"',
      },
      plugins: [
        {
          name: "local-replay-services",
          setup(builder) {
            builder.onResolve({ filter: /^@root\// }, ({ path }) => ({
              path: resolve(path.slice(6)),
            }));
            builder.onResolve({ filter: /^@\// }, ({ path }) => {
              if (mocks[path]) return { path, namespace: "test-service" };
              const file = resolve("src", path.slice(2));
              return { path: extname(file) ? file : [`${file}.ts`, `${file}.js`].find(existsSync) };
            });
            builder.onLoad({ filter: /.*/, namespace: "test-service" }, ({ path }) => ({
              contents: mocks[path],
            }));
          },
        },
      ],
    });
    const captures = [];
    const events = [];
    const decodeErrors = [];
    const remoteConfig = {
      hasFeatureFlags: false,
      sessionRecording: { endpoint: "/s/", minimumDurationMilliseconds: null, recordCanvas: true },
    };
    const server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/app.js") {
        response.setHeader("Content-Type", "application/javascript");
        response.end(bundle.outputFiles[0].text);
      } else if (url.pathname === "/config.js") {
        response.setHeader("Content-Type", "application/javascript");
        response.end(
          `window._POSTHOG_REMOTE_CONFIG={phc_local_fixture:{config:${JSON.stringify(remoteConfig)}}};`
        );
      } else if (url.pathname.startsWith("/static/")) {
        // Serve o lazy-recorder instalado, carregado pelo próprio SDK após o erro.
        const file = resolve("node_modules/posthog-js/dist", basename(url.pathname));
        if (extname(file) !== ".js" || !existsSync(file)) {
          response.writeHead(404).end();
          return;
        }
        response.setHeader("Content-Type", "application/javascript");
        response.end(readFileSync(file));
      } else if (url.pathname === "/") {
        response.setHeader("Content-Type", "text/html");
        response.setHeader("Content-Security-Policy", csp.buildCsp("prod-desktop"));
        response.end(
          '<main><input value="secret-fixture-value"><input type="hidden" value="hidden-fixture-value"></main><script src="/config.js"></script><script type="module" src="/app.js"></script>'
        );
      } else {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
          if (["/s/", "/e/"].includes(url.pathname)) {
            try {
              const body = Buffer.concat(chunks);
              const decoded = body[0] === 31 && body[1] === 139 ? gunzipSync(body) : body;
              const parsed = JSON.parse(decoded.toString());
              const batch = [].concat(parsed.batch ?? parsed);
              if (url.pathname === "/s/") captures.push(...batch);
              else events.push(...batch);
            } catch (error) {
              decodeErrors.push(error.message);
            }
          }
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ status: 1 }));
        });
      }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const context = await browser.newContext({ bypassCSP: false });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    try {
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => !!window.fixture);
      expect(await page.evaluate(() => window.fixture.posthog.sessionRecording.status)).toBe(
        "disabled"
      );
      expect(captures).toHaveLength(0);

      // Nenhuma chamada manual de rrweb.record ou $snapshot: exercita o fluxo do app.
      await page.evaluate((trigger) => {
        const { Telemetry } = window.fixture;
        Telemetry.breadcrumb("music_seek_requested", {
          requested_time: 25,
          action_source: "keyboard",
        });
        for (let i = 0; i < 2000; i++) {
          Telemetry.track("network_request", {
            source: "libras-bundle",
            status: 404,
            ok: false,
            outcome: "response",
            duration_ms: 10,
          });
          Telemetry.track("music_media_ready", { playback_id: "p1", readiness: "canplay" });
        }
        if (trigger === "functional")
          Telemetry.track("music_playback_stalled", { playback_id: "p1", stalled_ms: 6000 });
        else Telemetry.captureException(new Error("Replay automatic fixture"));
        Telemetry.flushDiagnostics();
      }, trigger);
      await page.waitForFunction(() => window.fixture.posthog.sessionRecording.status === "active");
      await page.locator("input:not([type])").fill("typed-private-value");
      await page.evaluate(() => {
        const p = document.createElement("p");
        p.textContent = "Mutation after replay started";
        document.querySelector("main").append(p);
      });
      await expect.poll(() => captures.length, { timeout: 15000 }).toBeGreaterThan(0);
      const incidentName = trigger === "functional" ? "music_playback_stalled" : "$exception";
      await expect
        .poll(() => events.some((event) => event.event === incidentName), { timeout: 15000 })
        .toBe(true);
      expect(events.filter((event) => event.event === "network_request")).toHaveLength(1);
      expect(events.filter((event) => event.event === "music_media_ready")).toHaveLength(1);
      expect(events.some((event) => event.event === "$client_warning")).toBe(false);
      const incident = events.find((event) => event.event === incidentName);
      expect(incident.properties.breadcrumbs).toContainEqual(
        expect.objectContaining({ event: "music_seek_requested" })
      );
      if (trigger === "functional")
        expect(events.some((event) => event.event === "$exception")).toBe(false);
      const summary = events.find((event) => event.event === "telemetry_activity_summary");
      expect(
        summary.properties.groups.find((group) => group.event === "network_request").count
      ).toBe(2000);
      expect(decodeErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
      const snapshots = captures.flatMap((event) => event.properties?.$snapshot_data || []);
      const fullSnapshots = snapshots.filter((event) => event.type === 2);
      expect(fullSnapshots.length).toBeGreaterThan(0);
      for (const snapshot of fullSnapshots) {
        expect(snapshot.cv).toBe("2024-10");
        expect(snapshot.data.length).toBeGreaterThan(20000);
      }
      const decompressField = (value) =>
        typeof value === "string" && value.charCodeAt(0) === 31 && value.charCodeAt(1) === 139
          ? JSON.parse(gunzipSync(Buffer.from(value, "latin1")).toString())
          : value;
      const decodedContent = () =>
        JSON.stringify(
          captures
            .flatMap((event) => event.properties?.$snapshot_data || [])
            .map((snapshot) => ({
              ...snapshot,
              data:
                snapshot.cv === "2024-10"
                  ? typeof snapshot.data === "string"
                    ? decompressField(snapshot.data)
                    : Object.fromEntries(
                        Object.entries(snapshot.data).map(([key, value]) => [
                          key,
                          decompressField(value),
                        ])
                      )
                  : snapshot.data,
            }))
        );
      // O SDK pode enviar o snapshot inicial antes do lote das ações seguintes.
      await expect
        .poll(() => decodedContent().includes("Mutation after replay started"), { timeout: 15000 })
        .toBe(true);
      const raw = decodedContent();
      expect(raw.includes("secret-fixture-value")).toBe(false);
      expect(raw.includes("hidden-fixture-value")).toBe(false);
      expect(raw.includes("typed-private-value")).toBe(false);
      expect(decodeErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  });
}
