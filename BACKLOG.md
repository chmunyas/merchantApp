# Backlog

## Monitoring
- ✅ **DONE — `GET /api/ops/health` (admin-only, cross-venue).** Every asynchronous
  path in this app fails the same way: quietly and slowly. Nothing errors, work
  just stops moving. This reports, for all five work queues (`financial_outbox`,
  `outbound_deliveries`, `pos_tender_pushes`, `channel_ingress_events`,
  `invoice_communication_outbox`): depth, how **overdue** the oldest due item is,
  dead letters, and claims held by a worker that died. Age is measured from
  `next_attempt_at`, not `created_at` — otherwise a deliberate retry backoff reads
  as lateness, and `financial_outbox` has no `created_at` at all.
  It also reports **money that has stopped moving**: payout runs awaiting approval,
  held tip and salary payouts, and payments stuck in flight. Each has its own
  tolerance, because a payout run waiting over a weekend is normal and an M-Pesa
  STK stuck for three hours is not.
  **Depth alone is deliberately not an alert.** 400 items that arrived a minute
  ago are a busy service; three nobody has touched for an hour mean the worker is
  dead. Thresholds live in `src/lib/ops-health.ts` as pure functions so they are
  arguable in a test rather than buried in SQL.
  **A failed probe reports `critical`, never zeros** — this was a real bug caught
  by running the queries against the schema: the original `financial_outbox` query
  threw, and the catch rendered a dead queue as a healthy empty one. A monitor
  that lies is worse than none, because it is trusted.
  The response also flags **monitoring that is switched off** — `SENTRY_DSN`,
  `PESASWAP_API_KEY`, `STAFF_PAYOUT_KEY`, and the `RATE_LIMITER` binding — so a
  deployment with no error reporting does not look identical to a healthy one.
- **P1 — set `SENTRY_DSN` to turn error reporting on.** `src/lib/observability.ts`
  is a complete, dependency-free Sentry client that **no-ops without the DSN**. All
  that code is currently dead: server exceptions are logged to the Workers console
  and nowhere else. `/api/ops/health` now reports `sentry: configured=false` so the
  gap is visible rather than assumed.
- **P2 — this is PULL monitoring; nothing alerts.** `/api/ops/health` answers "is
  anything stuck?" only when somebody asks. Turning it into an actual alert needs
  either an external poller (Better Stack / Uptime-Kuma hitting it on a schedule
  and paging on `status != "ok"`) or a cron task that pushes to a channel. Until
  one of those exists it is a dashboard nobody opens.
- **P2 — client-side telemetry still has no sink.** See the best-effort entry
  below: guest payment-page failures are counted locally and go nowhere.


- ✅ **DONE — currency hardcodings that became bugs the moment six currencies were allowed.** Enabling USD/EUR/GBP/UGX/TZS turned three "KES is the only currency" shortcuts into real defects, all now fixed and pinned by `__tests__/unit/currency-hardcoding.test.ts`:
  - `invoice-payment-holds.ts` minted **every payment intent in `'KES'`** with a literal `'m_pesa_express'` method, and computed the outstanding balance with `Math.round(balanceMajor * 100)` — which overstates a UGX balance a hundredfold. It now uses the invoice's own currency and exponent.
  - `createAuditCheckpointInTransaction` hardcoded `currency = 'KES'` in four places, so non-KES journal entries sat **outside the tamper-evident hash chain entirely**. It now takes a currency (defaulting to KES) — one chain per currency, which is what `ledger_audit_checkpoints`' unique key `(venue_id, currency, period_end, final_hash)` was already designed for.
  - **Capture ≠ collection.** `COLLECTION_RAILS` in `src/lib/currency.ts` records which rails can actually take money per currency. M-Pesa STK is KES-only, so **today an invoice can be RAISED in six currencies but only PAID in KES** — the pay link returns a clear `no payment rail is available for USD yet` instead of the old vague "unsupported invoice currency". Wire the card rail into that table and nothing else needs to change.
- **P1 — apply migration 91 (invoice currencies) before invoicing in anything but KES.** It swaps `CHECK (currency = 'KES')` on `invoices` and `recurring_invoices` for `CHECK (currency IN ('KES','USD','EUR','GBP','UGX','TZS'))`, keeping KES as the column default. **Until it is applied the database rejects the new currencies even though the application accepts them.** Applied locally 2026-08-25 and verified by inserting a UGX invoice.
  - **Deliberately NOT relaxed: `tip_pools`, `tip_allocations`, `settlements`, `staff_payout_runs`, `payroll`.** Those are Kenyan payout rails (M-Pesa / Pesalink). A EUR payout cannot be sent over them, so allowing a non-KES row there would record a payout that no rail can settle. They stay KES-only until a matching rail exists.
  - **Still unsupported by design: FX conversion, revaluation and consolidated cross-currency reporting.** Balances are held *per currency* and never summed across them — every accounting report already takes a `currency` and filters on it. There is no rate table, so there is no way to answer "what is my total in KES across all currencies", and no FX gain/loss is computed. That needs effective-dated rates and a policy decision.
  - **`ledgerAuditCheckpoint` in `src/lib/accounting.ts` is still hard-coded to `currency = 'KES'`** — fixed, see the currency-hardcoding entry above.
- **P2 (dev environment) — two separate local-container problems that look like one, and both look like a hang.** `docker-compose.yml` mounts the source over `/app` but keeps `node_modules` in an **anonymous volume** (`- /app/node_modules`), populated from the image — so it is only as fresh as the last `docker build`, and any dependency added since is absent.
  1. **Stale deps.** Surfaces as `Error: Cannot find module 'postgres' imported from /app/src/lib/db.ts`, returned as a **500 in ~36s**. Fix: `docker exec pesaswap-merchant-app npm ci`. Use `npm ci`, **not `npm install`** — `/app` is bind-mounted, so `npm install` rewrites the host `package.json`/`package-lock.json` and Vite then churns on "Re-optimizing dependencies because lockfile has changed".
  2. **A genuinely slow first SSR request.** Once dependencies are complete, the first request must load the whole SSR graph through Vite's module runner across a Windows bind mount. It sits at ~56% CPU with **nothing in `docker logs`** and can exceed 400s. It is not deadlocked — Postgres shows no locks and no app connection, because the request has not reached a handler yet. **Restarting resets all of that work**, which is how it ends up looking permanently hung.
  - Counter-intuitively, a *missing* dependency responds faster than a healthy one, because the module graph short-circuits on the error.
  - The real fix is to rebuild the image whenever dependencies change (`docker compose build merchant-app`) rather than patching the volume, and/or to drop the anonymous-volume trick. This has cost significant time twice; the production build (`npm run build`) is unaffected.

## Migrations
- **P0 (BEHAVIOUR CHANGE) — apply migrations 88, 89 and 90 together, and tell managers before you deploy.** Tips no longer pay themselves. Until now `runTipCadence` called `issueDueTipPayouts` → `submitTipPayouts` on a **2-minute cron**, posting straight to PesaSwap's live `POST /payouts/create` with **no human approving anything** — `requested_by` recorded who triggered a batch, never who authorised it, and "manager only" was a role check on one endpoint the cron did not go through. Every payout now hangs off a `staff_payout_runs` row and `submitTipPayouts` joins to it, so **a payout with no approved run is never submitted**. The practical consequence: **after this deploy, staff stop being paid until a manager approves each run** at `POST /api/payouts/runs/:id/approve`. If nobody is watching the queue, wages silently stop. Brief the venue first.
  - Runs created before the deploy have `run_id = NULL` and can never be submitted. They are historical and already settled; the submit path only reads `pending` rows.
  - Approval is **single-manager and self-approval is permitted by policy** — a manager may approve a run that pays them. `staff_payout_runs.self_approved` records it so the fact is on the record rather than something an auditor reconstructs, and the dashboard renders a **Self-approved** badge against those runs. **If you want it blocked, it is a one-line change in `decideApproval`** (`src/lib/payout-runs.ts`) plus a test; it was left open deliberately, not by omission.
  - The manager surface is `/dashboard/payouts` (manager+ in both `src/lib/rbac.ts` and the central route policy): an approval queue with a per-person breakdown, salary entry, and a log of every decision with who made it.
