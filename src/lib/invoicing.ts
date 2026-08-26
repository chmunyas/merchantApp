import { queueOutbound } from "@/lib/outbound-jobs";
import type { ChannelId } from "@/lib/channels/types";
import { getSql } from "@/lib/db";
import type { QuerySql } from "@/lib/db";
import { getBaseUrl, payLink } from "@/lib/links";
import { createInvoice } from "@/lib/invoices";
import {
  DEFAULT_CURRENCY,
  fromMinorUnits,
  normalizeCurrency,
  toMinorUnits,
} from "@/lib/currency";
import { invoicePaymentLines, postEntryInTransaction } from "@/lib/accounting";

type Sql = NonNullable<ReturnType<typeof getSql>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export async function processInvoiceCommunications(
  env: unknown,
  limit = 50,
): Promise<{ accepted: number; failed: number }> {
  const sql = getSql(env);
  if (!sql) return { accepted: 0, failed: 0 };
  const claimToken = crypto.randomUUID();
  const rows = await sql`
    WITH candidates AS (
      SELECT id FROM invoice_communication_outbox
      WHERE ((status IN ('pending','failed','queued') AND next_attempt_at <= now())
          OR (status = 'processing' AND lease_expires_at < now()))
      ORDER BY next_attempt_at, created_at
      LIMIT ${Math.max(1, Math.min(100, limit))}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE invoice_communication_outbox o
    SET status = 'processing', claim_token = ${claimToken},
        lease_expires_at = now() + interval '2 minutes', attempts = attempts + 1
    FROM candidates c WHERE o.id = c.id
    RETURNING o.id, o.invoice_id, o.venue_id, o.purpose, o.channel,
              o.recipient, o.payload, o.attempts, o.claim_token`;
  let accepted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const message = String((row.payload as Record<string, unknown>)?.message ?? "");
      if (!message) throw new Error("invoice message missing");
      const delivery = await queueOutbound(env, {
        deliveryKey: `invoice:${row.id}`,
        venue: String(row.venue_id),
        sourceType: "invoice_communication",
        sourceId: String(row.id),
        channel: String(row.channel) as ChannelId,
        handle: String(row.recipient),
        purpose: "transactional",
        body: message,
      });
      const [deliveryState] = await sql`
        SELECT id, status FROM outbound_deliveries
        WHERE delivery_key = ${`invoice:${row.id}`}`;
      if (!deliveryState) throw new Error("invoice delivery queue missing");
      if (!["accepted", "delivered", "read", "pull"].includes(String(deliveryState.status))) {
        await sql`
          UPDATE invoice_communication_outbox
          SET status = 'queued', claim_token = NULL, lease_expires_at = NULL,
              provider_id = ${String(deliveryState.id)},
              next_attempt_at = now() + interval '2 minutes'
          WHERE id = ${row.id} AND claim_token = ${row.claim_token}`;
        continue;
      }
      await sql.begin(async (tx) => {
        const [done] = await tx`
          UPDATE invoice_communication_outbox
          SET status = 'accepted', accepted_at = now(), lease_expires_at = NULL,
                last_error = NULL, provider_id = ${delivery.id ?? String(deliveryState.id)}
              WHERE id = ${row.id} AND status = 'processing'
            AND claim_token = ${row.claim_token}::uuid
          RETURNING id`;
        if (!done) throw new Error("invoice communication lease lost");
        await tx`
          UPDATE invoices SET
            status = CASE WHEN status = 'issued' THEN 'sent' ELSE status END,
            reminder_count = reminder_count + CASE WHEN ${String(row.purpose)} = 'reminder' THEN 1 ELSE 0 END,
            last_reminder_at = CASE WHEN ${String(row.purpose)} = 'reminder' THEN now() ELSE last_reminder_at END
          WHERE id = ${row.invoice_id} AND venue_id = ${row.venue_id}`;
        await tx`
          INSERT INTO invoice_events
            (invoice_id, venue_id, type, detail, channel, delivery)
          VALUES
            (${row.invoice_id}, ${row.venue_id}, ${String(row.purpose)},
             ${`Accepted by ${row.channel}`}, ${row.channel}, 'accepted')`;
      });
      accepted += 1;
    } catch (error) {
      const delay = Math.min(3600, 2 ** Math.min(Number(row.attempts ?? 1), 10));
      await sql`
        UPDATE invoice_communication_outbox
        SET status = 'failed', lease_expires_at = NULL,
            last_error = ${error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000)},
            next_attempt_at = now() + make_interval(secs => ${delay})
        WHERE id = ${row.id} AND status = 'processing'
          AND claim_token = ${row.claim_token}::uuid`;
      failed += 1;
    }
  }
  return { accepted, failed };
}

