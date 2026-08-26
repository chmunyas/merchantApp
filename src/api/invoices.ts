import { getSql } from "@/lib/db";
import {
  createInvoice,
  listInvoices,
  type LineItem,
} from "@/lib/invoices";
import {
  invoiceStats,
  processInvoiceCommunications,
  sendReminder,
} from "@/lib/invoicing";
import { getBaseUrl, payLink } from "@/lib/links";
import { invoiceIssueLines, postEntryInTransaction } from "@/lib/accounting";
import { requireAuth, resolveVenue } from "@/api/auth";
import { tokenHasScope } from "@/lib/api-tokens";
import { roleAtLeast } from "@/lib/rbac";
import { createInvoicePaymentHold } from "@/lib/invoice-payment-holds";
import { validateInvoiceInput } from "@/lib/invoice-validation";
import { computeGuestServiceFee } from "@/lib/fees";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export async function handleInvoiceRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/invoices")) return null;

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = await resolveVenue(request, env, url);

  // Public: resolve a short pay link (/pay?i=INV-XXX) to its amount + merchant.
  if (path === "/api/invoices/payinfo" && request.method === "GET") {
    const number = url.searchParams.get("number");
    if (!number) return json({ error: "number required" }, 400);
    const [inv] = await sql`
      SELECT i.id, i.number, i.amount, i.amount_paid, i.currency, i.status, i.staff_id,
             i.venue_id, i.paid_ref,
             v.name AS merchant, vb.logo_url, vb.primary_color,
             o.name AS org_name, o.branding AS org_branding
      FROM invoices i
      LEFT JOIN venues v ON v.id = i.venue_id
      LEFT JOIN venue_branding vb ON vb.venue_id = i.venue_id
      LEFT JOIN organizations o ON o.id = v.org_id
      WHERE i.number = ${number} LIMIT 1`;
    if (!inv) return json({ error: "not found" }, 404);
    const org = (inv.org_branding ?? {}) as Record<string, unknown>;
    if (["paid", "void"].includes(String(inv.status))) {
      return json({
        till: inv.number,
        amount: 0,
        merchant: inv.merchant ?? "PesaSwap",
        currency: inv.currency,
        status: inv.status,
        venue: inv.venue_id ?? null,
        paidRef: inv.paid_ref ?? null,
        logoUrl: inv.logo_url ?? null,
        primaryColor: inv.primary_color ?? null,
        poweredBy: inv.org_name
          ? ((org.poweredBy as string) ?? `Powered by ${inv.org_name}`)
          : null,
        paymentIntentToken: null,
      });
    }
    const intent = await createInvoicePaymentHold(sql, {
      invoiceId: String(inv.id),
      venue: String(inv.venue_id),
    });
    if ("error" in intent) return json({ error: intent.error }, intent.status);
    const payableAmount = intent.amountMinor / 100;
    // A5.5: quote the guest-side fee server-side so the pay page can be explicit
    // about what — if anything — the guest pays on top before they commit.
    const guestFee = computeGuestServiceFee(intent.amountMinor);
    return json({
      till: inv.number,
      amount: payableAmount,
      merchant: inv.merchant ?? "PesaSwap",
      currency: inv.currency,
      status: inv.status,
      venue: inv.venue_id ?? null,
      paidRef: inv.paid_ref ?? null,
      logoUrl: inv.logo_url ?? null,
      primaryColor: inv.primary_color ?? null,
      poweredBy: inv.org_name
        ? ((org.poweredBy as string) ?? `Powered by ${inv.org_name}`)
        : null,
      staffId: inv.staff_id ?? null,
      guestFee: {
        enabled: guestFee.enabled,
        amount: guestFee.fee / 100,
        percent: guestFee.percent,
        fixed: guestFee.fixed / 100,
        benefits: guestFee.benefits,
        optOut: guestFee.optOut,
      },
      paymentIntentToken: intent.token,
    });
  }

  if (path === "/api/invoices" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!tokenHasScope(payload, "invoices:read")) return json({ error: "forbidden" }, 403);
    return json({ invoices: await listInvoices(sql, venue) });
  }

  if (path === "/api/invoices/stats" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "analytics:read")) {
      return json({ error: "forbidden" }, 403);
    }
    return json(await invoiceStats(sql, venue));
  }

  if (path === "/api/invoices" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!tokenHasScope(payload, "invoices:write")) return json({ error: "forbidden" }, 403);
    const body = (await request.json()) as {
      venue?: string;
      customerName?: string;
      phone?: string;
      amount?: number;
      currency?: string;
      description?: string;
      channel?: string;
      lineItems?: LineItem[];
      taxRate?: number;
      dueDate?: string;
      notes?: string;
    };
    const result = await createInvoice(env, {
      venue,
      customerName: body.customerName ?? null,
      phone: body.phone ?? null,
      amount: Number(body.amount ?? 0),
      currency: body.currency,
      description: body.description ?? null,
      channel: body.channel,
      lineItems: body.lineItems,
      taxRate: body.taxRate,
      dueDate: body.dueDate ?? null,
      notes: body.notes ?? null,
      staffId: typeof payload.staff_id === "string" ? payload.staff_id : null,
    });
    if ("error" in result) return json(result, 400);
    if (result.delivery === "queued") {
      void processInvoiceCommunications(env, 10).catch(() => {});
    }
    return json(result, 201);
  }

  // Publish a client-side (MerchantApp / pesaswapApp) invoice to Postgres so its
  // shared link + QR resolve to a real, payable /pay?i=<number> page. Idempotent:
  // keyed on the client id as the invoice `number` (UPSERT). Preserves an existing
  // paid/void status and amount_paid so re-sharing never resets a real payment.
  if (path === "/api/invoices/publish" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "invoices:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const body = (await request.json()) as {
      id?: string;
      amount?: number;
      currency?: string;
      customer?: string | null;
      phone?: string | null;
      note?: string | null;
      status?: string | null;
    };
    const number = (body.id ?? "").trim();
    if (!number) return json({ error: "id required" }, 400);
    const validated = validateInvoiceInput({
      amount: body.amount,
      currency: body.currency,
    });
    if ("error" in validated) return json(validated, 400);
    const { amount, currency } = validated;
    const base = await getBaseUrl(env);
    const link = payLink(base, { number });
    const outcome = await sql.begin(async (tx) => {
      const [existing] = await tx`
        SELECT id, amount, currency, customer_name, phone, description, pay_link
        FROM invoices WHERE venue_id = ${venue} AND number = ${number}
        FOR UPDATE`;
      if (existing) {
        const same = Number(existing.amount) === amount &&
          String(existing.currency) === currency &&
          String(existing.customer_name ?? "") === String(body.customer ?? "") &&
          String(existing.phone ?? "") === String(body.phone ?? "") &&
          String(existing.description ?? "") === String(body.note ?? "");
        return same
          ? { replay: true, payLink: String(existing.pay_link ?? link) }
          : { conflict: true };
      }
      await tx`
        INSERT INTO invoices (venue_id, number, customer_name, phone, amount,
                              currency, description, status, pay_link,
                              subtotal, tax_rate, tax_amount)
        VALUES (${venue}, ${number}, ${body.customer ?? null}, ${body.phone ?? null},
                ${amount}, ${currency}, ${body.note ?? null}, 'issued', ${link},
                ${amount}, 0, 0)`;
      await postEntryInTransaction(tx, {
        venue,
        sourceType: "invoice",
        sourceId: number,
        currency,
        memo: `Invoice ${number} issued`,
        lines: invoiceIssueLines(amount * 100, 0),
      });
      return { replay: false, payLink: link };
    });
    if ("conflict" in outcome) {
      return json({ error: "invoice already exists with different economics" }, 409);
    }
    return json({ number, payLink: outcome.payLink, replay: outcome.replay });
  }

  const activityMatch = path.match(/^\/api\/invoices\/([^/]+)\/activity$/);
  if (activityMatch && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!tokenHasScope(payload, "invoices:read")) return json({ error: "forbidden" }, 403);
    const events = await sql`
      SELECT type, detail, amount, channel, delivery, created_at
      FROM invoice_events
      WHERE invoice_id = ${activityMatch[1]} AND venue_id = ${venue}
      ORDER BY created_at`;
    const communications = await sql`
      SELECT purpose, channel, recipient, status, attempts, provider_id,
             last_error, next_attempt_at, accepted_at, created_at
      FROM invoice_communication_outbox
      WHERE invoice_id = ${activityMatch[1]} AND venue_id = ${venue}
      ORDER BY created_at`;
    return json({ events, communications });
  }

  const idMatch = path.match(/^\/api\/invoices\/([^/]+)\/(paid|pay|remind|resend|void)$/);
  if (idMatch && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    const [, id, action] = idMatch;
    if (!tokenHasScope(payload, "invoices:write")) return json({ error: "forbidden" }, 403);
    if (["paid", "pay", "void"].includes(action) && !roleAtLeast(payload, "manager")) {
      return json({ error: "forbidden" }, 403);
    }

    if (action === "paid" || action === "pay") {
      return json(
        { error: "Manual settlement is disabled; use a server-bound payment link." },
        409,
      );
    }

    if (action === "remind" || action === "resend") {
      const [inv] = await sql`
        SELECT id, number, customer_name, phone, channel, amount, amount_paid,
               currency, due_date, pay_link, reminder_count
        FROM invoices WHERE id = ${id} AND venue_id = ${venue}`;
      if (!inv) return json({ error: "invoice not found" }, 404);
      if (!inv.phone) return json({ error: "no recipient phone on invoice" }, 400);
      const delivery = await sendReminder(env, venue, inv);
      return json({ ok: true, delivery });
    }

    if (action === "void") {
      const key = request.headers.get("Idempotency-Key")?.trim();
      if (!key) return json({ error: "Idempotency-Key required" }, 400);
      const body = (await request.json().catch(() => ({}))) as { reason?: string };
      const reason = String(body.reason ?? "").trim();
      if (!reason) return json({ error: "void reason required" }, 400);
      const actor = String(payload.sub ?? "merchant");
      const result = await sql.begin(async (tx) => {
        const [invoice] = await tx`
          SELECT id, number, amount, amount_paid, subtotal, tax_amount, currency, status
          FROM invoices WHERE id = ${id} AND venue_id = ${venue}
          FOR UPDATE`;
        if (!invoice) return { error: "not_found" as const };
        if (String(invoice.status) === "void") return { replay: true };
        if (Number(invoice.amount_paid) > 0 || String(invoice.status) === "paid") {
          return { error: "paid" as const };
        }
        const [activePayment] = await tx`
          SELECT 1 FROM invoice_payment_holds h
          JOIN payment_intents pi ON pi.id = h.payment_intent_id
          LEFT JOIN payments p ON p.id = pi.consumed_payment_id
          WHERE h.invoice_id = ${id} AND h.status = 'active' AND h.expires_at > now()
            AND (pi.consumed_payment_id IS NULL OR p.status = 'processing')
          LIMIT 1`;
        if (activePayment) return { error: "payment_in_progress" as const };
        const subtotalMinor = Math.round(Number(invoice.subtotal ?? invoice.amount) * 100);
        const taxMinor = Math.round(Number(invoice.tax_amount ?? 0) * 100);
        await tx`
          INSERT INTO invoice_voids
            (invoice_id, venue_id, idempotency_key, reason, actor,
             subtotal, tax_amount, currency)
          VALUES
            (${id}, ${venue}, ${key}, ${reason}, ${actor},
             ${subtotalMinor}, ${taxMinor}, ${invoice.currency})
          ON CONFLICT (venue_id, invoice_id, idempotency_key) DO NOTHING`;
        await postEntryInTransaction(tx, {
          venue,
          sourceType: "invoice_void",
          sourceId: String(invoice.number),
          currency: String(invoice.currency),
          memo: `Invoice ${invoice.number} voided: ${reason}`,
          lines: [
            ...(subtotalMinor > 0 ? [{ account: "4000", debit: subtotalMinor }] : []),
            ...(taxMinor > 0 ? [{ account: "2100", debit: taxMinor }] : []),
            { account: "1100", credit: subtotalMinor + taxMinor },
          ],
        });
        await tx`UPDATE invoices SET status = 'void' WHERE id = ${id}`;
        await tx`
          INSERT INTO invoice_events (invoice_id, venue_id, type, detail)
          VALUES (${id}, ${venue}, 'void', ${reason})`;
        return { replay: false };
      });
      if ("error" in result) {
        return result.error === "not_found"
          ? json({ error: "invoice not found" }, 404)
          : result.error === "payment_in_progress"
            ? json({ error: "invoice payment is in progress" }, 409)
          : json({ error: "Paid/partial invoices require a credit note and refund." }, 409);
      }
      return json({ ok: true, replay: result.replay });
    }
  }

  return null;
}
