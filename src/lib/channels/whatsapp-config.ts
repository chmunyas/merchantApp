import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";

export type WhatsappTransport = "auto" | "bridge" | "cloud";

export type WhatsappConfig = {
  token?: string;
  phoneId?: string;
  verifyToken: string;
  bridgeUrl?: string;
  transport: WhatsappTransport;
};

// Resolve WhatsApp Cloud API config: dashboard-saved settings (app_settings)
// take precedence, falling back to environment variables. The Baileys bridge
// URL is infrastructure and only comes from the environment. `transport` selects
// the active outbound path (auto = bridge -> cloud -> simulated).
export async function getWhatsappConfig(env: unknown): Promise<WhatsappConfig> {
  let token = envVar(env, "WHATSAPP_TOKEN");
  let phoneId = envVar(env, "WHATSAPP_PHONE_ID");
  let verifyToken = envVar(env, "WHATSAPP_VERIFY_TOKEN") ?? "pesaswap-verify";
  const bridgeUrl = envVar(env, "WHATSAPP_BRIDGE_URL");
  let transport: WhatsappTransport = "auto";

  try {
    const sql = getSql(env);
    if (sql) {
      const [row] = await sql`SELECT value FROM app_settings WHERE key = 'whatsapp_cloud'`;
      const value = row?.value as
        | {
            token?: string;
            phoneId?: string;
            verifyToken?: string;
            transport?: string;
          }
        | undefined;
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
    }
  } catch {
    /* fall back to env */
  }

  return { token, phoneId, verifyToken, bridgeUrl, transport };
}
