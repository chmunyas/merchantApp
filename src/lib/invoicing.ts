import { getAdapter } from "@/lib/channels";
import { getSql } from "@/lib/db";
import { getBaseUrl, payLink } from "@/lib/links";
import { createInvoice, logInvoiceEvent } from "@/lib/invoices";
import { postInvoicePaymentEntry } from "@/lib/accounting";

type Sql = NonNullable<ReturnType<typeof getSql>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// Record a (partial or full) payment against an invoice.
export async function recordPayment(
  env: unknown,
  venue: string,
  invoiceId: string,
  amount: number,
): Promise<Record<string, unknown>> {
  const sql = getSql(env);
  if (!sql) return { error: "database not configured" };
  const [invoice] = await sql`
    SELECT amount, amount_paid, currency, number FROM invoices
    WHERE id = ${invoiceId} AND venue_id = ${venue}`;
  if (!invoice) return { error: "invoice not found" };

  const total = Number(invoice.amount);
  const newPaid = Number(invoice.amount_paid) + Number(amount);
  const paid = newPaid >= total;
  if (paid) {
    await sql`
      UPDATE invoices SET amount_paid = ${newPaid}, status = 'paid', paid_at = now()
      WHERE id = ${invoiceId}`;
  } else {
    await sql`
      UPDATE invoices SET amount_paid = ${newPaid}, status = 'partial'
      WHERE id = ${invoiceId}`;
  }
  await logInvoiceEvent(
    sql,
    venue,
    invoiceId,
    paid ? "paid" : "payment",
    `Payment ${invoice.currency} ${Number(amount).toLocaleString()}`,
    { amount },
  );
  // Settle the receivable in the general ledger (Dr Cash, Cr A/R). Idempotent
  // per cumulative-paid amount; best-effort so bookkeeping never fails a payment.
  // Invoice amounts are whole KES; the ledger is in minor units (×100).
  try {
    await postInvoicePaymentEntry(sql, {
      venue,
      sourceId: `${invoiceId}:${newPaid}`,
      amount: Number(amount) * 100,
      currency: invoice.currency as string,
    });
  } catch {
    /* best-effort accounting */
  }
  return { ok: true, status: paid ? "paid" : "partial", balance: total - newPaid };
}

// Send a payment reminder for one invoice on its own channel, tracking it.
export async function sendReminder(
  env: unknown,
  venue: string,
  invoice: Row,
): Promise<string> {
  const sql = getSql(env);
  if (!sql) return "no-db";
  const handle = invoice.phone as string | null;
  if (!handle) return "no-recipient";
  const channel = (invoice.channel as string) || "whatsapp";
  const balance = Number(invoice.amount) - Number(invoice.amount_paid);
  const dueText = invoice.due_date
    ? `due ${new Date(invoice.due_date).toISOString().slice(0, 10)}`
    : "outstanding";
  const base = await getBaseUrl(env);
  const link = payLink(base, { number: invoice.number });
  const message = `Friendly reminder: invoice ${invoice.number} for ${invoice.currency} ${balance.toLocaleString()} is ${dueText}.\n\nTap to pay securely 👇\n${link}`;

  let delivery = "failed";
  try {
    const out = await getAdapter(channel).send(handle, message, env, venue);
    delivery = out.delivery;
    const [conversation] = await sql`
      INSERT INTO conversations (venue_id, wa_id, name, role, channel)
      VALUES (${venue}, ${handle}, ${invoice.customer_name ?? null}, 'customer', ${channel})
      ON CONFLICT (venue_id, wa_id) DO UPDATE SET last_message_at = now()
      RETURNING id`;
    await sql`
      INSERT INTO messages (conversation_id, direction, body, ai, channel)
      VALUES (${conversation.id}, 'outbound', ${message}, false, ${channel})`;
  } catch {
    delivery = "failed";
  }
  await sql`
    UPDATE invoices SET reminder_count = reminder_count + 1, last_reminder_at = now()
    WHERE id = ${invoice.id}`;
  await logInvoiceEvent(
    sql,
    venue,
    invoice.id as string,
    "reminder",
    `Reminder #${Number(invoice.reminder_count) + 1}`,
    { channel, delivery },
  );
  return delivery;
}

// Auto-send reminders for invoices due within 2 days or overdue (max 3, once
// per ~day). Safe to call repeatedly from the sweep.
export async function runReminders(
  env: unknown,
  venue: string,
): Promise<{ sent: number }> {
  const sql = getSql(env);
  if (!sql) return { sent: 0 };
  const due = await sql`
    SELECT id, number, customer_name, phone, channel, amount, amount_paid,
           currency, due_date, pay_link, reminder_count
    FROM invoices
    WHERE venue_id = ${venue} AND status NOT IN ('paid','void') AND phone IS NOT NULL
      AND due_date IS NOT NULL AND due_date <= CURRENT_DATE + 2
      AND (amount - amount_paid) > 0
      AND reminder_count < 3
      AND (last_reminder_at IS NULL OR last_reminder_at < now() - interval '20 hours')
    ORDER BY due_date LIMIT 50`;
  let sent = 0;
  for (const invoice of due) {
    await sendReminder(env, venue, invoice);
    sent += 1;
  }
  return { sent };
}

// Generate + (optionally) send any due recurring invoices, then reschedule.
export async function runRecurring(
  env: unknown,
  venue: string,
): Promise<{ generated: number }> {
  const sql = getSql(env);
  if (!sql) return { generated: 0 };
  const due = await sql`
    SELECT id, customer_name, phone, channel, amount, currency, description,
           cadence, due_days, auto_send
    FROM recurring_invoices
    WHERE venue_id = ${venue} AND active AND next_run_at <= now()
    ORDER BY next_run_at LIMIT 50`;
  let generated = 0;
  for (const schedule of due) {
    const dueDate = new Date(
      Date.now() + Number(schedule.due_days) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const result = await createInvoice(env, {
      venue,
      customerName: schedule.customer_name as string | null,
      phone: schedule.phone as string | null,
      amount: Number(schedule.amount),
      currency: schedule.currency as string,
      description: schedule.description as string | null,
      channel: schedule.auto_send ? (schedule.channel as string) : undefined,
      dueDate,
      recurringId: schedule.id as string,
    });
    if (!("error" in result)) generated += 1;
    const interval = schedule.cadence === "weekly" ? "7 days" : "1 month";
    await sql`
      UPDATE recurring_invoices
      SET last_run_at = now(), next_run_at = now() + (${interval})::interval
      WHERE id = ${schedule.id}`;
  }
  return { generated };
}

export async function invoiceStats(sql: Sql, venue: string): Promise<Row> {
  const [row] = await sql`
    SELECT
      coalesce(sum(amount - amount_paid) FILTER (WHERE status NOT IN ('paid','void')), 0)::numeric AS outstanding,
      coalesce(sum(amount - amount_paid) FILTER (WHERE status NOT IN ('paid','void') AND due_date < CURRENT_DATE), 0)::numeric AS overdue,
      coalesce(sum(amount_paid), 0)::numeric AS collected,
      count(*) FILTER (WHERE status NOT IN ('paid','void') AND (amount - amount_paid) > 0)::int AS open_count,
      count(*) FILTER (WHERE status = 'paid')::int AS paid_count,
      count(*) FILTER (WHERE status = 'draft')::int AS draft_count
    FROM invoices WHERE venue_id = ${venue}`;
  return row;
}
