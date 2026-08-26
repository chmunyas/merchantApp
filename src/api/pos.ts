// C5.1 / C5.5 / C5.10 — the POS connector surface.
//
// Connecting a POS decides where a venue's money is recorded, so the write
// actions are owner-only and human-only: a personal access token has no business
// repointing a restaurant's till. Reading a check is staff-level, because a
// server on the floor needs to see the bill they are about to take payment for.
//
// Nothing here moves money. Tender push-back is C5.6 and lands with db/77.

import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { tokenHasScope } from "@/lib/api-tokens";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";
import { compatibilityMatrix, connectorFor, providerStatus } from "@/lib/pos/registry";
import { isPosProvider, type PosProvider } from "@/lib/pos/types";
import {
  contextFor,
  disableConnection,
  getConnection,
  listOpenChecks,
  markConnectionError,
  markConnectionVerified,
  readCheck,
  syncOpenChecks,
  upsertConnection,
} from "@/lib/pos-checks";
import {
  listPushes,
  listTenderMap,
  markPushRecorded,
  parseTenderMap,
  replaceTenderMap,
  requeuePush,
} from "@/lib/pos-tender-map";
import { runTenderPushWorker } from "@/lib/pos-tender-jobs";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function actorOf(payload: Record<string, unknown>): string {
  return String(payload.sub ?? payload.email ?? "unknown");
}

