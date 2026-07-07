import { aiChat } from "@/lib/ai-providers";
import { getAdapter } from "@/lib/channels";
import { getSql } from "@/lib/db";
import { createInvoice } from "@/lib/invoices";
import { searchKb } from "@/lib/kb";
import { findMenuItem, formatMenu, getMenu } from "@/lib/menu";
import { createPayLink } from "@/lib/pay-links";

export type AgentRole = "customer" | "staff" | "admin";

export type AgentContext = {
  venue: string;
  role: AgentRole;
  from?: string;
  name?: string;
};

export type AgentResult = {
  reply: string;
  tool?: string;
  escalate?: boolean;
  data?: unknown;
};

// --- Circuit breaker for the AI provider (improves on AgenticCRM's Opossum) ---
const breaker = { failures: 0, openUntil: 0 };
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30_000;

function breakerOpen(): boolean {
  return Date.now() < breaker.openUntil;
}
function breakerRecord(ok: boolean): void {
  if (ok) {
    breaker.failures = 0;
    return;
  }
  breaker.failures += 1;
  if (breaker.failures >= BREAKER_THRESHOLD) {
    breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    breaker.failures = 0;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Extract booking details from free text ("book 6 tonight at 7").
export function parseBookingIntent(text: string): {
  covers: number | null;
  date: string | null;
  time: string | null;
} {
  const t = text.toLowerCase();
  let covers: number | null = null;
  const coversMatch =
    t.match(/(?:table for|for|party of|group of|book)\s+(\d{1,2})/) ??
    t.match(/(\d{1,2})\s*(?:people|guests|pax|persons?|of us)/);
  if (coversMatch) covers = parseInt(coversMatch[1], 10);

  let date: string | null = null;
  if (/tomorrow/.test(t)) {
    date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  } else if (/today|tonight/.test(t)) {
    date = today();
  }

  let time: string | null = null;
  const ampm = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (ampm) {
    let hour = parseInt(ampm[1], 10);
    const minute = ampm[2] ?? "00";
    if (ampm[3] === "pm" && hour < 12) hour += 12;
    if (ampm[3] === "am" && hour === 12) hour = 0;
    time = `${String(hour).padStart(2, "0")}:${minute}`;
  } else {
    const at = t.match(/(?:at|by)\s+(\d{1,2})(?::(\d{2}))?/);
    if (at) {
      let hour = parseInt(at[1], 10);
      if (hour <= 11 && /tonight|dinner|evening|pm/.test(t)) hour += 12;
      time = `${String(hour).padStart(2, "0")}:${at[2] ?? "00"}`;
    } else if (/tonight|dinner/.test(t)) {
      time = "19:00";
    }
  }
  return { covers, date, time };
}

const VENUE_CAPACITY = 60;

// The agent: rule-based tool routing over Postgres, with a Workers AI fallback
// for free-form questions (guarded by the circuit breaker).
export async function runAgent(
  text: string,
  ctx: AgentContext,
  env: unknown,
): Promise<AgentResult> {
  const sql = getSql(env);
  if (!sql) {
    return {
      reply: "Our system is briefly unavailable — a team member will follow up.",
      escalate: true,
    };
  }
  const t = text.toLowerCase();
  const venue = ctx.venue;

  try {
    if (/human|real person|manager|complain|speak to|agent/.test(t)) {
      return {
        reply: "Of course — connecting you with a team member now. They'll reply shortly.",
        tool: "escalate_to_human",
        escalate: true,
      };
    }

    // Menu & prices (any customer, any channel).
    if (
      /\b(menu|what do you (have|serve|offer)|what.?s on|food|dishes?|drinks?|cocktails?|desserts?)\b/.test(
        t,
      )
    ) {
      const items = await getMenu(sql, venue);
      return { reply: formatMenu(items), tool: "get_menu" };
    }
    if (/\b(how much|price|cost|charge)\b/.test(t)) {
      const item = await findMenuItem(sql, venue, text);
      if (item) {
        return {
          reply: `${item.name} is ${item.currency} ${item.price.toLocaleString()}${
            item.dietary.length ? ` (${item.dietary.join(", ")})` : ""
          }.`,
          tool: "get_menu",
        };
      }
    }

    // Bill / payment link (customer self-checkout across any channel).
    if (ctx.role === "customer" && /\b(bill|pay|payment|checkout|settle)\b/.test(t)) {
      const amountMatch = text.match(/([\d,]{2,})/);
      const amount = amountMatch
        ? parseInt(amountMatch[1].replace(/,/g, ""), 10)
        : 0;
      if (amount > 0) {
        const invoice = await createInvoice(env, {
          venue,
          amount,
          phone: ctx.from ?? null,
          customerName: ctx.name ?? null,
        });
        if (!("error" in invoice)) {
          return {
            reply: `Here's your secure payment link for ${invoice.currency} ${invoice.amount.toLocaleString()}.\n\nTap to pay 👇\n${invoice.payLink}`,
            tool: "send_payment_link",
            data: invoice,
          };
        }
      }
      return {
        reply:
          "Happy to help you pay! How much is the bill? (You can also ask your server for the total.)",
        tool: "collect_payment",
      };
    }

    const intent = parseBookingIntent(t);
    const wantsBooking =
      /book|reserve|reservation|table|seat/.test(t) || intent.covers !== null;

    if (wantsBooking) {
      if (intent.covers && intent.date && intent.time) {
        const [{ booked }] = await sql`
          SELECT coalesce(sum(covers),0)::int AS booked FROM reservations
          WHERE venue_id = ${venue} AND date = ${intent.date}
            AND time = ${intent.time} AND status <> 'cancelled'`;
        if (VENUE_CAPACITY - booked < intent.covers) {
          return {
            reply: `Sorry, we're fully booked for ${intent.covers} at ${intent.time} on ${intent.date}. Want me to try another time?`,
            tool: "check_availability",
          };
        }
        const [row] = await sql`
          INSERT INTO enquiries (venue_id, customer_name, phone, covers, date, time, notes, status, source)
          VALUES (${venue}, ${ctx.name ?? "WhatsApp guest"}, ${ctx.from ?? null},
                  ${intent.covers}, ${intent.date}, ${intent.time}, ${text}, 'new', 'whatsapp')
          RETURNING id`;
        return {
          reply: `Done! I've requested a table for ${intent.covers} on ${intent.date} at ${intent.time}. You'll get a confirmation shortly (ref ${String(row.id).slice(0, 8)}).`,
          tool: "create_enquiry",
          data: { id: row.id },
        };
      }
      return {
        reply: "Happy to help you book! How many guests, and what date & time?",
        tool: "collect_booking",
      };
    }

    // Staff / admin CRM tools (allowlisted numbers only).
    if (ctx.role !== "customer") {
      // Ad-hoc payment request — mint a server-bound pay link (Tap&Go / deposit /
      // split / any amount) and send it to the customer on their channel. Lighter
      // than a full invoice; the amount is bound to the server, not the URL.
      if (/(request payment|pay ?link|payment link)/.test(t)) {
        const phoneMatch = text.match(/\+?\d{9,15}/);
        const phoneRaw = phoneMatch ? phoneMatch[0].replace(/[\s-]/g, "") : null;
        const phone = phoneRaw
          ? phoneRaw.startsWith("+")
            ? phoneRaw
            : `+${phoneRaw}`
          : null;
        const withoutPhone = phoneMatch
          ? text.replace(phoneMatch[0], " ")
          : text;
        const amountMatch = withoutPhone.match(/([\d,]{2,})/);
        const amount = amountMatch
          ? parseInt(amountMatch[1].replace(/,/g, ""), 10)
          : 0;
        const descMatch = text.match(/for (.+)$/i);
        if (amount > 0) {
          const link = await createPayLink(env, venue, {
            amount: amount * 100, // whole KES → minor units
            description: descMatch ? descMatch[1].trim() : null,
            kind: "request",
            phone,
            createdBy: "agent",
          });
          if ("error" in link) {
            return {
              reply: `Couldn't create the pay link: ${link.error}`,
              tool: "request_payment",
            };
          }
          const msg = `Here's your secure payment link for KES ${amount.toLocaleString()}${
            descMatch ? ` (${descMatch[1].trim()})` : ""
          }. Tap to pay 👇\n${link.url}`;
          let sent = false;
          if (phone) {
            try {
              const out = await getAdapter("whatsapp").send(phone, msg, env);
              sent = out.delivery === "sent";
            } catch {
              /* best-effort send */
            }
          }
          return {
            reply: `Payment request for KES ${amount.toLocaleString()} created${
              phone
                ? sent
                  ? ` and sent to ${phone}`
                  : ` (couldn't auto-send to ${phone} — share the link below)`
                : ""
            }.\n\nPay link 👇\n${link.url}`,
            tool: "request_payment",
            data: link,
          };
        }
        return {
          reply:
            "Sure — how much should I request, and which customer phone should I send the pay link to?",
          tool: "collect_payment_request",
        };
      }
      if (/invoice|bill/.test(t) && !/billboard/.test(t)) {
        const phoneMatch = text.match(/\+?\d{9,15}/);
        const phoneRaw = phoneMatch ? phoneMatch[0].replace(/[\s-]/g, "") : null;
        const phone = phoneRaw
          ? phoneRaw.startsWith("+")
            ? phoneRaw
            : `+${phoneRaw}`
          : null;
        const withoutPhone = phoneMatch
          ? text.replace(phoneMatch[0], " ")
          : text;
        const amountMatch = withoutPhone.match(/([\d,]{2,})/);
        const amount = amountMatch
          ? parseInt(amountMatch[1].replace(/,/g, ""), 10)
          : 0;
        const descMatch = text.match(/for (.+)$/i);
        if (amount > 0) {
          const invoice = await createInvoice(env, {
            venue,
            amount,
            phone,
            description: descMatch ? descMatch[1].trim() : null,
            channel: phone ? "whatsapp" : undefined,
          });
          if ("error" in invoice) {
            return {
              reply: `Couldn't create the invoice: ${invoice.error}`,
              tool: "create_invoice",
            };
          }
          return {
            reply: `Invoice ${invoice.number} for ${invoice.currency} ${invoice.amount.toLocaleString()} created${
              phone ? ` and sent to ${phone}` : ""
            }.\n\nPay link 👇\n${invoice.payLink}`,
            tool: "create_invoice",
            data: invoice,
          };
        }
        return {
          reply:
            "Sure — what amount, and which customer phone should I send the invoice to?",
          tool: "collect_invoice",
        };
      }
      if (/(cover|booking|reservation)/.test(t)) {
        const [row] = await sql`
          SELECT count(*)::int AS bookings, coalesce(sum(covers),0)::int AS covers
          FROM reservations WHERE venue_id = ${venue} AND date = CURRENT_DATE
            AND status <> 'cancelled'`;
        return {
          reply: `Today: ${row.bookings} bookings, ${row.covers} covers.`,
          tool: "get_todays_bookings",
        };
      }
      if (/enquir/.test(t)) {
        const [row] = await sql`
          SELECT count(*)::int AS n FROM enquiries
          WHERE venue_id = ${venue} AND status = 'new'`;
        return { reply: `You have ${row.n} new enquiries.`, tool: "count_enquiries" };
      }
      if (/vip|top|spend|loyal/.test(t)) {
        const rows = await sql`
          SELECT name, tier FROM contacts WHERE venue_id = ${venue}
          ORDER BY total_spent DESC LIMIT 3`;
        return {
          reply: `Top spenders: ${rows.map((r) => `${r.name} (${r.tier})`).join(", ")}.`,
          tool: "search_contacts",
        };
      }
      if (/contact|customer/.test(t)) {
        const [row] = await sql`
          SELECT count(*)::int AS n FROM contacts WHERE venue_id = ${venue}`;
        return { reply: `You have ${row.n} contacts.`, tool: "search_contacts" };
      }
    }

    // Knowledge base (RAG): answer FAQs from the merchant's own content
    // (opening hours, parking, wifi, dietary, cancellation, private events...).
    const kbHits = await searchKb(venue, text, env);
    if (kbHits.length > 0) {
      return { reply: kbHits[0].body, tool: "search_kb" };
    }

    // Free-form: multi-provider AI (OpenAI / Anthropic / Ollama-local / Workers
    // AI, with fallback) when the breaker is closed. Degrades gracefully to the
    // rule-based closing reply when no provider is configured.
    if (!breakerOpen()) {
      const reply = await aiChat(
        [
          {
            role: "system",
            content:
              "You are a friendly WhatsApp assistant for a restaurant. Keep replies to 1-2 sentences. If the guest wants to book, ask for number of guests, date and time.",
          },
          { role: "user", content: text },
        ],
        env,
      );
      if (reply) {
        breakerRecord(true);
        return { reply, tool: "ai" };
      }
      breakerRecord(false);
    }

    if (breakerOpen()) {
      return {
        reply: "Thanks for your message! A team member will assist you shortly.",
        escalate: true,
      };
    }

    return {
      reply:
        ctx.role === "customer"
          ? "Hi! I can book you a table — just tell me guests, date & time. For anything else a team member will follow up."
          : "Try: 'covers today', 'new enquiries', 'top spenders', or 'book 6 tonight at 7'.",
    };
  } catch {
    return {
      reply: "Something went wrong — a team member will follow up.",
      escalate: true,
    };
  }
}
