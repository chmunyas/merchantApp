import { getSql } from "@/lib/db";
import { requireApiKey } from "@/lib/api-auth";
import { getVapidKeys, latestNotification, notifyStaff } from "@/lib/push";

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

export async function handlePushRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/push")) return null;

  const sql = getSql(env);
  const venue = url.searchParams.get("venue") ?? "main";

  // Public VAPID key for the browser's PushManager.subscribe().
  if (path === "/api/push/vapid" && request.method === "GET") {
    if (!sql) return json({ error: "database not configured" }, 503);
    const vapid = await getVapidKeys(sql, env);
    if (!vapid) return json({ error: "push unavailable" }, 503);
    return json({ publicKey: vapid.publicKey });
  }

  if (path === "/api/push/subscribe" && request.method === "POST") {
    if (!sql) return json({ error: "database not configured" }, 503);
    const body = (await request.json()) as {
      venue?: string;
      audience?: string;
      subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    };
    const sub = body.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return json({ error: "invalid subscription" }, 400);
    }
    await sql`
      INSERT INTO push_subscriptions (venue_id, endpoint, p256dh, auth, audience)
      VALUES (${body.venue ?? venue}, ${sub.endpoint}, ${sub.keys.p256dh},
              ${sub.keys.auth}, ${body.audience ?? "staff"})
      ON CONFLICT (endpoint) DO UPDATE
        SET venue_id = EXCLUDED.venue_id, audience = EXCLUDED.audience`;
    return json({ ok: true });
  }

  // The service worker fetches this on a payloadless push to get the text.
  if (path === "/api/push/latest" && request.method === "GET") {
    if (!sql) {
      return json({ title: "PesaSwap", body: "You have a new notification" });
    }
    return json(await latestNotification(sql, venue));
  }

  if (path === "/api/push/test" && request.method === "POST") {
    const denied = requireApiKey(request, env);
    if (denied) return denied;
    await notifyStaff(
      env,
      venue,
      "Test notification",
      "Your PesaSwap alerts are working.",
    );
    return json({ ok: true });
  }

  return null;
}
