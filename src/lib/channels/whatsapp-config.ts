import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";

export type WhatsappTransport = "auto" | "bridge" | "cloud";

export type WhatsappConfig = {
  token?: string;
  phoneId?: string;
  verifyToken: string;
  bridgeUrl?: string;
  bridgeToken?: string;
  transport: WhatsappTransport;
};

// Resolve WhatsApp Cloud API config: dashboard-saved settings (app_settings)
// take precedence, falling back to environment variables. The Baileys bridge
// URL is infrastructure and only comes from the environment. `transport` selects
// the active outbound path (auto = bridge -> cloud -> simulated).
export async function getWhatsappConfig(
  env: unknown,
  venue?: string,
  accountId?: string,
): Promise<WhatsappConfig> {
  let token = venue ? undefined : envVar(env, "WHATSAPP_TOKEN");
  let phoneId = venue ? undefined : envVar(env, "WHATSAPP_PHONE_ID");
  let verifyToken = envVar(env, "WHATSAPP_VERIFY_TOKEN") ?? "pesaswap-verify";
  let bridgeUrl = venue ? undefined : envVar(env, "WHATSAPP_BRIDGE_URL");
  let bridgeToken = venue ? undefined : envVar(env, "WHATSAPP_BRIDGE_TOKEN");
  let transport: WhatsappTransport = "auto";

  try {
    const sql = getSql(env);
    if (sql) {
      // Per-venue config (whatsapp_cloud:<venue>) wins over the global default,
      // so each store can run its own WhatsApp number.
      const keys = venue
        ? [`whatsapp_cloud:${venue}`]
        : ["whatsapp_cloud"];
      let value:
        | {
            token?: string;
            phoneId?: string;
            verifyToken?: string;
            transport?: string;
          }
        | undefined;
      for (const k of keys) {
        const [row] = await sql`
          SELECT value FROM app_settings WHERE key = ${k} LIMIT 1`;
        if (row?.value) {
          value = row.value as typeof value;
          break;
        }
      }
      if (value) {
        if (value.token) token = value.token;
        if (value.phoneId) phoneId = value.phoneId;
        if (value.verifyToken) verifyToken = value.verifyToken;
        if (
          value.transport === "auto" ||
          value.transport === "bridge" ||
          value.transport === "cloud"
        ) {
          transport = value.transport;
        }
      }
      if (venue && envVar(env, "WHATSAPP_BRIDGE_VENUE") === venue) {
        bridgeUrl = envVar(env, "WHATSAPP_BRIDGE_URL");
        bridgeToken = envVar(env, "WHATSAPP_BRIDGE_TOKEN");
      }
      if (accountId && phoneId !== accountId) {
        token = undefined;
        phoneId = undefined;
        bridgeUrl = undefined;
        bridgeToken = undefined;
      }
    }
  } catch {
    /* fall back to env */
  }

  return { token, phoneId, verifyToken, bridgeUrl, bridgeToken, transport };
}
