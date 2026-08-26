import { expect, test } from "@playwright/test";

import { seedAuth } from "./_auth";

// Offline money safety: a sale draft never auto-charges on reconnection.
const rnd = () => Math.random().toString(36).slice(2, 8);

test.describe("offline payment drafts (browser)", () => {
  test("a sale draft remains local until explicit online review", async ({
    page,
    context,
    request,
  }) => {
    // Seed a real merchant + open the mobile app already signed in (deterministic
    // — no launch-token/demo-session race).
    const email = `e2e-off-${rnd()}@e2e.test`;
    const su = await request
      .post("/api/auth/signup", {
        data: {
          businessName: `E2E Offline ${rnd()}`,
          email,
          password: "e2e-passw0rd",
        },
      })
      .then((r) => r.json());
    const venue: string = su.user.venue;

    await seedAuth(page, { token: su.token, venue, name: "E2E Offline" });
    await page.goto("/pesaswapApp");
    // IMPORTANT: fully hydrate the app BEFORE going offline — otherwise blocking
    // the network would prevent lazy JS chunks from loading and the app would
    // never render. Wait for the mobile shell + home view to be interactive.
    await expect(page.getByText("PesaSwap").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Merchant").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(1000);

    // Go offline, then simulate a Tap&Go sale being queued (the POS calls the same
    // outbox key). We inject through localStorage + the app's change event so the
    // sync cockpit and header pill react exactly as they do for a real offline sale.
    await context.setOffline(true);
    const saleId = `TG-OFF-${rnd()}`;
    await page.evaluate(
      ({ saleId, venue }) => {
        const charge = {
          id: saleId,
          amount: 50000, // KES 500 in minor units
          currency: "KES",
          metadata: {
            venue,
            merchant_id: venue,
            flow_type: "tapgo",
            merchant_name: "E2E Offline",
            till_number: "0",
            customer_phone: "254700000111",
            description: "Offline E2E sale",
          },
          idempotencyKey: saleId,
          queuedAt: Date.now(),
          attempts: 0,
        };
        localStorage.setItem("pesaswap.pos.outbox", JSON.stringify([charge]));
        window.dispatchEvent(new Event("pesaswap:offline-changed"));
        // Also fire the browser offline event the hook listens for.
        window.dispatchEvent(new Event("offline"));
      },
      { saleId, venue },
    );

    // Back online: reconnection must not submit money movement.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await page.waitForTimeout(2000);
    const list = await request
      .get(`/api/payments/list?venue=${venue}&limit=20`, {
        headers: { authorization: `Bearer ${su.token}` },
      })
      .then((r) => r.json());
    expect((list.payments ?? []).some(
      (p: { amount?: number }) => Math.round(Number(p.amount)) === 50000,
    )).toBe(false);

    // The draft remains until the operator reviews or discards it.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const raw = localStorage.getItem("pesaswap.pos.outbox");
            try {
              return (JSON.parse(raw || "[]") as unknown[]).length;
            } catch {
              return -1;
            }
          }),
        { timeout: 25_000, intervals: [1000, 1500] },
      )
      .toBe(1);
  });
});
