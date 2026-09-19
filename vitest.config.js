import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "url";

export default defineConfig({
  // Sem o plugin, arquivos .vue não são transformados e nenhum teste de
  // componente chega a rodar.
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    teardownTimeout: 5000,
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
      "@constants": fileURLToPath(new URL("./src/constants", import.meta.url)),
      "@helpers": fileURLToPath(new URL("./src/helpers", import.meta.url)),
      "@root": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
