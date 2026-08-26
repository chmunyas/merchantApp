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
    const hydrationErrors: string[] = [];
    page.on("pageerror", (error) => {
      if (/hydration failed|hydration mismatch/i.test(error.message)) {
        hydrationErrors.push(error.message);
      }
    });
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

    // A real login carries a venue claim, so the demo-venue banner must NOT show.
    await expect(page.getByText(/viewing the demo venue/i)).toHaveCount(0);
    expect(hydrationErrors).toEqual([]);
  });

  test("a cold open (no login) surfaces the demo-venue banner", async ({
    page,
  }) => {
    // Opening the standalone app with no token falls back to an anonymous session
    // scoped to the shared demo venue — which must be announced, not silent.
    await page.goto("/pesaswapApp");
    await expect(page.getByText("PesaSwap").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/viewing the demo venue/i)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("shows an intent-bound payment in the operator ledger", async ({
    page,
    request,
  }) => {
    const suffix = rnd();
    const sourceId = `PWA-${suffix}`;
    const signup = await request.post("/api/auth/signup", {
      data: {
        businessName: `E2E Ledger ${suffix}`,
        email: `e2e-ledger-${suffix}@e2e.test`,
        password: "e2e-passw0rd",
      },
    });
    const merchant = await signup.json();
    expect(signup.ok()).toBe(true);

    const intent = await request.post("/api/payments/intent", {
      headers: { authorization: `Bearer ${merchant.token}` },
      data: {
        amount: 32_100,
        currency: "KES",
        sourceId,
        metadata: {
          flow_type: "tapgo",
          customer_phone: "0700111333",
          customer_name: "E2E Ledger Guest",
        },
      },
    });
    const intentBody = await intent.json();
    expect(intent.ok()).toBe(true);

    const payment = await request.post("/api/payments/create", {
      headers: { "Idempotency-Key": `e2e-ledger-${suffix}` },
      data: {
        payment_intent_token: intentBody.paymentIntentToken,
        metadata: {
          customer_phone: "0700111333",
          customer_name: "E2E Ledger Guest",
        },
      },
    });
    expect(payment.ok()).toBe(true);

    await page.goto(`/pesaswapApp#token=${merchant.token}`);
    await page.getByRole("button", { name: "Ledger" }).click();
    const row = page.getByRole("button", {
      name: /Tap & Go.*E2E Ledger Guest.*Settled/,
    });
    await expect(row).toContainText(/Ksh\s*321/);
    await row.click();
    const detail = page.getByRole("dialog", { name: "Payment detail" });
    await expect(detail).toContainText(sourceId);
    await expect(detail).toContainText("E2E Ledger Guest");

    await page.getByRole("button", { name: "Close payment detail" }).click();
    await page.getByRole("link", { name: "Back office" }).click();
    await page.waitForURL(/\/dashboard\/payments/);
    await expect(
      page.getByRole("heading", { name: "Live payments" }),
    ).toBeVisible({
      timeout: 20_000,
    });
    const backOfficeRow = page.getByRole("row", {
      name: new RegExp(`E2E Ledger Guest.*tapgo.*${sourceId}`, "i"),
    });
    await expect(backOfficeRow).toBeVisible();
    await backOfficeRow.click();
    const backOfficeDetail = page.getByRole("dialog", {
      name: "Transaction detail",
    });
    await expect(backOfficeDetail).toContainText(sourceId);
    await expect(backOfficeDetail).toContainText("E2E Ledger Guest");
  });

  test("uses server orders and pay links for authenticated table operations", async ({
    page,
    request,
  }) => {
    const suffix = rnd();
    const signup = await request.post("/api/auth/signup", {
      data: {
        businessName: `E2E Tables ${suffix}`,
        email: `e2e-tables-${suffix}@e2e.test`,
        password: "e2e-passw0rd",
      },
    });
    const merchant = await signup.json();
    expect(signup.ok()).toBe(true);

    const orderResponse = await request.post("/api/orders", {
      headers: { authorization: `Bearer ${merchant.token}` },
      data: {
        tableId: "12",
        items: [{ name: "E2E Pilau", qty: 2, price: 12_500 }],
      },
    });
    expect(orderResponse.ok()).toBe(true);

    await page.goto(`/pesaswapApp#token=${merchant.token}`);
    await page.getByRole("button", { name: "Tables" }).click();
    await expect(
      page.getByRole("heading", { name: "Live table orders" }),
    ).toBeVisible();
    await expect(page.getByText("Table 12")).toBeVisible();
    await expect(page.getByText("Ksh 250").first()).toBeVisible();

    await page.getByRole("button", { name: "Request payment" }).click();
    const share = page.getByRole("dialog", { name: /Request Ksh 250/ });
    await expect(share).toContainText(/\/pay\?o=[a-f0-9]+/i);
    await share.getByRole("button", { name: "Close" }).click();

    await page.getByRole("link", { name: "KDS" }).click();
    await page.waitForURL(/\/dashboard\/orders/);
    await expect(page.getByText("E2E Pilau")).toBeVisible({ timeout: 20_000 });
  });

  test("records the Tap&Go keypad amount exactly once in minor units", async ({
    page,
    request,
  }) => {
    const suffix = rnd();
    const signup = await request.post("/api/auth/signup", {
      data: {
        businessName: `E2E TapGo ${suffix}`,
        email: `e2e-tapgo-${suffix}@e2e.test`,
        password: "e2e-passw0rd",
      },
    });
    const merchant = await signup.json();
    expect(signup.ok()).toBe(true);

    await page.goto(`/pesaswapApp#token=${merchant.token}`);
    await page.getByRole("button", { name: "Tap&Go" }).click();
    for (const digit of ["1", "2", "3"]) {
      await page.getByRole("button", { name: digit, exact: true }).click();
    }
    await page.getByRole("button", { name: "Generate payment QR" }).click();
    await expect(
      page.getByRole("heading", { name: /Collect KES 123/ }),
    ).toBeVisible();
    await page.getByPlaceholder("7XX XXX XXX").fill("700111444");
    await page.getByRole("button", { name: /Send STK push/ }).click();
    await expect(page.getByText("Payment confirmed")).toBeVisible({
      timeout: 15_000,
    });

    const list = await request.get("/api/payments/list?limit=20", {
      headers: { authorization: `Bearer ${merchant.token}` },
    });
    const body = await list.json();
    const recorded = body.payments.find(
      (payment: { customerPhone?: string; flowType?: string }) =>
        payment.customerPhone === "+254700111444" &&
        payment.flowType === "tapgo",
    );
    expect(recorded).toMatchObject({
      amount: 12_300,
      status: "succeeded",
    });
  });
});
