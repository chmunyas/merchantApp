import { aiChat } from "@/lib/ai-providers";
import { getSql } from "@/lib/db";
import { createInvoice } from "@/lib/invoices";
import { findMenuItem, getMenu, type MenuItem } from "@/lib/menu";

// Runtime ops tools for the merchant copilot. These EXECUTE (reprice, restock,
// bill, draft campaigns) — not just answer. The router is LLM-agnostic: it routes
// deterministically first (works with zero LLM), and only falls back to a
// prompt-based JSON tool-pick through `aiChat` (OpenAI / Anthropic / Ollama /
// Workers AI, or none). The LLM only PICKS a tool; every critical parameter
// (price, amount, item) is re-extracted deterministically to prevent a model
// from inventing numbers.

export type ToolContext = { venue: string; env: unknown; role: string };
export type ToolResult = {
  reply: string;
  tool: string;
  data?: unknown;
  mutated?: boolean;
};

const MUTATE_ROLES = new Set(["manager", "merchant", "admin"]);
const canMutate = (role: string) => MUTATE_ROLES.has(role);
const NEEDS_MANAGER =
  "That change needs a manager or owner login — I can't do it from a staff session.";

const kes = (n: number) => `KES ${Number(n).toLocaleString("en-KE")}`;

function numbersIn(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])
    .map((s) => Number(s.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

// Amount that appears after a "to/at/=/now/for" cue wins (e.g. "price ... to 400");
// otherwise the largest number in the message.
function targetNumber(message: string): number | null {
  const cue = message.match(
    /(?:to|at|=|now|for|of)\s*(?:ksh?\.?|kes)?\s*(\d[\d,]*(?:\.\d+)?)/i,
  );
  if (cue) return Number(cue[1].replace(/,/g, ""));
  const nums = numbersIn(message);
  return nums.length ? Math.max(...nums) : null;
}

async function resolveMenuItem(
  ctx: ToolContext,
  message: string,
): Promise<MenuItem | null> {
  const sql = getSql(ctx.env);
  if (!sql) return null;
  const items = await getMenu(sql, ctx.venue, true);
  const m = message.toLowerCase();
  let best: MenuItem | null = null;
  for (const it of items) {
    if (it.name && m.includes(it.name.toLowerCase())) {
      if (!best || it.name.length > best.name.length) best = it;
    }
  }
  return best ?? findMenuItem(sql, ctx.venue, message);
}

const CATEGORIES = [
  "Starters",
  "Mains",
  "Sides",
  "Drinks",
  "Cocktails",
  "Desserts",
];

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function periodRange(message: string): { from: string; to: string; label: string } {
  const m = message.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  if (/yesterday/.test(m)) {
    const y = isoDaysAgo(1);
    return { from: y, to: y, label: "yesterday" };
  }
  if (/\b(this )?week\b|7 ?days|last 7/.test(m)) {
    return { from: isoDaysAgo(6), to: today, label: "the last 7 days" };
  }
  if (/\b(this )?month\b|30 ?days|last 30/.test(m)) {
    return { from: isoDaysAgo(29), to: today, label: "the last 30 days" };
  }
  return { from: today, to: today, label: "today" };
}

// --- Tools ------------------------------------------------------------------

async function toolSalesReport(
  message: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const sql = getSql(ctx.env);
  if (!sql) return { reply: "Sales data is unavailable right now.", tool: "sales_report" };
  const { from, to, label } = periodRange(message);
  const [row] = await sql`
    SELECT count(*)::int AS tx,
           coalesce(sum(amount), 0)::bigint AS gross,
           coalesce(sum(tip_amount), 0)::bigint AS tips
    FROM payments
    WHERE venue_id = ${ctx.venue}
      AND status IN ('succeeded', 'paid', 'captured')
      AND created_at::date BETWEEN ${from} AND ${to}`;
  const gross = Number(row?.gross ?? 0) / 100;
  const tips = Number(row?.tips ?? 0) / 100;
  const tx = Number(row?.tx ?? 0);
  const reply =
    tx === 0
      ? `No paid sales recorded for ${label} yet.`
      : `${label[0].toUpperCase()}${label.slice(1)}: ${kes(gross)} across ${tx} paid transaction${tx === 1 ? "" : "s"}${tips > 0 ? `, ${kes(tips)} in tips` : ""}.`;
  return { reply, tool: "sales_report", data: { from, to, gross, tips, tx } };
}

async function toolTopCustomers(
  _message: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const sql = getSql(ctx.env);
  if (!sql) return { reply: "Customer data is unavailable right now.", tool: "top_customers" };
  const rows = await sql`
    SELECT name, tier, total_spent
    FROM contacts
    WHERE venue_id = ${ctx.venue}
    ORDER BY total_spent DESC NULLS LAST
    LIMIT 5`;
  if (rows.length === 0) {
    return { reply: "No customers on file yet.", tool: "top_customers" };
  }
  const list = rows
    .map(
      (r, i) =>
        `${i + 1}. ${r.name} — ${kes(Number(r.total_spent ?? 0))} (${r.tier})`,
    )
    .join("\n");
  return { reply: `Top spenders:\n${list}`, tool: "top_customers", data: { rows } };
}

async function toolStockReport(
  _message: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const sql = getSql(ctx.env);
  if (!sql) return { reply: "Inventory is unavailable right now.", tool: "stock_report" };
  const rows = await sql`
    SELECT name, stock, reorder_level, unit
    FROM inventory_items
    WHERE venue_id = ${ctx.venue} AND active = true AND stock <= reorder_level
    ORDER BY (reorder_level - stock) DESC
    LIMIT 10`;
  if (rows.length === 0) {
    return {
      reply: "Nothing is below its reorder level — stock looks healthy.",
      tool: "stock_report",
    };
  }
  const list = rows
    .map(
      (r) =>
        `• ${r.name}: ${Number(r.stock)} ${r.unit} left (reorder at ${Number(r.reorder_level)})`,
    )
    .join("\n");
  return {
    reply: `${rows.length} item${rows.length === 1 ? "" : "s"} low on stock:\n${list}`,
    tool: "stock_report",
    data: { rows },
  };
}

async function toolSettlementStatus(
  _message: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const sql = getSql(ctx.env);
  if (!sql) return { reply: "Settlement data is unavailable right now.", tool: "settlement_status" };
  const [row] = await sql`
    SELECT coalesce(sum(amount) FILTER (WHERE settlement_id IS NULL), 0)::bigint AS unreconciled,
           count(*) FILTER (WHERE settlement_id IS NULL)::int AS unreconciled_tx
    FROM payments
    WHERE venue_id = ${ctx.venue}
      AND status IN ('succeeded', 'paid', 'captured')`;
  const unreconciled = Number(row?.unreconciled ?? 0) / 100;
  const n = Number(row?.unreconciled_tx ?? 0);
  const reply =
    n === 0
      ? "Everything is settled — no unreconciled payments."
      : `${kes(unreconciled)} across ${n} payment${n === 1 ? "" : "s"} is unsettled. Run a settlement in the Settlement tab to batch it.`;
  return { reply, tool: "settlement_status", data: { unreconciled, count: n } };
}

async function toolReprice(
  message: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!canMutate(ctx.role)) return { reply: NEEDS_MANAGER, tool: "reprice_item" };
  const sql = getSql(ctx.env);
  if (!sql) return { reply: "The menu is unavailable right now.", tool: "reprice_item" };
  const item = await resolveMenuItem(ctx, message);
  if (!item) {
    return {
      reply: "Which item should I reprice? I couldn't match that to your menu.",
      tool: "reprice_item",
    };
  }
  const price = targetNumber(message.replace(new RegExp(item.name, "i"), " "));
  if (price == null) {
    return {
      reply: `What's the new price for ${item.name}? (currently ${kes(item.price)})`,
      tool: "reprice_item",
    };
  }
  await sql`
    UPDATE menu_items SET price = ${price}
    WHERE id = ${item.id} AND venue_id = ${ctx.venue}`;
  return {
    reply: `Updated ${item.name}: ${kes(item.price)} → ${kes(price)}.`,
    tool: "reprice_item",
    mutated: true,
    data: { id: item.id, name: item.name, from: item.price, to: price },
  };
}

async function toolAvailability(
  message: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!canMutate(ctx.role))
    return { reply: NEEDS_MANAGER, tool: "item_availability" };
  const sql = getSql(ctx.env);
  if (!sql) return { reply: "The menu is unavailable right now.", tool: "item_availability" };
  const item = await resolveMenuItem(ctx, message);
  if (!item) {
    return {
      reply: "Which item? I couldn't match that to your menu.",
      tool: "item_availability",
    };
  }
  const m = message.toLowerCase();
  const makeAvailable =
    /\b(restock|re-?stock|back in stock|available|enable|show|resume|put back)\b/.test(
      m,
    ) &&
    !/\b(un-?available|not available|out of stock|sold ?out|86)\b/.test(m);
  await sql`
    UPDATE menu_items SET available = ${makeAvailable}
    WHERE id = ${item.id} AND venue_id = ${ctx.venue}`;
  return {
    reply: `${item.name} is now ${makeAvailable ? "available" : "off the menu (86'd)"}.`,
    tool: "item_availability",
    mutated: true,
    data: { id: item.id, name: item.name, available: makeAvailable },
  };
}

