import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { resolve } from "node:path";
import process from "node:process";

test("recupera importação interrompida pelo botão mesmo sem uma versão nova", async ({
  browser,
}) => {
  const buildId = "00000000-0000-0000-0000-00000000000a";
  // Executa o controlador, a guarda de atividade e o aviso reais, com SW e import() nativos.
  // Os demais serviços da aplicação só oferecem o estado necessário à guarda.
  const mocks = {
    "@/helpers/Http": "export const NET_TIMEOUT={QUICK:5000}; export const fetchWithTimeout=fetch;",
    "@/helpers/ReliabilityDiagnostics":
      "export const reportReliabilityEvent=()=>{}; export const reportReliabilityFailure=()=>{};",
    "@/helpers/Platform": "export default {isDesktop:false};",
    "@/helpers/AppData": "export default {get:()=>window.playing};",
    "@/helpers/UserData":
      "export default {flushPendingWebSave:()=>{window.flushed=true;localStorage.setItem('flushed','yes')}};",
    "@/helpers/ScheduledStore": "export default {flush:async()=>{}};",
    "@/helpers/projection/webWindow": "export const hasOpenWebWindows=()=>false;",
    "@/composables/useBackgroundTasks":
      "export const useBackgroundTasks=()=>({hasActiveTasks:{value:false}});",
    "@/composables/useBackgroundSound":
      "export const useBackgroundSound=()=>({isPlaying:{value:false}});",
    "@/stores/appStore": "export const useAppStore=()=>({modules:{}});",
    "@/i18n": "export const i18nAtual=()=>({global:{t:()=> 'Recarregar'}});",
    "@/helpers/Snackbar": `export default {show: options => {
      document.querySelector('#recover')?.remove();
      const button = document.createElement('button'); button.id='recover';
      button.textContent=options.text; button.onclick=options.action; document.body.append(button);
    }};`,
  };
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import {effectScope} from 'vue';
        import {startPwaUpdates,subscribePwaUpdates} from '@/helpers/PwaUpdates';
        import {usePwaUpdates} from '@/composables/usePwaUpdates';
        import {notifyStaleVersion} from '@/helpers/StaleVersion';
        await navigator.serviceWorker.register('/sw.js?build=${buildId}');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve =>
          navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
        startPwaUpdates(); effectScope().run(usePwaUpdates);
        subscribePwaUpdates(state => {document.body.dataset.status=state.status});
        document.querySelector('#load').onclick=async()=>{
          try {const module=await import('/chunk.js'); document.querySelector('#result').textContent=module.value;}
          catch {notifyStaleVersion();}
        };`,
    },
    bundle: true,
    write: false,
    format: "esm",
    external: ["/chunk.js"],
    define: { "import.meta.env.BASE_URL": '"/"', "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "pwa-test-services",
        setup(builder) {
          builder.onResolve({ filter: /^@\// }, ({ path }) =>
            mocks[path]
              ? { path, namespace: "test-service" }
              : { path: resolve("src", `${path.slice(2)}.ts`) }
          );
          builder.onLoad({ filter: /.*/, namespace: "test-service" }, ({ path }) => ({
            contents: mocks[path],
          }));
        },
      },
    ],
  });
  let documents = 0;
  let chunkRequests = 0;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/sw.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(
        "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));"
      );
    } else if (url.pathname === "/app-build.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ version: 1, id: buildId }));
    } else if (url.pathname === "/app.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(bundle.outputFiles[0].text);
    } else if (url.pathname === "/chunk.js") {
      chunkRequests++;
      response.statusCode = chunkRequests === 1 ? 503 : 200;
      response.setHeader("Content-Type", "application/javascript");
      response.end(
        chunkRequests === 1 ? "temporarily unavailable" : "export const value='Módulo carregado';"
      );
    } else if (url.pathname === "/") {
      documents++;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        `<meta name="louvorja-build" content="${buildId}"><button id="load">Abrir módulo</button><p id="result"></p><script type="module" src="/app.js"></script>`
      );
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const context = await browser.newContext({ serviceWorkers: "allow" });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.locator("body")).toHaveAttribute("data-status", "current");
    await page.evaluate(() => localStorage.setItem("preference", "keep"));
    await page.locator("#load").click();
    await expect(page.locator("#recover")).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute("data-status", "current");
    // O navegador conserva a falha do módulo até uma nova navegação.
    await page.locator("#load").click();
    expect(chunkRequests).toBe(1);
    expect(documents).toBe(1);
    await page.evaluate(() => {
      window.playing = true;
    });
    await page.locator("#recover").click();
    await expect(page.locator("body")).toHaveAttribute("data-status", "current");
    expect(documents).toBe(1);
    expect(await page.evaluate(() => window.flushed)).toBeUndefined();
    await page.evaluate(() => {
      window.playing = false;
    });
    await expect.poll(() => documents).toBe(2);
    await expect(page.locator("body")).toHaveAttribute("data-status", "current");
    expect(await page.evaluate(() => localStorage.getItem("preference"))).toBe("keep");
    expect(await page.evaluate(() => localStorage.getItem("flushed"))).toBe("yes");
    await page.locator("#load").click();
    await expect(page.locator("#result")).toHaveText("Módulo carregado");
    expect(chunkRequests).toBe(2);
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});
