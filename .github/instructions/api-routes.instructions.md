---
applyTo: "src/api/**"
description: "Rules for adding or changing API routes: central route-policy registration, tenancy, roles, PAT scopes, sensitivity classification."
---

# API route rules

Every HTTP surface is default-deny. A handler that is not in the central inventory is
unreachable — registration is not optional bookkeeping, it is the authorization.

## 1. Register the route before writing the handler

Add a `route(...)` entry to the inventory in [src/lib/route-policy.ts](../../src/lib/route-policy.ts).
Supply all seven positional facts, then options:

`route(id, handler, methods, path, access, tenant, sensitivity, { minimumVenueRole, scopes, cors })`

- `access` — `public` · `human-or-api-token` · `human-only` · `customer-token` · `service` ·
  `webhook` · `cron-or-human` · `development`.
- `tenant` — how the venue is resolved. Default to `principalVenue`. Only use `global`,
  `publicSelector` or `resourceToken` when the route genuinely cannot be principal-scoped.
- `sensitivity` — `public` · `operational` · `pii` · `financial` · `credential` · `platform`.
  Money movement is `financial`. Guest data is `pii`. Tokens/secrets are `credential`.
- Dynamic segments must use the declared `DYNAMIC_SEGMENTS` classes (`:uuid`, `:id`, `:token`,
  `:hex`, `:slug`, `:code`, `:channel`, `:ingress`, `:action`) — do not invent ad-hoc regexes.

## 2. Gate by role, not by hope

- Reads of financial, PII or credential data: `minimumVenueRole: "manager"` or stricter.
- Any mutation that moves money (refunds, payouts, tip distribution, manual tender pushes,
  walkout claims, fee changes): **manager+, no exceptions.**
- Session/account routes (`/api/auth/**`, `/api/tokens`) are `human-only`. A PAT must never be
  able to mint or manage tokens.

## 3. PAT scopes are exact, not implied

- Declare `scopes` from `API_SCOPES` in [src/lib/api-tokens.ts](../../src/lib/api-tokens.ts).
- Write actions require the `:write` scope; read routes require `:read`. Never accept `:write`
  as a substitute for a missing `:read`.
- `/api/a2a` needs entry-scope `agent:invoke` **plus** the domain scope for each selected tool.
- Introducing a new domain means adding `<domain>:read` / `<domain>:write` to `API_SCOPES` first.

## 4. Tenancy

- Derive `venue_id` from the principal, never from the request body or a query param.
- Every SQL statement in a handler filters on `venue_id`. No exceptions for "internal" reads.
- Cross-venue reads belong to `multistore.ts` / `org.ts` and require an explicit org claim.

## 5. Defense in depth

Handler-local `requireAuth` / role checks stay even after the central policy covers the route.
Do not remove them when adding a policy entry.

## 6. Secrets and inputs

- Provider credentials, POS credentials, webhook secrets: environment secrets only. Never
  `app_settings`, never a database column, never a committed default.
- Inbound webhooks must verify signature or shared secret before any side effect. Unverified
  deliveries are acknowledged and dropped, never processed.
- Validate and narrow request bodies at the boundary. Reject unknown fields on financial routes.

## 7. Before you finish

- Add negative-path coverage: wrong role, wrong venue, missing scope, wrong method (405), and
  undeclared path (404).
- Run `npm run lint && npm run build`.
- If the change needs an operator action (new secret, provider config, migration to apply),
  record it in [BACKLOG.md](../../BACKLOG.md).
