import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";

export type TelegramConfig = {
  botToken?: string;
  bridgeUrl?: string;
};

// Resolve the Telegram bot token: dashboard-saved settings (app_settings) take
// precedence, falling back to the TELEGRAM_BOT_TOKEN environment variable.
export async function getTelegramConfig(env: unknown): Promise<TelegramConfig> {
  let botToken = envVar(env, "TELEGRAM_BOT_TOKEN");
  const bridgeUrl = envVar(env, "WHATSAPP_BRIDGE_URL");
  try {
    const sql = getSql(env);
    if (sql) {
      const [row] = await sql`SELECT value FROM app_settings WHERE key = 'telegram'`;
      const value = row?.value as { botToken?: string } | undefined;
      if (value?.botToken) botToken = value.botToken;
    }
  } catch {
    /* fall back to env */
  }
  return { botToken, bridgeUrl };
}
