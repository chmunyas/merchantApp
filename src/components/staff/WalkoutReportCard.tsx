import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";

import { authFetch } from "@/lib/auth";

type Candidate = {
  orderId: string;
  tableKey: string | null;
  tableLabel: string | null;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  idleMinutes: number;
  qrScanned: boolean;
  alreadyReported: boolean;
  candidate: boolean;
  reason: string;
  openedAt: string;
};

function money(minor: number, currency = "KES") {
  return `${currency} ${(minor / 100).toLocaleString("en-KE", {
    maximumFractionDigits: 2,
  })}`;
}

/**
 * C9.2 + C9.3 — report a walkout from the floor.
 *
 * Deliberately mirrors Sunday's three steps, in order and in words: leave the
 * check open, report it, submit the table and the amount remaining. Step 1 is
 * shown BEFORE the form rather than as fine print underneath, because closing
 * the check is the one irreversible mistake in this flow — it takes away the
 * guest's ability to come back and pay from their phone.
 *
 * Nothing here promises the venue will be reimbursed. Whether a walkout is
 * covered is a decision the business takes, not something this form can offer.
 */
export function WalkoutReportCard() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [tableLabel, setTableLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/walkouts/candidates");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { candidates?: Candidate[] };
      setCandidates(data.candidates ?? []);
    } catch {
      setUnavailable(true);
      setCandidates([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function choose(orderId: string) {
    setSelected(orderId);
    setErrors({});
    const match = (candidates ?? []).find((c) => c.orderId === orderId);
    if (match) {
      setTableLabel(match.tableLabel ?? "");
      setAmount((match.outstandingMinor / 100).toFixed(2));
    }
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!tableLabel.trim()) next.tableLabel = "Enter the table number.";
    const value = Number(amount);
    if (!amount.trim() || !Number.isFinite(value)) {
      next.amount = "Enter the amount still on the bill.";
    } else if (value <= 0) {
      next.amount = "The amount must be more than zero.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("");
    if (!validate()) {
      setStatus("Check the highlighted fields and try again.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch("/api/walkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selected || undefined,
          tableLabel: tableLabel.trim(),
          outstandingMinor: Math.round(Number(amount) * 100),
          note: note.trim() || undefined,
          source: "staff_app",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        duplicate?: boolean;
      };
      if (!res.ok) {
        setStatus(data.error ?? "Couldn't record that walkout.");
        return;
      }
      setStatus(
        data.duplicate
          ? `Table ${tableLabel.trim()} was already reported. Leave the check open.`
          : `Walkout reported for table ${tableLabel.trim()}. Leave the check open — if the guest pays, it closes itself.`,
      );
      setSelected("");
      setAmount("");
      setNote("");
      setTableLabel("");
      await load();
    } catch {
      setStatus("Couldn't record that walkout. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const flagged = (candidates ?? []).filter((c) => c.candidate);

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-5 text-amber-500" />
        <h2 className="text-lg font-semibold">Report a walkout</h2>
      </div>

      <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Step 1 — leave the check open.</p>
        <p className="mt-1">
          Do not close or remove the check. Keeping the table open is what lets
          the guest still complete payment from their phone. If they do, the
          check closes on its own.
        </p>
      </div>

      {unavailable ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Walkout reporting is unavailable right now.
        </p>
      ) : null}

      {flagged.length > 0 ? (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4 text-amber-500" />
            Tables that have gone quiet with money on the bill
          </p>
          <ul className="mt-2 space-y-2">
            {flagged.map((c) => (
              <li key={c.orderId}>
                <button
                  type="button"
                  onClick={() => choose(c.orderId)}
                  className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl border px-4 py-2 text-left text-sm ${
                    selected === c.orderId
                      ? "border-foreground bg-foreground/5"
                      : "border-border"
                  }`}
                >
                  <span>
                    <span className="font-semibold">
                      Table {c.tableLabel ?? "—"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Quiet for {c.idleMinutes} min
                      {c.alreadyReported ? " · already reported" : ""}
                    </span>
                  </span>
                  <span className="font-semibold">
                    {money(c.outstandingMinor, c.currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form onSubmit={submit} noValidate className="mt-5 space-y-4">
        <p className="text-sm font-semibold">
          Step 2 — submit the table and the amount remaining
        </p>

        <div>
          <label
            htmlFor="walkout-table"
            className="block text-sm font-medium"
          >
            Table number
          </label>
          <input
            id="walkout-table"
            name="tableLabel"
            type="text"
            value={tableLabel}
            onChange={(e) => setTableLabel(e.target.value)}
            aria-invalid={Boolean(errors.tableLabel)}
            aria-describedby={
              errors.tableLabel ? "walkout-table-error" : undefined
            }
            className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-background px-3 text-base"
          />
          {errors.tableLabel ? (
            <p
              id="walkout-table-error"
              className="mt-1 text-sm text-destructive"
            >
              {errors.tableLabel}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="walkout-amount"
            className="block text-sm font-medium"
          >
            Amount remaining on the bill (KES)
          </label>
          <input
            id="walkout-amount"
            name="outstanding"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={
              errors.amount ? "walkout-amount-error" : undefined
            }
            className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-background px-3 text-base"
          />
          {errors.amount ? (
            <p
              id="walkout-amount-error"
              className="mt-1 text-sm text-destructive"
            >
              {errors.amount}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="walkout-note" className="block text-sm font-medium">
            What happened (optional)
          </label>
          <textarea
            id="walkout-note"
            name="note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-background p-3 text-base"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-foreground px-5 font-semibold text-background disabled:opacity-60"
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Report walkout
        </button>

        <p
          role="status"
          aria-live="polite"
          className="min-h-[1.25rem] text-sm text-muted-foreground"
        >
          {status}
        </p>
      </form>
    </section>
  );
}
