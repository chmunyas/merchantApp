import { chromium, type FullConfig } from "@playwright/test";

// Warm the on-demand-compiled dev routes BEFORE the suite runs. The dev server
// (vite) compiles each SSR route + its client chunks on the FIRST request; on a
// cold CI server that first-hit latency stacked up and blew past per-test
// timeouts. Navigating the heavy routes once here (real browser → compiles both
// SSR and client modules) means the actual tests hit warm, fast routes.
// Best-effort: any failure here is ignored so it can never fail the suite.
async function globalSetup(_config: FullConfig) {
  const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";
  const routes = [
    "/",
    "/get-started",
    "/sign-in",
    "/dashboard",
    "/dashboard/fees",
    "/pay",
    "/pesaswapApp",
    "/enquire",
    "/merchant",
  ];
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    for (const r of routes) {
      try {
        await page.goto(base + r, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        await page.waitForTimeout(250);
      } catch {
        /* ignore — warming is best-effort */
      }
    }
  } catch {
    /* ignore — never fail the suite on warmup */
  } finally {
    await browser?.close();
  }
}

export default globalSetup;
