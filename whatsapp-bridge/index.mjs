import http from "node:http";

import baileys, {
  DisconnectReason,
  initAuthCreds,
  BufferJSON,
  proto,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pg from "pg";
import pino from "pino";
import QRCode from "qrcode";

const makeWASocket = baileys.default ?? baileys;

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://pesaswap:pesaswap@postgres:5432/pesaswap";
const APP_INBOUND_URL =
  process.env.APP_INBOUND_URL ??
  "http://merchant-app:8080/api/whatsapp/bridge/inbound";
const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://merchant-app:8080";
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 8090);
const BRIDGE_VENUE = process.env.BRIDGE_VENUE ?? "main";
// Shared secret required on all bridge-control endpoints when the bridge is
// exposed publicly (e.g. behind a Cloudflare Tunnel so the deployed Worker can
// reach it), and presented to the app on bridge/inbound.
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN ?? "";
// Shared secret presented to the app's cron sweeps (invoicing/run, sequences/run)
// so those endpoints can reject anonymous callers. Matches the app's CRON_SECRET.
const CRON_SECRET = process.env.CRON_SECRET ?? "";
// Presented on Telegram updates forwarded from long polling to the app. It must
// match TELEGRAM_WEBHOOK_SECRET on the Worker in production.
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

const logger = pino({ level: "silent" });
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

// --- Runtime state -------------------------------------------------------
let sock = null;
let currentQR = null; // data URL of the pairing QR while awaiting a scan
let status = "starting"; // starting | qr | connecting | open | logged_out
let meNumber = null;
let lastEventAt = Date.now();
let reconnecting = false;

// --- PostgreSQL-backed Baileys auth state --------------------------------
async function usePostgresAuthState() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS wa_bridge_auth (id text PRIMARY KEY, data text NOT NULL)`,
  );

  const readData = async (id) => {
    const res = await pool.query("SELECT data FROM wa_bridge_auth WHERE id = $1", [id]);
    if (!res.rows[0]) return null;
    return JSON.parse(res.rows[0].data, BufferJSON.reviver);
  };
  const writeData = async (id, value) => {
    const data = JSON.stringify(value, BufferJSON.replacer);
    await pool.query(
      `INSERT INTO wa_bridge_auth (id, data) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [id, data],
    );
  };
  const removeData = async (id) => {
    await pool.query("DELETE FROM wa_bridge_auth WHERE id = $1", [id]);
  };

  const creds = (await readData("creds")) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              result[id] = value ?? undefined;
            }),
          );
          return result;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const name = `${category}-${id}`;
              tasks.push(value ? writeData(name, value) : removeData(name));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData("creds", creds),
    clearAll: async () => {
      await pool.query("DELETE FROM wa_bridge_auth");
    },
  };
}

// --- Helpers -------------------------------------------------------------
function numberToJid(to) {
  const digits = String(to).replace(/[^\d]/g, "");
  return `${digits}@s.whatsapp.net`;
}

function jidToNumber(jid) {
  const digits = String(jid).split("@")[0].split(":")[0];
  return `+${digits}`;
}

async function forwardInbound(from, name, text, id) {
  try {
    const response = await fetch(APP_INBOUND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(BRIDGE_TOKEN ? { "x-webhook-secret": BRIDGE_TOKEN } : {}),
      },
      body: JSON.stringify({
        accountId: meNumber ? String(meNumber).replace(/[^\d]/g, "") : null,
        from,
        name,
        text,
        id,
      }),
    });
    if (!response.ok) {
      throw new Error(`app ingress rejected with ${response.status}`);
    }
    return true;
  } catch (error) {
    logger.error({ error }, "failed to forward inbound");
    return false;
  }
}

// --- Baileys connection --------------------------------------------------
let auth;

