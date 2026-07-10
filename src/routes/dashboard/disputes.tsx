import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/disputes")({
  component: DisputesPage,
});

type Dispute = {
  id: string;
  paymentId: string | null;
  amount: number;
  currency: string;
  status: string;
  reason: string | null;
  connectorDisputeId: string | null;
  evidenceDueBy: string | null;
  evidence: string | null;
  evidenceSubmittedAt: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
};

type Summary = { total: number; open: number; openAmount: number };

const kes = (minor: number) =>
  `KES ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

// Status → badge style + human label. Mirrors the card-scheme dispute lifecycle:
// open → under_review (evidence submitted) → won / lost, or accepted (conceded).
const STATUS: Record<string, { label: string; variant: "secondary" | "destructive" | "outline" | "default" }> = {
  open: { label: "Needs response", variant: "destructive" },
  needs_response: { label: "Needs response", variant: "destructive" },
  under_review: { label: "Under review", variant: "default" },
  warning_needs_response: { label: "Needs response", variant: "destructive" },
  won: { label: "Won", variant: "secondary" },
  lost: { label: "Lost", variant: "outline" },
  accepted: { label: "Accepted", variant: "outline" },
};

function statusMeta(status: string) {
  return STATUS[status] ?? { label: status.replace(/_/g, " "), variant: "outline" as const };
}

const OPEN_STATES = new Set(["open", "needs_response", "under_review", "warning_needs_response"]);

// Days until the evidence deadline (negative = overdue).
function dueInfo(due: string | null): { text: string; urgent: boolean } | null {
  if (!due) return null;
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 864e5);
  if (days < 0) return { text: `Overdue ${-days}d`, urgent: true };
  if (days === 0) return { text: "Due today", urgent: true };
  return { text: `${days}d left`, urgent: days <= 3 };
}

const FILTERS: Array<[string, string | null]> = [
  ["All", null],
  ["Needs response", "open"],
  ["Under review", "under_review"],
];

function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, open: 0, openAmount: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Dispute | null>(null);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(status: string | null = filter) {
    setLoading(true);
    try {
      const q = status ? `?status=${status}` : "";
      const res = await authFetch(`/api/disputes${q}`);
      if (res.ok) {
        const data = (await res.json()) as { disputes: Dispute[]; summary: Summary };
        setDisputes(data.disputes ?? []);
        // Summary always reflects the whole venue, not the filter.
        if (!status) setSummary(data.summary ?? { total: 0, open: 0, openAmount: 0 });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openDispute(d: Dispute) {
    setSelected(d);
    setEvidence(d.evidence ?? "");
  }

  async function submitEvidence() {
    if (!selected) return;
    if (!evidence.trim()) {
      toast.error("Add your evidence before submitting.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch(`/api/disputes/${selected.id}/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidence: evidence.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { dispute?: Dispute; error?: string };
      if (!res.ok || !body.dispute) {
        toast.error(res.status === 403 ? "Manager access required." : body.error ?? "Failed.");
        return;
      }
      toast.success("Evidence submitted — the dispute is now under review.");
      setSelected(body.dispute);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function acceptDispute() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/disputes/${selected.id}/accept`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { dispute?: Dispute; error?: string };
      if (!res.ok || !body.dispute) {
        toast.error(res.status === 403 ? "Manager access required." : body.error ?? "Failed.");
        return;
      }
      toast.success("Dispute accepted. The refund stands — no evidence will be sent.");
      setSelected(body.dispute);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const canAct = selected && OPEN_STATES.has(selected.status);
  const due = selected ? dueInfo(selected.evidenceDueBy) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Disputes &amp; chargebacks</h1>
        <p className="text-sm text-muted-foreground">
          Respond to chargebacks before the deadline — submit evidence to contest, or
          accept to concede.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Open disputes", String(summary.open)],
          ["At risk", kes(summary.openAmount)],
          ["Total (all time)", String(summary.total)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Disputes</CardTitle>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(([label, value]) => (
              <Button
                key={label}
                size="sm"
                variant={filter === value ? "default" : "outline"}
                onClick={() => {
                  setFilter(value);
                  void load(value);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opened</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : disputes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No disputes 🎉 — a clean record with the card schemes.
                  </TableCell>
                </TableRow>
              ) : (
                disputes.map((d) => {
                  const meta = statusMeta(d.status);
                  const info = dueInfo(d.evidenceDueBy);
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="whitespace-nowrap">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {d.paymentId ?? "—"}
                      </TableCell>
                      <TableCell className="capitalize">
                        {d.reason?.replace(/_/g, " ") ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">{kes(d.amount)}</TableCell>
                      <TableCell>
                        {info ? (
                          <span className={info.urgent ? "font-semibold text-destructive" : ""}>
                            {info.text}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openDispute(d)}>
                          {OPEN_STATES.has(d.status) ? "Respond" : "View"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Dispute {selected && kes(selected.amount)}
              {selected && (
                <Badge variant={statusMeta(selected.status).variant}>
                  {statusMeta(selected.status).label}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {selected?.reason ? `Reason: ${selected.reason.replace(/_/g, " ")}. ` : ""}
              Payment {selected?.paymentId ?? "—"}
              {selected?.connectorDisputeId ? ` · ${selected.connectorDisputeId}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {due && (
              <div
                className={`rounded-md px-3 py-2 ${
                  due.urgent
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                Evidence deadline: {due.text}
                {selected?.evidenceDueBy &&
                  ` (${new Date(selected.evidenceDueBy).toLocaleDateString()})`}
              </div>
            )}

            {selected?.resolution && (
              <div className="rounded-md bg-muted px-3 py-2">
                Resolution: <span className="capitalize">{selected.resolution}</span>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Evidence {selected?.evidenceSubmittedAt ? "(submitted)" : "(to contest)"}
              </label>
              <Textarea
                rows={5}
                placeholder="Describe why this charge is legitimate — receipts, delivery proof, signed authorization, prior communication…"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                disabled={!canAct || busy}
              />
              {selected?.evidenceSubmittedAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Submitted {new Date(selected.evidenceSubmittedAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {canAct ? (
              <>
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => void acceptDispute()}
                  disabled={busy}
                >
                  Accept (concede)
                </Button>
                <Button onClick={() => void submitEvidence()} disabled={busy}>
                  {busy ? "Submitting…" : "Submit evidence"}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setSelected(null)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
