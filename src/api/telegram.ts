import { getTelegramConfig } from "@/lib/channels/telegram-config";
import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { roleAtLeast } from "@/lib/rbac";
import { requireHumanAuth, venueFromPayload } from "@/api/auth";
import { registerChannelAccount } from "@/lib/venue-routing";

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
    const getPayload = await requireHumanAuth(request, env);
    if (!getPayload || !roleAtLeast(getPayload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    const getVenue = venueFromPayload(getPayload, url);
    const cfg = await getTelegramConfig(env, getVenue);
    return json({
      hasToken: Boolean(cfg.botToken),
      bridgeEnabled: Boolean(cfg.bridgeUrl),
    });
  }

  if (path === "/api/telegram/config" && request.method === "POST") {
    const cfgPayload = await requireHumanAuth(request, env);
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
    const statusPayload = await requireHumanAuth(request, env);
    if (!statusPayload || !roleAtLeast(statusPayload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    const statusVenue = venueFromPayload(statusPayload, url);
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
        result?: { id?: number; username?: string; first_name?: string };
        description?: string;
      };
      if (data.ok && data.result) {
        if (data.result.id != null) {
          await registerChannelAccount(
            env,
            "telegram",
            String(data.result.id),
            statusVenue,
            "telegram_get_me",
          );
        }
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
    const setPayload = await requireHumanAuth(request, env);
    if (!setPayload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(setPayload, "merchant")) return json({ error: "forbidden" }, 403);
    const cfg = await getTelegramConfig(env, venueFromPayload(setPayload, url));
    if (!cfg.botToken) return json({ ok: false, error: "No bot token set." });
    const me = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getMe`)
      .then((response) => response.json()) as { ok?: boolean; result?: { id?: number } };
    if (!me.ok || me.result?.id == null) {
      return json({ ok: false, error: "Could not verify Telegram bot." });
    }
    const venue = venueFromPayload(setPayload, url);
    await registerChannelAccount(
      env,
      "telegram",
      String(me.result.id),
      venue,
      "telegram_get_me",
    );
    const webhookUrl = `${url.origin}/api/channel-webhooks/telegram/${encodeURIComponent(String(me.result.id))}`;
    try {
      // When TELEGRAM_WEBHOOK_SECRET is configured, register it as Telegram's
      // secret_token so every inbound carries X-Telegram-Bot-Api-Secret-Token —
      // which the inbound route verifies. Without this, setting the secret would
      // (correctly) reject all inbound because Telegram never sends the header.
      const secret = envVar(env, "TELEGRAM_WEBHOOK_SECRET");
      const setUrl =
        `https://api.telegram.org/bot${cfg.botToken}/setWebhook` +
        `?url=${encodeURIComponent(webhookUrl)}` +
        (secret ? `&secret_token=${encodeURIComponent(secret)}` : "");
      const res = await fetch(setUrl);
      const data = (await res.json()) as { ok?: boolean; description?: string };
      return json({ ok: data.ok === true, description: data.description, webhookUrl });
    } catch {
      return json({ ok: false, error: "Could not reach Telegram." });
    }
  }

  if (path === "/api/telegram/webhook/delete" && request.method === "POST") {
    const delPayload = await requireHumanAuth(request, env);
    if (!delPayload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(delPayload, "merchant")) return json({ error: "forbidden" }, 403);
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
