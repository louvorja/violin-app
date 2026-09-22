import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "url";

// O pool padrão ("forks") e o pool "threads" quebram no Windows + Node 24 com
// "Cannot read properties of undefined (reading 'config')" ao subir os
// workers do tinypool. "vmThreads" evita esse crash, mas roda as specs num
// contexto vm: `window` deixa de ser redefinível, o TZ do processo não vale,
// `import()` dinâmico de .cjs falha e o mock de "electron" via require.cache
// não alcança o require — por isso o CI do Windows fixa Node 22 (ver
// release.yml) e usa "forks" como todo o resto. "vmThreads" fica só como
// rede de segurança para quem rodar Node 24+ no Windows fora do CI.
const needsVmThreads =
  process.platform === "win32" && Number(process.versions.node.split(".")[0]) >= 24;

export default defineConfig({
  // Sem o plugin, arquivos .vue não são transformados e nenhum teste de
  // componente chega a rodar.
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    teardownTimeout: 5000,
    pool: needsVmThreads ? "vmThreads" : "forks",
    exclude: ["**/node_modules/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/helpers/**"],
      exclude: ["src/helpers/__tests__/**"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@components": fileURLToPath(new URL("./src/components", import.meta.url)),
      "@constants": fileURLToPath(new URL("./src/constants", import.meta.url)),
      "@helpers": fileURLToPath(new URL("./src/helpers", import.meta.url)),
      "@root": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
