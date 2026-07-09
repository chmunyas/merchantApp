import {
  getAdapter,
  parseWhatsappInbound,
  verifyWhatsappWebhook,
} from "@/lib/channels";
import { getWhatsappConfig } from "@/lib/channels/whatsapp-config";
import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { processInbound } from "@/lib/inbound";
import { verifyHubSignature, verifyToken } from "@/lib/webhook-verify";
import { roleAtLeast } from "@/lib/rbac";
import {
  registerChannelAccount,
  resolveVenueForAccount,
} from "@/lib/venue-routing";
import { requireAuth, resolveVenue, venueFromPayload } from "@/api/auth";

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

export async function handleWhatsappRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/whatsapp")) return null;

  // Inbound message forwarded by the Baileys bridge service.
  if (path === "/api/whatsapp/bridge/inbound" && request.method === "POST") {
    const bridgeSecret = envVar(env, "BRIDGE_SECRET");
    if (
      bridgeSecret &&
      !verifyToken(request.headers.get("x-webhook-secret"), bridgeSecret)
    ) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as {
      venue?: string;
      from?: string;
      name?: string;
      text?: string;
      id?: string;
    };
    if (body.from && body.text) {
      await processInbound(
        {
          channel: "whatsapp",
          handle: body.from,
          platformUserId: body.from,
          name: body.name ?? null,
          text: String(body.text),
          providerMsgId: body.id ? `wa:${body.id}` : null,
        },
        body.venue ?? "main",
        env,
      );
    }
    return json({ ok: true });
  }

  // Proxy the bridge control API to the dashboard (status / qr / logout).
  if (path.startsWith("/api/whatsapp/bridge/")) {
    const bridgeUrl = envVar(env, "WHATSAPP_BRIDGE_URL");
    if (!bridgeUrl) return json({ enabled: false });
    const sub = path.slice("/api/whatsapp/bridge/".length);
    try {
      const res = await fetch(`${bridgeUrl}/${sub}`, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: request.method === "POST" ? "{}" : undefined,
      });
      return json(await res.json(), res.status);
    } catch {
      return json({ enabled: true, status: "offline" });
    }
  }

  // WhatsApp Cloud API config (dashboard connection wizard).
  if (path === "/api/whatsapp/config" && request.method === "GET") {
    // Optional auth: an authed merchant sees THEIR store's config; otherwise the
    // global default (non-breaking for any unauthenticated caller).
    const getPayload = await requireAuth(request, env);
    const getVenue = getPayload ? venueFromPayload(getPayload, url) : undefined;
    const cfg = await getWhatsappConfig(env, getVenue);
    return json({
      hasToken: Boolean(cfg.token),
      phoneId: cfg.phoneId ?? "",
      verifyToken: cfg.verifyToken,
      webhookUrl: `${url.origin}/api/whatsapp/webhook`,
      bridgeEnabled: Boolean(cfg.bridgeUrl),
      transport: cfg.transport,
    });
  }
  if (path === "/api/whatsapp/config" && request.method === "POST") {
    const cfgPayload = await requireAuth(request, env);
    if (!cfgPayload) return json({ error: "unauthorized" }, 401);
    // Channel API keys are an owner-only setting.
    if (!roleAtLeast(cfgPayload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const venue = venueFromPayload(cfgPayload, url);
    const body = (await request.json()) as {
      token?: string;
      phoneId?: string;
      verifyToken?: string;
      transport?: string;
    };
    const current = await getWhatsappConfig(env, venue);
    const transport =
      body.transport === "auto" ||
      body.transport === "bridge" ||
      body.transport === "cloud"
        ? body.transport
        : current.transport;
    const value = {
      token: body.token?.trim() ? body.token.trim() : current.token ?? "",
      phoneId: body.phoneId?.trim() ? body.phoneId.trim() : current.phoneId ?? "",
      verifyToken: body.verifyToken?.trim()
        ? body.verifyToken.trim()
        : current.verifyToken,
      transport,
    };
    // Store per-venue so each store runs its own WhatsApp number.
    await sql`
      INSERT INTO app_settings (key, value)
      VALUES (${`whatsapp_cloud:${venue}`}, ${sql.json(value)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    // Route inbound to this WhatsApp number to the configuring venue, so a
    // customer messaging this store reaches this store's agent (multi-venue).
    if (value.phoneId) {
      await registerChannelAccount(env, "whatsapp", value.phoneId, venue);
    }
    return json({ ok: true });
  }

  // Verify the Cloud API credentials against Meta.
  if (path === "/api/whatsapp/test" && request.method === "POST") {
    const testPayload = await requireAuth(request, env);
    if (!testPayload) {
      return json({ error: "unauthorized" }, 401);
    }
    const cfg = await getWhatsappConfig(env, venueFromPayload(testPayload, url));
    if (!cfg.token || !cfg.phoneId) {
      return json({ ok: false, error: "Add a token and phone number ID first." });
    }
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${cfg.phoneId}?fields=display_phone_number,verified_name`,
        { headers: { authorization: `Bearer ${cfg.token}` } },
      );
      const data = (await res.json()) as {
        display_phone_number?: string;
        verified_name?: string;
        error?: { message?: string };
      };
      if (res.ok && data.display_phone_number) {
        return json({
          ok: true,
          number: data.display_phone_number,
          name: data.verified_name ?? null,
        });
      }
      return json({ ok: false, error: data.error?.message ?? "Verification failed." });
    } catch {
      return json({ ok: false, error: "Could not reach Meta." });
    }
  }

  // Meta webhook verification handshake.
  if (path === "/api/whatsapp/webhook" && request.method === "GET") {
    return await verifyWhatsappWebhook(url, env);
  }

  // Inbound messages from the WhatsApp Cloud API.
  if (path === "/api/whatsapp/webhook" && request.method === "POST") {
    const rawBody = await request.text();
    const appSecret = envVar(env, "WHATSAPP_APP_SECRET");
    if (
      appSecret &&
      !(await verifyHubSignature(
        rawBody,
        request.headers.get("X-Hub-Signature-256"),
        appSecret,
      ))
    ) {
      return json({ error: "unauthorized" }, 401);
    }
    try {
      const body = JSON.parse(rawBody);
      // Route each inbound to the venue that owns the RECEIVING number, so a
      // customer messaging store A reaches store A (falls back to "main" when the
      // number isn't registered — preserving single-venue behaviour).
      const phoneNumberId =
        body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
      const venue = await resolveVenueForAccount(env, "whatsapp", phoneNumberId);
      for (const message of parseWhatsappInbound(body)) {
        await processInbound(message, venue, env);
      }
    } catch {
      // Always 200 so WhatsApp does not retry a malformed event.
    }
    return json({ received: true });
  }

  // Local simulator — drives the exact same pipeline without a Meta account.
  if (path === "/api/whatsapp/simulate" && request.method === "POST") {
    const body = (await request.json()) as {
      venue?: string;
      from?: string;
      name?: string;
      text?: string;
    };
    const from = body.from ?? "+254712345678";
    const result = await processInbound(
      {
        channel: "whatsapp",
        handle: from,
        platformUserId: from,
        name: body.name ?? null,
        text: String(body.text ?? ""),
        providerMsgId: null,
      },
      body.venue ?? "main",
      env,
    );
    return json(result);
  }

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = await resolveVenue(request, env, url);

  if (path === "/api/whatsapp/conversations" && request.method === "GET") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const conversations = await sql`
      SELECT c.id, c.wa_id, c.name, c.role, c.status, c.channel, c.last_message_at,
             (SELECT body FROM messages m WHERE m.conversation_id = c.id
              ORDER BY created_at DESC LIMIT 1) AS last_message
      FROM conversations c
      WHERE c.venue_id = ${venue}
      ORDER BY c.last_message_at DESC`;
    return json({ conversations });
  }

  if (path === "/api/whatsapp/messages" && request.method === "GET") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const conversationId = url.searchParams.get("conversation");
    if (!conversationId) return json({ error: "conversation required" }, 400);
    // Scope by venue via the conversation so a UUID from another tenant (which
    // the conversations list hands out) cannot be used to read its messages.
    const messages = await sql`
      SELECT m.id, m.direction, m.body, m.ai, m.tool, m.channel, m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ${conversationId} AND c.venue_id = ${venue}
      ORDER BY m.created_at`;
    return json({ messages });
  }

  // Staff takeover — send a manual reply on the conversation's own channel.
  if (path === "/api/whatsapp/reply" && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as {
      conversation?: string;
      text?: string;
    };
    if (!body.conversation || !body.text?.trim()) {
      return json({ error: "conversation and text required" }, 400);
    }
    const [conversation] = await sql`
      SELECT wa_id, channel FROM conversations
      WHERE id = ${body.conversation} AND venue_id = ${venue}`;
    if (!conversation) return json({ error: "conversation not found" }, 404);

    await sql`
      INSERT INTO messages (conversation_id, direction, body, ai, channel)
      VALUES (${body.conversation}, 'outbound', ${body.text}, false, ${conversation.channel})`;
    await sql`
      UPDATE conversations SET last_message_at = now(), status = 'open'
      WHERE id = ${body.conversation}`;

    let delivery = "pull";
    try {
      const out = await getAdapter(conversation.channel).send(
        conversation.wa_id,
        body.text,
        env,
        venue,
      );
      delivery = out.delivery;
    } catch {
      delivery = "simulated";
    }
    return json({ ok: true, delivery });
  }

  return null;
}
