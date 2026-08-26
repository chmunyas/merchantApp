import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Check,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/payouts")({
  component: PayoutsPage,
});

type PayoutRun = {
  id: string;
  kind: "tips" | "salary";
  period: string;
  status: string;
  totalAmount: number;
  staffCount: number;
  note: string | null;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  selfApproved: boolean;
  rejectedBy: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
};

type RunLine = {
  id: string;
  staffId: string;
  name: string;
  amount: number;
  status: string;
  heldReason: string | null;
};

type PayrollStaff = {
  staffId: string;
  name: string;
  role: string;
  active: boolean;
  salaryAmount: number | null;
  salaryPeriod: string | null;
  hasDestination: boolean;
  destinationMethod: string | null;
};

const kes = (minor: number) =>
  `KES ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

const STATUS_TONE: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  submitted: "bg-sky-100 text-sky-800",
  completed: "bg-slate-100 text-slate-700",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-500",
};

const HELD_REASON: Record<string, string> = {
  no_payout_details: "No payout destination on file",
  bank_code_missing: "Bank not selected — they must re-enter their details",
  bank_rail_unavailable: "Bank rail was unavailable when this was created",
  run_rejected: "Run was rejected",
  unsupported_method: "Unsupported payout method",
};

function PayoutsPage() {
  const [runs, setRuns] = useState<PayoutRun[]>([]);
  const [lines, setLines] = useState<Record<string, RunLine[]>>({});
  const [staff, setStaff] = useState<PayrollStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [period, setPeriod] = useState<"weekly" | "biweekly" | "monthly">("monthly");
  const [salaryDraft, setSalaryDraft] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<PayoutRun | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    try {
      const [runsRes, staffRes] = await Promise.all([
        authFetch("/api/payouts/runs"),
        authFetch("/api/payroll/staff"),
      ]);
      if (runsRes.ok) setRuns(((await runsRes.json()) as { runs: PayoutRun[] }).runs);
      if (staffRes.ok) setStaff(((await staffRes.json()) as { staff: PayrollStaff[] }).staff);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadLines = useCallback(async (runId: string) => {
    const res = await authFetch(`/api/payouts/runs/${runId}`);
    if (!res.ok) return;
    const body = (await res.json()) as { lines: RunLine[] };
    setLines((current) => ({ ...current, [runId]: body.lines }));
  }, []);

  const approve = useCallback(
    async (run: PayoutRun) => {
      setBusy(run.id);
      try {
        const res = await authFetch(`/api/payouts/runs/${run.id}/approve`, { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          submitted?: number;
          held?: number;
          skipped?: string | null;
        };
        if (!res.ok) {
          toast.error(body.error ?? "Could not approve this run.");
          return;
        }
        if (body.skipped === "credentials-unavailable") {
          toast.warning("Approved, but PesaSwap credentials are not configured — nothing was sent.");
        } else {
          toast.success(
            `Approved. ${body.submitted ?? 0} sent${body.held ? `, ${body.held} held` : ""}.`,
          );
        }
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const reject = useCallback(
    async (run: PayoutRun, reason: string) => {
      setBusy(run.id);
      try {
        const res = await authFetch(`/api/payouts/runs/${run.id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          toast.error(body.error ?? "Could not reject this run.");
          return;
        }
        toast.success("Run rejected. The money stays held, not written off.");
        setRejecting(null);
        setRejectReason("");
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const saveSalary = useCallback(
    async (person: PayrollStaff) => {
      const raw = salaryDraft[person.staffId];
      if (raw === undefined) return;
      const trimmed = raw.trim();
      setBusy(person.staffId);
      try {
        const res = await authFetch(`/api/payroll/staff/${person.staffId}/salary`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            trimmed === ""
              ? { amountMinor: null }
              : { amountMinor: Math.round(Number(trimmed) * 100), period },
          ),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          toast.error(body.error ?? "Could not save that salary.");
          return;
        }
        toast.success(trimmed === "" ? `Salary cleared for ${person.name}.` : `Saved ${person.name}.`);
        setSalaryDraft((current) => {
          const next = { ...current };
          delete next[person.staffId];
          return next;
        });
        await load();
      } finally {
        setBusy(null);
      }
    },
    [salaryDraft, period, load],
  );

  const createPayrollRun = useCallback(async () => {
    setBusy("payroll-run");
    try {
      const res = await authFetch("/api/payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        excluded?: { name: string; reason: string }[];
      };
      if (!res.ok) {
        toast.error(body.error ?? "Could not create the payroll run.");
        return;
      }
      const skipped = body.excluded?.filter((e) => e.reason === "no-salary").length ?? 0;
      toast.success(
        `Payroll run created and waiting for approval${skipped ? ` · ${skipped} skipped` : ""}.`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  }, [period, load]);

  const awaiting = runs.filter((run) => run.status === "pending_approval");
  const decided = runs.filter((run) => run.status !== "pending_approval");
  const payable = staff.filter(
    (person) => person.active && person.salaryAmount && person.salaryPeriod === period,
  );
  const missingDestination = payable.filter((person) => !person.hasDestination);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading payouts…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Payouts</h1>
        <p className="text-sm text-muted-foreground">
          Tips and salaries both leave through here, and nothing leaves without an
          approval on the record.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-500" />
            Waiting for your approval
          </CardTitle>
          <CardDescription>
            {awaiting.length === 0
              ? "Nothing is waiting. Staff are not paid until a run here is approved."
              : `${awaiting.length} run${awaiting.length === 1 ? "" : "s"} — nobody is paid until you approve.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {awaiting.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs awaiting approval.</p>
          ) : (
            awaiting.map((run) => (
              <div key={run.id} className="rounded-xl border border-amber-300 bg-amber-50/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {run.kind === "salary" ? "Salaries" : "Tips"} · {run.period}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {kes(run.totalAmount)} to {run.staffCount}{" "}
                      {run.staffCount === 1 ? "person" : "people"} · created by {run.createdBy}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void loadLines(run.id)}
                    >
                      Show who gets paid
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === run.id}
                      onClick={() => {
                        setRejecting(run);
                        setRejectReason("");
                      }}
                    >
                      <X className="mr-1 size-4" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy === run.id}
                      onClick={() => void approve(run)}
                    >
                      {busy === run.id ? (
                        <Loader2 className="mr-1 size-4 animate-spin" />
                      ) : (
                        <Check className="mr-1 size-4" />
                      )}
                      Approve and pay
                    </Button>
                  </div>
                </div>
                {lines[run.id] && (
                  <ul className="mt-3 divide-y divide-amber-200 border-t border-amber-200 pt-2 text-sm">
                    {lines[run.id].map((line) => (
                      <li key={line.id} className="flex justify-between gap-4 py-1.5">
                        <span>{line.name}</span>
                        <span className="flex items-center gap-2">
                          {line.status === "held" && (
                            <span className="text-xs text-amber-700">
                              {HELD_REASON[line.heldReason ?? ""] ?? line.heldReason}
                            </span>
                          )}
                          <span className="font-mono">{kes(line.amount)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="size-5" /> Salaries
          </CardTitle>
          <CardDescription>
            A fixed amount per person per period. Enter whole shillings — it is stored
            to the cent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm">
              <span className="mr-2 text-muted-foreground">Pay period</span>
              <select
                value={period}
                onChange={(event) =>
                  setPeriod(event.target.value as "weekly" | "biweekly" | "monthly")
                }
                className="rounded-lg border border-border bg-background px-3 py-1.5"
              >
                <option value="monthly">Monthly</option>
                <option value="biweekly">Biweekly</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <Button
              disabled={busy === "payroll-run" || payable.length === 0}
              onClick={() => void createPayrollRun()}
            >
              {busy === "payroll-run" && <Loader2 className="mr-1 size-4 animate-spin" />}
              Create {period} payroll run ({payable.length})
            </Button>
          </div>

          {missingDestination.length > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {missingDestination.length} of these people have nowhere to be paid
                </p>
                <p className="mt-1">
                  {missingDestination.map((p) => p.name).join(", ")} — their lines will be
                  held, not lost. They add a destination themselves under My earnings.
                </p>
              </div>
            </div>
          )}

          <div className="divide-y divide-border rounded-xl border border-border">
            {staff.map((person) => {
              const draft = salaryDraft[person.staffId];
              const current =
                person.salaryAmount === null ? "" : String(person.salaryAmount / 100);
              return (
                <div
                  key={person.staffId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-40">
                    <p className="text-sm font-medium">
                      {person.name}
                      {!person.active && (
                        <Badge variant="secondary" className="ml-2">
                          Inactive
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {person.role}
                      {person.salaryPeriod ? ` · paid ${person.salaryPeriod}` : ""}
                      {person.hasDestination
                        ? ` · ${person.destinationMethod}`
                        : " · no payout destination"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={draft ?? current}
                      inputMode="decimal"
                      placeholder="0"
                      className="w-32 text-right font-mono"
                      onChange={(event) =>
                        setSalaryDraft((c) => ({
                          ...c,
                          [person.staffId]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={draft === undefined || busy === person.staffId}
                      onClick={() => void saveSalary(person)}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decided runs</CardTitle>
          <CardDescription>Every approval and rejection, with who made it.</CardDescription>
        </CardHeader>
        <CardContent>
          {decided.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing decided yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {decided.map((run) => (
                <li key={run.id} className="flex flex-wrap justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {run.kind === "salary" ? "Salaries" : "Tips"} · {run.period} ·{" "}
                      {kes(run.totalAmount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {run.approvedBy
                        ? `Approved by ${run.approvedBy}`
                        : run.rejectedBy
                          ? `Rejected by ${run.rejectedBy} — ${run.rejectionReason}`
                          : run.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {run.selfApproved && (
                      // Permitted by policy, but never silent.
                      <Badge className="bg-amber-100 text-amber-800">
                        <BadgeCheck className="mr-1 size-3" /> Self-approved
                      </Badge>
                    )}
                    <Badge className={STATUS_TONE[run.status] ?? "bg-slate-100"}>
                      {run.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {rejecting && (
        <ModalOverlay
          onClose={() => setRejecting(null)}
          labelledBy="reject-run-heading"
          closeLabel="Close reject dialog"
          className="flex items-center justify-center p-4"
          panelClassName="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl"
        >
          <h2 id="reject-run-heading" className="text-base font-bold">
            Reject this payout run?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {rejecting.kind === "salary" ? "Salaries" : "Tips"} · {rejecting.period} ·{" "}
            {kes(rejecting.totalAmount)} to {rejecting.staffCount}{" "}
            {rejecting.staffCount === 1 ? "person" : "people"}. Nobody is paid, and the
            money stays held rather than being written off.
          </p>
          <label htmlFor="reject-reason" className="mt-4 block text-sm font-medium">
            Why?
          </label>
          <textarea
            id="reject-reason"
            value={rejectReason}
            rows={3}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Wrong pay period, amount looks wrong, …"
            className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Recorded against the run, so whoever picks this up next knows what to fix.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              // Matches the server's minimum, so the button never sends a 400.
              disabled={rejectReason.trim().length < 3 || busy === rejecting.id}
              onClick={() => void reject(rejecting, rejectReason.trim())}
            >
              {busy === rejecting.id && <Loader2 className="mr-1 size-4 animate-spin" />}
              Reject run
            </Button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
