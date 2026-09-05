import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { createRequire } from "module";

const require_ = createRequire(import.meta.url);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// https://vitejs.dev/config/
export default async ({ mode }) => {
  // -----------------------------------------------------------------------
  // Domínios base compartilhados (fonte única: config/cspDomains.cjs)
  // -----------------------------------------------------------------------
  const { DOMAINS, DOMAINS_CSP } = require_("./config/cspDomains.cjs");

  const { visualizer } = await import("rollup-plugin-visualizer");
  // Load app-level env vars to node-level env vars.
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

  // Detectar target: "desktop" (Electron) ou "web" (padrão PWA)
  const isDesktop = process.env.VITE_TARGET === "desktop";

  // URLs da API para CSP (derivadas de VITE_URL_API)
  const apiUrl = (process.env.VITE_URL_API || "").replace(/\/$/, "");
  const apiUrlFallback = (process.env.VITE_URL_API_FALLBACK || "").replace(/\/$/, "");
  const apiOrigins = [apiUrl, apiUrlFallback].filter(Boolean).join(" ");

  function buildCspMeta() {
    const api = DOMAINS.API.join(" ");
    const cspApiConnect = apiOrigins ? ` ${apiOrigins} ${api}` : api;

    return (
      `<meta http-equiv="Content-Security-Policy" content="` +
      `default-src 'self';` +
      ` script-src 'self' blob: ${DOMAINS_CSP.SCRIPT} 'wasm-unsafe-eval';` +
      ` style-src 'self' 'unsafe-inline' ${DOMAINS_CSP.STYLE};` +
      ` font-src 'self' data: ${DOMAINS_CSP.FONT};` +
      ` img-src 'self' data: ${DOMAINS_CSP.IMG};` +
      ` media-src 'self' blob: ${DOMAINS_CSP.MEDIA};` +
      ` connect-src 'self' blob: ${cspApiConnect} http://localhost:* ws://localhost:* ${DOMAINS_CSP.CONNECT};` +
      ` worker-src 'self' blob:;` +
      ` frame-src ${DOMAINS_CSP.FRAME};` +
      `">`
    );
  }

  const cspMeta = buildCspMeta();

  // Plugins base — sempre incluídos
  const plugins = [
    vue(),
    // No desktop (Electron), CSP é gerenciado via session.webRequest no
    // main process, com política relaxada para janelas de projeção de vídeo
    // (YouTube IFrame Player API precisa de 'unsafe-inline' no script-src).
    ...(isDesktop
      ? []
      : [
          {
            name: "louvorja-csp-prod",
            apply: "build",
            transformIndexHtml(html) {
              return html.replace("<!--CSP_PROD-->", cspMeta);
            },
          },
        ]),
  ];

  // Bundle visualizer — gera dist/stats.html a cada build
  plugins.push(
    visualizer({
      filename: "dist/stats.html",
      open: false,
      gzipSize: true,
      brotliSize: true,
    })
  );

  // VitePWA só para target web — no Electron o protocolo file:// não suporta Service Workers
  if (!isDesktop) {
    const dbUrl = process.env.VITE_URL_API
      ? `${process.env.VITE_URL_API}${process.env.VITE_PATH_JSON_DB || "/json_db"}`
      : (process.env.VITE_URL_DATABASE ?? "");
    const filesUrl = process.env.VITE_URL_API
      ? `${process.env.VITE_URL_API}${process.env.VITE_PATH_FILES || "/file"}`
      : (process.env.VITE_URL_FILES ?? "");

    // Runtime caching: DB JSONs (stale-while-revalidate) + mídia (cache-first 30 dias).
    // Quando VITE_URL_* está definido, usa padrão preciso de URL; caso contrário, cai
    // em padrão por extensão (amplo mas seguro para este app de apresentação).
    const runtimeCaching = [
      // JSONs do banco — serve do cache enquanto atualiza em background
      ...(dbUrl
        ? [
            {
              urlPattern: new RegExp(`^${escapeRegex(dbUrl)}`),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "louvorja-db",
                expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 3600 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ]
        : []),
      // Áudio (mp3, ogg, wav) — cache-first, TTL 30 dias
      {
        urlPattern: filesUrl
          ? new RegExp(`^${escapeRegex(filesUrl)}.*\\.(mp3|ogg|wav)(\\?.*)?$`, "i")
          : /\.(mp3|ogg|wav)(\?.*)?$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "louvorja-audio",
          expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 3600 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      // Imagens externas — cache-first, TTL 30 dias
      {
        urlPattern: filesUrl
          ? new RegExp(`^${escapeRegex(filesUrl)}.*\\.(jpg|jpeg|png|webp|gif)(\\?.*)?$`, "i")
          : /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "louvorja-images",
          expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 3600 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ];

    plugins.push(
      VitePWA({
        registerType: "autoUpdate",
        devOptions: {
          enabled: true,
        },
        workbox: {
          globPatterns: ["**/*.{html,js,css,svg,png,woff,woff2}"],
          runtimeCaching,
        },
        manifest: {
          name: "LouvorJA Violin",
          short_name: "LouvorJA Violin",
          description: "Software de músicas para Louvor e Adoração",
          start_url: process.env.VITE_BASE_URL ?? "/",
          display: "standalone",
          background_color: "#000000",
          theme_color: "#000000",
          icons: [
            {
              src: (process.env.VITE_BASE_URL ?? "/") + "ico/favicon-16x16.png",
              sizes: "16x16",
              type: "image/png",
            },
            {
              src: (process.env.VITE_BASE_URL ?? "/") + "ico/favicon-32x32.png",
              sizes: "32x32",
              type: "image/png",
            },
            {
              src: (process.env.VITE_BASE_URL ?? "/") + "ico/favicon-144x144.png",
              sizes: "144x144",
              type: "image/png",
            },
            {
              src: (process.env.VITE_BASE_URL ?? "/") + "ico/favicon-152x152.png",
              sizes: "152x152",
              type: "image/png",
            },
            {
              src: (process.env.VITE_BASE_URL ?? "/") + "ico/favicon-180x180.png",
              sizes: "180x180",
              type: "image/png",
            },
          ],
        },
      })
    );
  }

  return defineConfig({
    // No Electron, base deve ser "./" para que assets relativos funcionem via file://
    // No web/PWA, usa VITE_BASE_URL ou "/" como padrão
    base: isDesktop ? "./" : (process.env.VITE_BASE_URL ?? "/"),

    plugins,

    define: {
      "process.env": {},
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "true",
    },
    optimizeDeps: {
      include: ["jszip"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@components": path.resolve(__dirname, "src/components"),
        "@constants": path.resolve(__dirname, "src/constants"),
        "@helpers": path.resolve(__dirname, "src/helpers"),
        "@lang": path.resolve(__dirname, "src/lang"),
        "@layout": path.resolve(__dirname, "src/layout"),
        "@modules": path.resolve(__dirname, "src/modules"),
        "@root": path.resolve(__dirname),
        "@store": path.resolve(__dirname, "src/store"),
        "@views": path.resolve(__dirname, "src/views"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // Framework core — raramente muda, longa vida no cache do browser
            "vendor-vue": ["vue", "vue-router", "pinia"],
            // i18n — muda só com novas traduções
            "vendor-i18n": ["vue-i18n"],
            // Busca full-text
            "vendor-fuse": ["fuse.js"],
            // Reka UI — o headless por trás dos primitivos
            "vendor-reka": ["reka-ui"],
          },
        },
      },
    },
    server: {
      port: 5002,
    },
    /* remove the need to specify .vue files https://vitejs.dev/config/#resolve-extensions
  resolve: {
    extensions: [
      '.js',
      '.json',
      '.jsx',
      '.mjs',
      '.ts',
      '.tsx',
      '.vue',
    ]
  },
  */
  });
};
