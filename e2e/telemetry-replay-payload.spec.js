import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Buffer } from "node:buffer";
import process from "node:process";

test("preserva snapshot real do Replay e mantém inputs mascarados", async ({ browser }) => {
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
        import posthog from 'posthog-js/full/no-external';
        // Grava um DOM real com o rrweb do SDK. A captura usa o hook real do app.
        window.snapshots=[];
        let recordingOptions;
        const originalInit=posthog.init.bind(posthog);
        posthog.init=(key,config)=>{
          recordingOptions=config.session_recording;
          const beforeSend=config.before_send;
          return originalInit(key,{...config,opt_out_useragent_filter:true,before_send:capture=>{
            const before=capture?.event==='$snapshot' ? structuredClone(capture.properties.$snapshot_data) : null;
            const result=beforeSend(capture);
            if(before) window.snapshots.push({before,after:result?.properties.$snapshot_data});
            return result;
          }});
        };
        const fragment=document.createDocumentFragment();
        for(let i=0;i<1200;i++){
          const p=document.createElement('p');
          p.textContent=Array.from(crypto.getRandomValues(new Uint32Array(12)),v=>v.toString(36)).join('-');
          fragment.append(p);
        }
        document.querySelector('main').append(fragment);
        await Telemetry.init();
        window.captureReplay=async()=>{
          let fullSnapshot;
          const stop=window.__PosthogExtensions__.rrweb.record({...recordingOptions,
            emit:event=>{if(event.type===2) fullSnapshot=event;}
          });
          stop();
          if(!fullSnapshot) throw new Error('O rrweb não produziu snapshot');
          // Formato cv=2024-10 usado pelo SDK instalado: gzip em string binária.
          const bytes=new Uint8Array(await new Response(new Blob([JSON.stringify(fullSnapshot.data)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
          let data='';
          for(let i=0;i<bytes.length;i+=8192) data+=String.fromCharCode(...bytes.subarray(i,i+8192));
          posthog.capture('$snapshot',{
            $snapshot_data:[{...fullSnapshot,data,cv:'2024-10'}],
            $snapshot_bytes:bytes.length,$session_id:posthog.get_session_id(),$window_id:'fixture-window'
          },{_noTruncate:true,send_instantly:true});
        };`,
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
          builder.onResolve({ filter: /^posthog-js(?:\/full\/no-external)?$/ }, () => ({
            path: resolve("node_modules/posthog-js/dist/module.full.no-external.js"),
          }));
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
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/app.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(bundle.outputFiles[0].text);
    } else if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<main><input value="secret-fixture-value"><input type="hidden" value="hidden-fixture-value"><script type="module" src="/app.js"></script></main>'
      );
    } else {
      request.resume();
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ featureFlags: {}, sessionRecording: { endpoint: "/s/" } }));
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const context = await browser.newContext();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.captureReplay === "function");
    await page.evaluate(() => window.captureReplay());
    const batches = await page.evaluate(() => window.snapshots);
    const before = batches.flatMap((batch) => batch.before).find((event) => event.type === 2);
    const after = batches.flatMap((batch) => batch.after).find((event) => event.type === 2);
    expect(before.cv).toBe("2024-10");
    expect(before.data.length).toBeGreaterThan(20000);
    const raw = gunzipSync(Buffer.from(before.data, "latin1")).toString();
    expect(raw).not.toContain("secret-fixture-value");
    expect(raw).not.toContain("hidden-fixture-value");
    expect(after.data.length).toBe(before.data.length);
    expect(gunzipSync(Buffer.from(after.data, "latin1")).toString()).toBe(raw);
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});
