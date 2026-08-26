import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// An invoice is settled by a GUEST, on the server, in a different browser from
// the merchant's. Both merchant surfaces therefore have to be told rather than
// asked — otherwise a paid invoice reads "Pending" until someone reloads.

const dashboard = readFileSync("src/routes/dashboard/invoices.tsx", "utf8");
const pwaHooks = readFileSync(
  "src/components/merchant/features/hooks.ts",
  "utf8",
);
const migration = readFileSync("db/82-payments-invoice-index.sql", "utf8");

describe("back office stays in sync", () => {
  it("reloads when a payment succeeds", () => {
    expect(dashboard).toMatch(
      /usePesaSwapEvent\("payment\.succeeded", \(\) => void loadAll\(\)\)/,
    );
  });

  it("reloads when a payment is refunded", () => {
    expect(dashboard).toMatch(
      /usePesaSwapEvent\("payment\.refunded", \(\) => void loadAll\(\)\)/,
    );
  });

  it("reloads when the tab is brought back to the front", () => {
    expect(dashboard).toMatch(/visibilitychange/);
    expect(dashboard).toMatch(/document\.visibilityState === "visible"/);
  });

  it("removes its listeners on unmount", () => {
    expect(dashboard).toMatch(/removeEventListener\("visibilitychange", onVisible\)/);
  });
});

describe("PWA stays in sync", () => {
  it("refetches on a settled payment instead of trusting local state", () => {
    expect(pwaHooks).toMatch(/realtime\.on\("payment\.succeeded", onSettled\)/);
    expect(pwaHooks).toMatch(/realtime\.on\("payment\.refunded", onSettled\)/);
  });

  it("refetches when the app is foregrounded", () => {
    expect(pwaHooks).toMatch(/document\.visibilityState === "visible"/);
  });

  it("unsubscribes both realtime handlers on cleanup", () => {
    expect(pwaHooks).toMatch(/offSucceeded\(\);/);
    expect(pwaHooks).toMatch(/offRefunded\(\);/);
  });
});

describe("a venue-less session says so instead of looking empty", () => {
  it("treats 401/403 as an access problem, not as being offline", () => {
    expect(dashboard).toMatch(/invRes\.status === 401 \|\| invRes\.status === 403/);
  });

  it("names the venue-claim case, which is the one that actually happens", () => {
    expect(dashboard).toMatch(/venue claim required/);
    expect(dashboard).toMatch(/won't appear here until you do|will not appear here until you do/);
  });

  it("clears stale rows rather than leaving another venue's data on screen", () => {
    expect(dashboard).toMatch(/setInvoices\(\[\]\);/);
  });

  it("announces the failure to assistive tech", () => {
    expect(dashboard).toMatch(/role="alert"/);
  });

  it("marks a PWA invoice that never reached the server", () => {
    expect(pwaHooks).toMatch(/localOnly: true/);
  });
});

describe("the payments to invoice link is indexed", () => {  it("indexes the exact expression reconciliation filters on", () => {
    expect(migration).toMatch(
      /ON payments \(venue_id, \(\(metadata ->> 'invoice_number'\)\)\)/,
    );
  });

  it("stays partial so it only covers invoice-originated payments", () => {
    expect(migration).toMatch(
      /WHERE \(metadata ->> 'invoice_number'\) IS NOT NULL/,
    );
  });
});
