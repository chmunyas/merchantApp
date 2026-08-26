import {
  parseWhatsappInbound,
  verifyWhatsappWebhook,
} from "@/lib/channels";
import { getWhatsappConfig } from "@/lib/channels/whatsapp-config";
import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { processInbound } from "@/lib/inbound";
import { persistIngress } from "@/lib/channel-ingress";
import { verifyHubSignature, verifyToken } from "@/lib/webhook-verify";
import { roleAtLeast } from "@/lib/rbac";
import {
  registerChannelAccount,
  resolveVenueForAccount,
} from "@/lib/venue-routing";
import { requireAuth, requireHumanAuth, resolveVenue, venueFromPayload } from "@/api/auth";
import { simulatorsAllowed } from "@/lib/runtime-security";
import { tokenHasScope } from "@/lib/api-tokens";
import { queueOutbound } from "@/lib/outbound-jobs";
import { applyDeliveryReceipt } from "@/lib/outbound-jobs";

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

async function stableBridgeEventId(body: {
  accountId?: string;
  from?: string;
  text?: string;
  id?: string;
}): Promise<string> {
  if (body.id) return `wa:${body.id}`;
  const material = `${body.accountId ?? ""}\0${body.from ?? ""}\0${body.text ?? ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return `bridge:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
    const bridgeSecret =
      envVar(env, "BRIDGE_SECRET") || envVar(env, "WHATSAPP_BRIDGE_TOKEN");
    if (!bridgeSecret && !simulatorsAllowed(env)) {
      return json({ error: "service unavailable" }, 503);
    }
    if (
      bridgeSecret &&
      !verifyToken(request.headers.get("x-webhook-secret"), bridgeSecret)
    ) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as {
      accountId?: string;
      from?: string;
      name?: string;
      text?: string;
      id?: string;
    };
    const venue = await resolveVenueForAccount(env, "whatsapp", body.accountId);
    if (!body.accountId || !venue) {
      return json({ error: "unknown receiving account" }, 404);
    }
    if (body.from && body.text) {
      await persistIngress(env, {
        channel: "whatsapp",
        accountId: body.accountId,
        venue,
        providerEventId: await stableBridgeEventId(body),
        message: {
          channel: "whatsapp",
          handle: body.from,
          platformUserId: body.from,
          name: body.name ?? null,
          text: String(body.text),
          providerMsgId: body.id ? `wa:${body.id}` : null,
        },
      });
    }
    return json({ ok: true, queued: true }, 202);
  }

  // Proxy the bridge control API to the dashboard (status / qr / logout).
  const bridgeControl = path.match(
    /^\/api\/whatsapp\/bridge\/(status|qr|logout)$/,
  );
  if (bridgeControl) {
    const sub = bridgeControl[1];
    const expectedMethod = sub === "logout" ? "POST" : "GET";
    if (request.method !== expectedMethod) return null;
    const bridgePayload = await requireHumanAuth(request, env);
    if (!bridgePayload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(bridgePayload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    const bridgeUrl = envVar(env, "WHATSAPP_BRIDGE_URL");
    if (!bridgeUrl) return json({ enabled: false });
    try {
      const res = await fetch(`${bridgeUrl}/${sub}`, {
        method: request.method,
        headers: {
          "content-type": "application/json",
          ...(envVar(env, "WHATSAPP_BRIDGE_TOKEN")
            ? { authorization: `Bearer ${envVar(env, "WHATSAPP_BRIDGE_TOKEN")}` }
            : {}),
        },
        body: request.method === "POST" ? "{}" : undefined,
      });
      const data = (await res.json()) as {
        number?: string;
        connected?: boolean;
        [key: string]: unknown;
      };
      if (sub === "status" && data.connected && data.number) {
        const venue = venueFromPayload(bridgePayload, url);
        await registerChannelAccount(
          env,
          "whatsapp",
          data.number.replace(/[^\d]/g, ""),
          venue,
          "authenticated_bridge_status",
        );
      }
      return json(data, res.status);
    } catch {
      return json({ enabled: true, status: "offline" });
    }
  }

  // WhatsApp Cloud API config (dashboard connection wizard).
  if (path === "/api/whatsapp/config" && request.method === "GET") {
    const getPayload = await requireHumanAuth(request, env);
    if (!getPayload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(getPayload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    const getVenue = venueFromPayload(getPayload, url);
    const cfg = await getWhatsappConfig(env, getVenue);
    return json({
      hasToken: Boolean(cfg.token),
      phoneId: cfg.phoneId ?? "",
      hasVerifyToken: Boolean(cfg.verifyToken),
      webhookUrl: `${url.origin}/api/whatsapp/webhook`,
      bridgeEnabled: Boolean(cfg.bridgeUrl),
      transport: cfg.transport,
    });
  }
  if (path === "/api/whatsapp/config" && request.method === "POST") {
    const cfgPayload = await requireHumanAuth(request, env);
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
    return json({ ok: true });
  }

  // Verify the Cloud API credentials against Meta.
  if (path === "/api/whatsapp/test" && request.method === "POST") {
    const testPayload = await requireHumanAuth(request, env);
    if (!testPayload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(testPayload, "merchant")) {
      return json({ error: "forbidden" }, 403);
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
        await registerChannelAccount(
          env,
          "whatsapp",
          cfg.phoneId,
          venueFromPayload(testPayload, url),
          "meta_graph_verification",
        );
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
    if (!appSecret && !simulatorsAllowed(env)) {
      return json({ error: "service unavailable" }, 503);
    }
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
      const body = JSON.parse(rawBody) as {
        entry?: Array<{
          changes?: Array<{ value?: Record<string, unknown> }>;
        }>;
      };
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          const value = change.value ?? {};
          const metadata = value.metadata as { phone_number_id?: string } | undefined;
          const accountId = metadata?.phone_number_id ?? null;
          const venue = await resolveVenueForAccount(env, "whatsapp", accountId);
          if (!accountId || !venue) return json({ error: "unknown receiving account" }, 404);
          const statuses = Array.isArray(value.statuses)
            ? value.statuses as Array<{ id?: string; status?: string; errors?: Array<{ code?: number }> }>
            : [];
          for (const status of statuses) {
            if (!status.id || !["delivered", "read", "failed"].includes(status.status ?? "")) continue;
            await applyDeliveryReceipt(env, {
              channel: "whatsapp",
              accountId,
              providerMessageId: status.id,
              status: status.status as "delivered" | "read" | "failed",
              providerCode: status.errors?.[0]?.code == null
                ? undefined
                : String(status.errors[0].code),
            });
          }
          for (const message of parseWhatsappInbound({ entry: [{ changes: [{ value }] }] })) {
            await persistIngress(env, {
              channel: "whatsapp",
              accountId,
              venue,
              providerEventId: message.providerMsgId ?? `generated:${crypto.randomUUID()}`,
              message,
            });
          }
        }
      }
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "webhook persistence failed" },
        503,
      );
    }
    return json({ received: true, queued: true }, 202);
  }

  // Local simulator — drives the exact same pipeline without a Meta account.
  if (path === "/api/whatsapp/simulate" && request.method === "POST") {
    if (!simulatorsAllowed(env)) return json({ error: "not found" }, 404);
    const simulatorPayload = await requireAuth(request, env);
    if (!simulatorPayload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(simulatorPayload, "manager")) {
      return json({ error: "forbidden" }, 403);
    }
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
      venueFromPayload(simulatorPayload, url),
      env,
    );
    return json(result);
  }

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = await resolveVenue(request, env, url);

  if (path === "/api/whatsapp/conversations" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "staff") || !tokenHasScope(payload, "messaging:read")) {
      return json({ error: "forbidden" }, 403);
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
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "staff") || !tokenHasScope(payload, "messaging:read")) {
      return json({ error: "forbidden" }, 403);
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
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "staff") || !tokenHasScope(payload, "messaging:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const body = (await request.json()) as {
      conversation?: string;
      text?: string;
    };
    if (!body.conversation || !body.text?.trim()) {
      return json({ error: "conversation and text required" }, 400);
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey) return json({ error: "Idempotency-Key header required" }, 400);
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

    const handle = String(conversation.wa_id).replace(
      new RegExp(`^${String(conversation.channel)}:`),
      "",
    );
    await queueOutbound(env, {
      deliveryKey: `reply:${body.conversation}:${idempotencyKey}`,
      venue,
      sourceType: "staff_reply",
      sourceId: body.conversation,
      channel: conversation.channel,
      handle,
      purpose: "utility",
      body: body.text,
    });
    return json({ ok: true, delivery: "queued" }, 202);
  }

  return null;
}
