import { aiChat } from "@/lib/ai-providers";
import { getSql } from "@/lib/db";
import {
  buildReplyPrompt,
  clampRating,
  isNegative,
  summarizeReviews,
  type ReviewRow,
} from "@/lib/reviews";
import { venueFromPayload } from "@/lib/tenancy";
import { requireAuth, resolveVenue } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function validUuid(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function handleReviewsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/reviews")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // Public capture — the post-payment review prompt (pay / table / QR pages).
  if (url.pathname === "/api/reviews" && request.method === "POST") {
    const venue = await resolveVenue(request, env, url);
    const body = (await request.json().catch(() => ({}))) as {
      rating?: number;
      food?: number;
      service?: number;
      ambience?: number;
      value?: number;
      comment?: string;
      customerName?: string;
      phone?: string;
      staffId?: string;
      paymentId?: string;
      source?: string;
    };
    const rating = clampRating(body.rating);
    if (!rating) return json({ error: "rating 1-5 required" }, 400);
    const [row] = await sql`
      INSERT INTO reviews
        (venue_id, rating, food, service, ambience, value, comment,
         customer_name, phone, staff_id, payment_id, source)
      VALUES (${venue}, ${rating}, ${clampRating(body.food)}, ${clampRating(body.service)},
              ${clampRating(body.ambience)}, ${clampRating(body.value)},
              ${body.comment ?? null}, ${body.customerName ?? null}, ${body.phone ?? null},
              ${validUuid(body.staffId)}, ${body.paymentId ?? null}, ${body.source ?? "pay"})
      RETURNING id`;
    return json({ ok: true, id: row.id, negative: isNegative(rating) }, 201);
  }

  // Everything below is gated (dashboard).
  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);

  if (url.pathname === "/api/reviews" && request.method === "GET") {
    const rows = await sql`
      SELECT id, rating, food, service, ambience, value, comment, customer_name,
             phone, staff_id, payment_id, source, response, response_ai,
             responded_at, created_at
      FROM reviews WHERE venue_id = ${venue}
      ORDER BY created_at DESC LIMIT 200`;
    return json({
      reviews: rows,
      stats: summarizeReviews(rows as unknown as ReviewRow[]),
    });
  }

  // Reply to a review — provide `text`, or omit it for an AI-generated reply.
  const replyMatch = url.pathname.match(
    /^\/api\/reviews\/([0-9a-f-]{36})\/reply$/i,
  );
  if (replyMatch && request.method === "POST") {
    const id = replyMatch[1];
    const [rev] = await sql`
      SELECT id, rating, comment FROM reviews
      WHERE id = ${id} AND venue_id = ${venue}`;
    if (!rev) return json({ error: "review not found" }, 404);
    const body = (await request.json().catch(() => ({}))) as { text?: string };
    let text = typeof body.text === "string" ? body.text.trim() : "";
    let ai = false;
    if (!text) {
      const [v] = await sql`SELECT name FROM venues WHERE id = ${venue} LIMIT 1`;
      const venueName = (v?.name as string) || "our venue";
      text =
        (await aiChat(
          buildReplyPrompt(venueName, {
            rating: Number(rev.rating),
            comment: rev.comment as string | null,
          }),
          env,
        )) ?? "";
      ai = true;
      if (!text) return json({ error: "AI reply unavailable" }, 503);
    }
    await sql`
      UPDATE reviews SET response = ${text}, response_ai = ${ai}, responded_at = now()
      WHERE id = ${id} AND venue_id = ${venue}`;
    return json({ ok: true, response: text, ai });
  }

  return null;
}
