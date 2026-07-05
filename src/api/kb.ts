import { aiEmbed } from "@/lib/ai-providers";
import { getSql } from "@/lib/db";
import { searchKb } from "@/lib/kb";
import { requireAuth, resolveVenue } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export async function handleKbRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/kb")) return null;

  if (path === "/api/kb" && request.method === "GET") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const venue = await resolveVenue(request, env, url);
    const articles = await sql`
      SELECT id, title, body, tags, (embedding IS NOT NULL) AS embedded, created_at
      FROM kb_articles WHERE venue_id = ${venue} ORDER BY created_at DESC`;
    return json({ articles });
  }

  if (path === "/api/kb" && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const venue = await resolveVenue(request, env, url);
    const body = (await request.json()) as {
      venue?: string;
      title?: string;
      body?: string;
      tags?: string[];
    };
    if (!body.title?.trim() || !body.body?.trim()) {
      return json({ error: "title and body required" }, 400);
    }
    const targetVenue = venue;
    const vector = await aiEmbed(`${body.title}\n${body.body}`, env);
    const [article] = await sql`
      INSERT INTO kb_articles (venue_id, title, body, tags, embedding)
      VALUES (${targetVenue}, ${body.title}, ${body.body},
              ${body.tags ?? []}, ${vector ? JSON.stringify(vector) : null})
      RETURNING id`;
    return json({ id: article.id, embedded: vector !== null }, 201);
  }

  if (path === "/api/kb/search" && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const venue = await resolveVenue(request, env, url);
    const body = (await request.json()) as { venue?: string; query?: string };
    const hits = await searchKb(venue, String(body.query ?? ""), env);
    return json({ hits });
  }

  if (path.startsWith("/api/kb/") && request.method === "DELETE") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const venue = await resolveVenue(request, env, url);
    const id = path.slice("/api/kb/".length);
    await sql`DELETE FROM kb_articles WHERE id = ${id} AND venue_id = ${venue}`;
    return json({ ok: true });
  }

  return null;
}
