import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { invoiceNumber } from "../../src/lib/invoice-number";

// Two defects are guarded here, both found from a real report: a PWA invoice
// that never reached Postgres still offered a shareable /pay link (which 404s),
// and the number it minted could collide with another merchant's under the
// GLOBAL unique index on invoices.number.

const merchantApp = readFileSync("src/components/merchant/MerchantApp.tsx", "utf8");
const creator = readFileSync(
  "src/components/merchant/features/InvoiceCreator.tsx",
  "utf8",
);

describe("invoice number", () => {
  it("uses the same format as a server-issued invoice", () => {
    expect(invoiceNumber()).toMatch(/^INV-[0-9A-F]{16}$/);
  });

  it("does not repeat across a large batch", () => {
    const minted = new Set(Array.from({ length: 5000 }, () => invoiceNumber()));
    expect(minted.size).toBe(5000);
  });

  it("is minted from the shared helper in the PWA, not a short random integer", () => {
    expect(creator).toMatch(/invoiceNumber\(\)/);
    expect(creator).not.toMatch(/Math\.random\(\) \* 89999/);
  });

  it("is minted from the shared helper on the server too", () => {
    const server = readFileSync("src/lib/invoices.ts", "utf8");
    expect(server).toMatch(/from "@\/lib\/invoice-number"/);
  });
});

describe("an unpublished invoice is never presented as payable", () => {
  it("tracks why publishing failed rather than silently falling back", () => {
    expect(merchantApp).toMatch(/"publishing" \| "published" \| "signed-out" \| "failed"/);
    expect(merchantApp).toMatch(/res\.status === 401 \|\| res\.status === 403/);
  });

  it("only treats a confirmed publish as shareable", () => {
    expect(merchantApp).toMatch(/const shareable = publishState === "published"/);
  });

  it("withholds the payment QR until the invoice is payable", () => {
    expect(merchantApp).toMatch(/\{shareable \? \(\s*<>\s*<PaymentQr/);
  });

  it("refuses to copy or share a link that cannot be paid", () => {
    expect(merchantApp).toMatch(/async function copyLink\(\) \{\s*if \(!shareable\) return;/);
    expect(merchantApp).toMatch(/async function share\(\) \{\s*if \(!shareable\) return;/);
  });

  it("disables every send path, not just the toolbar buttons", () => {
    // Copy, Share, "Send to <customer>", audited channel, and device share.
    const disabledCount = (merchantApp.match(/disabled=\{!shareable\}/g) ?? []).length;
    expect(disabledCount).toBeGreaterThanOrEqual(5);
  });

  it("explains the demo case in the merchant's own terms", () => {
    // The consequence the merchant cares about is back-office visibility, not
    // the word "demo" — an invoice they can't find later is the actual harm.
    expect(merchantApp).toMatch(/won't appear in your back office/);
    expect(merchantApp).toMatch(/Sign in with a venue account to publish it/);
  });

  it("announces the unpayable state to assistive technology", () => {
    expect(merchantApp).toMatch(/role="status"[\s\S]{0,200}AlertTriangle/);
  });
});
