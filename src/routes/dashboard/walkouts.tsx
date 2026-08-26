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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/walkouts")({
  component: WalkoutsPage,
});

type Candidate = {
  orderId: string;
  tableKey: string | null;
  tableLabel: string | null;
  currency: string;
  outstandingMinor: number;
  idleMinutes: number;
  qrScanned: boolean;
  alreadyReported: boolean;
  candidate: boolean;
  reason: string;
  openedAt: string;
};

type Walkout = {
  id: string;
  orderId: string | null;
  tableLabel: string;
  outstandingMinor: number;
  recoveredMinor: number;
  currency: string;
  status: string;
  reviewOutcome: string | null;
  source: string;
  note: string | null;
  idleMinutesAtReport: number | null;
  reportedByName: string | null;
  reportedByRole: string | null;
  createdAt: string;
};

type Summary = {
  total: number;
  live: number;
  recovered: number;
  writtenOff: number;
  reportedMinor: number;
  recoveredMinor: number;
  netLossMinor: number;
};

const kes = (minor: number, currency = "KES") =>
  `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const STATUS_TONE: Record<string, string> = {
  open: "bg-amber-100 text-amber-900",
  under_review: "bg-blue-100 text-blue-900",
  recovered: "bg-emerald-100 text-emerald-900",
  written_off: "bg-rose-100 text-rose-900",
  dismissed: "bg-slate-100 text-slate-700",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  under_review: "Under review",
  recovered: "Recovered — guest paid",
  written_off: "Written off",
  dismissed: "Dismissed",
};

/**
 * C9.2 / C9.3 / C9.6 — the merchant side of walkout protection.
 *
 * Two surfaces on one page: the guided report (available to anyone who can work
 * the floor) and the register with its loss totals (manager+, enforced by the
 * API — a 403 collapses the panel to an explanation rather than an empty table).
 *
 * On coverage: this page never tells a merchant a walkout will be reimbursed.
 * `Under review` means a human is looking at it and nothing more. Eligibility and
 * any make-good are a commercial decision that lives outside this product.
 */
function WalkoutsPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [walkouts, setWalkouts] = useState<Walkout[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [registerDenied, setRegisterDenied] = useState(false);

  const [selected, setSelected] = useState("");
  const [tableLabel, setTableLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadCandidates = useCallback(async () => {
    try {
      const res = await authFetch("/api/walkouts/candidates");
      if (!res.ok) return;
      const data = (await res.json()) as { candidates?: Candidate[] };
      setCandidates(data.candidates ?? []);
    } catch {
      /* the report form still works without the detection feed */
    }
  }, []);

  const loadRegister = useCallback(async () => {
    try {
      const res = await authFetch("/api/walkouts");
      if (res.status === 403) {
        setRegisterDenied(true);
        setWalkouts([]);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        walkouts?: Walkout[];
        summary?: Summary;
      };
      setRegisterDenied(false);
      setWalkouts(data.walkouts ?? []);
      setSummary(data.summary ?? null);
    } catch {
      setWalkouts([]);
    }
  }, []);

  useEffect(() => {
    void loadCandidates();
    void loadRegister();
  }, [loadCandidates, loadRegister]);

  function choose(candidate: Candidate) {
    setSelected(candidate.orderId);
    setTableLabel(candidate.tableLabel ?? "");
    setAmount((candidate.outstandingMinor / 100).toFixed(2));
    setErrors({});
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
          source: "dashboard",
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
          ? `Table ${tableLabel.trim()} was already on the register. Leave the check open.`
          : `Walkout recorded for table ${tableLabel.trim()}. Leave the check open — if the guest pays, it closes itself.`,
      );
      setSelected("");
      setTableLabel("");
      setAmount("");
      setNote("");
      await Promise.all([loadCandidates(), loadRegister()]);
    } catch {
      setStatus("Couldn't record that walkout. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resolve(walkout: Walkout, next: string) {
    setBusyId(walkout.id);
    setStatus("");
    try {
      const res = await authFetch(`/api/walkouts/${walkout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus(data.error ?? "Couldn't update that walkout.");
        return;
      }
      setStatus(`Table ${walkout.tableLabel} moved to ${STATUS_LABEL[next] ?? next}.`);
      await loadRegister();
    } catch {
      setStatus("Couldn't update that walkout. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  const flagged = candidates.filter((c) => c.candidate);

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Walkouts</h1>
        <p className="text-sm text-muted-foreground">
          Report a table that left without settling, and keep a register of what
          it cost.
        </p>
      </header>

      <p
        role="status"
        aria-live="polite"
        className="min-h-[1.25rem] text-sm text-muted-foreground"
      >
        {status}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Report a walkout</CardTitle>
          <CardDescription>
            Step 1 — leave the check open. Do not close or remove it: keeping the
            table open is what lets the guest still complete payment from their
            phone, and the check then closes on its own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {flagged.length > 0 ? (
            <div>
              <p className="text-sm font-medium">
                Open checks that have gone quiet
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {flagged.map((c) => (
                  <Button
                    key={c.orderId}
                    type="button"
                    variant={selected === c.orderId ? "default" : "outline"}
                    className="min-h-[44px]"
                    onClick={() => choose(c)}
                  >
                    Table {c.tableLabel ?? "—"} · {kes(c.outstandingMinor, c.currency)} ·{" "}
                    {c.idleMinutes} min idle
                    {c.alreadyReported ? " · reported" : ""}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No open check has gone quiet past the venue's idle threshold right
              now. You can still report a table manually below.
            </p>
          )}

          <form onSubmit={submit} noValidate className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="wo-table" className="text-sm font-medium">
                  Table number
                </label>
                <Input
                  id="wo-table"
                  name="tableLabel"
                  value={tableLabel}
                  onChange={(e) => setTableLabel(e.target.value)}
                  aria-invalid={Boolean(errors.tableLabel)}
                  aria-describedby={
                    errors.tableLabel ? "wo-table-error" : undefined
                  }
                  className="mt-1"
                />
                {errors.tableLabel ? (
                  <p id="wo-table-error" className="mt-1 text-sm text-destructive">
                    {errors.tableLabel}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="wo-amount" className="text-sm font-medium">
                  Amount remaining on the bill (KES)
                </label>
                <Input
                  id="wo-amount"
                  name="outstanding"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={Boolean(errors.amount)}
                  aria-describedby={errors.amount ? "wo-amount-error" : undefined}
                  className="mt-1"
                />
                {errors.amount ? (
                  <p id="wo-amount-error" className="mt-1 text-sm text-destructive">
                    {errors.amount}
                  </p>
                ) : null}
              </div>
            </div>
            <div>
              <label htmlFor="wo-note" className="text-sm font-medium">
                What happened (optional)
              </label>
              <Textarea
                id="wo-note"
                name="note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button type="submit" disabled={submitting} className="min-h-[44px]">
              {submitting ? "Recording…" : "Report walkout"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Walkout register</CardTitle>
          <CardDescription>
            Every reported walkout and what it actually cost. A walkout marked
            "Recovered" is one the guest came back and paid — the check closed
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {registerDenied ? (
            <p className="text-sm text-muted-foreground">
              The register and its loss totals are available to managers.
            </p>
          ) : (
            <>
              {summary ? (
                <div className="mb-5 grid gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border p-4">
                    <p className="text-xs text-muted-foreground">Reported</p>
                    <p className="text-lg font-semibold">
                      {kes(summary.reportedMinor)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {summary.total} walkout{summary.total === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="rounded-xl border p-4">
                    <p className="text-xs text-muted-foreground">Recovered</p>
                    <p className="text-lg font-semibold">
                      {kes(summary.recoveredMinor)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {summary.recovered} guest{summary.recovered === 1 ? "" : "s"} paid
                    </p>
                  </div>
                  <div className="rounded-xl border p-4">
                    <p className="text-xs text-muted-foreground">Net loss</p>
                    <p className="text-lg font-semibold">
                      {kes(summary.netLossMinor)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Still owed or written off
                    </p>
                  </div>
                  <div className="rounded-xl border p-4">
                    <p className="text-xs text-muted-foreground">Live</p>
                    <p className="text-lg font-semibold">{summary.live}</p>
                    <p className="text-xs text-muted-foreground">
                      Checks still open
                    </p>
                  </div>
                </div>
              ) : null}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Table</TableHead>
                    <TableHead>Outstanding</TableHead>
                    <TableHead>Reported by</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(walkouts ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        No walkouts recorded.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (walkouts ?? []).map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium">
                          {w.tableLabel}
                          <span className="block text-xs text-muted-foreground">
                            {new Date(w.createdAt).toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          {kes(w.outstandingMinor, w.currency)}
                          {w.recoveredMinor > 0 ? (
                            <span className="block text-xs text-emerald-700">
                              {kes(w.recoveredMinor, w.currency)} recovered
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {w.reportedByName ?? "—"}
                          <span className="block text-xs text-muted-foreground">
                            {w.source === "staff_app" ? "Staff app" : "Dashboard"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={STATUS_TONE[w.status] ?? "bg-slate-100"}
                          >
                            {STATUS_LABEL[w.status] ?? w.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {w.status === "open" || w.status === "under_review" ? (
                            <div className="flex justify-end gap-2">
                              {w.status === "open" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busyId === w.id}
                                  onClick={() => resolve(w, "under_review")}
                                >
                                  Send for review
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === w.id}
                                onClick={() => resolve(w, "written_off")}
                              >
                                Write off
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busyId === w.id}
                                onClick={() => resolve(w, "dismissed")}
                              >
                                Dismiss
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Closed
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
