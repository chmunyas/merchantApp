import { expect, test } from "@playwright/test";

// Store-and-forward resilience: a sale taken OFFLINE is queued locally (shown as
// pending, never "paid"), then syncs automatically when connectivity returns.
const rnd = () => Math.random().toString(36).slice(2, 8);

test.describe("offline store-and-forward (browser)", () => {
  test("a sale queued offline syncs to the server when back online", async ({
    page,
    context,
    request,
  }) => {
    // Seed a real merchant + launch the mobile app pinned to that JWT.
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
    const token: string = su.token;
    const venue: string = su.user.venue;

    await page.goto(`/pesaswapApp#token=${token}`);
    // Let the app adopt the token + render the home tab.
    await page.waitForTimeout(2500);

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
      },
      { saleId, venue },
    );

    // The offline indicator appears (pill in the status bar, visible on any tab).
    await expect(page.getByText(/Offline/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Back online: the queue drains automatically. Fire the browser 'online' event
    // the hook listens for.
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    // The sale reaches the server ledger for THIS venue (poll for the async flush).
    await expect
      .poll(
        async () => {
          const list = await request
            .get(`/api/payments/list?venue=${venue}&limit=20`, {
              headers: { authorization: `Bearer ${token}` },
            })
            .then((r) => r.json())
            .catch(() => ({ payments: [] }));
          const rows = list.payments ?? [];
          return rows.some((p: { amount?: number }) => Math.round(Number(p.amount)) === 50000);
        },
        { timeout: 20_000, intervals: [1000, 1500, 2000] },
      )
      .toBe(true);

    // ...and the local outbox is emptied once synced.
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
        { timeout: 20_000, intervals: [1000, 1500] },
      )
      .toBe(0);
  });
});
