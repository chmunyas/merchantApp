/**
 * E2E Tests — Intelligence Layer views
 * Verifies all 4 AI-powered views render correctly
 */
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:8080";

test.describe("Intelligence Layer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.click("text=Tables");
  });

  test("Revenue Forecast renders with charts", async ({ page }) => {
    await page.click("text=Revenue Forecast");
    await expect(page.locator("text=Revenue Forecast")).toBeVisible();
    await expect(page.locator("text=AVG/DAY")).toBeVisible();
    await expect(page.locator("text=PROJ. WEEK")).toBeVisible();
    await expect(page.locator("text=TREND")).toBeVisible();
    await expect(page.locator("text=Revenue by Day")).toBeVisible();
    await expect(page.locator("text=AI Insights")).toBeVisible();
    // Bar chart has day labels
    await expect(page.locator("text=Mon")).toBeVisible();
    await expect(page.locator("text=Sun")).toBeVisible();
  });

  test("Smart Staffing renders with heatmap", async ({ page }) => {
    await page.click("text=Smart Staffing");
    await expect(page.locator("text=Smart Staffing")).toBeVisible();
    await expect(page.locator("text=Right Now")).toBeVisible();
    await expect(page.locator("text=servers needed")).toBeVisible();
    await expect(page.locator("text=Hourly Traffic Heatmap")).toBeVisible();
    await expect(page.locator("text=Recommendations")).toBeVisible();
    await expect(page.locator("text=Server Performance")).toBeVisible();
    // Heatmap legend
    await expect(page.locator("text=Peak")).toBeVisible();
    await expect(page.locator("text=Quiet")).toBeVisible();
  });

  test("Customer Insights renders with metrics", async ({ page }) => {
    await page.click("text=Customer Insights");
    await expect(page.locator("text=Customer Insights")).toBeVisible();
    await expect(page.locator("text=AVG DWELL")).toBeVisible();
    await expect(page.locator("text=AVG SPEND")).toBeVisible();
    await expect(page.locator("text=REPEAT RATE")).toBeVisible();
    await expect(page.locator("text=UTILIZATION")).toBeVisible();
    await expect(page.locator("text=Most Popular Items")).toBeVisible();
    await expect(page.locator("text=Behavior Patterns")).toBeVisible();
  });

  test("Anomaly Detection renders status", async ({ page }) => {
    await page.click("text=Anomaly Detection");
    await expect(page.locator("text=Anomaly Detection")).toBeVisible();
    await expect(page.locator("text=Monitoring Active")).toBeVisible();
    // Should show either "All Clear" or issue cards
    const allClear = page.locator("text=All Clear");
    const issues = page.locator("text=Detected");
    await expect(allClear.or(issues)).toBeVisible();
    // Monitoring checkmarks
    await expect(page.locator("text=Tip Rates")).toBeVisible();
    await expect(page.locator("text=Walkout Risk")).toBeVisible();
    await expect(page.locator("text=Revenue Drops")).toBeVisible();
  });

  test("all views have back button returning to overview", async ({ page }) => {
    const views = ["Revenue Forecast", "Smart Staffing", "Customer Insights", "Anomaly Detection"];
    for (const view of views) {
      await page.click(`text=${view}`);
      await page.click("text=← Back");
      await expect(page.locator("text=Table Service")).toBeVisible();
    }
  });

  test("AI Powered badge on all views", async ({ page }) => {
    const views = ["Revenue Forecast", "Smart Staffing", "Customer Insights", "Anomaly Detection"];
    for (const view of views) {
      await page.click(`text=${view}`);
      await expect(page.locator("text=AI Powered")).toBeVisible();
      await page.click("text=← Back");
    }
  });
});