async function toolAddItem(
  message: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!canMutate(ctx.role)) return { reply: NEEDS_MANAGER, tool: "add_menu_item" };
  const sql = getSql(ctx.env);
  if (!sql) return { reply: "The menu is unavailable right now.", tool: "add_menu_item" };
  const price = targetNumber(message);
  const category =
    CATEGORIES.find((c) =>
      new RegExp(`\\b${c}\\b`, "i").test(message),
    ) ?? "Mains";
  const name = message
    .replace(/^\s*(please\s+)?add\s+(a\s+)?(new\s+)?(menu\s+)?(item\s+)?/i, "")
    .replace(/\bto (the )?menu\b/i, "")
    .replace(/\b(for|priced|price|costing|cost|at|@|=)\s*(ksh?\.?|kes)?\s*[\d,.]+/i, "")
    .replace(/\bin (the )?(starters|mains|sides|drinks|cocktails|desserts)\b/i, "")
    .replace(/[.,]+\s*$/, "")
    .trim();
  if (!name || price == null) {
    return {
      reply: "To add an item I need a name and a price, e.g. \"add Espresso to the menu for 250\".",
      tool: "add_menu_item",
    };
  }
  const [row] = await sql`
    INSERT INTO menu_items (venue_id, name, category, price)
    VALUES (${ctx.venue}, ${name}, ${category}, ${price})
    RETURNING id, name, category, price`;
  return {
    reply: `Added ${row.name} (${category}) at ${kes(Number(row.price))}.`,
    tool: "add_menu_item",
    mutated: true,
    data: row,
  };
}

