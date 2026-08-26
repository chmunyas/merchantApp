import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";

type Sql = NonNullable<ReturnType<typeof getSql>>;
type Vapid = { publicKey: string; privateJwk: JsonWebKey };

function b64urlFromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlFromString(value: string): string {
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Get the VAPID keypair — env override in production, otherwise a keypair
// generated once and persisted in Postgres (app_settings). Never a source
// secret. Returns null if Web Crypto / DB is unavailable (push simply no-ops).
export async function getVapidKeys(
  sql: Sql,
  env: unknown,
): Promise<Vapid | null> {
  const envPub = envVar(env, "VAPID_PUBLIC_KEY");
  const envPriv = envVar(env, "VAPID_PRIVATE_JWK");
  if (envPub && envPriv) {
    try {
      return { publicKey: envPub, privateJwk: JSON.parse(envPriv) as JsonWebKey };
    } catch {
      /* fall through to generated keys */
    }
  }
  try {
    const [existing] = await sql`SELECT value FROM app_settings WHERE key = 'vapid'`;
    if (existing?.value?.publicKey) return existing.value as Vapid;

    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const publicKey = b64urlFromBuffer(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    );
    const privateJwk = (await crypto.subtle.exportKey(
      "jwk",
      pair.privateKey,
    )) as JsonWebKey;
    const value: Vapid = { publicKey, privateJwk };
    const storable = JSON.parse(JSON.stringify(value));
    await sql`
      INSERT INTO app_settings (key, value) VALUES ('vapid', ${sql.json(storable)})
      ON CONFLICT (key) DO NOTHING`;
    const [saved] = await sql`SELECT value FROM app_settings WHERE key = 'vapid'`;
    return (saved?.value as Vapid) ?? value;
  } catch {
    return null;
  }
}

async function signVapidJwt(audience: string, vapid: Vapid): Promise<string> {
  const header = b64urlFromString(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64urlFromString(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: "mailto:ops@pesaswap.app",
    }),
  );
  const key = await crypto.subtle.importKey(
    "jwk",
    vapid.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64urlFromBuffer(signature)}`;
}

// Payloadless "tickle": the service worker wakes and fetches the notification
// text from /api/push/latest. Avoids RFC-8291 payload encryption entirely.
async function sendTickle(
  endpoint: string,
  vapid: Vapid,
): Promise<number> {
  const audience = new URL(endpoint).origin;
  const jwt = await signVapidJwt(audience, vapid);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "120",
      Urgency: "high",
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    },
  });
  return res.status;
}

// Best-effort staff notification. Stores the latest text per venue and tickles
// every registered staff device. Wrapped so a push failure never breaks the
// message pipeline.
export async function notifyStaff(
  env: unknown,
  venue: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    const sql = getSql(env);
    if (!sql) return;
    const subs = await sql`
      SELECT endpoint FROM push_subscriptions
      WHERE venue_id = ${venue} AND audience = 'staff'`;
    if (subs.length === 0) return;

    await sql`
      INSERT INTO app_settings (key, value)
      VALUES (${`push_latest:${venue}`}, ${sql.json({ title, body, at: new Date().toISOString() })})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

    const vapid = await getVapidKeys(sql, env);
    if (!vapid) return;
    for (const sub of subs) {
      try {
        const status = await sendTickle(sub.endpoint, vapid);
        if (status === 404 || status === 410) {
          await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
        }
      } catch {
        /* skip this device */
      }
    }
  } catch {
    /* best-effort */
  }
}

export async function latestNotification(
  sql: Sql,
  venue: string,
): Promise<unknown> {
  const [row] = await sql`
    SELECT value FROM app_settings WHERE key = ${`push_latest:${venue}`}`;
  return row?.value ?? { title: "PesaSwap", body: "You have a new notification" };
}

// Wake ONLY the devices belonging to the named staff members in this venue.
// The payload stays empty (RFC-8291 is avoided entirely): the service worker
// tickles /api/push/latest with its own device token and gets the text for that
// device's staff member. Reuses the same subscription table + VAPID keypair as
// the venue-wide notifyStaff above — there is one delivery path, not two.
export async function tickleStaffDevices(
  env: unknown,
  venue: string,
  staffIds: readonly string[],
): Promise<number> {
  if (staffIds.length === 0) return 0;
  try {
    const sql = getSql(env);
    if (!sql) return 0;
    const subs = await sql`
      SELECT endpoint FROM push_subscriptions
      WHERE venue_id = ${venue}
        AND audience = 'staff'
        AND device_token_hash IS NOT NULL
        AND staff_id = ANY(${staffIds as string[]}::uuid[])`;
    if (subs.length === 0) return 0;

    const vapid = await getVapidKeys(sql, env);
    if (!vapid) return 0;
    let delivered = 0;
    for (const sub of subs) {
      try {
        const status = await sendTickle(String(sub.endpoint), vapid);
        if (status === 404 || status === 410) {
          await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
        } else {
          delivered += 1;
        }
      } catch {
        /* skip this device */
      }
    }
    return delivered;
  } catch {
    return 0;
  }
}