// Invoice payments settle through `settleInvoicePayment` below, driven by the
// financial outbox. A direct writer used to live here; it is deliberately gone.
// See BACKLOG.md "Payments & settlement".

export async function settleInvoicePayment(
  sql: QuerySql,
  input: {
    venue: string;
    invoiceNumber: string;
    paymentId: string;
    amountMinor: number;
    providerRef?: string | null;
  },
): Promise<{ status: string; appliedMajor: number } | null> {
  const settle = async (tx: QuerySql) => {
    const [invoice] = await tx`
      SELECT id, amount, currency
      FROM invoices
      WHERE venue_id = ${input.venue} AND number = ${input.invoiceNumber}
      FOR UPDATE`;
    if (!invoice) return null;
    if (String(invoice.status) === "void") {
      throw new Error("cannot settle a void invoice");
    }
    const [existing] = await tx`
      SELECT 1 FROM invoice_events
      WHERE invoice_id = ${invoice.id}
        AND type = 'payment'
        AND detail = ${`payment:${input.paymentId}`}
      LIMIT 1`;
    const requestedMinor = Math.max(0, Math.round(input.amountMinor));
    const [appliedTotals] = await tx`
      SELECT COALESCE(sum(amount), 0)::numeric AS applied
      FROM invoice_events
      WHERE invoice_id = ${invoice.id} AND type = 'payment'`;
    // The invoice's own currency decides major↔minor: UGX/TZS have no cents.
    const currency = normalizeCurrency(invoice.currency) ?? DEFAULT_CURRENCY;
    const remainingMinor = Math.max(
      0,
      toMinorUnits(Number(invoice.amount), currency) -
        toMinorUnits(Number(appliedTotals?.applied ?? 0), currency),
    );
    const appliedMinor = Math.min(requestedMinor, remainingMinor);
    const excessMinor = requestedMinor - appliedMinor;
    const requestedMajor = fromMinorUnits(appliedMinor, currency);
    if (!existing) {
      await tx`
        INSERT INTO invoice_events
          (invoice_id, venue_id, type, detail, amount)
        VALUES
          (${invoice.id}, ${input.venue}, 'payment', ${`payment:${input.paymentId}`},
           ${requestedMajor})`;
      if (appliedMinor > 0) {
        await postEntryInTransaction(tx, {
          venue: input.venue,
          sourceType: "invoice_payment",
          sourceId: input.paymentId,
          currency: String(invoice.currency ?? "KES"),
          memo: "Invoice payment (A/R settled)",
          lines: invoicePaymentLines(appliedMinor),
        });
      }
      if (excessMinor > 0) {
        await postEntryInTransaction(tx, {
          venue: input.venue,
          sourceType: "invoice_overpayment",
          sourceId: input.paymentId,
          currency: String(invoice.currency ?? "KES"),
          memo: "Unapplied invoice customer credit",
          lines: [
            { account: "1000", debit: excessMinor },
            { account: "2200", credit: excessMinor },
          ],
        });
      }
    }
    const reconciled = await reconcileInvoiceBalance(tx, {
      venue: input.venue,
      invoiceNumber: input.invoiceNumber,
      providerRef: input.providerRef,
    });
    return reconciled
      ? { status: reconciled.status, appliedMajor: existing ? 0 : requestedMajor }
      : null;
  };
  return "begin" in sql ? sql.begin(settle) : settle(sql);
}

