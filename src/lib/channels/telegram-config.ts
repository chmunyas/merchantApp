import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";

export type TelegramConfig = {
  botToken?: string;
  bridgeUrl?: string;
};

// Resolve the Telegram bot token: dashboard-saved settings (app_settings) take
// precedence, falling back to the TELEGRAM_BOT_TOKEN environment variable.
export async function getTelegramConfig(
  env: unknown,
  venue?: string,
): Promise<TelegramConfig> {
  let botToken = envVar(env, "TELEGRAM_BOT_TOKEN");
  const bridgeUrl = envVar(env, "WHATSAPP_BRIDGE_URL");
  try {
    const sql = getSql(env);
    if (sql) {
      // Per-venue bot (telegram:<venue>) wins over the global default.
      const keys = venue ? [`telegram:${venue}`, "telegram"] : ["telegram"];
      for (const k of keys) {
        const [row] = await sql`
          SELECT value FROM app_settings WHERE key = ${k} LIMIT 1`;
        const value = row?.value as { botToken?: string } | undefined;
        if (value?.botToken) {
          botToken = value.botToken;
          break;
        }
      }
    }
  } catch {
    /* fall back to env */
  }
  return { botToken, bridgeUrl };
}
