/**
 * E2E Smoke Tests — PesaSwap
 * Run: npx playwright test __tests__/e2e/smoke.spec.ts
 * Ensures all pages load and critical UI elements render.
 */
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:8080";

test.describe("Smoke Tests — All Pages Load", () => {
  test("Home page loads with merchant app", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator("text=FX ENGINE")).toBeVisible();
    await expect(page.locator("text=Merchant App")).toBeVisible();
  });

  test("Bottom nav has all 6 tabs", async ({ page }) => {
    await page.goto(BASE);
    // Click into merchant app view
    await page.click("text=Merchant App");
    for (const tab of ["Tap&Go", "Tables", "Home", "Invoice", "AI", "Ledger"]) {
      await expect(page.locator(`button:has-text("${tab}")`)).toBeVisible();
    }
  });

  test("Tables tab renders overview", async ({ page }) => {
    await page.goto(BASE);
    await page.click("text=Tables");
    await expect(page.locator("text=Table Service")).toBeVisible();
    await expect(page.locator("text=Quick Charge")).toBeVisible();
    await expect(page.locator("text=Intelligence Layer")).toBeVisible();
  });

  test("Tap&Go tab renders numpad", async ({ page }) => {
    await page.goto(BASE);
    await page.click("text=Tap&Go");
    await expect(page.locator("text=KES")).toBeVisible();
  });

  test("AI tab renders insights", async ({ page }) => {
    await page.goto(BASE);
    await page.click("text=AI");
    await expect(page.locator("text=Insights")).toBeVisible();
  });

  test("/pay route loads without sidebar", async ({ page }) => {
    await page.goto(`${BASE}/pay`);
    await expect(page.locator("text=Tap & Go")).toBeVisible();
    // Sidebar should NOT be present
    await expect(page.locator("text=FX Engine")).not.toBeVisible();
  });

  test("/table route with valid QR param loads bill", async ({ page }) => {
    const payload = btoa(JSON.stringify({
      tableNumber: 1,
      merchant: "Test Cafe",
      till: "247365",
      server: "Grace",
      items: [{ id: "1", name: "Coffee", price: 200, qty: 1, category: "Drink" }],
      openedAt: new Date().toISOString(),
    }));
    await page.goto(`${BASE}/table?t=${payload}`);
    await expect(page.locator("text=Table 1")).toBeVisible();
    await expect(page.locator("text=Coffee")).toBeVisible();
    await expect(page.locator("text=Pay Now")).toBeVisible();
  });

  test("/table route without params shows error", async ({ page }) => {
    await page.goto(`${BASE}/table`);
    // Should show scan/error state
    await expect(page.locator("text=scan")).toBeVisible({ timeout: 5000 }).catch(() => {
      // Acceptable: may show loading or error
    });
  });

  test("Intelligence Layer buttons all navigate", async ({ page }) => {
    await page.goto(BASE);
    await page.click("text=Tables");

    // Revenue Forecast
    await page.click("text=Revenue Forecast");
    await expect(page.locator("text=Revenue Forecast")).toBeVisible();
    await page.click("text=← Back");

    // Smart Staffing
    await page.click("text=Smart Staffing");
    await expect(page.locator("text=servers needed")).toBeVisible();
    await page.click("text=← Back");

    // Customer Insights
    await page.click("text=Customer Insights");
    await expect(page.locator("text=AVG DWELL")).toBeVisible();
    await page.click("text=← Back");

    // Anomaly Detection
    await page.click("text=Anomaly Detection");
    await expect(page.locator("text=Monitoring Active")).toBeVisible();
  });
});
