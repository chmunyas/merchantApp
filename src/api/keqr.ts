import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { requireRole } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function clean(value: unknown): string | null {
  const t = String(value ?? "").trim();
  return t ? t.slice(0, 32) : null;
}

// Platform-level KE-QR scheme configuration. These are PUBLIC merchant/scheme
// identifiers (no secrets): the acquiring-PSP id issued from the CBK directory
// (once PesaSwap is registered), plus optional MCC / city overrides. Stored in
// app_settings('ke_qr'); read by the client PaymentQr so a real, interoperable
// PSP id can be flipped in from the admin portal without a deploy.
export async function handleKeQrConfigRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/ke-qr-config") return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  const sql = getSql(env);

  if (request.method === "GET") {
    // Public read (used by the QR renderer). Env vars seed the defaults; the
    // admin-saved app_settings row overrides them.
    let pspId = clean(envVar(env, "KE_QR_PSP_ID"));
    let mcc = clean(envVar(env, "KE_QR_MCC"));
    let city = clean(envVar(env, "KE_QR_CITY"));
    if (sql) {
      try {
        const [row] = await sql`SELECT value FROM app_settings WHERE key = 'ke_qr'`;
        const v = row?.value as
          | { pspId?: string; mcc?: string; city?: string }
          | undefined;
        if (v?.pspId) pspId = clean(v.pspId);
        if (v?.mcc) mcc = clean(v.mcc);
        if (v?.city) city = clean(v.city);
      } catch {
        /* fall back to env defaults */
      }
    }
    return json({ pspId, mcc, city });
  }

  if (request.method === "PUT") {
    // Platform-admin only.
    if (!(await requireRole(request, env, ["admin"]))) {
      return json({ error: "forbidden" }, 403);
    }
    if (!sql) return json({ error: "database not configured" }, 503);
    const body = (await request.json().catch(() => ({}))) as {
      pspId?: string | null;
      mcc?: string | null;
      city?: string | null;
    };
    const value = {
      pspId: clean(body.pspId),
      mcc: clean(body.mcc),
      city: clean(body.city),
    };
    await sql`
      INSERT INTO app_settings (key, value) VALUES ('ke_qr', ${sql.json(value)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    return json({ ok: true, config: value });
  }

  return null;
}
