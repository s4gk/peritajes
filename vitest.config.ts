import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // *.gen.test.ts son generadores (p.ej. el preview del PDF), no tests con
    // asserts: se corren a mano con su env var, no en la suite por defecto.
    exclude: ["**/node_modules/**", "**/*.gen.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
