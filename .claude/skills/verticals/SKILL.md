---
name: verticals
description: >-
  Vertical + tier productisation — what a venue IS (restaurant, retail,
  services, hospitality) and what it has PAID FOR (free, starter, growth,
  enterprise). Use when a task mentions verticals, business type, capabilities,
  feature flags, entitlements, plan tiers, paywalls, upgrade prompts, per-venue
  overrides, or gating navigation and API routes by what a merchant has bought.
---

# Verticals and tiers

One catalogue decides what every venue sees, on the server and in the browser.

## The two rules

| Concept      | Meaning                                           | Overridable?                                  |
| ------------ | ------------------------------------------------- | --------------------------------------------- |
| **Vertical** | What the business is. Sets sensible defaults.     | ✅ Yes — a café may enable the retail counter |
| **Tier**     | What the business has paid for. Sets the ceiling. | ❌ Never — an override cannot buy entitlement |

`canUseCapability(key, profile)` in [src/lib/verticals.ts](../../src/lib/verticals.ts)
applies tier **first**, then the override, then the vertical default. Reordering
those checks breaks the paywall.

## Key files

- `src/lib/verticals.ts` — the catalogue, resolution, path→capability mapping. Pure.
- `src/api/venue-profile.ts` — `GET` (staff+, drives nav) / `PUT` (owner-only).
- `db/80-venue-vertical-capabilities.sql` — `venues.vertical`, `venues.tier`,
  `venue_capability_overrides`.
- `src/routes/dashboard.tsx` — nav filtered by role **and** capability.
- `__tests__/unit/verticals.test.ts`, `__tests__/unit/venue-profile.test.ts`.

## Capability shape

```ts
{ key: "retail.counter", label: "Retail counter", group: "Sales",
  verticals: ["retail"], minTier: "starter", path: "/dashboard/retail" }
```

`verticals: "all"` means every vertical gets it by default (shared commerce:
payments, contacts, reviews, QR). `path` wires it to nav gating.

## Two gates, two jobs

- **Navigation** (`capabilityForPath`) is **UX**. It fails **open** when the
  profile has not loaded, so an offline dashboard is not crippled.
- **API** (`venueHasCapability`) is **security**. It fails **closed**.

Never rely on the sidebar to protect an endpoint.

## Adding a capability

1. Add to `CAPABILITIES` with key, group, verticals, `minTier`, optional `path`.
2. Test that the right verticals get it and a lower tier does not.
3. Enforce server-side if it owns an API route.

## Gotchas

- Existing venues were backfilled to `enterprise` in migration 80 so nothing
  disappeared from live merchants. Real tiers must be set before billing means
  anything — this is an **operator task**, not a code default.
- A merchant `PUT` containing `tier` is ignored by design.
- Enabling an unentitled capability returns **402**, not 403 — it is a payment
  problem, not a permission problem.
- `hospital` normalises to `hospitality`. Healthcare was never actually built;
  do not reintroduce it without the capabilities to back it.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: verticals -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- One commercial capability catalogue in which vertical supplies defaults and paid tier supplies a server-enforced ceiling across navigation, APIs, agents, SDKs, jobs, exports, and multi-store aggregation.
- Complete, sellable vertical journeys with operator-controlled tier changes, audited overrides, upgrade/downgrade and grace behavior, usage/limit visibility, and no capability represented by an empty label or local demo.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
