# Agent-to-Agent (A2A)

Lets external agents drive our CRM in natural language, and lets ours call peers —
a simplified take on the **Agent2Agent** pattern.

## Inbound (peers → us)
- **Discovery card:** `GET /.well-known/agent-card.json` (and `/.well-known/
  agent.json`) advertises `name`, `description`, `version`, `protocol`,
  `endpoints.message`, `capabilities` (e.g. `create_enquiry`, `check_availability`,
  `get_todays_bookings`, `count_enquiries`, `search_contacts`, `search_kb`,
  `create_invoice`, `escalate_to_human`) and `skills`.
- **Message endpoint:** `POST /api/a2a` `{message|text, venue?, from?, name?,
  role?}` → runs the agent (default `role:"staff"`) → `{reply, tool, escalate}`.
- Implemented in `src/api/a2a.ts` → `runAgent` (`src/lib/agent.ts`).

## Outbound (us → peers)
Pattern to add: fetch a peer's `/.well-known/agent-card.json`, pick a capability,
`POST` a natural-language task to its `endpoints.message`, and fold the structured
result back into the conversation as a tool result.

## Trust, auth & scoping (harden before external use)
- `/api/a2a` is currently **public** for demo. For production: require a signed
  token / mTLS / an allowlist of peer agents, and **scope capabilities** by caller
  (e.g. only `staff`-role peers may `create_invoice`).
- Rate-limit it (it's already in the rate-limit `RULES`, 30/min) and audit every
  call.

## Compliance in A2A
- A peer agent is a **data processor** — never expose another tenant's data
  (venue is resolved server-side, not from the caller) and never leak PII beyond
  what the task needs.
- Respect the same consent/opt-out state: an A2A request can't message a customer
  who has opted out.

## Guidelines
- Keep capabilities **declarative** in the agent card so peers can discover them.
- Return structured results (tool + data), not just prose.
- Escalate to a human when a peer's request is ambiguous or high-risk.
