import { getAdapter } from "@/lib/channels";
import { getSql } from "@/lib/db";
import { getBaseUrl, payLink } from "@/lib/links";
import { postInvoiceIssueEntry } from "@/lib/accounting";

type Sql = NonNullable<ReturnType<typeof getSql>>;

export type LineItem = { description: string; qty: number; price: number };

export type CreateInvoiceInput = {
  venue: string;
  customerName?: string | null;
  phone?: string | null;
  amount: number; // used when no line items are provided
  currency?: string;
  description?: string | null;
  channel?: string; // deliver the pay link on this channel when a handle exists
  handle?: string | null; // channel-native recipient (defaults to phone)
  lineItems?: LineItem[];
  taxRate?: number; // percent, e.g. 16
  dueDate?: string | null; // YYYY-MM-DD
  notes?: string | null;
  recurringId?: string | null;
  staffId?: string | null; // attributes the invoice's payment + tip to a staff member
};

export type InvoiceResult = {
  id: string;
  number: string;
  amount: number;
  currency: string;
  payLink: string;
  delivery: string;
};

function invoiceNumber(): string {
  return `INV-${Date.now().toString(36).toUpperCase()}`;
}

// Log an entry to the per-invoice audit / comms trail.
export async function logInvoiceEvent(
  sql: Sql,
  venue: string,
  invoiceId: string,
  type: string,
  detail: string | null,
  extra: {
    amount?: number | null;
    channel?: string | null;
    delivery?: string | null;
  } = {},
): Promise<void> {
  try {
    await sql`
      INSERT INTO invoice_events (invoice_id, venue_id, type, detail, amount, channel, delivery)
      VALUES (${invoiceId}, ${venue}, ${type}, ${detail}, ${extra.amount ?? null},
              ${extra.channel ?? null}, ${extra.delivery ?? null})`;
  } catch {
    /* audit logging is best-effort */
  }
}

export function invoiceMessage(
  number: string,
  currency: string,
  amount: number,
  link: string,
  opts: { description?: string | null; dueDate?: string | null } = {},
): string {
  const due = opts.dueDate ? ` (due ${opts.dueDate})` : "";
  const forWhat = opts.description ? ` for ${opts.description}` : "";
  return `Invoice ${number}: ${currency} ${amount.toLocaleString()}${forWhat}${due}.\n\nTap to pay securely 👇\n${link}`;
}

// Create an invoice (with optional line items + tax + due date), build its pay
// link, deliver it on the chosen channel, reflect it in the conversation thread,
// and record the audit trail.
export async function createInvoice(
  env: unknown,
  input: CreateInvoiceInput,
): Promise<InvoiceResult | { error: string }> {
  const sql = getSql(env);
  if (!sql) return { error: "database not configured" };

  const items = input.lineItems ?? [];
  const subtotal =
    items.length > 0
      ? items.reduce((sum, it) => sum + Number(it.qty) * Number(it.price), 0)
      : input.amount;
  const taxRate = Number(input.taxRate ?? 0);
  const taxAmount = Math.round((subtotal * taxRate) / 100);
  const amount = subtotal + taxAmount;
  if (!amount || amount <= 0) return { error: "amount required" };

  const number = invoiceNumber();
  const currency = input.currency ?? "KES";
  const base = await getBaseUrl(env);
  const link = payLink(base, { number });
  const channel = input.channel;
  const handle = input.handle ?? input.phone ?? null;

  let conversationId: string | null = null;
  let delivery = "none";

  if (channel && handle) {
    const message = invoiceMessage(number, currency, amount, link, {
      description: input.description,
      dueDate: input.dueDate,
    });
    try {
      const out = await getAdapter(channel).send(handle, message, env);
      delivery = out.delivery;
      const [conversation] = await sql`
        INSERT INTO conversations (venue_id, wa_id, name, role, channel)
        VALUES (${input.venue}, ${handle}, ${input.customerName ?? null}, 'customer', ${channel})
        ON CONFLICT (venue_id, wa_id) DO UPDATE SET last_message_at = now()
        RETURNING id`;
      conversationId = conversation.id;
      await sql`
        INSERT INTO messages (conversation_id, direction, body, ai, channel)
        VALUES (${conversationId}, 'outbound', ${message}, false, ${channel})`;
    } catch {
      delivery = "failed";
    }
  }

  const status = channel && handle ? "sent" : "draft";
  const [invoice] = await sql`
    INSERT INTO invoices (venue_id, number, customer_name, phone, amount, currency,
                          description, status, channel, conversation_id, pay_link,
                          subtotal, tax_rate, tax_amount, due_date, line_items, notes,
                          recurring_id, staff_id)
    VALUES (${input.venue}, ${number}, ${input.customerName ?? null}, ${input.phone ?? null},
            ${amount}, ${currency}, ${input.description ?? null},
            ${status}, ${channel ?? null}, ${conversationId}, ${link},
            ${subtotal}, ${taxRate}, ${taxAmount}, ${input.dueDate ?? null},
            ${sql.json(JSON.parse(JSON.stringify(items)))}, ${input.notes ?? null},
            ${input.recurringId ?? null}, ${input.staffId ?? null})
    RETURNING id`;

  await logInvoiceEvent(
    sql,
    input.venue,
    invoice.id,
    "created",
    `Invoice ${number} created`,
    { amount },
  );
  if (channel && handle) {
    await logInvoiceEvent(sql, input.venue, invoice.id, "sent", `Sent via ${channel}`, {
      channel,
      delivery,
    });
  }

  // Recognise revenue on account (accrual): the invoice becomes a receivable.
  // Invoice amounts are whole KES; the ledger is in minor units, so scale ×100.
  try {
    await postInvoiceIssueEntry(sql, {
      venue: input.venue,
      number,
      subtotal: subtotal * 100,
      tax: taxAmount * 100,
      currency,
    });
  } catch {
    /* best-effort accounting */
  }

  return { id: invoice.id, number, amount, currency, payLink: link, delivery };
}

export async function listInvoices(sql: Sql, venue: string) {
  return sql`
    SELECT id, number, customer_name, phone, amount, currency, description,
           status, channel, pay_link, due_date, subtotal, tax_rate, tax_amount,
           amount_paid, line_items, reminder_count, recurring_id, created_at, paid_at,
           (amount - amount_paid) AS balance,
           CASE
             WHEN status IN ('paid','void') THEN status
             WHEN due_date IS NOT NULL AND due_date < CURRENT_DATE AND (amount - amount_paid) > 0 THEN 'overdue'
             WHEN amount_paid > 0 AND amount_paid < amount THEN 'partial'
             ELSE status
           END AS display_status
    FROM invoices WHERE venue_id = ${venue} ORDER BY created_at DESC LIMIT 200`;
}
