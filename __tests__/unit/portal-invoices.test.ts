import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The portal's invoice list is the retention surface: a guest who can see what
// they owe must be able to pay it. `pay_link` was declared on the client type
// but never selected on the server, so every invoice rendered unpayable. These
// assertions are deliberately about the CONTRACT between the two files, because
// that is exactly where the gap lived and where it would silently reopen.

const portalApi = readFileSync("src/api/portal.ts", "utf8");
const portalPage = readFileSync("src/routes/me.$token.tsx", "utf8");

const invoiceQuery =
  portalApi.match(/const invoices = await sql`([\s\S]*?)`/)?.[1] ?? "";

describe("portal invoice query", () => {
  it("selects the pay link so the guest can settle the invoice", () => {
    expect(invoiceQuery).toMatch(/pay_link/);
  });

  it("selects the outstanding balance, not just the invoice total", () => {
    expect(invoiceQuery).toMatch(/balance_minor/);
    expect(invoiceQuery).toMatch(/amount_paid/);
  });

  it("stays scoped to the token holder's venue and phone", () => {
    expect(invoiceQuery).toMatch(/venue_id = \$\{venue\}/);
    expect(invoiceQuery).toMatch(/phone = \$\{phone\}/);
  });
});

describe("portal invoice list accessibility", () => {
  it("renders invoices as a list so structure is announced", () => {
    expect(portalPage).toMatch(/<ul className="mt-3 divide-y">/);
  });

  it("gives every pay action an accessible name identifying the invoice", () => {
    expect(portalPage).toMatch(/Pay invoice \$\{invoice\.number\}/);
  });

  it("meets the WCAG 2.2 target size minimum on the pay action", () => {
    // Tailwind 11 = 44px, comfortably above the 24x24 CSS px floor (SC 2.5.8).
    expect(portalPage).toMatch(/min-h-11 min-w-11/);
  });

  it("keeps a visible focus indicator on the pay action", () => {
    expect(portalPage).toMatch(/focus-visible:ring-2/);
  });

  it("hides the decorative section icon from screen readers", () => {
    expect(portalPage).toMatch(/<ReceiptText className="h-4 w-4" aria-hidden="true" \/>/);
  });

  it("does not offer payment on a settled or void invoice", () => {
    expect(portalPage).toMatch(/balanceMinor > 0/);
    expect(portalPage).toMatch(/invoice\.status !== "void"/);
  });
});
