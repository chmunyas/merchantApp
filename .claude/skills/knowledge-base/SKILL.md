---
name: knowledge-base
description: >-
  Manage the venue knowledge base (RAG) the agent uses to answer FAQs — articles,
  embeddings and semantic search. Use when a task mentions the knowledge base,
  FAQs, articles, embeddings, RAG, or "how does the agent know X".
---

# Knowledge base (RAG)

The agent's FAQ brain — venue-scoped articles with pgvector embeddings.

## Key files
- `src/api/kb.ts` — `/api/kb` (GET/POST), `/api/kb/search` (POST), `/api/kb/:id`
  (DELETE). All gated except none — writes/search are gated.
- `src/lib/kb.ts` — `searchKb(venue, query, env)` (vector search).
- `src/lib/ai-providers.ts` — `aiEmbed(text, env)`.
- `db/01-schema.sql` — `kb_articles` (title, body, tags, `embedding vector`).
- `src/routes/dashboard/knowledge.tsx` — the editor + search UI.

## Endpoints (venue-scoped)
- `GET /api/kb?venue=` — list articles (send the token).
- `POST /api/kb` — **gated**; embeds on write (`aiEmbed`).
- `POST /api/kb/search` — **gated**; semantic search.
- `DELETE /api/kb/:id` — **gated**.

## Conventions
- Venue from JWT (`resolveVenue`). The agent calls `searchKb` directly (lib), so
  gating the HTTP routes doesn't break retrieval.
- Embeddings use the configured AI provider; a null embedding falls back to text
  search — handle both.

## Guidelines
- Re-embed on article edit (title+body).
- Keep articles short and answer-shaped; tag them for retrieval.

## Definition of Done — full parity
A feature is not done until it has **full parity across all three runtime tiers** —
validated (typecheck + unit tests) and deployed + verified on dev (localhost:8080),
the prod-local workerd mirror (localhost:8787) and Cloudflare production, with any
`db/*.sql` migration applied to dev, prod-local **and** Neon. See
`.claude/DEPLOYMENT-PARITY.md`.
