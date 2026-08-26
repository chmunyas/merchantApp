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
  accountId?: string,
): Promise<TelegramConfig> {
  let botToken = venue ? undefined : envVar(env, "TELEGRAM_BOT_TOKEN");
  const bridgeUrl = envVar(env, "WHATSAPP_BRIDGE_URL");
  try {
    const sql = getSql(env);
    if (sql) {
      // Per-venue bot (telegram:<venue>) wins over the global default.
      const keys = venue ? [`telegram:${venue}`] : ["telegram"];
      for (const k of keys) {
        const [row] = await sql`
          SELECT value FROM app_settings WHERE key = ${k} LIMIT 1`;
        const value = row?.value as { botToken?: string } | undefined;
        if (value?.botToken) {
          botToken = value.botToken;
          break;
        }
      }
      if (accountId && botToken) {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const me = (await response.json()) as {
          ok?: boolean;
          result?: { id?: number };
        };
        if (!me.ok || String(me.result?.id ?? "") !== accountId) {
          botToken = undefined;
        }
      }
    }
  } catch {
    /* fall back to env */
  }
  return { botToken, bridgeUrl };
}