export async function handlePosRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/pos")) return null;

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // C5.10 — the compatibility matrix, in product. A venue is told what its POS
  // cannot do and what we have not built, as two different answers.
  if (path === "/api/pos/providers" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:read")) {
      return json({ error: "forbidden" }, 403);
    }
    return json({ providers: compatibilityMatrix(env) });
  }

  if (path === "/api/pos/connection") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);

    if (request.method === "GET") {
      if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:read")) {
        return json({ error: "forbidden" }, 403);
      }
      const connection = await getConnection(sql, venue);
      if (!connection) return json({ connection: null, provider: null });
      return json({
        connection,
        provider: providerStatus(connection.provider, env),
      });
    }

    if (request.method === "PUT") {
      if (!roleAtLeast(payload, "merchant")) return json({ error: "forbidden" }, 403);
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      if (!isPosProvider(body.provider)) {
        return json({ error: "unknown POS provider" }, 400);
      }
      const provider = body.provider as PosProvider;
      if (!connectorFor(provider, env)) {
        // Saying "we know your POS but have not built the connector" is the
        // whole point of the registry; a silent save would strand the venue.
        return json(
          {
            error: "connector not available",
            provider: providerStatus(provider, env),
          },
          409,
        );
      }
      const externalLocationId =
        String(body.externalLocationId ?? "").trim().slice(0, 200) || null;
      const config =
        body.config && typeof body.config === "object" && !Array.isArray(body.config)
          ? (body.config as Record<string, unknown>)
          : {};
      const connection = await upsertConnection(
        sql,
        venue,
        provider,
        externalLocationId,
        config,
      );
      return json({ connection, provider: providerStatus(provider, env) });
    }

    if (request.method === "DELETE") {
      if (!roleAtLeast(payload, "merchant")) return json({ error: "forbidden" }, 403);
      const connection = await getConnection(sql, venue);
      if (!connection) return json({ error: "not found" }, 404);
      await disableConnection(sql, venue, connection.id);
      return json({ ok: true });
    }
  }

  // Verification is a real provider round trip. Its warnings are the operator's
  // to act on — Sunday's Toast setup has two steps we cannot read back, so we
  // say we cannot rather than reporting a green tick we did not earn.
  if (path === "/api/pos/connection/verify" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "merchant")) return json({ error: "forbidden" }, 403);
    const venue = venueFromPayload(payload, url);
    const connection = await getConnection(sql, venue);
    if (!connection) return json({ error: "not found" }, 404);

    const connector = connectorFor(connection.provider, env);
    if (!connector) return json({ error: "not_implemented" }, 409);
    const ctx = contextFor(connection, env);
    if (!ctx) {
      return json(
        {
          error: "not_configured",
          requiredSecrets: connector.requiredSecrets,
        },
        409,
      );
    }
    const result = await connector.verify(ctx);
    if (!result.ok) {
      await markConnectionError(
        sql,
        venue,
        connection.id,
        result.detail ?? result.error,
      );
      return json({ error: result.error, detail: result.detail ?? null }, 502);
    }
    await markConnectionVerified(
      sql,
      venue,
      connection.id,
      actorOf(payload),
      result.data.externalLocationId,
      result.data.capabilities,
    );
    return json({
      connection: await getConnection(sql, venue),
      verification: result.data,
    });
  }

  if (path === "/api/pos/checks" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "staff") || !tokenHasScope(payload, "orders:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);
    const checkId = url.searchParams.get("id");
    if (checkId) {
      const check = await readCheck(sql, venue, checkId);
      return check ? json({ check }) : json({ error: "not found" }, 404);
    }
    return json({ checks: await listOpenChecks(sql, venue) });
  }

  if (path === "/api/pos/checks/sync" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "orders:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);
    const outcome = await syncOpenChecks(sql, env, venue);
    return outcome.ok ? json(outcome) : json(outcome, 409);
  }

  // C5.6 / C5.7 — which POS payment method is ours, and which is the exception
  // tender Sunday says must never be used unless support says so.
  if (path === "/api/pos/tenders") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);

    if (request.method === "GET") {
      if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "payments:read")) {
        return json({ error: "forbidden" }, 403);
      }
      return json({ tenders: await listTenderMap(sql, venue) });
    }

    if (request.method === "PUT") {
      if (!roleAtLeast(payload, "merchant")) return json({ error: "forbidden" }, 403);
      const connection = await getConnection(sql, venue);
      if (!connection) return json({ error: "not found" }, 404);
      const body = (await request.json().catch(() => ({}))) as { tenders?: unknown };
      const parsed = parseTenderMap(body.tenders);
      if ("error" in parsed) return json({ error: parsed.error }, 400);
      await replaceTenderMap(sql, venue, connection.id, parsed.tenders);
      return json({ tenders: await listTenderMap(sql, venue) });
    }
  }

  // C5.11 — the Notified / Not Notified view. Staff-readable: a server needs to
  // know which of their tables did not reach the POS.
  if (path === "/api/pos/pushes" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "staff") || !tokenHasScope(payload, "payments:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);
    const status = url.searchParams.get("status");
    return json({
      pushes: await listPushes(
        sql,
        venue,
        status === "not_notified" ? "not_notified" : null,
      ),
    });
  }

  if (path === "/api/pos/pushes/run" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "payments:write")) {
      return json({ error: "forbidden" }, 403);
    }
    return json(await runTenderPushWorker(sql, env, 50));
  }

  const pushMatch = path.match(/^\/api\/pos\/pushes\/([0-9a-fA-F-]+)\/(record|retry)$/);
  if (pushMatch && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);
    const venue = venueFromPayload(payload, url);
    const [pushId, action] = [pushMatch[1], pushMatch[2]];

    if (action === "record") {
      // C5.7 / B3.2 — a manager keyed the payment onto the POS by hand. This
      // moves no money and asserts no provider fact; it records that a human
      // closed the loop, which is what reconciliation needs to stop flagging it.
      const body = (await request.json().catch(() => ({}))) as { posPaymentId?: unknown };
      const ok = await markPushRecorded(
        sql,
        venue,
        pushId,
        actorOf(payload),
        String(body.posPaymentId ?? "").trim().slice(0, 200) || null,
      );
      return ok ? json({ ok: true }) : json({ error: "not found" }, 404);
    }

    const ok = await requeuePush(sql, venue, pushId);
    return ok
      ? json({ ok: true })
      : json({ error: "only an unsynced payment can be retried" }, 409);
  }

  return null;
}
