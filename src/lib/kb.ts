import { aiEmbed } from "@/lib/ai-providers";
import { getSql } from "@/lib/db";

export type KbHit = { title: string; body: string; score: number };

// Search the knowledge base. Uses pgvector cosine similarity when an embedding
// provider is available; otherwise falls back to Postgres full-text search
// (websearch_to_tsquery) so it always works locally without an AI provider.
export async function searchKb(
  venue: string,
  query: string,
  env: unknown,
  limit = 3,
): Promise<KbHit[]> {
  const sql = getSql(env);
  if (!sql || !query.trim()) return [];

  const vector = await aiEmbed(query, env);
  if (vector) {
    const vec = JSON.stringify(vector);
    const rows = await sql`
      SELECT title, body,
             1 - (embedding <=> ${vec}::vector) AS score
      FROM kb_articles
      WHERE venue_id = ${venue} AND embedding IS NOT NULL
        AND (1 - (embedding <=> ${vec}::vector)) >= 0.5
      ORDER BY embedding <=> ${vec}::vector
      LIMIT ${limit}`;
    if (rows.length > 0) {
      return rows.map((r) => ({
        title: r.title,
        body: r.body,
        score: Number(r.score),
      }));
    }
  }

  const rows = await sql`
    SELECT title, body,
           ts_rank(tsv, websearch_to_tsquery('english', ${query})) AS score
    FROM kb_articles
    WHERE venue_id = ${venue}
      AND tsv @@ websearch_to_tsquery('english', ${query})
    ORDER BY score DESC
    LIMIT ${limit}`;
  if (rows.length > 0) {
    return rows.map((r) => ({
      title: r.title,
      body: r.body,
      score: Number(r.score),
    }));
  }

  // OR word-match fallback (better recall than AND full-text, e.g. "park my
  // car" still finds the Parking article). Scored by how many words hit.
  const stop = new Set([
    "the", "and", "you", "your", "our", "are", "can", "for", "with", "what",
    "where", "when", "how", "why", "who", "have", "has", "does", "did", "any",
    "this", "that", "there", "here", "please", "would", "could", "should",
    "get", "got", "was", "were", "will", "shall", "may", "might", "must",
  ]);
  const words = Array.from(
    new Set((query.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !stop.has(w))),
  );
  if (words.length === 0) return [];
  const wordRows = await sql`
    SELECT title, body,
           (SELECT count(*) FROM unnest(${words}::text[]) w
            WHERE lower(title || ' ' || body) LIKE '%' || w || '%')::int AS score
    FROM kb_articles
    WHERE venue_id = ${venue}
      AND EXISTS (SELECT 1 FROM unnest(${words}::text[]) w
                  WHERE lower(title || ' ' || body) LIKE '%' || w || '%')
    ORDER BY score DESC
    LIMIT ${limit}`;
  return wordRows.map((r) => ({
    title: r.title,
    body: r.body,
    score: Number(r.score),
  }));
}
