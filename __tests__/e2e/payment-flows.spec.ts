/**
 * E2E Tests — Customer Payment Flows
 * Tests the full customer journey for both /pay and /table routes
 */
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:8080";

test.describe("Customer Tap&Go Payment (/pay)", () => {
  const payData = btoa(JSON.stringify({ till: "247365", amount: 500, merchant: "Sade's Atelier" }));

  test("full flow: scan → confirm → PIN → success", async ({ page }) => {
    await page.goto(`${BASE}/pay?tapgo=${payData}`);

    // Should show confirm screen
    await expect(page.locator("text=Sade's Atelier")).toBeVisible();
    await expect(page.locator("text=500")).toBeVisible();

    // Enter phone
    await page.fill('input[type="tel"]', "0712345678");

    // Click confirm/pay
    await page.click("text=Confirm");

    // Enter PIN (6 digits)
    for (let i = 0; i < 6; i++) {
      await page.click(`button:has-text("${i + 1}")`);
    }

    // Should transition to processing then success
    await expect(page.locator("text=Success")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Customer Table Payment (/table)", () => {
  const tablePayload = btoa(JSON.stringify({
    tableNumber: 5,
    merchant: "Test Cafe",
    till: "247365",
    server: "Grace M.",
    items: [
      { id: "1", name: "Nyama Choma", price: 850, qty: 1, category: "Main" },
      { id: "2", name: "Pilau Rice", price: 350, qty: 1, category: "Main" },
      { id: "3", name: "Tusker Lager", price: 280, qty: 2, category: "Drink" },
    ],
    openedAt: new Date().toISOString(),
  }));

  test("bill view shows items and total", async ({ page }) => {
    await page.goto(`${BASE}/table?t=${tablePayload}`);
    await expect(page.locator("text=Table 5")).toBeVisible();
    await expect(page.locator("text=Nyama Choma")).toBeVisible();
    await expect(page.locator("text=Pilau Rice")).toBeVisible();
    await expect(page.locator("text=Tusker Lager")).toBeVisible();
    await expect(page.locator("text=1,760")).toBeVisible(); // 850+350+560
  });

  test("full payment: pay all → tip 10% → M-Pesa → success", async ({ page }) => {
    await page.goto(`${BASE}/table?t=${tablePayload}`);

    // Click Pay Now (full amount)
    await page.click("text=Pay Now");

    // Continue with full amount
    await page.click('button:has-text("Continue")');

    // Select 10% tip
    await page.click("text=10%");
    await page.click('button:has-text("Continue")');

    // Enter phone and pay
    await page.fill('input[type="tel"]', "0712345678");
    await page.click('button:has-text("Pay")');

    // Enter PIN
    for (let i = 0; i < 4; i++) {
      await page.click(`button:has-text("${i + 1}")`);
    }

    // Success
    await expect(page.locator("text=Payment Complete")).toBeVisible({ timeout: 10000 });
  });

  test("equal split: 3 people", async ({ page }) => {
    await page.goto(`${BASE}/table?t=${tablePayload}`);
    await page.click("text=Pay Now");

    // Select Equal Split
    await page.click("text=Equal");

    // Set 3 people
    // Find the + button near people count and click twice (default is 2)
    const plusBtn = page.locator('button:has-text("+")').first();
    await plusBtn.click();

    // Continue with share
    await page.click('button:has-text("Continue")');

    // Verify share amount is ~587 (1760/3)
    await expect(page.locator("text=587")).toBeVisible();
  });

  test("smart tip suggestion visible", async ({ page }) => {
    await page.goto(`${BASE}/table?t=${tablePayload}`);
    await page.click("text=Pay Now");
    await page.click('button:has-text("Continue")');

    // Smart tip nudge
    await expect(page.locator("text=Most guests tip")).toBeVisible();
  });

  test("review prompt after payment", async ({ page }) => {
    await page.goto(`${BASE}/table?t=${tablePayload}`);
    await page.click("text=Pay Now");
    await page.click('button:has-text("Continue")');
    await page.click("text=No tip");
    await page.click('button:has-text("Continue")');
    await page.fill('input[type="tel"]', "0712345678");
    await page.click('button:has-text("Pay")');

    // Wait for success and review prompt
    await expect(page.locator("text=Payment Complete")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=How was your experience")).toBeVisible({ timeout: 5000 });
  });

  test("quick charge table hides item list", async ({ page }) => {
    const qcPayload = btoa(JSON.stringify({
      tableNumber: 9,
      merchant: "Test Cafe",
      till: "247365",
      server: "Grace M.",
      items: [],
      openedAt: new Date().toISOString(),
      quickCharge: 1500,
    }));
    await page.goto(`${BASE}/table?t=${qcPayload}`);
    await expect(page.locator("text=1,500")).toBeVisible();
    // No individual items shown
    await expect(page.locator("text=Nyama Choma")).not.toBeVisible();
  });
});
