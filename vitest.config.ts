import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@mailpilot/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@mailpilot/server-core": path.resolve(__dirname, "packages/server-core/src/index.ts"),
    },
  },
});