async function toolCreateBill(
  message: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const amount = targetNumber(message);
  if (amount == null) {
    return {
      reply: "How much should I bill, and to which phone number?",
      tool: "create_bill",
    };
  }
  const phoneMatch = message.match(/\+?\d[\d\s-]{8,14}\d/);
  const phone = phoneMatch ? `+${phoneMatch[0].replace(/[^\d]/g, "")}` : null;
  const invoice = await createInvoice(ctx.env, {
    venue: ctx.venue,
    amount,
    phone,
    description: "Copilot bill",
    channel: phone ? "whatsapp" : undefined,
  });
  if ("error" in invoice) {
    return { reply: `Couldn't create the bill: ${invoice.error}`, tool: "create_bill" };
  }
  return {
    reply: `Bill ${invoice.number} for ${kes(invoice.amount)} created${phone ? ` and sent to ${phone}` : ""}.\n\nPay link 👇\n${invoice.payLink}`,
    tool: "create_bill",
    mutated: true,
    data: invoice,
  };
}

async function toolDraftCampaign(
  message: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!canMutate(ctx.role)) return { reply: NEEDS_MANAGER, tool: "draft_campaign" };
  const sql = getSql(ctx.env);
  if (!sql) return { reply: "Campaigns are unavailable right now.", tool: "draft_campaign" };
  const said = message.match(
    /(?:saying|message|that says|:|offer(?:ing)?|promo(?:ting)?)\s*(.+)$/i,
  );
  const body =
    said?.[1]?.trim() ||
    "We'd love to see you at {{venue}}, {{name}}! Reply to this message for our latest offers.";
  const name = `Copilot campaign ${new Date().toISOString().slice(0, 10)}`;
  const steps = JSON.stringify([{ delayHours: 0, message: body }]);
  const [row] = await sql`
    INSERT INTO sequences (venue_id, name, channel, steps, active)
    VALUES (${ctx.venue}, ${name}, 'whatsapp', ${steps}::jsonb, false)
    RETURNING id, name`;
  return {
    reply: `Drafted a paused campaign "${row.name}" with this message:\n\n"${body}"\n\nReview + activate it (and pick a segment) in Automations.`,
    tool: "draft_campaign",
    mutated: true,
    data: { id: row.id, name: row.name, message: body },
  };
}

// --- Router (LLM-agnostic) --------------------------------------------------

type Route = {
  name: string;
  describe: string;
  test: (m: string) => boolean;
  run: (message: string, ctx: ToolContext) => Promise<ToolResult>;
};