async function start() {
  reconnecting = false;
  if (!auth) auth = await usePostgresAuthState();
  const { version } = await fetchLatestBaileysVersion().catch(() => ({
    version: undefined,
  }));

  sock = makeWASocket({
    version,
    auth: {
      creds: auth.state.creds,
      keys: makeCacheableSignalKeyStore(auth.state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: ["PesaSwap", "Chrome", "1.0.0"],
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", auth.saveCreds);

  sock.ev.on("connection.update", async (update) => {
    lastEventAt = Date.now();
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      status = "qr";
      try {
        currentQR = await QRCode.toDataURL(qr);
      } catch {
        currentQR = null;
      }
    }
    if (connection === "connecting") status = "connecting";
    if (connection === "open") {
      status = "open";
      currentQR = null;
      meNumber = sock.user?.id ? jidToNumber(sock.user.id) : null;
      logger.info({ meNumber }, "whatsapp bridge connected");
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        status = "logged_out";
        currentQR = null;
        meNumber = null;
        await auth.clearAll();
        auth = null;
      } else if (!reconnecting) {
        reconnecting = true;
        status = "connecting";
        setTimeout(() => start().catch(() => {}), 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    lastEventAt = Date.now();
    if (type !== "notify") return;
    for (const message of messages) {
      if (message.key.fromMe) continue;
      const jid = message.key.remoteJid ?? "";
      if (jid.endsWith("@g.us") || jid === "status@broadcast") continue;
      const text =
        message.message?.conversation ??
        message.message?.extendedTextMessage?.text ??
        message.message?.imageMessage?.caption ??
        "";
      if (!text.trim()) continue;
      // Show a "typing…" indicator for a natural feel (Omni best practice).
      try {
        await sock.sendPresenceUpdate("composing", jid);
      } catch {
        /* presence is best-effort */
      }
      let forwarded = false;
      for (let attempt = 0; attempt < 5 && !forwarded; attempt += 1) {
        forwarded = await forwardInbound(
          jidToNumber(jid),
          message.pushName ?? null,
          text,
          message.key.id,
        );
        if (!forwarded) await sleep(500 * 2 ** attempt);
      }
      if (!forwarded) {
        logger.error({ messageId: message.key.id }, "inbound was not durably acknowledged");
      }
    }
  });
}

async function sendMessage(to, text) {
  if (!sock || status !== "open") throw new Error("not connected");
  const jid = numberToJid(to);
  const sent = await sock.sendMessage(jid, { text });
  try {
    await sock.sendPresenceUpdate("paused", jid);
  } catch {
    /* best-effort */
  }
  return sent?.key?.id ?? null;
}

async function logout() {
  try {
    if (sock) await sock.logout();
  } catch {
    /* ignore */
  }
  if (auth) await auth.clearAll();
  auth = null;
  sock = null;
  status = "logged_out";
  currentQR = null;
  meNumber = null;
  setTimeout(() => start().catch(() => {}), 1500);
}

// --- Keepalive + stale watchdog (24/7) -----------------------------------
setInterval(() => {
  if (sock && status === "open") {
    sock.sendPresenceUpdate("available").catch(() => {});
  }
}, 30000);

// Auto-run due sequence steps + invoice reminders/recurring every 3 minutes so
// follow-ups and billing fire 24/7 without an external cron.
setInterval(() => {
  const cronHeaders = CRON_SECRET ? { "x-cron-secret": CRON_SECRET } : {};
  fetch(`${APP_BASE_URL}/api/sequences/run?venue=${BRIDGE_VENUE}`, {
    method: "POST",
    headers: cronHeaders,
  }).catch(() => {});
  fetch(`${APP_BASE_URL}/api/invoicing/run?venue=${BRIDGE_VENUE}`, {
    method: "POST",
    headers: cronHeaders,
  }).catch(() => {});
  fetch(`${APP_BASE_URL}/api/channels/run`, {
    method: "POST",
    headers: cronHeaders,
  }).catch(() => {});
}, 180000);

// --- Telegram long polling (official Bot API; forwards to the app pipeline) ---
// Works locally without a public webhook URL. The app dedupes reprocessed
// updates, so an in-memory offset is safe across restarts.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let tgOffset = 0;

async function getTelegramToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  try {
    const res = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'telegram'",
    );
    return res.rows[0]?.value?.botToken || null;
  } catch {
    return null;
  }
}

async function telegramLoop() {
  let announced = false;
  let tgBotId = null;
  for (;;) {
    const token = await getTelegramToken();
    if (!token) {
      announced = false;
      await sleep(5000);
      continue;
    }
    if (!announced) {
      console.log("[whatsapp-bridge] telegram polling started");
      announced = true;
      try {
        const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json());
        tgBotId = me.ok && me.result?.id != null ? String(me.result.id) : null;
      } catch {
        tgBotId = null;
      }
    }
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${tgOffset}`,
      );
      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          if (!tgBotId) throw new Error("telegram bot identity unavailable");
          console.log(
            `[whatsapp-bridge] telegram update from ${update.message?.from?.first_name}: ${update.message?.text}`,
          );
          const forwarded = await fetch(
            `${APP_BASE_URL}/api/channel-webhooks/telegram/${encodeURIComponent(tgBotId)}`,
            {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(TELEGRAM_WEBHOOK_SECRET
                ? {
                    "x-telegram-bot-api-secret-token":
                      TELEGRAM_WEBHOOK_SECRET,
                  }
                : {}),
            },
            body: JSON.stringify(update),
            },
          );
          if (!forwarded.ok) {
            throw new Error(`app telegram ingress rejected with ${forwarded.status}`);
          }
          tgOffset = update.update_id + 1;
        }
      } else if (data.error_code === 409) {
        console.log("[whatsapp-bridge] telegram 409 — a webhook is set; backing off");
        await sleep(15000);
      } else if (!data.ok) {
        console.log(`[whatsapp-bridge] telegram getUpdates error: ${data.description}`);
        await sleep(5000);
      } else {
        await sleep(1000);
      }
    } catch {
      await sleep(3000);
    }
  }
}

telegramLoop();

setInterval(() => {
  const idleMs = Date.now() - lastEventAt;
  if (status !== "open" && status !== "qr" && idleMs > 120000 && !reconnecting) {
    reconnecting = true;
    start().catch(() => {});
  }
}, 60000);

// --- HTTP control API ----------------------------------------------------
function sendJson(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// Constant-time-ish check that the request carries the shared bridge secret.
// When BRIDGE_TOKEN is unset the bridge is open (internal-only dev).
function authorized(req) {
  if (!BRIDGE_TOKEN) return true;
  const header = req.headers["authorization"] ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  return provided.length === BRIDGE_TOKEN.length && provided === BRIDGE_TOKEN;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/status" && req.method === "GET" && !authorized(req)) {
      return sendJson(res, 401, { ok: false, error: "unauthorized" });
    }
    if (url.pathname === "/status" && req.method === "GET") {
      return sendJson(res, 200, {
        enabled: true,
        status,
        connected: status === "open",
        number: meNumber,
        hasQR: currentQR !== null,
        venue: BRIDGE_VENUE,
      });
    }
    // /qr exposes the pairing QR, /send impersonates the number, /logout wipes
    // the session — all require the shared secret when the bridge is exposed.
    if (
      (url.pathname === "/qr" ||
        url.pathname === "/send" ||
        url.pathname === "/logout") &&
      !authorized(req)
    ) {
      return sendJson(res, 401, { ok: false, error: "unauthorized" });
    }
    if (url.pathname === "/qr" && req.method === "GET") {
      return sendJson(res, 200, { qr: currentQR, status });
    }
    if (url.pathname === "/send" && req.method === "POST") {
      const body = await readBody(req);
      if (!body.to || !body.text) {
        return sendJson(res, 400, { ok: false, error: "to and text required" });
      }
      const id = await sendMessage(body.to, body.text);
      return sendJson(res, 200, { ok: true, id });
    }
    if (url.pathname === "/logout" && req.method === "POST") {
      await logout();
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
  }
});

server.listen(BRIDGE_PORT, () => {
  logger.info({ BRIDGE_PORT }, "bridge http listening");
  console.log(`[whatsapp-bridge] listening on ${BRIDGE_PORT}`);
});

start().catch((error) => {
  console.error("[whatsapp-bridge] start failed", error);
});
