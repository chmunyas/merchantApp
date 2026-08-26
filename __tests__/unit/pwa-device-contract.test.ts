import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "public/manifest.webmanifest"), "utf8"),
) as Record<string, unknown>;
const serviceWorker = readFileSync(resolve(root, "public/sw.js"), "utf8");
const playwrightConfig = readFileSync(
  resolve(root, "playwright.config.ts"),
  "utf8",
);

describe("PWA device contract", () => {
  it("launches the operator app without locking device orientation", () => {
    expect(manifest.start_url).toBe("/pesaswapApp");
    expect(manifest).not.toHaveProperty("orientation");
  });

  it("pre-caches an existing offline document", () => {
    expect(() =>
      readFileSync(resolve(root, "public/offline.html"), "utf8"),
    ).not.toThrow();
    expect(serviceWorker).toContain('"/offline.html"');
    expect(serviceWorker).not.toContain('"/offline"');
  });

  it("never serves cached staff, admin, dashboard or tokenized payment pages", () => {
    for (const path of ["/staff", "/admin", "/dashboard"]) {
      expect(serviceWorker).toContain(`url.pathname.startsWith("${path}")`);
    }
    for (const token of ["o", "r", "i", "tapgo"]) {
      expect(serviceWorker).toContain(`url.searchParams.has("${token}")`);
    }
  });

  it("keeps desktop, iPhone, Android handheld and Android tablet browser projects", () => {
    for (const project of [
      "Desktop Chrome",
      "iPhone 13",
      "Pixel 7",
      "Galaxy Tab S4",
    ]) {
      expect(playwrightConfig).toContain(`devices["${project}"]`);
    }
  });
});
