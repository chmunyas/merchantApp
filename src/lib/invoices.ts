import { getSql } from "@/lib/db";
import { getBaseUrl, payLink } from "@/lib/links";
import { invoiceIssueLines, postEntryInTransaction } from "@/lib/accounting";
import { validateInvoiceInput } from "@/lib/invoice-validation";
import { toMinorUnits } from "@/lib/currency";
import { invoiceNumber as sharedInvoiceNumber } from "@/lib/invoice-number";

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
  idempotencyKey?: string | null;
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
  return sharedInvoiceNumber();
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

  if (input.idempotencyKey) {
    const [existing] = await sql`
      SELECT id, number, amount, currency, pay_link
      FROM invoices
      WHERE venue_id = ${input.venue} AND idempotency_key = ${input.idempotencyKey}
      LIMIT 1`;
    if (existing) {
      return {
        id: String(existing.id),
        number: String(existing.number),
        amount: Number(existing.amount),
        currency: String(existing.currency),
        payLink: String(existing.pay_link),
        delivery: "duplicate",
      };
    }
  }

  const validated = validateInvoiceInput({
    amount: input.amount,
    currency: input.currency,
    lineItems: input.lineItems,
    taxRate: input.taxRate,
    dueDate: input.dueDate,
    expectedTotal: input.lineItems?.length ? input.amount : undefined,
  });
  if ("error" in validated) return validated;
  const { items, subtotal, taxRate, taxAmount, amount, currency, dueDate } = validated;

  const number = invoiceNumber();
  const base = await getBaseUrl(env);
  const link = payLink(base, { number });
  const channel = input.channel;
  const handle = input.handle ?? input.phone ?? null;

  const message = channel && handle
    ? invoiceMessage(number, currency, amount, link, {
        description: input.description,
        dueDate,
      })
    : null;
  const [invoice] = await sql.begin(async (tx) => {
    const [created] = await tx`
      INSERT INTO invoices (venue_id, number, customer_name, phone, amount, currency,
                            description, status, channel, conversation_id, pay_link,
                            subtotal, tax_rate, tax_amount, due_date, line_items, notes,
                            recurring_id, staff_id, idempotency_key)
      VALUES (${input.venue}, ${number}, ${input.customerName ?? null}, ${input.phone ?? null},
              ${amount}, ${currency}, ${input.description ?? null},
              'issued', ${channel ?? null}, NULL, ${link},
              ${subtotal}, ${taxRate}, ${taxAmount}, ${dueDate},
              ${tx.json(JSON.parse(JSON.stringify(items)))}, ${input.notes ?? null},
              ${input.recurringId ?? null}, ${input.staffId ?? null},
              ${input.idempotencyKey ?? null})
      RETURNING id`;
    await tx`
      INSERT INTO invoice_events (invoice_id, venue_id, type, detail, amount)
      VALUES (${created.id}, ${input.venue}, 'created', ${`Invoice ${number} issued`}, ${amount})`;
    await postEntryInTransaction(tx, {
      venue: input.venue,
      sourceType: "invoice",
      sourceId: number,
      currency,
      memo: `Invoice ${number} issued`,
      lines: invoiceIssueLines(
        toMinorUnits(subtotal, currency),
        toMinorUnits(taxAmount, currency),
      ),
    });
    if (message && channel && handle) {
      await tx`
        INSERT INTO invoice_communication_outbox
          (invoice_id, venue_id, purpose, channel, recipient, dedupe_key, payload)
        VALUES
          (${created.id}, ${input.venue}, 'initial', ${channel}, ${handle},
           ${`invoice:${created.id}:initial`},
           ${tx.json({ message, customerName: input.customerName ?? null })})`;
    }
    return [created];
  });

  return {
    id: invoice.id,
    number,
    amount,
    currency,
    payLink: link,
    delivery: message ? "queued" : "none",
  };
}

export async function listInvoices(sql: Sql, venue: string) {
  return sql`
    SELECT id, number, customer_name, phone, amount, currency, description,
           status, channel, pay_link, due_date, subtotal, tax_rate, tax_amount,
           amount_paid, line_items, reminder_count, recurring_id, created_at, paid_at,
           paid_ref,
           (amount - amount_paid) AS balance,
           CASE
             WHEN status IN ('paid','void') THEN status
             WHEN due_date IS NOT NULL AND due_date < CURRENT_DATE AND (amount - amount_paid) > 0 THEN 'overdue'
             WHEN amount_paid > 0 AND amount_paid < amount THEN 'partial'
             ELSE status
           END AS display_status
    FROM invoices WHERE venue_id = ${venue} ORDER BY created_at DESC LIMIT 200`;
}
