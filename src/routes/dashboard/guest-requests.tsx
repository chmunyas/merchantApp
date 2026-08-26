import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/guest-requests")({
  component: GuestRequestsPage,
});

type RefundRequest = {
  id: string;
  paymentId: string;
  orderId: string | null;
  requesterPhone: string | null;
  amountMinor: number;
  currency: string;
  reason: string;
  detail: string | null;
  status: string;
  decidedByName: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  refundPaymentId: string | null;
  createdAt: string;
};

type DataRequest = {
  id: string;
  kind: string;
  subjectPhone: string | null;
  subjectEmail: string | null;
  note: string | null;
  status: string;
  handledByName: string | null;
  resolutionNote: string | null;
  completedAt: string | null;
  createdAt: string;
};

const money = (minor: number, currency = "KES") =>
  `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const REFUND_TONE: Record<string, string> = {
  received: "bg-amber-100 text-amber-900",
  acknowledged: "bg-blue-100 text-blue-900",
  approved: "bg-indigo-100 text-indigo-900",
  refunded: "bg-emerald-100 text-emerald-900",
  declined: "bg-slate-100 text-slate-700",
};

const DATA_TONE: Record<string, string> = {
  received: "bg-amber-100 text-amber-900",
  in_review: "bg-blue-100 text-blue-900",
  completed: "bg-emerald-100 text-emerald-900",
  rejected: "bg-slate-100 text-slate-700",
};

/**
 * A5.4 + A5.6 — the merchant's side of guest self-service.
 *
 * Sunday tells a guest who needs a refund to contact the restaurant, because
 * "sunday is not able to process any refunds on behalf of the restaurant without
 * their explicit permission" (article 7669635). This page is where that contact
 * lands — and it is deliberately NOT a refund button. Approving records a
 * decision; the money still moves only through the manager-gated refund action
 * on the payment itself, and the request is only marked `refunded` once a real
 * refund payment id can be quoted against it.
 */
function GuestRequestsPage() {
  const [refunds, setRefunds] = useState<RefundRequest[] | null>(null);
  const [dataRequests, setDataRequests] = useState<DataRequest[] | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [refundPaymentId, setRefundPaymentId] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, d] = await Promise.all([
        authFetch("/api/refund-requests"),
        authFetch("/api/data-requests"),
      ]);
      if (r.ok) {
        const body = (await r.json()) as { requests?: RefundRequest[] };
        setRefunds(body.requests ?? []);
      } else {
        setRefunds([]);
      }
      if (d.ok) {
        const body = (await d.json()) as { requests?: DataRequest[] };
        setDataRequests(body.requests ?? []);
      } else {
        setDataRequests([]);
      }
      setStatus("Guest requests loaded.");
    } catch {
      setError("Couldn't load guest requests.");
      setStatus("Guest requests failed to load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decideRefund(request: RefundRequest, next: string) {
    setBusyId(request.id);
    setError(null);
    setStatus(`Updating request ${request.id}…`);
    try {
      const res = await authFetch(
        `/api/refund-requests/${encodeURIComponent(request.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: next,
            note: note.trim() || undefined,
            refundPaymentId:
              next === "refunded" ? refundPaymentId.trim() : undefined,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "That update was rejected.");
        setStatus("Update rejected.");
        return;
      }
      setNoteFor(null);
      setNote("");
      setRefundPaymentId("");
      setStatus(`Request marked ${next}.`);
      await load();
    } catch {
      setError("That update failed.");
      setStatus("Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function decideData(request: DataRequest, next: string) {
    setBusyId(request.id);
    setError(null);
    setStatus(`Updating request ${request.id}…`);
    try {
      const res = await authFetch(
        `/api/data-requests/${encodeURIComponent(request.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next, note: note.trim() || undefined }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        redacted?: { contacts: number; payments: number } | null;
      };
      if (!res.ok) {
        setError(body.error ?? "That update was rejected.");
        setStatus("Update rejected.");
        return;
      }
      setNoteFor(null);
      setNote("");
      setStatus(
        body.redacted
          ? `Completed. Redacted ${body.redacted.contacts} contact record(s) and ${body.redacted.payments} payment record(s). Financial amounts were not changed.`
          : `Request marked ${next}.`,
      );
      await load();
    } catch {
      setError("That update failed.");
      setStatus("Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Refund requests from guests</CardTitle>
          <CardDescription>
            A guest asked you for a refund. Approving here records your decision
            — it does not move money. Refund the payment itself, then come back
            and mark this request refunded with that refund&apos;s payment id.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {refunds === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : refunds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No refund requests. Guests can raise one from their receipt portal.
            </p>
          ) : (
            refunds.map((request) => (
              <div
                key={request.id}
                className="rounded-xl border border-border p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-base font-bold">
                    {money(request.amountMinor, request.currency)}
                  </span>
                  <Badge className={REFUND_TONE[request.status] ?? ""}>
                    {request.status}
                  </Badge>
                </div>
                <p className="mt-2 text-sm">{request.reason}</p>
                {request.detail ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {request.detail}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  Payment {request.paymentId}
                  {request.requesterPhone ? ` · ${request.requesterPhone}` : ""}
                  {" · "}
                  {new Date(request.createdAt).toLocaleString()}
                </p>
                {request.refundPaymentId ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Refund {request.refundPaymentId}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {["acknowledged", "approved", "declined", "refunded"].map(
                    (next) => (
                      <Button
                        key={next}
                        type="button"
                        variant="outline"
                        className="min-h-[44px]"
                        disabled={busyId === request.id}
                        onClick={() => {
                          setNoteFor(`${request.id}:${next}`);
                          setNote("");
                          setRefundPaymentId("");
                        }}
                      >
                        Mark {next}
                      </Button>
                    ),
                  )}
                </div>

                {noteFor?.startsWith(`${request.id}:`) ? (
                  <div className="mt-3 space-y-2">
                    <label
                      htmlFor={`refund-note-${request.id}`}
                      className="block text-sm font-medium"
                    >
                      Note to file
                    </label>
                    <Textarea
                      id={`refund-note-${request.id}`}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                    />
                    {noteFor.endsWith(":refunded") ? (
                      <>
                        <label
                          htmlFor={`refund-payment-${request.id}`}
                          className="block text-sm font-medium"
                        >
                          Refund payment id
                        </label>
                        <p
                          id={`refund-payment-hint-${request.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          The id of the refund you already issued against this
                          payment. It is verified before the request is closed.
                        </p>
                        <Input
                          id={`refund-payment-${request.id}`}
                          value={refundPaymentId}
                          onChange={(e) => setRefundPaymentId(e.target.value)}
                          aria-describedby={`refund-payment-hint-${request.id}`}
                        />
                      </>
                    ) : null}
                    <Button
                      type="button"
                      className="min-h-[44px]"
                      disabled={busyId === request.id}
                      onClick={() =>
                        void decideRefund(request, noteFor.split(":")[1])
                      }
                    >
                      Confirm
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data requests from guests</CardTitle>
          <CardDescription>
            Deletion and correction requests. Completing an erasure redacts the
            guest&apos;s identifiers from their contact record and from payment
            metadata. It never deletes a payment, an invoice or a ledger entry —
            those are retained for accounting and tax. Only the account owner can
            complete an erasure, and every step is written to the audit trail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {dataRequests === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : dataRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data requests.</p>
          ) : (
            dataRequests.map((request) => (
              <div
                key={request.id}
                className="rounded-xl border border-border p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {request.kind === "erasure"
                      ? "Delete my details"
                      : "Correct my details"}
                  </span>
                  <Badge className={DATA_TONE[request.status] ?? ""}>
                    {request.status}
                  </Badge>
                </div>
                {request.note ? (
                  <p className="mt-2 text-sm">{request.note}</p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {request.subjectPhone ?? request.subjectEmail ?? "unknown"}
                  {" · "}
                  {new Date(request.createdAt).toLocaleString()}
                </p>

                {request.status === "completed" ? null : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["in_review", "completed", "rejected"].map((next) => (
                      <Button
                        key={next}
                        type="button"
                        variant="outline"
                        className="min-h-[44px]"
                        disabled={busyId === request.id}
                        onClick={() => {
                          setNoteFor(`${request.id}:${next}`);
                          setNote("");
                        }}
                      >
                        Mark {next.replace("_", " ")}
                      </Button>
                    ))}
                  </div>
                )}

                {noteFor?.startsWith(`${request.id}:`) ? (
                  <div className="mt-3 space-y-2">
                    <label
                      htmlFor={`data-note-${request.id}`}
                      className="block text-sm font-medium"
                    >
                      Note to file
                    </label>
                    <Textarea
                      id={`data-note-${request.id}`}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                    />
                    <Button
                      type="button"
                      className="min-h-[44px]"
                      disabled={busyId === request.id}
                      onClick={() =>
                        void decideData(request, noteFor.split(":")[1])
                      }
                    >
                      Confirm
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
