import { defineConfig } from "vitest/config";

// E2E project: hits the RUNNING app over HTTP (set E2E_BASE_URL, default
// http://localhost:8080) and exercises real PWA -> back-office flows. Kept
// separate from the unit suite (`npm test`) so it never runs without a server.
export default defineConfig({
  test: {
    include: ["__tests__/e2e/**/*.e2e.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    pool: "forks",
  },
});
