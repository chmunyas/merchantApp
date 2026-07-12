import { expect, test } from "@playwright/test";

// The fee-transparency cockpit renders for an authenticated merchant. Uses the
// real onboarding wizard so the session is established exactly like a live user.
const rnd = () => Math.random().toString(36).slice(2, 8);

test.describe("fees cockpit (browser)", () => {
  test("the fees dashboard shows the blended rate cockpit + calculator", async ({
    page,
    request,
  }) => {
    const su = await request
      .post("/api/auth/signup", {
        data: {
          businessName: `E2E Fees ${rnd()}`,
          email: `e2e-fees-${rnd()}@e2e.test`,
          password: "e2e-passw0rd",
        },
      })
      .then((r) => r.json());
    const token: string = su.token;

    // Adopt the session (pins venue + user), then open the dashboard cockpit.
    await page.goto(`/pesaswapApp#token=${token}`);
    await expect(page.getByText("PesaSwap").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(1000);

    // Open the fee cockpit.
    await page.goto("/dashboard/fees");
    await expect(
      page.getByRole("heading", { name: /Fees & takings/i }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Blended effective rate/i)).toBeVisible();
    await expect(page.getByText(/By payment method/i)).toBeVisible();
    await expect(page.getByText(/Fee calculator/i)).toBeVisible();

    // The calculator is live: pick M-Pesa and confirm the "You receive" line.
    await page.getByRole("button", { name: "M-Pesa", exact: true }).click();
    await expect(page.getByText("You receive", { exact: true })).toBeVisible();
  });
});
