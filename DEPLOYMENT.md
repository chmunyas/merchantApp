# Deployment and Scale Guide

The target runtime is Cloudflare Workers with Hyperdrive and PostgreSQL. The
canonical release decision and ordered gates are in [`review.md`](review.md).
Production is currently **NO-GO**; this guide describes preparation and validation,
not approval to move unrestricted money or PII.

## Topology

```text
Browser/PWA → Cloudflare Worker (SSR + /api) → Hyperdrive → PostgreSQL
                                      └──────→ PesaSwap/channel providers
```

- Version-controlled production profile: top-level `wrangler.toml`.
- Isolated simulated profile: `wrangler.toml` `[env.sandbox]`; it must use a
  separate Worker URL and database.
- Local development: `docker-compose.yml`, with simulators explicitly enabled.
- Production-like local Worker: `docker-compose.prod.yml`, with debug, simulation,
  and payment test mode explicitly disabled.

## Mandatory preflight

The Worker now refuses request dispatch with 503 when its production posture is
unsafe. Before any production deploy, verify:

| Configuration | Required production value |
| --- | --- |
| `APP_ENV` | `production` |
| `AUTH_REQUIRE_LOGIN` | `1` |
| `AUTH_OTP_DEBUG` | `0` |
| `ALLOW_SIMULATORS` | `0` |
| `PAYMENTS_TEST_MODE` | `0` |
| `PESASWAP_URL` | `https://api.pesaswap.io` |
| `CORS_ALLOWED_ORIGIN` | Trusted production origin/allowlist, never `*` |

Required secret-store values are `JWT_SECRET`, `PESASWAP_API_KEY`, and
`PESASWAP_WEBHOOK_SECRET`. Configure `ADMIN_PASSWORD`/`ADMIN_EMAIL` as appropriate.
When a feature is enabled, also provide its service secret:

- `WHATSAPP_BRIDGE_TOKEN` and `WHATSAPP_BRIDGE_VENUE` whenever
  `WHATSAPP_BRIDGE_URL` is set.
