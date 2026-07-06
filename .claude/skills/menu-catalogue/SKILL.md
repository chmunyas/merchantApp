---
name: menu-catalogue
description: >-
  Manage the menu / catalogue — items, categories, prices, dietary tags and
  availability — and keep the AI agent's menu in sync. Use when a task mentions
  the menu, catalogue, items, prices, or "what's on the menu" customer questions.
---

# Menu & catalogue

The agent answers menu/price questions from the same `menu_items` the dashboard
edits.

## Key files
- `src/api/menu.ts` — `GET /api/menu`, per-item CRUD (`POST /api/menu/item`,
  `PATCH`/`DELETE /api/menu/item/:id`), plus gated `POST /api/menu/sync`.
- `src/lib/menu.ts` — `getMenu(sql, venue)`.
- `src/routes/dashboard/menu.tsx` — the editor; server-authoritative via `authFetch`.
- `db/01-schema.sql` / `db/22-menu-item-id.sql` — `menu_items` (id, name, category,
  price, dietary[], available).

## Endpoints
- `GET /api/menu?venue=` — the agent + customer menu view.
- `POST /api/menu/item` — **gated**; create one item (server-authoritative).
- `PATCH /api/menu/item/:id` — **gated**; partial update, no whole-array clobber.
- `DELETE /api/menu/item/:id` — **gated**; remove one item.
- `POST /api/menu/sync?venue=` — **gated**; legacy replace-all (agent back-compat).

## Conventions
- Prefer per-item CRUD (the DB is the source of truth) over the replace-all sync.
- Sync remains for the AI agent's menu import — it is **replace-all** for the
  resolved venue (`resolveVenue`); send the token.
- The agent reads menu via the lib (`getMenu`), so protecting the HTTP route
  doesn't break the agent.
- Prices are numeric minor units (KES); dietary is a string array.

## Guidelines
- Filter out items without a name/price on sync.
- Keep availability + dietary tags so the agent can answer "vegan options?".

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
