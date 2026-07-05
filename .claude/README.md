# Agents & Skills

Reusable **Agent Skills** and **subagents** for each core function of the PesaSwap
merchant app, grounded in this codebase. They follow the
[Anthropic Agent Skills](https://agentskills.io) standard (`SKILL.md`) and the
[Claude Code subagent](https://code.claude.com/docs/) format, and are consumable
by GitHub Copilot's Agent Skills support.

## Layout
- **`.claude/skills/<name>/SKILL.md`** — a *skill*: model-loaded instructions for a
  domain (what it is, key files/endpoints, conventions, common tasks, guardrails).
  Frontmatter: `name`, `description` (the trigger). Auto-discovered by Claude Code
  and usable as an Agent Skill in Claude/Copilot.
- **`.claude/agents/<name>-engineer.md`** — a *subagent*: a specialist assistant
  for that domain. Frontmatter: `name`, `description` (when to delegate), `tools`,
  `model`, then a system prompt. Auto-discovered by Claude Code.

## Core functions

| Function | Skill | Subagent |
| --- | --- | --- |
| Payments & checkout | `skills/payments` | `payments-engineer` |
| Invoicing & accounting | `skills/invoicing` | `invoicing-engineer` |
| Omnichannel AI agent | `skills/omnichannel-agent` | `omnichannel-engineer` |
| CRM & loyalty | `skills/crm-loyalty` | `crm-engineer` |
| Bookings & enquiries | `skills/bookings-enquiries` | `bookings-engineer` |
| Menu & catalogue | `skills/menu-catalogue` | `menu-engineer` |
| Campaigns & automations | `skills/campaigns-automations` | `campaigns-engineer` |
| Knowledge base (RAG) | `skills/knowledge-base` | `knowledge-base-engineer` |
| Analytics & reporting | `skills/analytics` | `analytics-engineer` |
| Auth, tenancy & security | `skills/auth-tenancy` | `auth-tenancy-engineer` |

## Using them

**Claude Code** — skills and subagents in `.claude/` are auto-discovered.
- A skill activates when your request matches its `description`, or mention it:
  "use the invoicing skill to add a partial-payment action".
- Delegate to a subagent: "have the auth-tenancy-engineer review this endpoint".

**GitHub Copilot** — the `SKILL.md` files follow the Agent Skills standard; point
Copilot's skills at `.claude/skills/`. The subagent files double as scoped
instructions you can paste into a Copilot custom agent / chat mode.

## Conventions these encode (repo-wide)
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