const ROUTES: Route[] = [
  {
    name: "sales_report",
    describe: "sales / revenue / takings for today or a period",
    test: (m) =>
      /\b(sales|revenue|takings|turnover|gross|earnings?|how much did we (make|sell|take)|how are we doing|how'?s business|performance|busy)\b/.test(
        m,
      ) && !/\b(price|bill|invoice|charge|campaign)\b/.test(m),
    run: toolSalesReport,
  },
  {
    name: "top_customers",
    describe: "highest-spending customers",
    test: (m) =>
      /\b(top|best|highest)\b[\s\w]{0,10}\b(customers?|spenders?|clients?)\b|\bvips?\b|most loyal/.test(
        m,
      ),
    run: toolTopCustomers,
  },
  {
    name: "reprice_item",
    describe: "change a menu item's price",
    test: (m) =>
      /\breprice\b/.test(m) ||
      (/\b(price|cost)\b/.test(m) &&
        /\d/.test(m) &&
        /\b(to|=|at|now|set|change|update|make|adjust)\b/.test(m)),
    run: toolReprice,
  },
  {
    name: "item_availability",
    describe: "mark a menu item available or unavailable (86 / restock)",
    test: (m) =>
      /\b86\b|sold ?out|out of stock|(?:un)?available|in ?stock|re-?stock|stop selling|put back on the menu|off the menu/.test(
        m,
      ),
    run: toolAvailability,
  },
  {
    name: "stock_report",
    describe: "inventory items that are low on stock / need reordering",
    test: (m) =>
      /\b(running low|low on stock|what'?s? low|reorder|reorder level|inventory levels?|stock levels?|low stock|running out)\b/.test(
        m,
      ),
    run: toolStockReport,
  },
  {
    name: "settlement_status",
    describe: "how much is unsettled / unreconciled / awaiting payout",
    test: (m) =>
      /\b(unsettled|unreconciled|un-reconciled|to settle|awaiting (settlement|payout)|how much.*(settle|payout))\b/.test(
        m,
      ),
    run: toolSettlementStatus,
  },
  {
    name: "add_menu_item",
    describe: "add a new item to the menu",
    test: (m) =>
      /\badd\b.*\b(to (the )?menu|menu item|new item)\b|\bnew menu item\b/.test(m),
    run: toolAddItem,
  },
  {
    name: "create_bill",
    describe: "create a payment link / invoice for an amount",
    test: (m) =>
      /\b(bill|invoice|charge|payment link|collect|pay ?link)\b/.test(m) &&
      /\d/.test(m),
    run: toolCreateBill,
  },
  {
    name: "draft_campaign",
    describe: "draft a marketing campaign or promo",
    test: (m) =>
      /\b(campaign|promo(tion)?|blast|broadcast|drip|marketing|win-?back)\b/.test(
        m,
      ) &&
      /\b(create|draft|set up|start|make|launch|run|send|new|do)\b/.test(m),
    run: toolDraftCampaign,
  },
];

function parseToolName(out: string): string | null {
  const cleaned = out.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { tool?: string };
    if (typeof parsed.tool === "string") return parsed.tool;
  } catch {
    /* fall back to a scan */
  }
  const scan = cleaned.match(
    /sales_report|top_customers|reprice_item|item_availability|add_menu_item|create_bill|draft_campaign/,
  );
  return scan ? scan[0] : null;
}

// Any-chat-model routing: ask the configured provider to name ONE tool as JSON.
// Works with OpenAI/Anthropic/Ollama/Workers AI or returns null when no provider
// is configured, so the deterministic pass above stays the source of truth.
async function llmRoute(
  message: string,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  const menu = ROUTES.map((r) => `- ${r.name}: ${r.describe}`).join("\n");
  const system = [
    "You route a restaurant/merchant owner's message to exactly one back-office tool.",
    "Tools:",
    menu,
    'Reply with ONLY compact JSON: {"tool":"<name or none>"}. No prose, no code fences.',
    'Use "none" if the message is a general question, greeting, or unclear.',
  ].join("\n");
  const out = await aiChat(
    [
      { role: "system", content: system },
      { role: "user", content: message },
    ],
    ctx.env,
  );
  if (!out) return null;
  const name = parseToolName(out);
  const route = ROUTES.find((r) => r.name === name);
  if (!route) return null;
  return route.run(message, ctx);
}

// Entry point: deterministic routing first (no LLM required), then an
// LLM-agnostic JSON tool-pick. Returns null when nothing matches so the caller
// can fall back to the conversational agent.
export async function runCopilotTools(
  message: string,
  ctx: ToolContext,
): Promise<ToolResult | null> {
  const m = message.toLowerCase();
  for (const route of ROUTES) {
    if (route.test(m)) return route.run(message, ctx);
  }
  return llmRoute(message, ctx);
}
