# Telegram

## How it works
Official **Bot API**. Create a bot with **@BotFather** to get a token; store it in
`app_settings.telegram`. Two receive modes (we use long-poll via the bridge; a
public webhook is supported for production):
- **Long-poll** — `whatsapp-bridge/index.mjs` `telegramLoop()` calls `getUpdates`
  and forwards each update to `POST /api/telegram/webhook`. Works locally with no
  public URL.
- **Webhook** — `POST /api/telegram/webhook/set` registers `<origin>/api/telegram/
  webhook`; `/delete` removes it. (Only one of poll/webhook at a time; a 409 means
  a webhook is set.)
Outbound via `api.telegram.org/bot<token>/sendMessage`. Our bot: `@KeMerchaAppbot`.

## Capabilities
Text, media, files, **inline keyboards** + callback buttons, slash **commands**,
reply keyboards, `sendChatAction` (typing), deep links, payments (Telegram
Payments), and up to 2 GB file uploads. Groups & channels supported.

## Initiation & window
- **No cold DM.** A user must **`/start`** the bot (or add it to a group) before it
  can message them.
- **No 24-hour window** — once a user has started the bot you may message them
  anytime (still: no spam; honor stop requests).
- **Privacy mode** (default in groups): the bot only sees commands/replies unless
  disabled via BotFather.

## Rate limits
~**30 messages/second** overall; ~**1 message/second per chat**; ~20/min to the
same group. Bulk sends must throttle + retry on `429` (respect `retry_after`).

## Compliance & data protection
- Telegram **Bot ToS**: no spam/unsolicited; users can block/stop anytime — treat a
  block as opt-out.
- PII = Telegram user id/username + message content, stored on Telegram's cloud.
  Reflect in the privacy notice; GDPR erasure applies to your stored copy.

## Handoff notes
No window constraint makes Telegram the easiest for delayed human follow-up. Staff
takeover replies go out via the same bot token. See `../handoff.md`.

## Status in this app
**Live** — `src/api/telegram.ts` (config/status/webhook) + the bridge long-poll.
Config + `getMe` verification in the dashboard Telegram page.
