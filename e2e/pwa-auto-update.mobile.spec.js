import { test, expect, devices } from "@playwright/test";
import { build } from "esbuild";
import { generateSW } from "workbox-build";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, extname } from "node:path";
import process from "node:process";
import recovery from "../config/pwaRecovery.cjs";

// O debugger anexado pelo Playwright ao SW do Chromium pode atrasar sua ativação.
// Este cenário roda no projeto WebKit; Chromium também foi verificado sem o debugger do SW.
test.skip(({ browserName }) => browserName !== "webkit", "Ciclo nativo do Workbox no WebKit");

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

// Boot, monitor e guarda reais; só os serviços de dados/atividade são substituídos.
// O SW é gerado pelo Workbox, como no build de produção, sem simular sua ativação.
async function createBuilds(root) {
  const mocks = {
    "@/helpers/Http": "export const NET_TIMEOUT={QUICK:5000}; export const fetchWithTimeout=fetch;",
    "@/helpers/ReliabilityDiagnostics":
      "export const reportReliabilityEvent=()=>{}; export const reportReliabilityFailure=()=>{};",
    "@/helpers/AppData": "export default {get:()=>window.playing};",
    "@/helpers/UserData":
      "export default {flushPendingWebSave:()=>localStorage.setItem('flushed','yes')};",
    "@/helpers/ScheduledStore": "export default {flush:async()=>{}};",
    "@/helpers/projection/webWindow": "export const hasOpenWebWindows=()=>false;",
    "@/composables/useBackgroundTasks":
      "export const useBackgroundTasks=()=>({hasActiveTasks:{value:false}});",
    "@/composables/useBackgroundSound":
      "export const useBackgroundSound=()=>({isPlaying:{value:false}});",
    "@/stores/appStore": "export const useAppStore=()=>({modules:{}});",
  };
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import {effectScope} from 'vue';
        import {startPwaUpdates,subscribePwaUpdates} from '@/helpers/PwaUpdates';
        import {usePwaUpdates} from '@/composables/usePwaUpdates';
        if (!await window.__ljPwaRecovery.ready) {
          startPwaUpdates(navigator.serviceWorker.controller);
          effectScope().run(usePwaUpdates);
          subscribePwaUpdates(state => {document.body.dataset.status=state.status});
          window.__ljPwaRecovery.markMounted();
          document.body.dataset.mounted='yes';
        }`,
    },
    bundle: true,
    write: false,
    format: "esm",
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
  for (const id of [A, B]) {
    const dir = join(root, id);
    await mkdir(dir);
    const boot = `(${recovery.installPwaRecovery.toString()})(${JSON.stringify({
      scope: "/",
      build: id,
      storageKey: "recovery-test",
      startupWaitMs: 50,
    })})`;
    await writeFile(
      join(dir, "index.html"),
      `<meta name="louvorja-build" content="${id}"><body data-build="${id}"><script>${boot}</script><script type="module" src="/app.js"></script>`
    );
    await writeFile(join(dir, "app.js"), bundle.outputFiles[0].text);
    await writeFile(join(dir, "app-build.json"), JSON.stringify({ version: 1, id }));
    await writeFile(join(dir, "release.js"), `// ${id}`);
    await generateSW({
      globDirectory: dir,
      swDest: join(dir, "sw.js"),
      globPatterns: ["*.{html,js,json}"],
      skipWaiting: true,
      clientsClaim: true,
      cleanupOutdatedCaches: true,
      navigateFallback: "index.html",
    });
  }
}

test("aplica atualização tardia sem interromper reprodução nem perder dados (WebKit/iPhone)", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), "violin-pwa-update-"));
  let current = A;
  let releaseDownload;
  const download = new Promise((resolve) => {
    releaseDownload = resolve;
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (current === B && url.pathname === "/release.js") await download;
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    try {
      const body = await readFile(join(root, current, path));
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type":
          { ".js": "application/javascript", ".html": "text/html", ".json": "application/json" }[
            extname(path)
          ] || "text/plain",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  let context;
  try {
    await createBuilds(root);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "allow" });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated");
    await expect(page.locator("body")).toHaveAttribute("data-status", "current");
    await page.evaluate(async () => {
      localStorage.setItem("preference", "keep");
      await (await caches.open("louvorja-audio")).put("/song.opus", new Response("saved audio"));
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("user-data", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("data");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("data", "readwrite");
          transaction.objectStore("data").put("saved schedule", "schedule");
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    });
    current = B;
    // Reabre com HTML antigo; o download do novo código ultrapassa a espera do boot.
    await page.reload();
    await expect(page.locator("body")).toHaveAttribute("data-mounted", "yes");
    expect(await page.locator("body").getAttribute("data-build")).toBe(A);
    await page.evaluate(() => {
      window.playing = true;
    });
    releaseDownload();
    await expect(page.locator("body")).toHaveAttribute("data-status", "ready");
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            return {
              controller: navigator.serviceWorker.controller?.scriptURL,
              active: reg.active?.state,
              waiting: reg.waiting?.state ?? null,
            };
          }),
        { timeout: 10_000 }
      )
      .toEqual({
        controller: `http://127.0.0.1:${server.address().port}/sw.js?build=${B}`,
        active: "activated",
        waiting: null,
      });
    // Mesmo com o SW novo ativado, a reprodução impede trocar o documento.
    await page.waitForTimeout(1200);
    expect(await page.locator("body").getAttribute("data-build")).toBe(A);
    expect(await page.evaluate(() => localStorage.getItem("flushed"))).toBeNull();
    await page.evaluate(() => {
      window.playing = false;
    });
    // Não dispara retorno à aba, clique, online ou erro de chunk para autorizar a recarga.
    await expect(page.locator("body")).toHaveAttribute("data-build", B);
    await expect(page.locator("body")).toHaveAttribute("data-status", "current");
    await page.reload();
    await expect(page.locator("body")).toHaveAttribute("data-mounted", "yes");
    expect(await page.locator("body").getAttribute("data-build")).toBe(B);
    expect(
      await page.evaluate(async () => ({
        preference: localStorage.getItem("preference"),
        flushed: localStorage.getItem("flushed"),
        audio: await (await (await caches.open("louvorja-audio")).match("/song.opus")).text(),
        schedule: await new Promise((resolve, reject) => {
          const request = indexedDB.open("user-data");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction("data");
            const read = transaction.objectStore("data").get("schedule");
            read.onsuccess = () => resolve(read.result);
            transaction.oncomplete = () => db.close();
          };
        }),
      }))
    ).toEqual({
      preference: "keep",
      flushed: "yes",
      audio: "saved audio",
      schedule: "saved schedule",
    });
  } finally {
    releaseDownload();
    await context?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
