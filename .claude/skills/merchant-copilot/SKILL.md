---
name: merchant-copilot
description: >-
  The merchant's runtime AI employee — a conversational operator that reads the
  venue's live data (sales, orders, analytics, the notebook) and executes ops
  (campaigns, menu/price edits, bookings) on command. Use for tasks about the
  in-dashboard AI assistant, "run my business" agents, or the /dashboard/copilot page.
---

# Merchant copilot (runtime AI employee)

Not a build agent — a **runtime operator** the owner talks to inside the
dashboard. It grounds every answer in live venue data and can act through the
app's own APIs. The Alipay "Xiaoyu" analog: diagnose → decide → execute, in plain
language, with no back-office clicks.

## Key files

- `src/api/copilot.ts` — `POST /api/copilot` (authed); grounds on today's totals +
  open orders, then runs the ops agent for the venue.
- `src/routes/dashboard/copilot.tsx` — the chat UI.
- `src/lib/agent.ts` — `runAgent(...)`, the shared NL + tools engine it calls.

## Endpoints

- `POST /api/copilot` — { message } → { reply, data? }; authed, venue-scoped.

## Permissions (role-based access) — enforced server-side

The copilot answers for the **caller's role** (`payload.role`), scoped to their
venue. Two gates, both in code (never trust the client):

- `canMutate(role)` (`manager`+) — write/ops actions (reprice, 86/restock, add
  item, draft campaign).
- `canSeeSensitive(role)` = **owner-level only** (`merchant`, `admin`,
  `reseller_admin`) — reads of **money + PII**: revenue/sales, payment amounts,
  settlement figures, customer spend/top-spenders, outstanding invoices, and
  **phone numbers / bills / pay-links**. `src/lib/copilot-tools.ts` gates each
  sensitive tool; `src/api/copilot.ts` additionally (a) grounds gross/tx into the
  prompt **only** for an owner session, and (b) short-circuits any sensitive
  _topic_ (`isSensitiveTopic`) up front for a non-owner, returning an owner-only
  message — so no tool or agent path can leak it.
- **Staff / supervisor / manager** keep full **operational** use — orders, menu,
  stock/low-stock, bookings/covers, availability — but never see financials/PII.
- **Owner / admin** can query broadly across the API surface (add tools here, not
  prompt text; every sensitive one must call `canSeeSensitive`).

## Conventions

- **Ground first** (query small facts: today's gross/tx, open orders), then answer
  — never hallucinate numbers. Money facts are grounded **only** for owner sessions.
- Reuse existing tools/APIs to act (campaigns, menu, reports); don't fork logic.
- Runs for the caller's role, venue-scoped; sensitive data is owner-only.

## Guidelines

- Always return 200 with a helpful reply; never throw at the user.
- Keep data-changing actions previewable / reversible where possible.
- Surface the notebook (`/api/reports/summary`) and analytics as the fact base.

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: merchant-copilot -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- A role- and tenant-bound conversational operator whose reads, previews, mutations, approvals, idempotency, audit, and errors use the same domain services and policies as human workflows.
- Explicit confirmation for high-impact operations, prompt/tool abuse resistance, provenance and freshness for answers, safe recovery, human escalation, and evaluation evidence.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
