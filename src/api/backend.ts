import { getAi, getSql, hasDatabase } from "@/lib/db";
import { aiChat, activeProvider } from "@/lib/ai-providers";
import { requireAuth, resolveVenue } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Embed text with Workers AI (bge-base-en-v1.5 -> 768 dims). Null when the AI
// binding is unavailable (local dev without Cloudflare), so callers fall back.
async function embed(text: string, env: unknown): Promise<number[] | null> {
  const ai = getAi(env);
  if (!ai || !text.trim()) return null;
  try {
    const result = (await ai.run("@cf/baai/bge-base-en-v1.5", {
      text: [text],
    })) as { data?: number[][] };
    return result?.data?.[0] ?? null;
  } catch {
    return null;
  }
}

// Natural-language operations agent. Runs real SQL against Postgres; falls back
// to Workers AI (Llama) for anything the rule-based intents don't cover.
async function runAiCommand(
  text: string,
  venue: string,
  env: unknown,
): Promise<Record<string, unknown>> {
  const sql = getSql(env);
  if (!sql) return { reply: "Cloud database is not configured." };
  const t = text.toLowerCase();
  try {
    if (/(cover|guest)/.test(t) && /today/.test(t)) {
      const [row] = await sql`
        SELECT count(*)::int AS bookings, coalesce(sum(covers),0)::int AS covers
        FROM reservations
        WHERE venue_id = ${venue} AND date = CURRENT_DATE AND status <> 'cancelled'`;
      return {
        reply: `Today you have ${row.bookings} bookings for ${row.covers} covers.`,
        data: row,
      };
    }
    if (/booking|reservation/.test(t)) {
      const [row] = await sql`
        SELECT count(*)::int AS bookings, coalesce(sum(covers),0)::int AS covers
        FROM reservations WHERE venue_id = ${venue} AND date = CURRENT_DATE`;
      return { reply: `Today: ${row.bookings} bookings, ${row.covers} covers.`, data: row };
    }
    if (/enquir/.test(t)) {
      const [row] = await sql`
        SELECT count(*)::int AS n FROM enquiries
        WHERE venue_id = ${venue} AND status = 'new'`;
      return { reply: `You have ${row.n} new enquiries.`, data: row };
    }
    if (/vip|top|spend|loyal/.test(t)) {
      const rows = await sql`
        SELECT name, tier, total_spent FROM contacts
        WHERE venue_id = ${venue} ORDER BY total_spent DESC LIMIT 3`;
      return {
        reply: `Top spenders: ${rows
          .map((r) => `${r.name} (${r.tier})`)
          .join(", ")}.`,
        data: rows,
      };
    }
    if (/contact|customer/.test(t)) {
      const [row] = await sql`
        SELECT count(*)::int AS n FROM contacts WHERE venue_id = ${venue}`;
      return { reply: `You have ${row.n} contacts.`, data: row };
    }

    const reply = await aiChat(
      [
        {
          role: "system",
          content: "You are a concise restaurant back-office assistant.",
        },
        { role: "user", content: text },
      ],
      env,
    );
    if (reply) {
      return { reply, via: activeProvider(env) };
    }

    return {
      reply:
        "Try: 'covers today', 'new enquiries', 'top spenders', or 'how many contacts'.",
    };
  } catch (error) {
    return { reply: "That query failed.", error: errorMessage(error) };
  }
}

