import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // `tsconfig.json` declara `jsx: "preserve"` porque Next.js transpila con
  // SWC. Los tests de componentes (010 C1-1) renderizan JSX real con
  // `react-dom/server` en un entorno `node`, sin jsdom: es lo que permite
  // afirmar sobre el `disabled` que el JSX calcula, en vez de sobre una copia
  // de la regla. Aquí se le dice a esbuild el runtime automático.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
