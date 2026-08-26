import { expect, test } from "@playwright/test";

// Real browser click-through of the PWA UI. Requires the app running.
const rnd = () => Math.random().toString(36).slice(2, 8);

test.describe("PWA UI (browser)", () => {
  test("self-onboarding wizard creates an account and opens the dashboard", async ({
    page,
  }) => {
    await page.goto("/get-started");
    const businessName = `E2E PW ${rnd()}`;

    // Step 1 — welcome. Retry the click to survive SSR hydration (the button is
    // in the server HTML before React attaches its onClick).
    await expect(
      page.getByRole("heading", { name: /Run your business/i }),
    ).toBeVisible();
    await expect(async () => {
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByPlaceholder("you@business.com")).toBeVisible({
        timeout: 2500,
      });
    }).toPass({ timeout: 20_000 });

    // Step 2 — business + account
    await page.locator('label:has-text("Business name") input').fill(businessName);
    await page.getByPlaceholder("you@business.com").fill(`e2e-pw-${rnd()}@e2e.test`);
    await page.getByPlaceholder("At least 8 characters").fill("e2e-passw0rd");
    await expect(async () => {
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(
        page.getByRole("button", { name: /Create account/i }),
      ).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 20_000 });

    // Step 3 — create the account
    await page.getByRole("button", { name: /Create account/i }).click();

    // Lands in the back office as an ISOLATED tenant: the dashboard renders with
    // THEIR business name (not the demo merchant), proving per-venue branding.
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
    await expect(page.getByText(businessName).first()).toBeVisible();
    // ...and NEVER the shared "Sade's Atelier" demo tenant.
    await expect(page.getByText("Sade's Atelier")).toHaveCount(0);
  });

  test("customer can submit a booking enquiry", async ({ page }) => {
    await page.goto("/enquire");
    // Let the page settle (demo-data seeding) so React has hydrated and the
    // controlled input + onClick are live.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    await page.getByPlaceholder("Jane Doe").fill(`E2E PW Guest ${rnd()}`);
    await page.getByRole("button", { name: /Request booking/i }).click();
    // Target the confirmation heading (a toast also says "Request sent!").
    await expect(
      page.getByRole("heading", { name: "Request sent" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("merchant landing page offers to install the app", async ({ page }) => {
    await page.goto("/merchant");
    await expect(
      page.getByRole("button", { name: /Install app/i }),
    ).toBeVisible();
  });

  test("operator app adapts to desktop, phone and Android handheld profiles", async ({
    page,
  }) => {
    await page.goto("/pesaswapApp");
    const shell = page.getByTestId("operator-shell");
    await expect(shell).toBeVisible();
    const navigation = page.getByRole("navigation", {
      name: "Operator sections",
    });
    await expect(navigation).toBeVisible();

    const viewport = page.viewportSize();
    const shellBox = await shell.boundingBox();
    expect(shellBox).not.toBeNull();
    if ((viewport?.width ?? 0) >= 768) {
      expect(shellBox?.width ?? 0).toBeGreaterThan(600);
    } else {
      expect(shellBox?.width ?? 0).toBeLessThanOrEqual(viewport?.width ?? 0);
    }

    const targetHeights = await navigation
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().height),
      );
    expect(targetHeights.every((height) => height >= 44)).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("public pay link shows the invoice amount", async ({ page, request }) => {
    // Seed a merchant + invoice via the API, then open the customer pay page.
    const email = `e2e-pw-${rnd()}@e2e.test`;
    const su = await request
      .post("/api/auth/signup", {
        data: {
          businessName: `E2E PW Pay ${rnd()}`,
          email,
          password: "e2e-passw0rd",
        },
      })
      .then((r) => r.json());
    const inv = await request
      .post(`/api/invoices?venue=${su.user.venue}`, {
        headers: { authorization: `Bearer ${su.token}` },
        data: { customerName: "E2E PW Customer", amount: 2500 },
      })
      .then((r) => r.json());

    await page.goto(`/pay?i=${inv.number}`);
    await expect(page.getByText(/2,?500/)).toBeVisible();
  });
});
