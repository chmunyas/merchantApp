import { getTelegramConfig } from "@/lib/channels/telegram-config";
import { getSql } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";
import { requireAuth, venueFromPayload } from "@/api/auth";

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

// Telegram connection management. The inbound webhook itself (/api/telegram/
// webhook) is served by the generic channel route, so this handler only owns
// the /config, /status and /webhook/{set,delete} control paths.
export async function handleTelegramRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/telegram/config" && request.method === "GET") {
    const getPayload = await requireAuth(request, env);
    const getVenue = getPayload ? venueFromPayload(getPayload, url) : undefined;
    const cfg = await getTelegramConfig(env, getVenue);
    return json({
      hasToken: Boolean(cfg.botToken),
      bridgeEnabled: Boolean(cfg.bridgeUrl),
    });
  }

  if (path === "/api/telegram/config" && request.method === "POST") {
    const cfgPayload = await requireAuth(request, env);
    if (!cfgPayload) return json({ error: "unauthorized" }, 401);
    // Bot token is an owner-only setting.
    if (!roleAtLeast(cfgPayload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const venue = venueFromPayload(cfgPayload, url);
    const body = (await request.json()) as { botToken?: string };
    const token = String(body.botToken ?? "").trim();
    // Store per-venue so each store runs its own Telegram bot.
    await sql`
      INSERT INTO app_settings (key, value)
      VALUES (${`telegram:${venue}`}, ${sql.json({ botToken: token })})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    return json({ ok: true });
  }

  // Verify the token against Telegram (getMe) — returns the bot's @username.
  if (path === "/api/telegram/status" && request.method === "GET") {
    const statusPayload = await requireAuth(request, env);
    const statusVenue = statusPayload
      ? venueFromPayload(statusPayload, url)
      : undefined;
    const cfg = await getTelegramConfig(env, statusVenue);
    if (!cfg.botToken) {
      return json({ connected: false, error: "No bot token set." });
    }
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${cfg.botToken}/getMe`,
      );
      const data = (await res.json()) as {
        ok?: boolean;
        result?: { username?: string; first_name?: string };
        description?: string;
      };
      if (data.ok && data.result) {
        return json({
          connected: true,
          username: data.result.username,
          name: data.result.first_name,
          mode: "polling",
        });
      }
      return json({ connected: false, error: data.description ?? "Invalid token." });
    } catch {
      return json({ connected: false, error: "Could not reach Telegram." });
    }
  }

  // Production: register a public webhook (replaces long polling).
  if (path === "/api/telegram/webhook/set" && request.method === "POST") {
    const setPayload = await requireAuth(request, env);
    if (!setPayload) {
      return json({ error: "unauthorized" }, 401);
    }
    const cfg = await getTelegramConfig(env, venueFromPayload(setPayload, url));
    if (!cfg.botToken) return json({ ok: false, error: "No bot token set." });
    const webhookUrl = `${url.origin}/api/telegram/webhook`;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${cfg.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`,
      );
      const data = (await res.json()) as { ok?: boolean; description?: string };
      return json({ ok: data.ok === true, description: data.description, webhookUrl });
    } catch {
      return json({ ok: false, error: "Could not reach Telegram." });
    }
  }

  if (path === "/api/telegram/webhook/delete" && request.method === "POST") {
    const delPayload = await requireAuth(request, env);
    if (!delPayload) {
      return json({ error: "unauthorized" }, 401);
    }
    const cfg = await getTelegramConfig(env, venueFromPayload(delPayload, url));
    if (!cfg.botToken) return json({ ok: false, error: "No bot token set." });
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${cfg.botToken}/deleteWebhook`,
      );
      const data = (await res.json()) as { ok?: boolean };
      return json({ ok: data.ok === true });
    } catch {
      return json({ ok: false, error: "Could not reach Telegram." });
    }
  }

  return null;
}
