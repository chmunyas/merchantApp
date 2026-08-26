---
name: retail-commerce
description: >-
  Build the server-authoritative multi-store retail counter: catalogue, barcode,
  sales, stock, suppliers, purchase orders, credit, receipts, returns, cash and
  reporting. Use for retail, shop, store, till, POS checkout, SKU, barcode,
  credit book, cash drawer, Z-report, suppliers, or /dashboard/retail.
---

# Retail commerce

The retail vertical must converge on one server-authoritative record across
cashiers, managers, devices, stores, payments, inventory, and finance.

## Current boundary

- `db/81-retail-sales.sql` adds sell prices, barcodes, durable sales and line
  snapshots.
- `src/api/retail.ts` provides venue-scoped barcode/SKU lookup and idempotent
  sales that atomically write lines, stock projection, and stock movements.
- `src/routes/dashboard/retail.tsx` still hydrates and saves its products, sales,
  adjustments, suppliers, purchase orders, and credit records through browser
  helpers. The server foundation therefore does not yet make the operator
  journey server-authoritative.

State this as **partial** until the dashboard and all offered retail modules use
the server path and pass concurrent-device recovery tests.

## Invariants

- Money is integer minor units. Quantity may be fractional only where a product
  unit permits it; round at an explicit domain boundary.
- Every table, query, job, export, and event is venue-scoped. Multi-store reports
  aggregate authorised stores without removing that boundary.
- A sale, line snapshots, payment reference, stock projection, movement, receipt,
  and financial event must be idempotent and reconcilable.
- Stock, credit, cash, returns, and adjustments retain append-only events or
  compensating entries with actor and reason. Never erase business history.
- Cashiers may sell and count; cost, margin, supplier terms, cash exceptions,
  material voids, returns, and write-offs require configured elevated authority.

## Delivery order

1. Rewire catalogue, barcode, stock, and sale hydration/mutation to existing
   server APIs with visible loading, conflict, retry, and degraded states.
2. Complete receipts, returns/voids, payment linkage, shift/cash controls, and
   source-to-ledger reconciliation.
3. Add server-backed suppliers, purchase orders, receiving and stock transfer.
4. Add an append-only credit customer/ledger lifecycle with payment allocation,
   aging, limits, approval, statements, and accounting.
5. Validate scanners, printers, drawers, handheld layouts, concurrent tills,
   intermittent connectivity, multi-store reporting, close, and recovery.

New endpoints follow `.github/instructions/api-routes.instructions.md`; new SQL
follows `.github/instructions/db-migrations.instructions.md`.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: retail-commerce -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Server-authoritative multi-store catalogue lookup, sales, stock movements, payment linkage, receipts, returns and void controls, suppliers, purchase orders, credit ledger, shift/cash controls, and reporting.
- Idempotent checkout, role-separated cost and margin access, barcode/scanner and peripheral recovery, concurrent-device consistency, finance traceability, and removal of browser-local business authority.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
