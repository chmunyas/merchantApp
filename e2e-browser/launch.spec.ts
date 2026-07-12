import { expect, test } from "@playwright/test";

// The dashboard "Launch app" handoff (/pesaswapApp#token=…) must open on the
// logged-in merchant's OWN venue — never the shared demo venue — on the first
// paint. This exercises the REAL adoption path (not a seeded session).
const rnd = () => Math.random().toString(36).slice(2, 8);

test.describe("launch handoff (browser)", () => {
  test("opens on the merchant's own venue, never the demo venue", async ({
    page,
    request,
  }) => {
    const su = await request
      .post("/api/auth/signup", {
        data: {
          businessName: `E2E Launch ${rnd()}`,
          email: `e2e-launch-${rnd()}@e2e.test`,
          password: "e2e-passw0rd",
        },
      })
      .then((r) => r.json());

    await page.goto(`/pesaswapApp#token=${su.token}`);

    // The mobile shell + home view render...
    await expect(page.getByText("PesaSwap").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Merchant").first()).toBeVisible({
      timeout: 30_000,
    });

    // ...and it is adopted to the merchant's OWN venue — the demo tenant
    // ("Sade's Atelier" + its seeded receivables) must NOT appear.
    await expect(page.getByText("Sade's Atelier")).toHaveCount(0);
  });
});
