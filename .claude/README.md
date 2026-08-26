# Agents & Skills

Reusable **Agent Skills** and **subagents** for each core function of the PesaSwap
merchant app, grounded in this codebase. They follow the
[Anthropic Agent Skills](https://agentskills.io) standard (`SKILL.md`) and the
[Claude Code subagent](https://code.claude.com/docs/) format, and are consumable
by GitHub Copilot's Agent Skills support.

## Layout

- **`.claude/skills/<name>/SKILL.md`** — a _skill_: model-loaded instructions for a
  domain (what it is, key files/endpoints, conventions, common tasks, guardrails).
  Frontmatter: `name`, `description` (the trigger). Auto-discovered by Claude Code
  and usable as an Agent Skill in Claude/Copilot.
- **`.claude/agents/<name>-engineer.md`** — a _Claude specialist_: a focused
  implementation subagent for one domain. Frontmatter defines its name, trigger,
  tools and model; its body points back to the matching skill.
- **`.github/agents/<name>.agent.md`** — a _custom agent_: a specialist assistant
  for a cross-domain programme. Frontmatter defines its name, trigger, tools and
  optional delegated agents; its body defines the operating contract.

## Skills & subagents

### Core functions (domains)

| Function                       | Skill                          | Subagent                        |
| ------------------------------ | ------------------------------ | ------------------------------- |
| Payments & checkout            | `skills/payments`              | `payments-engineer`             |
| PesaSwap integration (SDK/API) | `skills/pesaswap-integration`  | `pesaswap-integration-engineer` |
| Invoicing & accounting         | `skills/invoicing`             | `invoicing-engineer`            |
| Omnichannel AI agent           | `skills/omnichannel-agent`     | `omnichannel-engineer`          |
| CRM & loyalty                  | `skills/crm-loyalty`           | `crm-engineer`                  |
| Bookings & enquiries           | `skills/bookings-enquiries`    | `bookings-engineer`             |
| Menu & catalogue               | `skills/menu-catalogue`        | `menu-engineer`                 |
| Campaigns & automations        | `skills/campaigns-automations` | `campaigns-engineer`            |
| Knowledge base (RAG)           | `skills/knowledge-base`        | `knowledge-base-engineer`       |
| Analytics & reporting          | `skills/analytics`             | `analytics-engineer`            |
| Auth, tenancy & security       | `skills/auth-tenancy`          | `auth-tenancy-engineer`         |

### Roles (RBAC personas)

| Role                    | Skill                     | Subagent                    |
| ----------------------- | ------------------------- | --------------------------- |
| Merchant / owner        | `skills/merchant-owner`   | `merchant-owner-engineer`   |
| Manager                 | `skills/manager`          | `manager-engineer`          |
| Supervisor / shift lead | `skills/supervisor`       | `supervisor-engineer`       |
| Staff / server          | `skills/staff-operations` | `staff-operations-engineer` |

### Staff-ops capabilities

| Capability                            | Skill                   | Subagent                  |
| ------------------------------------- | ----------------------- | ------------------------- |
| Tips (attribution / pooling / payout) | `skills/tips`           | `tips-engineer`           |
| Orders & kitchen                      | `skills/orders-kitchen` | `orders-kitchen-engineer` |

### Agentic commerce & unified interface

| Capability                                             | Skill                     | Subagent                    |
| ------------------------------------------------------ | ------------------------- | --------------------------- |
| Unified QR (one code = order + pay + enroll + receipt) | `skills/unified-qr`       | `unified-qr-engineer`       |
| Merchant copilot (runtime AI employee)                 | `skills/merchant-copilot` | `merchant-copilot-engineer` |
| Agentic checkout / AI-Collect (external agents buy)    | `skills/agentic-checkout` | `agentic-checkout-engineer` |

### Operations & finance depth

| Capability                           | Skill                    | Subagent                   |
| ------------------------------------ | ------------------------ | -------------------------- |
| Inventory (stock, COGS, reorder)     | `skills/inventory`       | `inventory-engineer`       |
| Reconciliation & settlement          | `skills/reconciliation`  | `reconciliation-engineer`  |
| Customer portal & rewards redemption | `skills/customer-portal` | `customer-portal-engineer` |

### Production and device programmes

| Capability                           | Skill                       | Custom agent                                |
| ------------------------------------ | --------------------------- | ------------------------------------------- |
| Enterprise production go-live        | `skills/production-go-live` | `production-go-live-engineer.agent.md`      |
| Android checkout and certified mPOS  | `skills/android-mpos`       | `android-mpos-engineer.agent.md`            |
| Server-authoritative retail commerce | `skills/retail-commerce`    | `retail-commerce-engineer.agent.md`         |
| WCAG 2.2 accessibility               | `skills/accessibility`      | `accessibility-engineer.agent.md`           |
| Vertical and tier productisation     | `skills/verticals`          | `vertical-productisation-engineer.agent.md` |

## Using them

**Claude Code** — skills and subagents in `.claude/` are auto-discovered.

- A skill activates when your request matches its `description`, or mention it:
  "use the invoicing skill to add a partial-payment action".
- Delegate to a subagent: "have the auth-tenancy-engineer review this endpoint".

**GitHub Copilot** — the `SKILL.md` files follow the Agent Skills standard and the
custom agents under `.github/agents/` are directly discoverable.

## Conventions these encode (repo-wide)

- **Production contract**: every skill, Claude specialist and GitHub custom agent links to
  [`docs/PRODUCTION-GO-LIVE-CAPABILITIES.md`](../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md),
  states its domain-specific ownership, and distinguishes designed, source
  complete, environment verified, production ready and certified evidence.
- **Four-runtime evidence**: applicable checks are retained for dev `:8080`,
  prod-local workerd `:8787`, isolated Cloudflare sandbox and production. See
  [`DEPLOYMENT-PARITY.md`](./DEPLOYMENT-PARITY.md).
- Run `npm run customizations:check` after adding or changing a skill or agent.
  Use `npm run customizations:sync` to add or refresh the managed contract block.
- Tenant isolation via `resolveVenue` (JWT `venue` claim wins) — see
  `skills/auth-tenancy`.
- Staff mutations gated with `requireAuth`; public (pay/chat/enquiries/webhooks)
  and service (bridge sweeps) routes stay open.
- New public endpoints join `RULES` in `src/lib/rate-limit.ts`.
- Every request runs inside `withRequestSql` (per-request Postgres client).
- Validate in the dev container: `docker exec pesaswap-merchant-app sh -lc 'cd
/app && node_modules/.bin/tsc --noEmit --skipLibCheck && node_modules/.bin/vitest
run'`; E2E via `npm run test:e2e` and `npm run test:e2e:browser`.

See `SECURITY.md` for the full production-readiness posture.
