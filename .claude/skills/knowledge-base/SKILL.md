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

<!-- PRODUCTION_GO_LIVE_CONTRACT:START -->
<!-- PRODUCTION_GO_LIVE_DOMAIN: knowledge-base -->

## Production go-live ownership

This skill inherits the [Production Go-Live Capability Contract](../../../docs/PRODUCTION-GO-LIVE-CAPABILITIES.md)
(`PRODUCTION_GO_LIVE_CONTRACT: v1`). The
[Global Enterprise Roadmap](../../../docs/GLOBAL-ENTERPRISE-ROADMAP.md) defines delivery order, and the
[Global Readiness Review](../../../docs/GLOBAL-READINESS-REVIEW.md) records the current verdict.

It owns production acceptance for:

- Tenant-scoped article authoring, review, publication, versioning, permissions, ingestion, deletion, provenance, embedding freshness, retrieval quality, and rollback.
- Grounded answers that expose uncertainty, respect channel and role policy, cite approved sources where appropriate, resist prompt injection, and hand off when evidence is insufficient.

For every change in this domain:

- Preserve default-deny tenant, role, scope, capability, sensitivity, and audit policy.
- Test the applicable owner, manager, supervisor, staff, finance, customer, and partner journey, including denial, concurrency, duplicate, timeout, and recovery paths.
- Apply financial, API/SDK, device, accessibility, localization, observability, security, data-governance, and disaster-recovery gates wherever the change crosses those boundaries.
- Report only the evidence produced. Use designed, source complete, environment verified, production ready, and certified exactly as defined by the contract.

A capability is not production-ready until the applicable checklist passes in dev, prod-local, sandbox, and production with retained evidence. Follow the [deployment parity procedure](../../DEPLOYMENT-PARITY.md); never infer live readiness from source tests or a single environment.

<!-- PRODUCTION_GO_LIVE_CONTRACT:END -->