- **P1 — payroll is new and pays nobody until salaries are set.** `db/89` adds `staff.salary_amount` / `salary_period` and a `salary_payouts` table. Salary is a **fixed amount per period, not hours × rate**: `db/33-shifts.sql` records a cash Z-report (`opened_at`/`closed_at`/float/counted), not an attested timesheet, so a wage derived from it is one the venue could not defend. `salary_basis` exists as a column so an hourly basis can be added without a rewrite. Nobody has a salary until a manager sets one via `PUT /api/payroll/staff/:id/salary`, and `POST /api/payroll/runs` returns 409 with a named `excluded` list rather than creating an empty run.
- **P1 — bank payouts worked for nobody before `db/90`, and still need staff to re-enter their details.** `staff_payout_details.bank_name` is free text, which cannot be sent to a rail, so every `method = 'bank'` destination was parked as `held / bank_rail_unavailable` **forever** — the staff member appeared set up and was never paid. PesaSwap routes bank payouts over PesaPay/Pesalink, which needs a **2-digit bank code** from a fixed list (`src/lib/pesaswap-banks.ts`, 40 banks, from [the published list](https://docs.pesaswap.io/api-reference/payouts/pesapay--bank-codes.md)). Existing bank rows keep their typed name and **stay held until the staff member re-enters their details and picks a bank** — guessing a code from a name would route wages to the wrong institution. Chase these people; they have been unpaid the whole time.
- **P1 — the Pesalink rail has never been exercised against PesaSwap.** `buildPayoutRequest` is written against the documented shape (`payout_type: "bank"`, `payout_method_data.bank.payout_method = "pesalink"`) and is unit-tested, which proves our side of the contract and nothing about theirs. **Send one small real payout to a known account before running payroll through it.**
- **P3 (was P1 — the original claim was wrong) — `db/19-staff-pin.sql` is not re-runnable, but a fresh bootstrap does NOT fail on it.** This entry previously said a fresh bootstrap would fail. **That was verified false on 2026-08-25:** all migrations apply cleanly to an empty database, because `19` runs long before `58-staff-credentials.sql` creates the `staff_plaintext_pin_forbidden` constraint. The real failure mode is narrower: `19`'s guard is `WHERE NOT EXISTS (SELECT 1 FROM staff WHERE pin = …)`, which stops matching once `58` purges plaintext PINs to `NULL`, so a **re-run** re-inserts the seed rows with plaintext PINs and the constraint rejects them. That only happens if the runner replays `19`, i.e. against a database that already carries the schema but has **lost `schema_migrations`**. Carry that table with any dump, or restore from a full dump — never a schema-only one. The failure is safe (the whole file runs in one transaction, so it rolls back and the deploy stops). The file is applied everywhere and immutable by house rule, so it is recorded as a known exception in `scripts/validate-migrations.mjs` rather than edited.
- **P3 (closed — ratcheted) — two pairs of migrations share a numeric prefix:** `78-payments-order-index` / `78-pos-tender-query-performance`, and `79-cron-cursor` / `79-pos-open-check-ordering`. Both pairs are already applied, so they cannot be renumbered (that would change the `schema_migrations` key and re-apply them under a new name). **Ordering is not actually ambiguous:** both the runner and the validator sort with `localeCompare(numeric: true)`, which is deterministic, and all four files are independent `IF NOT EXISTS` index/table creations on different tables — so apply order within each pair is irrelevant. `validate-migrations.mjs` now **grandfathers these two prefixes and fails the build on any new collision**, so this cannot recur. Still: check the highest existing number before adding a migration when more than one person is working.
- **`scripts/validate-migrations.mjs` mirrors the runner and enforces the re-run rule.** It creates `schema_migrations` first (migration 80 legitimately guards a one-time backfill on it, which used to break validation outright), records each applied file, then **applies the whole chain a second time** to prove every statement is safe to re-run. Run it against a throwaway database before every release: `VALIDATE_DATABASE_URL=postgres://…/throwaway node scripts/validate-migrations.mjs`. Verified 2026-08-25: all **84** migrations apply cleanly from empty, and re-apply cleanly except the documented `19` exception.
- **Migrations are applied automatically by CI, not by hand.** `.github/workflows/ci.yml` runs `scripts/migrate.mjs` against production and sandbox on deploy, applying anything not yet in `schema_migrations` in order. The per-migration "apply NN before deploying X" notes below are therefore **verification steps, not manual work** — confirm the CI migrate step succeeded, rather than running 11 commands.

## Performance & scale
- ✅ **DONE — route matching no longer runs 310 regexes per request.** `matchRoutePath` executed **every** compiled route regex on **every** API request and never short-circuited. Routes are now bucketed on the first path segment, so a request tests only its own bucket plus the routes whose first segment is dynamic (`/api/:channel/:ingress`). Declaration order is preserved by merging on the original index, because callers use `.find()` on the result. `__tests__/unit/route-matching-performance.test.ts` asserts the fast path returns **exactly** what the exhaustive scan returned for all 310 declared paths, and separately counts `RegExp.exec` calls so the optimisation can't silently degenerate back into a full scan.
  - `DYNAMIC_SEGMENTS` is now exported. The first version of that test duplicated the pattern table, drifted from the real one (`channel` is `(?:telegram|instagram|sms|email)`, not `[^/]+`) and produced a **false failure**. Import the real table; do not copy it.
- ⚠️ **AVAILABLE, OFF BY DEFAULT — `AUTH_MEMBERSHIP_TTL_MS` removes a DB round-trip from every authenticated request.** `resolveAuth` re-checks `user_venues` on every call so a revoked or role-changed account stops working before its JWT expires (24h). The query is properly indexed (`app_users_email_lower_idx`, `user_venues_pkey`) — the cost is the round-trip itself, which puts Postgres on the critical path of every authenticated request. An in-isolate cache is now wired in but **defaults to 0 (disabled)**: `membership_version` exists specifically to kill a session *immediately*, and `__tests__/unit/membership-session.test.ts` fails when that is weakened — it caught this during implementation. Setting `AUTH_MEMBERSHIP_TTL_MS=5000` trades a ≤5s revocation window for the round-trip. **That is an operator's security decision, not a default.** Negative lookups are never cached (that would lock out a user just granted access) and the cache is bounded at 5,000 entries.
- **P1 (unresolved) — the write path, not the read path, is what caps throughput.** A single payment writes `payments`, `journal_entries`, `journal_lines`, `financial_events` and `financial_outbox`, several inside one transaction, plus `SELECT … FOR UPDATE` on the order for split-pay. That is roughly **5+ synchronous writes per transaction against one Postgres primary**. Read-side work (routing, auth, indexes) is now cheap; the ledger is the ceiling. Getting past low-thousands TPS needs a change of data architecture — venue-sharded ledgers, or moving the hot write path off synchronous Postgres and settling the ledger asynchronously — not further micro-optimisation.
- **P1 (unresolved) — the scheduled worker is not built for high volume.** `VENUE_SLICE = 100` on a 2-minute cron means a venue is serviced roughly every `ceil(venues/100)` invocations. At large tenant counts, time-sensitive work (walkout detection, tip cadence, invoice reminders) drifts badly. Needs its own queue rather than a slice-and-wrap cursor.
- ✅ **DONE (FIXED) — invoice settlement scanned the whole payments table.** See migration 82 below.
- **P0 (FIXED) — payment status and webhooks read the ledger, not an isolate-local cache.** `src/api/payments.ts` kept a module-level `Map` of payments. On Workers that Map is **per-isolate**, so it only ever held payments the current isolate created. A status poll or a provider webhook almost never lands on that isolate, so at real concurrency the Map missed — and a miss was treated as "Payment not found" (**404 on a payment that exists in Postgres**), while the webhook's `amount` fell back to `0`. It passed every test and every low-traffic manual check because one warm isolate serves everything until it does not. The Map is gone; every read goes to the ledger. `__tests__/unit/payment-isolate-safety.test.ts` pins it. **If any monitoring counted those 404s as "payment not found", that count was wrong.**
- **P1 (FIXED — apply migration 82) — invoice settlement scanned the whole payments table.** `reconcileInvoiceBalance()` (`src/lib/invoicing.ts`) derives an invoice's paid amount with `WHERE venue_id = $1 AND metadata->>'invoice_number' = $2`. Orders got their equivalent index in migration 78; **invoices were simply missed**, so every settlement, partial payment and reconciliation read sequentially scanned `payments` for the venue — on the checkout path, getting slower with every payment the venue had ever taken. Migration 82 adds the matching partial expression index; `EXPLAIN ANALYZE` now reports an **Index Scan** where it previously reported a scan. Same caveat as 78: on a large table the build holds a lock, so run `CREATE INDEX CONCURRENTLY` by hand if that matters. **The same longer-term point also stands — `metadata->>'invoice_number'` is a JSONB string match, not a foreign key.** A typo or case difference orphans a payment from its invoice with nothing to catch it; this belongs in a real `payments.invoice_id` column with an FK, which needs a backfill and a dual-write window and was deliberately not bundled here.
- **P1 — apply migration 78 (payments order-id index) as early as you can.** `payments.metadata->>'order_id'` is a filter or JOIN key in thirteen places across seven modules and had **no index**: every one of those was a sequential scan. The worst is the split-payment balance read, which runs *inside* a transaction holding `FOR UPDATE` on the order row — a scan under a lock, on the checkout path, getting slower with every payment ever taken. On a large `payments` table the index build holds a lock for its duration; run `CREATE INDEX CONCURRENTLY` by hand if that matters (it cannot be scripted, since it may not run inside the runner's transaction). **Longer term this relationship belongs in a real `payments.order_id` column with a foreign key** — that needs a backfill and a dual-write window, so it was deliberately not bundled here.
- **P1 — apply migration 79 (cron cursor) with the same deploy.** The scheduled handler no longer loops over every venue. It now processes a bounded slice (100) with bounded concurrency (4) and remembers where it stopped in `cron_cursors`, wrapping at the end. Without the migration the cursor read throws and the per-venue tasks — drip sequences, tip cadence, walkout detection — stop running entirely. **Tune `VENUE_SLICE` in `src/server.ts` against your real venue count and cron frequency:** a venue is serviced once per `ceil(venues / VENUE_SLICE)` invocations, so at 5,000 venues on a 2-minute cron each venue is visited roughly every 100 minutes. Walkout detection is time-sensitive and may warrant its own faster job.
- **P1 — deploy the `RATE_LIMITER` Durable Object binding.** Rate limiting no longer writes to Postgres on every request; it uses a sharded DO (`RateLimiterShard`, 64 shards, in-memory counters, no storage I/O). `wrangler.toml` declares the binding and migration tag `v2` for **both** the default and `sandbox` environments — named environments do not inherit bindings. With no binding the limiter silently falls back to the old Postgres table, so verify the binding exists after deploy rather than assuming it. A DO eviction resets that shard's counters, which **fails open** — the same contract the Postgres limiter had when the database was unreachable.
- **P2 — no keyset pagination anywhere.** Several reads are capped by a bare `LIMIT` (500, and 5000 in `/api/fees`) with no cursor, so large tenants silently see truncated data rather than a next page.
- **P2 — `src/api/payments.ts` is still ~3,000 lines** holding payment creation, refunds, the webhook and the ledger. The seams are clean (`recordLedger`/`recordRefundLedger`/`reconcileRefunds` → a lib module; `handleWebhook`/`processWebhook`/`verifyWebhookSignature` → its own module) but the split was deliberately not attempted in the same pass as the correctness fixes above — reviewing a behavioural change and a 3,000-line move together is how regressions get through.
- **P2 — `src/lib/merchant-dashboard.ts` (150KB) is still a client-side data tier.** The dynamic-menu work removed the dashboard's dependency on it for menus and replaced it with a one-way server→localStorage mirror, but the legacy `/table` and `/table/:id` guest pages still read it as truth. Until they are repointed at the server, two devices can disagree about what a guest is shown. This is the largest remaining architectural liability and needs its own plan, not a drive-by.

## Sunday parity operator actions
- **P1 — apply migration 82 before deploying authoritative venue membership.** It adds `user_venues.membership_version`, automatic version bumps, and append-only `venue_membership_events`. The matching auth code deliberately rejects every pre-82 venue JWT, so all owner/manager/supervisor dashboard users must sign in again after deployment. Apply the migration before the Worker or every venue login fails; deploy all tiers together and verify that demotion/removal invalidates an existing manager token immediately. Managers can no longer grant, re-role or remove another manager — only a venue owner can.
- **P1 — apply migrations 85–87 before deploying refund-aware order balances.** They add and forward-correct `order_paid_minor(venue, order)`, the single collected-principal calculation used by order pay links, QR/split checkout, PWA floor views, notifications and walkout detection. The final function derives refunded principal from immutable payment snapshots + cumulative reversal facts, so it includes tax/A-R and does not depend on financial-outbox consumer order. None changes rows. Without them, the matching source reads fail; with old source, partially refunded parent payments can make different surfaces disagree about what remains due. Confirm the CI migration step applies all three before the Worker and verify one taxed partial-refund order in sandbox.
- ✅ **DONE (sandbox staff auth, 2026-08-24).** Migration 58 is recorded in `pesaswap_sandbox`; the legacy baseline ledger is backfilled through 56 with migration 57 deliberately left pending. Cloudflare version `b7ed03e4-291f-4c52-abc5-fb15eab2cef9` serves one coherent staff-auth release. Verified live: venue + account + a 6–8 digit PIN, no demo keypad, manager rotation `200`, a venue/staff/version-bound four-hour JWT, and old-session rejection (`401`) after rotation. `npm run deploy:sandbox` now rebuilds before publishing and `scripts/verify-staff-auth-deploy.mjs` prevents this client/handler/service-worker split from recurring.
- **P1 — apply migration 74 before deploying guest self-service (A5.2, A5.3, A5.4, A5.6).** It adds `guest_refund_requests`, `guest_data_requests`, `guest_data_request_events` and the additive `contacts.redacted_at` column. Nothing is deleted, backfilled or defaulted. Without it, `/dashboard/guest-requests` and both guest request endpoints **500**; `contacts.redacted_at` is also read by the A5.2 email-identity lookup, so `POST /api/guest/receipt-lookup` fails for the email channel until it is applied. The phone channel and the rest of the customer portal are unaffected.
- **P1 — A5.2 receipt lookup needs a verified SMS/WhatsApp (or Email) channel account per venue.** The one-time code is dispatched through the compliance-checked outbound worker. With no verified channel account the guest sees the same neutral "if those details match, we've sent a code" response and **nothing arrives** — this is deliberate (a channel error must not become a user-enumeration oracle), so verify each venue's channel in Dashboard → Channels before publishing `/receipt`.
- **P2 — publish the `/receipt` link where a departed guest will find it.** Add it to receipt/bill messages, the venue's website footer and the QR sticker artwork. The page needs the venue's short `code` (or `?v=<venueId>`); a guest who has neither cannot start the flow.
- **P2 — A5.6 erasure is owner-only and irreversible.** Completing an erasure redacts the guest's name, phone, email, notes and tags from `contacts` and strips identity keys from `payments.metadata`. Amounts, statuses, provider references, invoices, tips and the ledger are untouched, so the trial balance does not move — but the redaction cannot be undone and the guest's loyalty link is broken by design. Decide the venue's SLA (the portal tells guests 30 days) and who holds the owner role before advertising the control.
- **P2 — approving a guest refund request does NOT refund anything.** `/dashboard/guest-requests` records a decision; a manager must still refund the payment through the normal manager-gated action and then mark the request `refunded` with that refund's payment id. Train managers on the two-step, or approved requests will sit with guests believing money is on the way.
- **P2 — A1.4 printed receipts depend on the browser's print dialog.** There is no thermal-printer integration: staff open the receipt sheet and print from the device. Confirm each venue's floor device is paired with a printer, and check the output on the venue's actual paper size — the stylesheet sets a 12mm page margin and monospace body, but 80mm roll printers may need a per-venue tweak.
- **P1 — apply migration 72 before deploying split-by-item (A2.2, A2.4).** It adds `order_item_claims` with a unique index on `order_item_id` — that index IS the race guard, so applying the migration is not optional bookkeeping. Nothing is deleted or backfilled. Without it, `GET /api/qr/pay/:token` and the whole guest checkout **500** (the payload now reports which lines are already taken), and the by-item, bill and claim endpoints fail. Even-split, custom-amount and pay-in-full are unaffected by the code change itself but sit behind the same payload, so treat this as blocking for the guest pay page.
- **P2 — A2.4 live balances degrade to 5-second polling without a `REALTIME` Durable Object binding.** The per-bill topic bus (`src/lib/realtime-bus.ts`) addresses one DO instance per `bill:<orderId>`. On Workers without the binding there is no cross-isolate hub, so a guest's remaining balance only updates on the poll. The binding already exists in `wrangler.toml` for the merchant hub; confirm it is present in every environment before advertising live split-pay. No new binding or secret is required.
- **P2 — B3.5 receipt/bill resend requires a verified WhatsApp (or SMS) channel account for the venue.** `POST /api/orders/:id/receipt` queues through the compliance-checked outbound worker; with no verified channel account the delivery is queued and then dropped by policy, and the server sees "sent" with nothing arriving. Verify each venue's channel in Dashboard → Channels before rolling the staff console out to the floor.
- **P2 — B3.1 exposes a table-scoped payment read at STAFF level.** This is a deliberate, narrow widening: one table, recent bills only, guest number masked to the last three digits, no provider references. Refunds are unchanged (manager+, `payments:write`). If a venue's policy forbids servers seeing amounts at all, raise `tables.payments` in `src/lib/route-policy.ts` to `manager` — the UI already renders correctly for a caller who cannot read it.
- **P1 — apply migration 67 before deploying venue service hours and configurable business-day boundaries (D9.2, C2.3, D8.2).** Existing venues default to a 04:00 local boundary and no configured service windows; an owner must set each venue's lunch/dinner hours in Dashboard Settings.
- **P1 — apply migration 68 before deploying auto-gratuity-aware tip tiering (A3.2).** `/api/qr/pay/:token` now selects `orders.service_charge`; without the migration the QR checkout payload fails to load. Existing orders default to `0`, which is the "no service charge" case and renders today's standard 20/23/25% tip options unchanged. Nothing populates the column yet — a POS bill import (C5) must write the auto-gratuity amount into it before guests see pro-rated or reduced tiers.
- **P2 — the guest service fee (A5.5) is published as zero-rated and is NOT chargeable.** `/pay` now states plainly what the guest pays and that the fee is avoidable, driven by the server's quote in `src/lib/fees.ts`. Do not enable a non-zero guest fee: the payment intent has no fee component and every order-balance aggregation nets only the tip, so a charged fee would read as payment toward the bill. A5.7 tracks that work.
- **P1 — apply migration 70 before deploying tip distribution (B4.1–B4.4, D5.5–D5.11).** It adds `venue_tip_settings`, `staff_tip_rules`, `staff_payout_details`, the weekly cadence columns on `tip_pools`, the direct/jar split columns on `tip_pool_sources`, `tip_allocations.stream`, and the `held` payout status. It also **drops and re-creates three constraints** (`tip_pools_no_overlap` gains `kind`, `tip_allocations_base_key` gains `stream`, `tip_payouts`' status check gains `held`); no guarantee is lost, and `tip_pool_sources`' `UNIQUE (venue_id, payment_id)` still prevents a payment being paid twice. Without the migration the whole Tips tab and the staff earnings card 500.
- **P1 — set the `STAFF_PAYOUT_KEY` secret (32 random bytes, base64) before staff can add payout details.** `PUT /api/tips/me/payout-details` returns 503 without it rather than storing an account number in plaintext. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and set it with `wrangler secret put STAFF_PAYOUT_KEY`. **Losing the key loses every stored destination** — there is no plaintext column and no escrow; staff would have to re-enter their details. Rotating it requires the same.
- **P1 — apply migration 84, and connect a WhatsApp (or SMS) sender per venue, before staff can change payout details.** Changing where a person's tips are paid is an account-takeover target: a borrowed staff session used to be enough to repoint every future payout. It now requires a 6-digit code delivered to the phone **on that staff member's own record** (`POST /api/tips/me/payout-details/challenge`, then `code` on the `PUT`). Three properties make this worth having, and each is load-bearing:
  - **The destination is read from the database, never from the request.** A caller-supplied phone would let the attacker send the code to themselves.
  - **The code is bound to `payout:<staff_id>`**, so a login code cannot be replayed to move bank details and vice versa.
  - **The phone is re-resolved at verify time**, so changing the staff phone after a code is issued invalidates it.
  Consequences to plan for: a staff member whose record has **no phone, or an unparseable one, cannot self-serve** — `GET /api/tips/me` now returns a `confirmation` block so the card says so **before** they type their bank details, and a manager must fix the staff record. That is deliberate; letting staff supply the number would defeat the check. A venue with **no verified WhatsApp or SMS channel account cannot accept payout changes at all** (503). Existing stored destinations keep paying and are not invalidated; only the next *change* requires a code. The flow is rendered end to end in `src/components/staff/MyEarningsCard.tsx` (details → code → save, with resend and a masked destination).
- **P2 — a manager can still edit `staff.phone`, which is the root of trust for the payout step-up.** A rogue manager who also obtains a staff session could repoint the phone and then confirm a new destination. Mitigations not yet built: alerting the staff member when their own phone is changed, and a cooling-off period before a re-pointed phone can confirm a payout. `staff_payout_details.confirmed_via_phone` records which number confirmed the current destination, so the change is at least auditable after the fact.
- **P1 — tip payouts no longer fall back to `staff.phone`.** A contact number on the staff record is not a verified payout instruction, so a staff member with no `staff_payout_details` row now gets a `held` payout instead of a transfer. Before the first cadence run after deploy, tell every server to add their details in the staff app; the Tips tab banner lists who has not. Held payouts are released automatically on the next run.
- **P2 — a `bank` payout destination is stored but cannot be paid.** The only live rail is the PesaSwap M-Pesa wallet, so a bank destination produces a payout held with `bank_rail_unavailable`. Either wire a bank payout rail (D5.13) or restrict the staff app to M-Pesa before advertising bank transfers.
- **P1 — apply migration 71 before deploying the reputation loop (D6.2–D6.9).** It adds `review_settings`, `review_templates` and four additive columns on `reviews` (`google_review_id`, `redirected_to_google`, `redirected_at`, `response_synced_at`). Nothing is deleted or backfilled. The reading code degrades where it can — the Reviews tab settings/analytics fall back to the code defaults and no rating is ever routed to Google — but the Templates and Google sections **and review replies** 500 until it is applied.
- **P1 — set each venue's Google Place ID in Dashboard → Reviews before any guest is sent to Google.** With no Place ID `routeRating` returns `google_not_configured` and every rating, however good, is kept private. This is deliberate: the app will not guess a venue's Google profile.
- **P2 — Google Business Profile OAuth (D6.3) is unconfigured and therefore inert.** To enable reading and replying to Google reviews: create an OAuth client (Web application) in a Google Cloud project with the **Business Profile APIs** enabled (`mybusinessaccountmanagement`, `mybusinessbusinessinformation`, `mybusiness` v4 — the last requires Google to approve a quota request), add `<PUBLIC_BASE_URL>/api/reviews/google/callback` as an authorised redirect URI, then `wrangler secret put GOOGLE_OAUTH_CLIENT_ID` and `wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET`. Run **Connect** from the Reviews tab as the venue owner; the callback page shows the refresh token **once** — store it with `wrangler secret put GOOGLE_BUSINESS_REFRESH_TOKEN` and redeploy. The token is deliberately never written to the database, so it cannot be recovered later; re-run Connect to reissue.
- **P2 — the Google refresh token is a single deployment-wide secret, so only one Google account can be connected per deployment.** Multi-venue tenants sharing a Worker cannot each connect a different Google account until there is a per-venue secret store. Place ID, account and location are already per-venue, so only the credential is shared.
- **P2 — the star rating cannot be prefilled on Google (D6.2).** `search.google.com/local/writereview?placeid=…` prefills the *venue*, not the *rating*; Google publishes no rating query parameter. Do not market "one tap and it's posted" — the guest still taps a star on Google's page.
- **P2 — the scheduled worker now runs `runTipCadence` per venue.** Confirm the Cloudflare cron trigger fires at least daily, or the direct stream will not be paid on its Monday. `POST /api/tips/weekly/run` with `x-cron-secret` (or a manager session) is the manual equivalent.
- **P1 — apply migration 75 before deploying the dynamic menu (C6.1, C6.3, C6.5, C6.7–C6.13 / A6.2–A6.4, A6.6, A6.7).** It adds `venue_menu_settings`, `menus`, `menu_visibility_windows`, `menu_categories`, `menu_item_upsells`, `menu_checkout_upsells`, `menu_translations` and seven additive columns on `menu_items`. Nothing is deleted or backfilled, and **every venue starts with the dynamic menu OFF**, which is exactly today's behaviour. Without it, Menu → Menus and Menu → Settings show an explicit "not available" card rather than failing, but the guest QR page and `GET /api/menu` **500** because the item projection selects the new columns. Treat it as blocking.
- **P2 — the dashboard's local Menus and Schedules tabs have been retired.** Menus are now server-authoritative and visibility lives on the menu itself. On first load of Menu → Menus the page overwrites the local menu snapshot with the server's list and **clears the stored menu schedules**, because a stale schedule referencing old menu ids would filter the new menus out of the legacy `/table` pages. Any menu a merchant built in the old localStorage tab exists only on that browser and is **not** migrated — re-create it. Check with each pilot venue before deploying.
- **P2 — product media is a URL, not an upload.** The Worker has no object-storage binding, so the item editor and the menu header image accept an absolute `https` URL only, and a video is rejected without a still image (enforced in the database too). Host the assets somewhere durable before asking venues to add photos.
- **P2 — AI menu translation costs a model call per stale item, per language.** `POST /api/menu/translate` is manager-gated and only translates languages the merchant enabled; a guest page view never triggers one (the guest read is cache-only, falling back to the original text). Pre-translate from Menu → Settings after menu edits.
- **P1 — apply migrations 76 AND 77 together before deploying the POS connector (C5.1, C5.5, C5.6, C5.7, C5.11, B2.9).** 76 adds `pos_connections`, `pos_checks`, `pos_check_lines` and the additive `dining_tables.pos_table_ref` / `orders.pos_check_id`. 77 adds `pos_tender_map` and `pos_tender_pushes`. Nothing is deleted or backfilled and no venue has a connection, so behaviour is unchanged for everyone until one is created. **`pos-tender` is now a financial-outbox consumer, so every payment gets an outbox row** — without 77 that consumer throws and payments stop clearing the outbox. Do not deploy the code without both migrations.
- **P1 — no POS credential is stored in the database, by design.** `pos_connections` holds only the provider, the public restaurant/location id and the connector's declared capabilities. Toast needs `TOAST_CLIENT_ID` and `TOAST_CLIENT_SECRET` as Worker secrets (`wrangler secret put`), optionally `TOAST_API_BASE`. Until they are set, `POST /api/pos/connection/verify` returns `not_configured` and names the missing secrets rather than pretending to connect.
- **P1 — the Toast connector has NEVER run against a real Toast account.** It is written against Toast's documented API but we hold no partner credentials. The simulator connector exercises the whole path and 63 unit tests pin the decision rules — that proves our side of the contract and nothing about Toast's. Until a supervised pilot, expect every payment at a POS-connected venue to end `Not Notified`. Do not connect a paying venue.
- **P1 — map the `sunday` POS payment method before any payment can reach the POS.** The push worker refuses to send when no `pos_tender_map` row has `role='sunday'`; it marks the payment `Not Notified` and alerts the floor. The refusal is deliberate — landing under whatever tender the POS defaults to is Sunday's discrepancy class 2 (payment attributed to the wrong payment method), and it is far harder to unpick later than a manual entry today. Set it with `PUT /api/pos/tenders` (owner only).
- **P2 — schedule the push worker.** `POST /api/pos/pushes/run` (cron secret or a manager session) drains due pushes. Run it at least every 60s, or a failed push waits for the next manual run; the target is that a payment reaches the check within 60 seconds or raises an actionable alert.
- **P2 — a venue with no POS is unaffected, by design.** The consumer records `skipped` for a payment with no connection and for one with no bill behind it (a counter sale, a pay link). Those never raise an unsynced alert — paging a server about something nobody can fix would train them to ignore the alert that matters.
- **P2 — "record on the POS" moves no money and asserts no provider fact.** `POST /api/pos/pushes/:id/record` only marks that a human keyed the payment onto the POS, and only accepts a payment already `Not Notified`. Manager-only and human-only. Reconciliation must treat `manual` as human-attested, never machine-confirmed.
- **P2 — connecting a POS is owner-only and human-only.** A personal access token cannot repoint a venue's till. Reading a pulled check is staff-level so a server can see the bill they are taking payment for.
- **P2 — Sunday's two Toast setup steps cannot be verified through the API.** `verify` returns an explicit warning telling the operator to confirm the `sunday` payment method exists under Payments → Payment Methods → Other Payment Options, that **Require Manager Approval is enabled**, and that they clicked **Save and then Publish** — Sunday states the integration "will not load properly" otherwise. We surface the instruction rather than reporting a green tick we did not earn.
- **P2 — the compatibility matrix distinguishes "your POS cannot" from "we have not built it".** `GET /api/pos/providers` returns both verdicts per capability. Line-by-line reconciliation is marked unsupported on Clover, Comtrex, PI Electronique and Zonal because Sunday publishes those as incompatible; menu sync is claimed only for Toast and NCR Aloha because Sunday's published list is truncated mid-sentence and anything further would be a guess.

Pending / follow-up work, flagged during development. Grouped by area with a rough
priority (P1 = before real go-live, P2 = soon after, P3 = nice to have). See
`review.md` for the ordered production-readiness programme, `SECURITY.md` for the
current posture, and `.claude/` for the domain skills/agents. Production remains
**NO-GO** until every approval gate in `review.md` is met.

## Security & production readiness
- 🟡 **HARDENED IN SOURCE; REDEPLOY NOT VERIFIED** — the production Wrangler
  profile now forces `APP_ENV=production`, `AUTH_REQUIRE_LOGIN=1`,
  `AUTH_OTP_DEBUG=0`, `ALLOW_SIMULATORS=0`, and `PAYMENTS_TEST_MODE=0`.
  `runtimeSecurityResponse` refuses an insecure production runtime before route
  dispatch. Operator actions still open: verify required secrets, redeploy,
  rotate credentials, revoke old sessions/tokens, retain audit evidence, and
  smoke-test the deployed Worker.
- ✅ **DONE (Phase 1 source gate)** Central default-deny API policy now inventories
  every supported method/path, selects its handler, enforces human/PAT role/scope/
  tenant boundaries, and generates 404/405/declared-route preflight behavior.
  Sensitive reads and mutations are manager/owner scoped; enquiry/memory/campaign/
  sequence/push privacy leaks and invoice-activity/payment-method tenant bugs are
  closed. Deployment and live negative probes remain unverified operator work.
- ✅ **DONE (ingress containment)** **Provider webhook signatures** — inbound is
  signature/shared-secret verified per channel outside explicit non-production
  simulation: WhatsApp + Instagram `X-Hub-Signature-256`
  (`WHATSAPP_APP_SECRET`/`INSTAGRAM_APP_SECRET`), Telegram
  `X-Telegram-Bot-Api-Secret-Token` (now also **registered** on `webhook/set` so
  Telegram actually sends it), SMS/bridge shared secret. See
  `src/lib/webhook-verify.ts`, `src/api/channels.ts`, `src/api/whatsapp.ts`.
- ✅ **DONE** Configurable **CORS** origin — `src/lib/cors.ts` + a single rewrite in
  `server.ts` `withSecurityHeaders`. `CORS_ALLOWED_ORIGIN` is now set (wrangler
  `[vars]`) to the app origin, so Cloudflare prod is locked to same-origin; dev
  stays open. Verified: an unknown Origin is not reflected.
- ✅ **DONE** **Passwordless-first auth** — email / WhatsApp / SMS **OTP** login
  (`/api/auth/otp/{request,verify}`, `db/51 auth_otps`, hashed + attempt-capped +
  10-min expiry), provisioning a passwordless account on first verify; optional
  **password + TOTP** 2FA (`/api/auth/totp/{setup,enable,disable}`, RFC 6238
  `src/lib/totp.ts`, enforced on both OTP + password login), `POST /api/auth/password/set`.
  Passwordless email OTP is the default on `/sign-in`. `password_hash` is now nullable.
- ✅ **DONE** **Enterprise OIDC SSO** — per-reseller-org connection (`db/52
  sso_connections` + `sso_states`); `GET /api/auth/sso/:slug/start` →
  authorization-code redirect, `GET /api/auth/sso/callback` exchanges the code +
  **verifies the id_token (RS256 against the IdP JWKS, `src/lib/oidc.ts`)** +
  checks iss/aud/exp/nonce + email-domain, then find-or-provisions the user
  (attached to the org) and hands the SPA a session via the URL fragment
  (`completeSso`). **Self-service**: a `/reseller` SSO settings form (GET/POST
  `/api/org/sso`, shows the redirect + staff sign-in URLs) + a **"company SSO"
  entry on `/sign-in`** (org slug → start). Verified start→IdP redirect + callback
  error handling + config-save (secret never returned) on all tiers; RS256 verify
  unit-tested. **Remaining:** SAML (heavier; OIDC covers Okta/Entra/Google/Auth0).
- ✅ **DONE (Phase 1 source gate)** **Agent / API tokens** — scoped, revocable `pat_…` bearer credentials
  so agents act on a user's behalf, **decoupled from the login session** (`db/53
  api_tokens`; `src/lib/api-tokens.ts` — SHA-256-hashed, shown once, role capped at
  manager, optional expiry). `requireAuth` resolves `pat_` tokens; `GET/POST
  /api/tokens` + `DELETE /api/tokens/:id` (human manager+ only — a token can't mint
  tokens). Exact scopes now apply to every PAT-enabled policy; `/api/a2a` requires
  entry-only `agent:invoke` plus domain scopes, and PATs cannot call human session/
  account routes. Migration 57 binds the immutable creator membership, converts
  legacy `agent`, and revokes orphaned tokens. UI remains at `/dashboard/api-keys`.
  **Operator work:** apply migration 57 and re-run create→use→revoke probes on all
  tiers. **Future:** OAuth2 client credentials.
- ✅ **DONE (Phase 1 source gate)** Rate limiting: **per-account** limits
  (`enforceAccountRateLimit`/`isAccountRateLimited`, `/api/copilot` 30/min,
  `/api/broadcast` 6/min) + OTP request 5/hour/destination + **Turnstile CAPTCHA**
  on signup + OTP request (`src/lib/turnstile.ts`, gated on `TURNSTILE_SECRET`),
  with the client widget wired into `/sign-in` + `/get-started` (renders only when
  `TURNSTILE_SITE_KEY` is set). Public identity/money/PII/compute routes are
  centrally inventoried and fail closed if the database limiter is unavailable.
  **Remaining P2:** Cloudflare WAF/bot rules (dashboard config).
- ✅ **DONE (hook)** **APM / error tracking** — `src/lib/observability.ts`
  `captureException`, wired into the server error handler; sends to Sentry when
  `SENTRY_DSN` is set (no-op otherwise). **Remaining:** uptime/alerting config.
- **P2** **CI auto-deploy** — create a scoped API token (Workers Scripts:Edit +
  Hyperdrive:Read), set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_DEPLOY_ENABLED=true`
  (the Global API Key isn't suitable for CI); deploys are manual from the
  container today.
- **P2** Set `A2A_API_KEY` (or `OMNI_API_KEY`) to enable staff-scoped `/api/a2a`
  integrations — staff role is now gated behind it (anonymous callers run as
  `customer`).

## Payments & settlement
- ✅ **DONE (sandbox testing) — `SANDBOX_AUTO_LOGIN` lands testers on a real, venue-bound merchant.** The existing `/api/auth/session` bootstrap mints a token with **no `venue` claim**, so testers spent their time looking at `403 venue claim required`. `POST /api/auth/sandbox-session` returns a session for one configured account (`SANDBOX_AUTO_LOGIN_EMAIL`), and `ensureSessionToken()` prefers it over the anonymous fallback. **It is a password-less session, so it is fenced on four independent gates**, each with a test in `__tests__/unit/sandbox-auto-login.test.ts`:
  1. `sandboxAutoLoginAllowed()` requires a **non-production** runtime — and `runtimeMode()` fails *toward* production, so an unknown deployed profile (e.g. a Hyperdrive binding with no `APP_ENV`) is refused rather than allowed.
  2. The flag must be set **explicitly**; sandbox alone does not enable it.
  3. `validateRuntimeSecurity()` **fails production startup** if `SANDBOX_AUTO_LOGIN` is left on, alongside the existing `AUTH_REQUIRE_LOGIN` / `ALLOW_SIMULATORS` checks. `wrangler.toml` pins it to `"0"` in the production vars block.
  4. The endpoint **refuses to mint an admin** (both by configured email and by the stored role), derives claims from `authoritativeVenueClaims()` on the stored account — never from the request body — and 404s rather than advertising itself.
  - **The account is not created automatically.** `merchant@demo.com` must exist in `app_users`; the endpoint 404s otherwise. Deliberate: auto-provisioning an account from an unauthenticated endpoint is the same hole in a different shape.
- ✅ **DONE (state sync) — the dashboard was conflicting with itself and blaming another device.** `pushState` in `src/lib/browser-storage.ts` read the mirrored key's revision when the request *started*, but the new revision is only known when the response *lands*. Two writes to the same key in one burst therefore both sent the same base revision; the server correctly rejected the second `409`, and the merchant got **"This data changed on another device. The server copy was preserved; refresh and review."** — for a tab racing itself, with no second device involved. Observed live: `fxengine.merchant.catalogue` posted twice at revision 5 in a single page load. Writes are now chained per revision marker (`.then(run, run)`, so a failed write doesn't strand the queue), leaving unrelated keys parallel. Verified in the browser: 12/12 `/api/state` writes returned 200 with no conflict toast. `__tests__/unit/state-sync-serialisation.test.ts` pins it.
  - This is a symptom of the wider `merchant-dashboard.ts` client-side data tier liability below, not a cure for it. **A genuine cross-device conflict is still surfaced** — only the self-inflicted one is gone.
- ✅ **DONE** — invoice due dates rendered raw in `/dashboard/invoices` ("due 2026-04-27T00:00:00.000Z"). Now formatted.
- ✅ **DONE (invoice visibility) — "I raise an invoice in the PWA and it never appears in the back office" was not a sync bug.** Diagnosed live: the dashboard session is minted by `POST /api/auth/session`, the password-less SPA bootstrap, which signs `{ sub: "session:merchant", role: "merchant", name: "Operator" }` and **no `venue` claim**. Every tenant-scoped endpoint therefore answers `403 {"error":"venue claim required"}` — tenant isolation working exactly as designed. The damage was that **both surfaces hid it**: `loadAll()` in `src/routes/dashboard/invoices.tsx` caught the 403 in `catch { /* offline */ }` and rendered a bare "No invoices yet", while the PWA's `add()` fell through to `setInvoices(...)` and produced a local-only invoice that looked shareable. The merchant got a confident, empty screen and a phantom invoice, with no indication either was wrong.
  - **Fixed the silence, not the 403.** The dashboard now separates 401/403 from a network failure, clears stale rows and renders a `role="alert"` banner naming the venue-claim case; the PWA marks such invoices `localOnly` and the invoice sheet now says the invoice *"won't appear in your back office and can't be paid"* rather than the vaguer "Not payable yet". Pinned by `__tests__/unit/invoice-sync.test.ts`.
  - **Deliberately NOT done: giving the anonymous bootstrap a venue.** Attaching a tenant to a token anyone can mint without a password is an authentication bypass — it would hand every caller of `/api/auth/session` a real venue's invoices, payments and customers. The bootstrap stays venue-less; operators must sign in.
  - **The sync pipeline itself is proven working.** With a venue-bound token (`/api/auth/signup` issues `venue: v_…`), the PWA's exact create returns `201` and the dashboard's exact list call returns that invoice immediately. No venue in `app_users` is bound to `main`, so the demo venue can never show real invoices.
- ✅ **DONE (ledger integrity) — the "GL posting swallows errors" risk was real but confined to dead code, which is now deleted.** `src/lib/invoicing.ts` carried a second invoice writer, `recordPayment()`, that ended in `catch { /* best-effort accounting */ }` — it marked an invoice `paid` and then **silently discarded a failed A/R posting**, leaving a settled invoice against a receivable that never cleared, with nothing recording the discrepancy. **Investigated before fixing: it had no caller.** Manual settlement is refused at the route (`/api/invoices/:id/paid|pay` → 400 "Manual settlement is disabled; use a server-bound payment link"), so the function was unreachable. It was **deleted rather than patched** — it also wrote `amount_paid`/`status` directly, bypassing the `invoice_events` idempotency ledger that the live path uses, so anyone who wired it up would have double-counted payments *and* unbalanced the ledger.
  - **The live path was already correct.** `settleInvoicePayment()` posts via `postEntryInTransaction(tx, …)` **inside** the settling transaction, so a ledger failure rolls the settlement back and the financial outbox retries it with backoff (`failFinancialEffect`, capped exponential). An invoice cannot be paid without its journal entry.
  - `__tests__/unit/invoice-ledger-integrity.test.ts` pins all of it, including a **positive control** proving the failure test really intercepts the ledger write rather than throwing earlier, and a guard that no second `amount_paid` writer reappears.
- ✅ **DONE (invoice sync) — a paid invoice no longer reads "Pending" until someone reloads.** An invoice is settled by a **guest**, on the server, in a different browser from the merchant's — but neither merchant surface was told. `/dashboard/invoices` fetched once per `venue` change; the PWA's `useInvoices()` refetched only on mount, `pesaswap:auth-changed`, `storage` and after `add`. Both now subscribe to `payment.succeeded` / `payment.refunded` over the existing realtime channel (`usePesaSwapEvent` in the dashboard, `realtime.on` in the PWA hook) and both refetch on foreground, which covers the case where the socket was asleep. Both unsubscribe on unmount. `__tests__/unit/invoice-sync.test.ts` pins it.
  - **Realtime is the notification, not the source of truth** — every handler triggers a **refetch from the server** rather than patching local state from the event payload, so a dropped or duplicated event costs a redundant read, never a wrong balance.
- **Verified, not a gap — settlement already includes invoice payments.** `src/api/settlement.ts` aggregates `FROM payments WHERE venue_id = … AND status IN (…)` with no filter on origin, so invoice-originated payments are counted in gross/refunds/fees/net exactly like order payments. It does not *break out* invoice vs order revenue; that is a reporting nicety, not a sync defect, and was left alone.
- **Verified, not a gap — `/api/analytics` is deliberately omnichannel-only.** It reads `conversations`, `messages`, `events`, `outbound_deliveries` and `channel_consent_events` and never touches `invoices` or `payments`. That is the documented scope of the agent/channel analytics surface; revenue reporting lives in accounting (P&L, AR aging), settlement and `/api/invoices/stats`. **No invoice wiring was added here** — doing so would have duplicated revenue reporting in a page that is not about revenue.
- **P1** Certified provider **sandbox → production credentials**; PCI-DSS SAQ-A
  attestation (keep: no PAN on the server; pay links to hosted checkout).
- ✅ **DONE (trust containment)** `/api/webhooks/pesaswap` processes inline only
  when the raw-body HMAC is valid. Unverified deliveries are deliberately fast-
  acknowledged and create no financial side effect; authenticated pull
  reconciliation is the authority. Production startup now requires both
  `PESASWAP_WEBHOOK_SECRET` and `PESASWAP_API_KEY`.
- ✅ **DONE (Phase 0 refund boundary)** `/api/refunds` requires manager+ auth and
  `payments:write` for API tokens, derives tenant/actor/original amount from the
  server, enforces cumulative settled refunds from PostgreSQL, and books only a
  provider-settled refund. The dashboard no longer marks failed/pending refunds
  locally.
- ✅ **DONE (Phase 4 local code gate)** Payment first-success, immutable allocation
  snapshots, financial events, and per-consumer outbox rows commit atomically.
  Fenced leases, scheduled recovery, failed-event UI/retry audit, cumulative refund
  reservations, ambiguous provider recovery, paginated refund pull, and append-only
  proportional accounting/commission/loyalty/COGS/order/pay-link/invoice/settlement
  adjustments are implemented in migration 63. **Operator work:** apply migration
  63, deploy the scheduled trigger, and run real PostgreSQL concurrency/failure
  injection plus a live provider payment/refund/payout cycle before production.
- ✅ **DONE (Phase 5 local controls)** Migration 64 adds strict KES invoice
  validation, balance holds, persist-before-send communication outbox, immutable
  voids, recurring occurrence claims, distinct tip rules/periods, pending
  evidence-backed payouts, provider statement imports/matches, KES-only reports,
  and persistent audit checkpoints. **Operator work:** remediate migration-64
  preflight conflicts, apply it to each tier, run real PostgreSQL concurrency and
  provider payout/transfer evidence tests, and externally anchor/sign checkpoints.
- ✅ **DONE** Persist **webhook + refund + dispute** events — every trusted webhook
  is written to `payment_events` (audit trail + idempotency, `db/40`); refunds are
  booked to the ledger (`recordRefundRow`); **disputes/chargebacks** are upserted to
  `disputes` (`db/41`) from the payment's `disputes[]` or a dispute event, with
  `GET /api/disputes` + `GET /api/payment-events` reads. Current settlement
  batching is an **internal estimate**, not evidence of provider payout or bank
  reconciliation; provider statements/fees/payout matching remain P1.
- ✅ **DONE (API)** Dispute / chargeback **response tooling** — `db/49` adds
  `evidence`/`evidence_submitted_at`/`resolution`; `POST /api/disputes/:id/evidence`
  (contest → `under_review`) and `POST /api/disputes/:id/accept` (concede) gated
  manager+ + a full **`/dashboard/disputes`** page (summary, deadline countdowns,
  submit-evidence / accept, status lifecycle). The provider "submit evidence" API
  call activates once a PesaSwap dispute key is configured.
- **P1 (external dependency)** **KE-QR interoperability — CBK-directory PSP id.**
  KE-QR codes (EMVCo MPM TLV, `src/lib/ke-qr.ts`) are structurally valid +
  CRC-verified but not yet routable by other banks until an acquiring-PSP
  identifier is issued from the CBK directory via **PesaSwap's PSP registration**.
  Until then the till is encoded under `ke.go.qr` with a placeholder account.
  **Ready:** it's an optional field in **Admin → Settings → KE-QR**
  (`app_settings('ke_qr').pspId`, `GET/PUT /api/ke-qr-config`, consumed by
  `PaymentQr` via `src/lib/ke-qr-config.ts`). Flipping in the real `pspId` is a
  runtime change — **no deploy required**. Action when issued: enter it there.

## Data model (server-authoritative migration)
- ✅ **DONE (PWA invoices never present a dead pay link)** Reported from the field:
  an invoice created in the PWA was absent from `/dashboard/invoices`, and its
  `/pay?i=INV-11496` link returned **404**. Cause: the invoice sheet publishes via
  `POST /api/invoices/publish`, but on a demo/unauthenticated session that returns
  403, and the handler did `if (!res.ok) return;` — silently falling back to an
  in-app link that resolves to nothing. The merchant was then offered Copy link,
  Share, a payment QR and "Send to <customer>" for an invoice that does not exist
  in Postgres, so a customer could be sent a link that 404s at the till.
  The sheet now tracks `publishing | published | signed-out | failed`; **only a
  confirmed publish is shareable**. The QR is withheld (not decorated) and replaced
  by a `role="status"` explanation, and all five send paths are disabled. The
  signed-out case says plainly: "You're on the demo venue. Sign in to publish this
  invoice and share a payable link."
- ✅ **DONE (invoice numbers cannot collide across merchants)** The PWA minted
  `INV-${Math.floor(10000 + Math.random() * 89999)}` — ~90k values — against a
  **global** unique index (`invoices_public_number_key` is on `number` alone, not
  per venue). Two merchants collide within a few thousand invoices and the second
  publish fails with a 409. Both surfaces now mint from `src/lib/invoice-number.ts`
  using the server's existing 16-hex-char scheme. 11 tests.
  **Note:** invoices already created locally under the old short format keep those
  numbers; they publish normally unless they happen to collide.
- ✅ **DONE (AR aging corrected to the accounting standard)** `arAging` aged every
  invoice from `created_at`, so an invoice raised 45 days ago on 60-day terms was
  reported as "31–60 days overdue" when it was **current**. That overstates credit
  risk, misprices any bad-debt provision and starts collection calls against a
  customer who has done nothing wrong. `src/lib/ar-aging.ts` now ages from the
  **due date** (blank terms = due on receipt), with the conventional five buckets
  (Current / 1–30 / 31–60 / 61–90 / 90+), a separate `overdueMinor`, and a
  **per-customer rollup keyed on phone** so one payer is not split across three
  spellings of their name. SQL retrieves; the policy is pure and unit-tested (12
  tests). `/api/accounting/ar-aging` and the Accounting page show all five buckets.
  **Breaking:** the `d0_30` bucket is replaced by `current` + `d1_30`; any PAT
  integration reading the old shape must be updated — the old numbers were wrong,
  so they should not be preserved.
- ✅ **DONE (customer portal invoices are payable)** `me.$token.tsx` declared
  `pay_link` on its `Invoice` type but `/api/portal/:token` never selected it, so
  the retention surface listed what a guest owed with no way to settle it. The
  query now returns `pay_link`, `due_date` and the outstanding `balance_minor`, and
  the list renders a Pay action for unpaid, non-void invoices only. WCAG 2.2: the
  list is a real `<ul>/<li>`, the action's accessible name identifies the invoice
  and amount ("Pay invoice INV-123, KES 1,500 outstanding") rather than a bare
  "Pay", the target is 44px (SC 2.5.8 floor is 24px), focus stays visible, and the
  decorative section icon is `aria-hidden`. 9 contract tests guard the
  server↔client seam where the gap lived.
- ✅ **DONE (vertical + tier productisation)** `MerchantVertical` existed only as a
  TypeScript union in admin localStorage, so every merchant saw every other
  vertical's features and no plan limit was enforceable. `db/80` persists
  `venues.vertical` + `venues.tier` + `venue_capability_overrides`;
  `src/lib/verticals.ts` resolves them (vertical = default, tier = hard limit, an
  override can never buy entitlement); `/api/venue-profile` serves it (GET staff+,
  PUT owner-only, tier not settable by a merchant, unentitled override → 402); the
  dashboard sidebar filters by role AND capability. 30 tests.
  **Operator work:** apply migration 80, then set each venue's real `vertical` and
  `tier`. Existing venues were backfilled to `enterprise` so nothing disappeared —
  billing means nothing until real tiers are set.
- 🟡 **P2 (accessibility debt, ratcheted)** `eslint-plugin-jsx-a11y` now runs over
  all source. **11** rules are **errors at zero violations** and cannot regress —
  `no-autofocus`, `click-events-have-key-events` and `no-static-element-interactions`
  were promoted once the modal-overlay debt was paid off by routing all 10
  click-outside-to-close surfaces through `src/components/ui/modal-overlay.tsx`
  (backdrop is now a real button sibling; Escape closes; `role="dialog"`).
  Remaining debt is a single warning-level rule: **74**
  `label-has-associated-control`, concentrated in `dashboard/retail.tsx` (16) and
  `dashboard/staff.tsx` (10) — fix is one shared `Field` primitive using `useId`
  with explicit `htmlFor`/`id`. Also still missing: **focus trapping and focus
  restore** inside `ModalOverlay`, and runtime `axe`, contrast measurement and
  screen-reader passes are **not** wired up — accessibility is currently
  "lint-enforced, manually unverified".
- ✅ **DONE — a broken page no longer takes the dashboard with it.** The only React
  error boundaries were at the root, so a render error in any one page replaced the
  **entire document** — sidebar and header included — leaving an operator mid-service
  with no way to navigate anywhere. `src/components/PageErrorBoundary.tsx` now wraps
  the dashboard `<Outlet />`, scoping a failure to the page and keeping the shell
  usable. It resets on `pathname`, so navigating away and back clears a transient
  error without a reload.
- ✅ **DONE — "empty" and "the server is down" are no longer the same screen.**
  Invoices, the knowledge base and the inbox each caught a failed load and set an
  empty array, so an outage was indistinguishable from an empty account: the
  operator sat looking at "no invoices" while invoices existed. They now render
  `src/components/LoadFailure.tsx` — names what failed, says the data is not lost,
  and offers Retry. The knowledge and inbox loads also gained the missing `res.ok`
  check, without which an error page was fed to `.json()` and the resulting throw
  was caught as if the venue simply had no data.
- ✅ **DONE — API errors return JSON, not an HTML error page.** An unhandled server
  error returned `renderErrorPage()` for **every** path including `/api/*`. Every
  client here calls `res.json()`, so the real failure was buried under
  `Unexpected token '<'`. `/api/*` now gets `{ error, requestId }` — the id matches
  the `[req …]` log line, so a user can quote it and the failure can actually be
  traced instead of being unresolvable after the fact.
- ✅ **DONE — the last blocking `window.confirm` is gone.** Deleting a merchant in
  the admin console used a native confirm. It is now a `ModalOverlay` dialog, which
  is keyboard-dismissable, styleable and announced.
- 🟡 **P2 — best-effort failures are now named and counted, but have no sink.**
  `src/routes/pay.tsx` deliberately swallows six things that must never block a
  guest mid-payment: a malformed realtime frame, a failed socket connect, a claim
  release (the reservation expires on its own), two receipt refreshes, and a
  review submission. Each was a bare `catch {}` — individually correct, collectively a blind spot, because if
  one started failing for every guest nothing anywhere would say so. They now call
  `noteBestEffortFailure` (`src/lib/best-effort.ts`), which counts each event and
  logs **once per event per page load** so a persistent fault shows up in a support
  session without spamming the console mid-payment. Behaviour is unchanged and no
  network call was added.
  **This is local-only.** The counts live in the guest's tab and go nowhere. There
  is no client→server telemetry path (`captureException` is server-side and
  no-ops without `SENTRY_DSN`). Wiring a sink means a public unauthenticated
  endpoint on the payment page, which is an abuse surface and a deliberate
  decision, not a drive-by — `bestEffortFailures()` is the single seam to plug
  into when that decision is made.
- ✅ **DONE — the last `window.prompt` is gone, and weak staff PINs are now refused.**
  `src/routes/dashboard/settings.tsx` used to collect a new 6–8 digit staff PIN
  through a browser prompt: unmaskable, unstyleable, poorly announced, and a live
  credential in a dialog the page could not control. It is now a `ModalOverlay`
  dialog with a masked input, a show/hide toggle and a **Generate** button
  (`crypto.getRandomValues`), because a manager left to choose picks `123456`.
  `isWeakStaffPin` in `src/lib/staff-pin.ts` rejects repeated digits, runs and
  repeating blocks, and `POST /api/staff/:id/pin/reset` **enforces it server-side**
  — the UI check alone would be theatre, since a manager can call the endpoint
  directly. **It is deliberately NOT part of `isValidStaffPin`:** that function also
  guards staff *login*, so tightening it there would have locked out every existing
  staff member holding a weak PIN instead of asking them to rotate it. Pinned by
  `__tests__/unit/staff-pin-strength.test.ts`.
- � **P1 (retail counter now server-side; catalogue UI still local)** `db/81` adds
  the missing **sell price** to `inventory_items` (it only had `cost`, which is why
  the counter kept prices in the browser) plus `barcode`/`category`, and a durable
  `retail_sales` + `retail_sale_lines` ledger. `POST /api/retail/sales` writes the
  sale, its lines, the stock decrement and the explaining `inventory_movements` row
  in **one transaction**, so takings and stock can never disagree. Line name, price
  and cost are **snapshots**, so a receipt and a margin report stay true after a
  reprice. `Idempotency-Key` makes a double-tapped till button return the original
  sale. Cost and margin are manager+; a cashier never sees purchase cost. The
  counter is gated by the `retail.counter` capability **server-side**, not just
  hidden in the sidebar. `/dashboard/retail` now mirrors every completed sale into
  that ledger via `src/lib/retail-sync.ts`, which owns the two conversions that were
  previously implicit and dangerous: whole shillings → minor units (**×100**), and a
  local `prod_*` id → a real `inventory_items` UUID (never sent as a foreign key —
  the SKU/barcode is sent and the server resolves it). The local sale is not blocked
  on the network, so a shop keeps selling offline. 38 tests.
  **Operator work:** apply migration 81; dedupe
  `inventory_items.sku` then add a unique index (deliberately omitted — failing on
  legacy duplicates would block every later migration).
  **Remaining:** hydrate the catalogue FROM `inventory_items` so ids are server
  UUIDs from the start; replay the offline sale queue; suppliers/purchase orders;
  the credit book (`deni`).
- ✅ **DONE (POS open-check ordering source gate)** `db/79` adds the partial
  `(venue_id, opened_at DESC)` index for the venue-wide open-check list. It avoids
  a separate sort while retaining the existing table-specific open-check index.
  **Operator work:** apply migration 79 before relying on POS check lists at
  production volume.
- ✅ **DONE (POS tender-query performance source gate)** `db/78` adds the
  `(venue_id, status, created_at DESC)` index used by the POS tender operational
  list. The existing partial indexes retain their queue and unsynced-alert paths;
  this index covers the all-status/notified/manual dashboard views without a
  growing sort. **Operator work:** apply migration 78 before enabling POS tender
  operations at production volume.
- ✅ **DONE (POS recovery source gate)** The vendor-neutral POS contract now runs
  on the Worker schedule: it refreshes open checks for each connected venue and
  drains PesaSwap payment-to-POS-tender intents through the leased retry worker
  (`src/lib/pos-recovery.ts`). One unavailable venue does not stop the rest; a
  tender retry cannot double-record because `pos_tender_pushes` retains its lease
  and provider idempotency key. **Operator work:** apply migrations 76 and 77,
  configure a supported provider's secrets, verify the connection, publish and map
  the PesaSwap tender, then run a capped provider pilot. PesaSwap documents
  checkout SDKs and payment APIs but no terminal/reader/card-present protocol, so
  physical-device support remains capability-gated until that vendor contract and
  certification requirements are published.
- ✅ **DONE (staff service notifications, B2)** Sunday's alert set now fires from the
  real sources of truth: `payment.full` / `payment.partial` (carrying the outstanding
  balance) / `payment.failed` / `payment.failed_3ds` / `payment.fraud` /
  `payment.received` / `table.paid` from the payment ledger, `order.new` /
  `order.failed` from `/api/orders`, `tip.new` from the tip attribution, and
  `review.new` from the public review capture. Recipients are resolved by the pure
  filter in `src/lib/staff-notifications.ts`: a table-scoped alert reaches ONLY the
  servers who tapped that table (`staff_table_subscriptions`), never a broadcast;
  per-type opt-outs live in `staff_notification_prefs`; a clocked-out member is
  skipped; cross-venue candidates are dropped outright. Delivery reuses the existing
  Web Push path (no second transport). Staff manage it from "My tables" on
  `/staff-console` via human-only `/api/staff-alerts*`. **Operator work:** apply
  migration 69 before deploying. **Still blocked:** B2.9 (unsynced payment) needs the
  POS connector. B2.8 (potential walkout) shipped with C9.1 — see below.
- ✅ **DONE (walkout protection, C9.1–C9.4 + C9.6 + B2.8)** A table that leaves without
  settling is now detectable, reportable and recoverable. Detection (`src/lib/walkouts.ts`)
  combines the three signals Sunday's flow relies on — the QR was scanned during table
  service, the check still carries a balance, and the table has been idle past the
  **venue's own** threshold (`venue_walkout_settings.idle_minutes`, default 45, never
  hardcoded) — and pages the servers following that table as `walkout.potential` (B2.8)
  on the scheduled tick. The guided report runs from BOTH `/dashboard/walkouts` and the
  staff console (`WalkoutReportCard`), captures the table and the amount remaining, and
  leads with Sunday's Step 1: **leave the check open**. Nothing in the flow writes to
  `orders`, so a guest who returns to the bill on their phone can still pay; when they do,
  the existing `consumer === "order"` path that stamps `orders.paid_at` closes any live
  walkout to `recovered` in the same transaction. The register (`GET /api/walkouts`,
  manager+) reports reported / recovered / net loss. Reporting is staff+, resolution and
  the register are manager+, all routes are human-only, every transition writes a
  `walkout_events` audit row, and `walkouts_live_per_order` makes a double-tap idempotent.
  **Operator work:** (1) apply **migration 73** before deploying; (2) set each venue's idle
  threshold via **PUT `/api/walkouts/settings`** (owner-only) if 45 minutes is wrong for
  that service style, or set `enabled: false` to silence detection; (3) confirm the
  Cloudflare cron trigger is running — detection fires from `scheduled()` and produces no
  alerts without it.
  **Deliberately NOT built — needs a business decision:** **C9.5**, the coverage guarantee.
  Sunday reimburses an eligible walkout including an 18% tip for the server. That is
  underwriting, not engineering: it needs eligibility criteria, a funding source, a
  reserve and a dispute path. The schema carries `status = 'under_review'` and a free-text
  `review_outcome` so a decision can be recorded later, but nothing computes a covered
  amount, tops up a tip, or promises reimbursement anywhere in the UI. **Action:** the
  business must define the criteria and who funds them before any coverage claim is built.
- ✅ **DONE (split-pay concurrency)** Two guests settling the same bill at the same
  instant could each read the full outstanding balance before either payment hit the
  ledger and overpay the check. `payment_holds` (`db/62`) + `src/lib/split-lock.ts`
  now RESERVE a share under a per-order `SELECT … FOR UPDATE`, so a grant is
  serialised and visible to the next payer. Holds expire after 120s (covering the
  M-Pesa STK `processing` window), are keyed by the request's `Idempotency-Key` so a
  retry re-competes for its own share, and are released on a decline or an abandoned
  payment intent. Falls back to the previous read-clamp if the database refuses a
  transaction. **Operator work:** apply migration 62 before deploying.
- ✅ **DONE (staff, orders)** `staff` + `orders`/`order_items` are server-authoritative
  (`/api/staff`, `/api/orders`); `tips` attribution/pooling live (`/api/tips`,
  `payments.staff_id`+`tip_amount`, `tip_pools`, `tip_allocations`). **Reference pattern**.
- ✅ **DONE (settings/branding)** `venue_branding` (logo/colour/name) via `/api/branding`.
- ✅ **DONE (client per-venue isolation)** The merchant localStorage store is now
  namespaced to the logged-in venue (login pins `currentVenue` to the JWT claim); a
  real merchant (`v_*`) gets an EMPTY starter with their own business name instead of
  the shared "Sade's Atelier" demo (`createMerchantStarterData`, `isDemoVenue`,
  `getMerchantIdentity`). POS/KE-QR read the per-venue identity, not constants.
- ✅ **DONE (menus, tables)** `menu_items` + `dining_tables` are server-authoritative
  with per-row CRUD (`/api/menu/item`, `/api/tables`) and dedicated editors
  (`/dashboard/menu`, `/dashboard/tables`). `src/lib/server-sync.ts` mirrors both
  into the localStorage snapshot on dashboard entry + after each edit, so the
  read-only views (overview, floor plan, bookings, customer table) share one source
  of truth. Gated to real merchants (demo keeps its rich local showcase).
- ✅ **DONE (venues picker)** `GET /api/venues` serves the back-office picker from
  Postgres, principal-scoped (merchant → member stores, reseller admin → org venues,
  admin → all). The dashboard picker consumes it (additive; falls back to the local
  list offline). `src/api/venues.ts`.
- ✅ **DONE (multi-store)** One login can own **multiple stores** — `user_venues`
  membership (`db/42`), `POST /api/venues` "add a store" (plan-capped),
  `POST /api/auth/switch-venue` re-mints the JWT for a member store (server-verified),
  and a store switcher + "Add a store" in the dashboard picker. Each store is fully
  isolated; a user can never switch into a store they don't own.
- ✅ **DONE (store roles + team)** Owner/manager-per-store — `GET/POST/DELETE
  /api/venues/members` (`src/api/multistore.ts`) with per-store RBAC: a manager+
  may invite/re-role/remove members up to their own rank (no privilege
  escalation), find-or-creates the invitee's `app_users` row, is plan-capped on
  team size, and never orphans a store's last owner. Surfaced at `/dashboard/team`.
- ✅ **DONE (chain rollup)** `GET /api/venues/rollup` aggregates net/gross/tips/
  refunds/txns across every store the login manages (last 30 days), rendered at
  `/dashboard/chain`. Revenue is only shown for stores where the caller is
  manager+, so a staff-level membership never leaks another store's takings.
- ✅ **DONE (multi-venue staff)** A staff member's per-venue `staff` rows are linked
  by phone, so one PIN login can list (`GET /api/staff/my-venues`) + switch
  (`POST /api/auth/staff-switch-venue`, re-mints the staff JWT, verified same-phone
  + active there) between every store they work at — store switcher on
  `/staff-console`. Switching to an unassigned store is 403.
- ✅ **DONE (order lifecycle notifications)** On a real status change to accepted /
  preparing / ready, `PATCH /api/orders/:id` notifies the customer on their channel
  (consent-checked, timeline-logged), fulfillment-aware (eat-in vs collection) with
  the scheduled time — `src/lib/order-notify.ts`. Customers can ask "where's my
  order?" via the agent's `get_order_status` tool.
- ✅ **DONE (venue-aware inbound)** Inbound is routed to the venue that owns the
  receiving channel account (`channel_accounts`, `db/44`) via
  `resolveVenueForAccount` — a customer messaging store A's WhatsApp number reaches
  store A's agent/menu/orders (falls back to `main`). Payments + orders are already
  `venue_id`-scoped in the DB, so each store's transactions are fully separated.
- ✅ **DONE (per-venue outbound config)** Each store sends on its OWN number/bot —
  channel config is namespaced `whatsapp_cloud:<venue>` / `telegram:<venue>` (global
  default fallback, no migration), `getWhatsappConfig/getTelegramConfig(env, venue)`
  and `adapter.send(handle, text, env, venue)` thread the venue through every
  outbound path (agent reply, order notify, share, campaigns, sequences, invoices,
  reminders, DLQ, staff reply). The agent's free-form reply names the specific store.
  **Remaining (external creds only, can't build/test without accounts):** TikTok + X
  (Twitter) adapters; live keys for SMS (Africa's Talking + 10DLC), Email
  (Resend/SendGrid), and per-venue WhatsApp/Telegram numbers. The Baileys bridge is
  single-account (one WhatsApp number) — multi-venue uses Cloud API webhooks.
- ✅ **DONE (sub-entity persistence)** Table combinations / zones / areas / floor-plan
  and menu modifiers / schedules already persist server-side per-venue via the
  `merchant_state` blob (`writeStorage` → `/api/state`, hydrated by
  `hydrateMerchantState`). **Deferred (P3, low value):** normalising these nested
  floor-plan / menu-decoration structures into dedicated per-row tables.

## Tenancy & billing (#5)
- ✅ **DONE (quota enforcement)** Per-plan caps are enforced on create (count vs cap
  → 402) for `recurring`, `staff`, `tables`, `menu_items` and `contacts`
  (`planLimit`/`planLimitMessage` in `src/lib/tenancy.ts`). Free-tier defaults:
  5 staff, 20 tables, 50 menu items, 25 recurring, 500 contacts. Demo/admin/pro
  tokens are uncapped; existing data is never touched.
- ✅ **DONE (M-Pesa billing)** Real **billing / subscriptions** on the existing
  PesaSwap M-Pesa integration — `db/50` `subscriptions`; `src/lib/billing.ts`
  (plan catalogue free/pro + `activateSubscription`/`downgradeToFree`);
  `src/api/billing.ts` (`GET /api/billing`, `POST /api/billing/subscribe` → M-Pesa
  STK, `/cancel`, `/run` dunning sweep); activation hooked into `recordLedger`
  first-success; `POST /api/auth/refresh` re-mints the plan claim; upgrade/usage UI
  at `/dashboard/billing`. Verified: free → pro via M-Pesa (test-mode) → plan
  unlocked → downgrade. **Remaining:** metering-based overage billing.

## White-label & reseller (foundation shipped this session)
- ✅ **DONE** Reseller **org layer** — `organizations` + `venues.org_id` +
  `app_users.org_id`; `POST /api/org` (admin), `GET /api/org?slug` (public),
  `GET /api/org/merchants` (reseller admin); merchant signup accepts `?org=slug`.
- ✅ **DONE** Per-merchant **branding** — logo/colour/name persisted
  (`venue_branding`), `GET/PUT /api/branding`, Settings upload UI + reseller
  "powered by" co-brand.
- ✅ **DONE (P1)** **Apply branding to surfaces** — the dashboard shell shows the
  reseller/bank brand (not hardcoded "PesaSwap") and the **pay page** shows the
  merchant's logo/name via `useBranding(venue)` (public), keeping a "Powered by
  PesaSwap" attribution.
- ✅ **DONE (P1)** **Bank-admin portal** — `/reseller` onboards/lists merchants +
  edits org branding, **plus aggregate analytics + revenue-share**: `db/45`
  `organizations.commission_bps`, `GET /api/org/analytics` (processed volume + tx
  per merchant + the reseller's commission), rendered as stat cards + per-merchant
  Gross/Commission columns.
- ✅ **DONE** **Org-scoped login** — login carries the `org` claim + `reseller_admin`
  role (`src/api/auth.ts`); `getDefaultRouteForRole` routes them to `/reseller`;
  RBAC separates reseller vs merchant. Verified: a reseller admin logs in and lists
  only their org's merchants.
- ✅ **DONE (co-branded signup)** `/get-started?org=<slug>` reads `GET /api/org`,
  shows the reseller's brand (logo + "{bank} × PesaSwap"), and links the new
  `venue.org_id` to the org on signup (`signup({..., org})`). **Invite-token flow
  DONE:** `db/46` `org_invites` + `organizations.require_invite`; invite-only orgs
  reject open signups (403) until a valid unused unexpired token is supplied
  (`POST/GET /api/org/invites`, portal "Invite links" section). Verified live:
  open→403, valid invite→201, reuse→403.
- ✅ **DONE (P2)** **Reseller settlement + commission ledger** — `db/47`
  `commission_ledger`; `src/lib/commission.ts` posts the org's revenue share once
  per succeeded payment (idempotent on `payment_id`), and `handleCreatePayment`
  tags `settlement_partner_id` from `organizations.pesaswap_partner_id` so a bank's
  merchants settle under its PesaSwap partner. `GET /api/org/ledger` + a
  "Commission posted" portal stat. Verified live: KES 600 (3% of 20,000) posted.
- ✅ **DONE (per-merchant manifest)** + **P2** **Logo storage** — a dynamic
  `GET /api/manifest?venue=|org=` (`src/api/manifest.ts`) serves each merchant a
  branded installable app (name/colour/logo icon); `__root.tsx` points at it and
  swaps in the logged-in venue. **Remaining:** move inline data-URL logos (≤512KB)
  to Cloudflare R2 / Images (needs an R2 binding).

## Testing & CI
- ✅ **DONE** **E2E job in CI** — runs the HTTP + Playwright suites against the
  ephemeral Postgres service; green on GitHub Actions (curl health-poll on
  127.0.0.1 instead of wait-on).
- **P2** Add **branch protection** on `main` requiring `CI / quality` + `CI / E2E`.
- ✅ **DONE** More **integration/E2E** coverage (payment webhook, campaigns, DLQ)
  — `__tests__/unit/payment-ledger.test.ts` proves a signed `payment_failed`
  webhook is written to the ledger with its decline reason (and an unsigned one
  never is); `__tests__/e2e/payments-campaigns-dlq.e2e.ts` drives a DECLINED +
  a SUCCESSFUL payment (`PAYMENTS_TEST_MODE`, `metadata.simulate="failed"`),
  asserts both are recorded + distinct in `/api/payments/list`, and smokes
  broadcast/campaign history + the tenant-scoped DLQ (list + retry).

## Omnichannel channels (see `.claude/skills/omnichannel-agent/`)
- ✅ **DONE** Enforce **consent + suppression in code** — the `suppressions` table
  + `src/lib/consent.ts` (STOP/START/HELP detection, `isSuppressed`/`setSuppressed`)
  are now honoured on **every** outbound path: inbound auto-opt-out + agent reply
  (`inbound.ts`), single merchant sends (`share.ts`), **bulk campaigns**
  (`lib/broadcast.ts`), **drip sequences** (`lib/sequences.ts`, opt-out halts the
  drip) and **DLQ retries** (`api/dlq.ts`). STOP → suppressed + transactional
  confirmation; suppressed contacts never receive unsolicited outbound.
- **P2** Build the **to-build adapters** following the `parseInbound`/`send`/
  `verifyWebhook` pattern:
  - ✅ **Email** — DONE (`src/lib/channels/email.ts`): inbound-parse webhook
    (`/api/email/inbound`, SendGrid/Mailgun shapes) → agent → reply; outbound via
    **Resend** or **SendGrid**, gated on `EMAIL_FROM` + `RESEND_API_KEY`/
    `SENDGRID_API_KEY` (simulated without keys). Marketing draws from `contacts.email`.
  - **TikTok** — via a Business Solution Provider; inbound-only, region-gated. *(needs BSP creds)*
  - **X (Twitter)** — API v2 DMs, paid tier, eligibility + rate-limit back-off. *(needs paid API)*
- **P2** **Instagram**: wire the Meta webhook + page token; enforce the 24h / 7-day
  Human-Agent-Tag / message-tag rules in `send`.
- **P2** **SMS**: STOP/HELP auto-replies are enforced (shared consent pipeline) and
  **quiet hours** gate marketing sends (`SMS_QUIET_START`/`SMS_QUIET_END` +
  `SMS_TZ_OFFSET_MIN`, default EAT; `src/lib/quiet-hours.ts`). Still needs
  **10DLC/TCR** registration (carrier, external) before a US outbound campaign.
- **P2** **A2A hardening**: ✅ **peer allowlist** (`A2A_PEER_ALLOWLIST`) +
  **capability scoping** by caller (customer vs staff, returned in the response) +
  signed intents (agent-intent) + ✅ **rotating signed peer tokens**
  (`A2A_PEER_SECRET`; `x-agent-signature` = HMAC over `${agentId}.${ts}`, 5-min
  window — grants trusted scope without a static shared key). Remaining: mTLS
  (not available on Workers).
- ✅ **DONE** Cross-channel **consent-to-switch** logging when moving a customer to
  a new channel — `db/48` `consent_switch_log`; `src/api/share.ts` `logConsentSwitch`
  records `(channel, from_channel, kind)` on every merchant-initiated share,
  detecting the customer's last-seen channel from `conversations.channel`. Verified
  live (dev + prod-local): an SMS share to a WhatsApp-last-seen handle logs
  `from_channel='whatsapp'`.

## Integrations & config
- **P2** **Google sign-in**: set `GOOGLE_CLIENT_ID` (+ optional
  `GOOGLE_ALLOWED_EMAILS`) to activate the button.
- **P2** Set `app_settings.public_base_url` to a stable domain (the cloudflared
  quick tunnel is ephemeral) so pay links are durable.

## PWA
- **P3** Replace the placeholder install-listing **screenshots**
  (`public/screenshots/*.png`, generated by `scripts/gen-screenshots.mjs`) with real
  captures. *(needs real device captures)*
- ✅ **DONE** Post-onboarding **setup checklist** on the dashboard overview
  (`OnboardingChecklist`) — add a menu item, set the M-Pesa till, add branding,
  invite a team member, set up tables/QR; completion derived from the merchant's
  own data, per-venue dismissible, only shows for a real (non-demo) venue.
