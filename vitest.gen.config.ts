import { defineConfig } from "vitest/config";
import path from "node:path";

// Config para los generadores (*.gen.test.ts): previews del PDF y validaciones
// end-to-end. La suite normal (vitest.config.ts) los excluye a propósito.
// "server-only" se stubea porque es un guard de bundling de Next, no de Node.
export default defineConfig({
  test: {
    include: ["tests/**/*.gen.test.ts"],
    exclude: ["**/node_modules/**"],
    environment: "node",
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "tests/_server-only-stub.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
});