- `WHATSAPP_APP_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `INSTAGRAM_APP_SECRET`,
  `BRIDGE_SECRET`, and `EMAIL_WEBHOOK_SECRET` for their respective ingress paths.
- `CRON_SECRET` for bridge/scheduler-triggered invoicing and sequence sweeps.
- `TURNSTILE_SECRET` for production signup and portal OTP requests, plus a live
  SMS or WhatsApp outbound provider for portal verification delivery.

Do not commit, print, or paste secret values into issue trackers or logs.

## Build and schema gate

Run the repository quality gate before deployment:

```powershell
npm ci
npm run typecheck
npm test
npm run lint
npm run build
```

Apply migrations strictly by filename order with stop-on-error semantics, using a
direct PostgreSQL connection appropriate for schema changes. Back up production,
record the migration set/checksums, and test restore/rollback procedures first.
The current migration sequence ends at `db/66-state-timezone.sql`.

- Migration 57 records immutable PAT creators and converts legacy agent scopes.
- Migration 58 invalidates all plaintext staff PINs and adds scoped scrypt
  credentials. Managers must issue fresh PINs after deployment.
- Migration 59 revokes/scrubs legacy portal links and adds expiring hash-only
  credentials. Customers must OTP-verify for a new link.
- Migration 60 deletes untrusted legacy push subscriptions and adds hash-only
  device tokens. Staff must re-enable notifications.
- Migration 61 adds single-use server payment intents and stable menu-item links
  on order lines.
- Migration 62 adds short-lived, per-order split-payment holds to serialize
  concurrent share grants.
- Migration 63 adds the fenced financial event/outbox, immutable snapshots,
  refund reservations/reversals, and retry evidence.
- Migration 64 adds invoice, tip, provider-evidence, settlement, and audit controls.
- Migration 65 deactivates unverified channel accounts, adds persist-first ingress,
  affirmative consent/template records, leased outbound deliveries, append-only
  attempts/receipts, and sequence leases. It intentionally aborts on duplicate
  active sequence enrollments.
- Migration 66 adds compare-and-set revisions for shared/menu/table state and a
  validated venue IANA timezone used by scheduling and demand analysis.

Apply migrations 57–66 immediately before the matching Worker. New migrations
must use the next number and remain additive/idempotent where practical.

## Deployment sequence

Current source migration head: `db/66-state-timezone.sql`. The migration
runner applies each file and its `schema_migrations` marker in one transaction.

1. Preserve the evidence listed in Phase 0 of [`review.md`](review.md).
2. Back up PostgreSQL and verify recovery.
3. Validate the isolated sandbox with sandbox credentials and database.
4. Apply production migrations under a change window.
  Verify `63-financial-events.sql` as one transaction and confirm its outbox,
  refund reservation, snapshot, adjustment, retry-audit, and immutability tables/
  triggers before allowing payment traffic.
  Before migration 64, inventory duplicate public invoice numbers, non-KES or
  invalid invoice balances, overlapping tip periods, duplicate open shifts, and
  legacy payouts. Migration 64 intentionally aborts rather than silently rewrite
  unsafe financial history.
  Before migration 65, inventory duplicate active sequence enrollments. After it
  commits, re-verify every receiving/sending account and approved provider
  template before enabling ingress or outbound traffic; legacy account rows are
  intentionally inactive.
  Before migration 66, confirm all venues can use the default `Africa/Nairobi`
  timezone or prepare explicit IANA values. After deploy, run stale-revision
  probes for merchant state, menu items, and tables and require HTTP 409.
5. Deploy the Worker using a scoped Cloudflare API token.
  Confirm the `*/2 * * * *` scheduled recovery trigger is installed.
  For the sandbox staff-auth release, run `npm run deploy:sandbox` after its
  migrations are applied. It always rebuilds before publishing and then verifies
  the deployed staff form, service worker and protected PIN-rotation route.
6. Immediately rotate affected runtime credentials and revoke old sessions/API
   tokens as required by the containment plan.
7. Run negative smoke tests: anonymous session, OTP disclosure, unauthenticated/
   cross-tenant refund, simulator, bridge control, and forged channel ingress.
8. Run one capped end-to-end provider transaction/refund and reconcile every row.
  Include duplicate/reordered webhooks, an ambiguous refund timeout, stale-lease
  recovery, forged/unknown receiving accounts, consent/window/template denials,
  accepted-vs-delivered receipts, and manager failed-event retry evidence.
9. Roll back on any failed gate; do not “monitor through” an integrity failure.

No production deployment or secret rotation is performed by a source-code change.
Those operator actions must be recorded separately with evidence.

## Runtime and scaling guidance

- Keep per-request PostgreSQL clients through `withRequestSql`; never cache a
  Workers socket across requests.
- Keep correctness-sensitive merchant/payment queries uncached. Introduce read
  replicas or a separately bounded cache only for genuinely public, immutable data.
- Add Cloudflare WAF/bot controls in addition to application rate limits.
- Financial fan-out uses the fenced PostgreSQL outbox in migration 63. Channel
  ingress/outbound uses the leased PostgreSQL queues in migration 65. Keep the
  scheduled trigger (or the protected local bridge recovery sweep) and failure/
  unknown-outcome alerting enabled.
- Configure Workers logs/analytics, Logpush, database metrics, error tracking,
  uptime alerts, failed-event alerts, and refund/reconciliation alerts.
- Configure PITR, tested backups, retention, and incident runbooks.
- Add a custom domain and disable public preview URLs before a controlled pilot.

## Release approval

A successful build or deploy is not production approval. Approval requires every
criterion in [`review.md`](review.md), independent penetration/PCI evidence, and a
capped pilot that completes a full provider settlement cycle with zero unexplained
ledger difference.