export async function reconcileInvoiceBalance(
  sql: QuerySql,
  input: {
    venue: string;
    invoiceNumber: string;
    providerRef?: string | null;
  },
): Promise<{ status: string; paidMajor: number } | null> {
  const [invoice] = await sql`
    SELECT id, amount, status FROM invoices
    WHERE venue_id = ${input.venue} AND number = ${input.invoiceNumber}
    FOR UPDATE`;
  if (!invoice) return null;
  if (String(invoice.status) === "void") {
    return { status: "void", paidMajor: 0 };
  }
  const [totals] = await sql`
    SELECT
      COALESCE((
        SELECT sum(p.amount - COALESCE(p.tip_amount, 0))
        FROM payments p
        WHERE p.venue_id = ${input.venue} AND p.kind <> 'refund'
          AND p.metadata->>'invoice_number' = ${input.invoiceNumber}
          AND p.status IN ('succeeded','paid','captured','partially_refunded','refunded')
      ), 0)::bigint AS collected,
      COALESCE((
        SELECT sum(
          (fps.principal_amount * fr.cumulative_after / fps.gross_amount) -
          (fps.principal_amount * fr.cumulative_before / fps.gross_amount)
        )
        FROM financial_reversals fr
        JOIN financial_payment_snapshots fps ON fps.payment_id = fr.payment_id
        WHERE fr.venue_id = ${input.venue}
          AND fps.metadata->>'invoice_number' = ${input.invoiceNumber}
      ), 0)::bigint AS refunded`;
  const total = Number(invoice.amount);
  const paidMajor = Math.min(
    total,
    Math.max(0, (Number(totals?.collected ?? 0) - Number(totals?.refunded ?? 0)) / 100),
  );
  const status = paidMajor <= 0 ? "sent" : paidMajor >= total ? "paid" : "partial";
  await sql`
    UPDATE invoices
    SET amount_paid = ${paidMajor}, status = ${status},
        paid_at = CASE WHEN ${status} = 'paid' THEN COALESCE(paid_at, now()) ELSE NULL END,
        paid_ref = COALESCE(${input.providerRef ?? null}, paid_ref)
    WHERE id = ${invoice.id}`;
  return { status, paidMajor };
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

  const reminderNumber = Number(invoice.reminder_count) + 1;
  const [queued] = await sql`
    INSERT INTO invoice_communication_outbox
      (invoice_id, venue_id, purpose, channel, recipient, dedupe_key, payload)
    VALUES
      (${invoice.id}, ${venue}, 'reminder', ${channel}, ${handle},
       ${`invoice:${invoice.id}:reminder:${reminderNumber}`},
       ${sql.json({ message, customerName: invoice.customer_name ?? null })})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`;
  return queued ? "queued" : "already-queued";
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
    const queued = await sendReminder(env, venue, invoice);
    if (queued === "queued") sent += 1;
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
  let generated = 0;
  for (let i = 0; i < 50; i += 1) {
    type DueSchedule = {
      id: string;
      customer_name: string | null;
      phone: string | null;
      channel: string;
      amount: number | string;
      currency: string;
      description: string | null;
      cadence: string;
      due_days: number | string;
      auto_send: boolean;
      next_run_at: string;
      occurrence_id: string;
    };
    const schedule = await sql.begin(async (tx): Promise<DueSchedule | null> => {
      const [row] = await tx<DueSchedule[]>`
        SELECT id, customer_name, phone, channel, amount, currency, description,
               cadence, due_days, auto_send, next_run_at
        FROM recurring_invoices
        WHERE venue_id = ${venue} AND active AND next_run_at <= now()
        ORDER BY next_run_at LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      if (!row) return null;
      const [occurrence] = await tx`
        INSERT INTO recurring_invoice_occurrences (schedule_id, scheduled_for)
        VALUES (${row.id}, ${row.next_run_at})
        ON CONFLICT (schedule_id, scheduled_for) DO NOTHING
        RETURNING id`;
      if (occurrence) return { ...row, occurrence_id: String(occurrence.id) };
      const [recoverable] = await tx`
        SELECT id FROM recurring_invoice_occurrences
        WHERE schedule_id = ${row.id} AND scheduled_for = ${row.next_run_at}
          AND status IN ('pending','failed')
        FOR UPDATE`;
      if (!recoverable) return null;
      await tx`
        UPDATE recurring_invoice_occurrences
        SET status = 'pending', last_error = NULL
        WHERE id = ${recoverable.id}`;
      return { ...row, occurrence_id: String(recoverable.id) };
    });
    if (!schedule) break;
    const dueDate = new Date(
      new Date(schedule.next_run_at).getTime() + Number(schedule.due_days) * 86_400_000,
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
    await sql.begin(async (tx) => {
      if ("error" in result) {
        await tx`
          UPDATE recurring_invoice_occurrences
          SET status = 'failed', last_error = ${result.error}
          WHERE id = ${schedule.occurrence_id}`;
        return;
      }
      await tx`
        UPDATE recurring_invoice_occurrences
        SET status = 'created', invoice_id = ${result.id}
        WHERE id = ${schedule.occurrence_id}`;
      await tx`
        UPDATE recurring_invoices
        SET last_run_at = ${schedule.next_run_at},
            next_run_at = ${schedule.next_run_at} + (${interval})::interval
        WHERE id = ${schedule.id}`;
    });
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