export async function handleBackendRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const venue = await resolveVenue(request, env, url);

  if (path === "/api/health" && request.method === "GET") {
    const sql = getSql(env);
    if (!sql) return json({ ok: false, database: "not-configured" });
    try {
      const [row] = await sql`SELECT count(*)::int AS venues FROM venues`;
      return json({ ok: true, database: "postgres", venues: row.venues });
    } catch (error) {
      return json({ ok: false, database: "error", error: errorMessage(error) }, 500);
    }
  }

  if (path === "/api/contacts") {
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    try {
      if (request.method === "GET") {
        const contacts = await sql`
          SELECT id, name, phone, email, tier, points, total_spent, visits,
                 last_visit, tags
          FROM contacts WHERE venue_id = ${venue}
          ORDER BY total_spent DESC`;
        return json({ contacts });
      }
      if (request.method === "POST") {
        const body = (await request.json()) as {
          name?: string;
          phone?: string;
          email?: string;
          tier?: string;
        };
        if (!body.name?.trim()) return json({ error: "name is required" }, 400);
        const [contact] = await sql`
          INSERT INTO contacts (venue_id, name, phone, email, tier)
          VALUES (${venue}, ${body.name.trim()}, ${body.phone ?? null},
                  ${body.email ?? null}, ${body.tier ?? "Bronze"})
          RETURNING id, name, phone, email, tier, points, total_spent, visits,
                    last_visit, tags`;
        return json({ contact }, 201);
      }
    } catch (error) {
      return json({ error: errorMessage(error) }, 500);
    }
  }

  if (path === "/api/ai/command" && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as { text?: string };
    return json(await runAiCommand(String(body.text ?? ""), venue, env));
  }

  // Public: customer booking enquiries land here (Postgres-backed, venue-scoped)
  // so the back office and AI agent see the same requests.
  if (path === "/api/enquiries") {
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    try {
      if (request.method === "GET") {
        const enquiries = await sql`
          SELECT id, customer_name, phone, covers, date, time, notes,
                 status, source, created_at
          FROM enquiries WHERE venue_id = ${venue}
          ORDER BY created_at DESC LIMIT 200`;
        return json({ enquiries });
      }
      if (request.method === "POST") {
        const body = (await request.json()) as {
          venue?: string;
          customerName?: string;
          phone?: string;
          covers?: number;
          date?: string;
          time?: string;
          notes?: string;
        };
        if (!body.customerName?.trim()) {
          return json({ error: "name is required" }, 400);
        }
        const [row] = await sql`
          INSERT INTO enquiries
            (venue_id, customer_name, phone, covers, date, time, notes, source)
          VALUES (${body.venue ?? venue}, ${body.customerName.trim()},
                  ${body.phone?.trim() || null}, ${Number(body.covers ?? 2)},
                  ${body.date || new Date().toISOString().slice(0, 10)},
                  ${body.time || "19:00"}, ${body.notes?.trim() || null}, 'web')
          RETURNING id, created_at`;
        return json({ id: row.id, created_at: row.created_at }, 201);
      }
    } catch (error) {
      return json({ error: errorMessage(error) }, 500);
    }
  }

  if (path === "/api/memory") {
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    try {
      if (request.method === "POST") {
        const body = (await request.json()) as {
          content?: string;
          metadata?: unknown;
        };
        const content = String(body.content ?? "").trim();
        if (!content) return json({ error: "content is required" }, 400);
        const vector = await embed(content, env);
        const [memory] = await sql`
          INSERT INTO ai_memory (venue_id, content, embedding, metadata)
          VALUES (${venue}, ${content},
                  ${vector ? JSON.stringify(vector) : null},
                  ${JSON.stringify(body.metadata ?? {})}::jsonb)
          RETURNING id, content`;
        return json({ memory, embedded: vector !== null }, 201);
      }
      if (request.method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        const vector = await embed(q, env);
        if (vector) {
          const results = await sql`
            SELECT content, metadata,
                   1 - (embedding <=> ${JSON.stringify(vector)}::vector) AS score
            FROM ai_memory
            WHERE venue_id = ${venue} AND embedding IS NOT NULL
            ORDER BY embedding <=> ${JSON.stringify(vector)}::vector
            LIMIT 5`;
          return json({ results, mode: "vector" });
        }
        const results = await sql`
          SELECT content, metadata FROM ai_memory
          WHERE venue_id = ${venue} AND content ILIKE ${"%" + q + "%"}
          ORDER BY created_at DESC LIMIT 5`;
        return json({ results, mode: "keyword" });
      }
    } catch (error) {
      return json({ error: errorMessage(error) }, 500);
    }
  }

  return null;
}

export { hasDatabase };
