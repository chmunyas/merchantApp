import { defineConfig, devices } from "@playwright/test";

// Browser E2E: clicks through the real PWA UI against the running app.
// Run: npm run test:e2e:browser   (E2E_BASE_URL defaults to http://localhost:8080)
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8080";

export default defineConfig({
  testDir: "./e2e-browser",
  // Warm the on-demand-compiled dev routes before the suite so a cold server's
  // first-hit compilation doesn't blow past per-test timeouts.
  globalSetup: "./e2e-browser/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "iphone", use: { ...devices["iPhone 13"] } },
    {
      name: "android-handheld",
      use: { ...devices["Pixel 7"], channel: "chromium" },
    },
    {
      name: "android-tablet",
      use: { ...devices["Galaxy Tab S4"], channel: "chromium" },
    },
  ],
});
