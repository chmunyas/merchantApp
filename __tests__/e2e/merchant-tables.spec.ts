/**
 * E2E Tests — Merchant Table Management
 * Tests the full merchant table lifecycle
 */
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:8080";

test.describe("Merchant Table Lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.click("text=Tables");
  });

  test("create new table", async ({ page }) => {
    // Click + button
    await page.click('button:has([class*="Plus"])');
    // Fill table number
    await page.fill('input[type="tel"]', "99");
    // Click Open Table
    await page.click("text=Open Table");
    // Verify table appears
    await expect(page.locator("text=Table 99")).toBeVisible();
  });

  test("quick charge flow", async ({ page }) => {
    await page.click("text=Quick Charge");
    await expect(page.locator("text=Quick Charge")).toBeVisible();
    // Enter amount using numpad or input
    await page.fill('input[type="tel"]', "2500");
    await page.click("text=Create & Generate QR");
    // QR should appear
    await expect(page.locator("svg")).toBeVisible(); // QR SVG
  });

  test("add items from catalogue", async ({ page }) => {
    // Click on an existing table
    await page.click("text=Table 3");
    // Click Add Items
    await page.click("text=Add Items");
    // Select items from catalogue
    await page.click("text=Nyama Choma");
    // Confirm
    await page.click("text=Confirm");
    // Verify item added
    await expect(page.locator("text=Nyama Choma")).toBeVisible();
  });

  test("catalogue CRUD", async ({ page }) => {
    await page.click("text=Catalogue");

    // Add new item
    await page.fill('input[placeholder*="name"]', "Test Burger");
    await page.fill('input[placeholder*="price"]', "750");
    await page.click("text=Save");

    // Verify added
    await expect(page.locator("text=Test Burger")).toBeVisible();

    // Delete item
    await page.click('button:has([class*="X"])'); // X/delete button
    await expect(page.locator("text=Test Burger")).not.toBeVisible();
  });

  test("generate and view QR", async ({ page }) => {
    await page.click("text=Table 3");
    await page.click("text=QR");
    await expect(page.locator("text=Table 3 QR Code")).toBeVisible();
    await expect(page.locator("svg")).toBeVisible(); // QR code SVG
  });

  test("refund payment", async ({ page }) => {
    // Navigate to a table with payments
    await page.click("text=Table 7"); // has payments from seed
    await page.click("text=Refund");
    await page.click("text=Confirm");
    // Payment should be removed
  });

  test("tips analytics view", async ({ page }) => {
    await page.click("text=Tips Analytics");
    await expect(page.locator("text=Tips Analytics")).toBeVisible();
    // Should show server leaderboard or empty state
  });

  test("payment history with filter", async ({ page }) => {
    await page.click("text=History");
    await expect(page.locator("text=Payment History")).toBeVisible();
    // Filter by table
    await page.fill('input[type="tel"]', "3");
    // Should filter results
  });
});
