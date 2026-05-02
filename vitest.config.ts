import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup/integration.setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    hookTimeout: 30000,
    testTimeout: 30000,
    sequence: {
      concurrent: false
    }
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  }
});
