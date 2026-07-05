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
- `src/api/menu.ts` — `GET /api/menu`, gated `POST /api/menu/sync` (replace-all).
- `src/lib/menu.ts` — `getMenu(sql, venue)`.
- `src/routes/dashboard/menu.tsx` — the editor; pushes via `authFetch` to sync.
- `db/01-schema.sql` — `menu_items` (name, category, price, dietary[], available).

## Endpoints
- `GET /api/menu?venue=` — the agent + customer menu view.
- `POST /api/menu/sync?venue=` — **gated**; replace-all for the venue.

## Conventions
- Sync is **replace-all** for the resolved venue (`resolveVenue`) — send the token.
- The agent reads menu via the lib (`getMenu`), so protecting the HTTP route
  doesn't break the agent.
- Prices are numeric; dietary is a string array.

## Guidelines
- Filter out items without a name/price on sync.
- Keep availability + dietary tags so the agent can answer "vegan options?".
