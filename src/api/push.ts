import { getSql } from "@/lib/db";
import { getVapidKeys, latestNotification, notifyStaff } from "@/lib/push";
import { requireHumanAuth } from "@/api/auth";
import { roleAtLeast } from "@/lib/rbac";
import { principalVenue } from "@/lib/tenancy";
import { generateDeviceToken, hashDeviceToken } from "@/lib/device-token";

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

  // Public VAPID key for the browser's PushManager.subscribe().
  if (path === "/api/push/vapid" && request.method === "GET") {
    if (!sql) return json({ error: "database not configured" }, 503);
    const vapid = await getVapidKeys(sql, env);
    if (!vapid) return json({ error: "push unavailable" }, 503);
    return json({ publicKey: vapid.publicKey });
  }

  if (path === "/api/push/subscribe" && request.method === "POST") {
    if (!sql) return json({ error: "database not configured" }, 503);
    const payload = await requireHumanAuth(request, env);
    if (!payload || !roleAtLeast(payload, "staff")) {
      return json({ error: "unauthorized" }, 401);
    }
    const venue = principalVenue(payload);
    if (!venue) return json({ error: "venue claim required" }, 403);
    const body = (await request.json()) as {
      venue?: string;
      audience?: string;
      subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    };
    const sub = body.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return json({ error: "invalid subscription" }, 400);
    }
    const [existing] = await sql`
      SELECT principal_sub FROM push_subscriptions
      WHERE endpoint = ${sub.endpoint}
      LIMIT 1`;
    if (existing && String(existing.principal_sub ?? "") !== payload.sub) {
      return json({ error: "subscription belongs to another principal" }, 409);
    }
    const deviceToken = generateDeviceToken();
    const deviceTokenHash = await hashDeviceToken(deviceToken);
    await sql`
      INSERT INTO push_subscriptions
        (venue_id, endpoint, p256dh, auth, audience, device_token_hash,
         principal_sub, staff_id, updated_at)
      VALUES (${venue}, ${sub.endpoint}, ${sub.keys.p256dh},
              ${sub.keys.auth}, ${body.audience ?? "staff"}, ${deviceTokenHash},
              ${payload.sub}, ${payload.staffId ?? null}, now())
      ON CONFLICT (endpoint) DO UPDATE
        SET venue_id = EXCLUDED.venue_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            audience = EXCLUDED.audience,
            device_token_hash = EXCLUDED.device_token_hash,
            principal_sub = EXCLUDED.principal_sub,
            staff_id = EXCLUDED.staff_id,
            updated_at = now()`;
    return json({ ok: true, deviceToken });
  }

  // The service worker fetches this on a payloadless push to get the text.
  if (path === "/api/push/latest" && request.method === "GET") {
    if (!sql) return json({ error: "database not configured" }, 503);
    const token = request.headers.get("x-push-device-token") ?? "";
    if (!/^[a-f0-9]{64}$/i.test(token)) return json({ error: "unauthorized" }, 401);
    const tokenHash = await hashDeviceToken(token);
    const [subscription] = await sql`
      SELECT venue_id FROM push_subscriptions
      WHERE device_token_hash = ${tokenHash}
      LIMIT 1`;
    if (!subscription) return json({ error: "unauthorized" }, 401);
    const venue = String(subscription.venue_id);
    return json(await latestNotification(sql, venue));
  }

  if (path === "/api/push/test" && request.method === "POST") {
    const payload = await requireHumanAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);
    const venue = principalVenue(payload);
    if (!venue) return json({ error: "venue claim required" }, 403);
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
