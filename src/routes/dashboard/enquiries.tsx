import { createFileRoute } from "@tanstack/react-router";
import { Check, Clock3, Inbox, Phone, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  Enquiry,
  Reservation,
  TableCombination,
} from "@/components/merchant/features/types";
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
  ensureMerchantDemoData,
  getNewEnquiries,
  saveMerchantEnquiries,
  saveMerchantReservations,
  suggestPartyAssignment,
  type MerchantTable,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/enquiries")({
  component: DashboardEnquiriesPage,
});

const STATUS_STYLES: Record<Enquiry["status"], string> = {
  new: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  declined: "bg-slate-200 text-slate-600",
};

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return "";
  const mins = Math.max(0, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function DashboardEnquiriesPage() {
  const [hydrated, setHydrated] = useState(false);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<MerchantTable[]>([]);
  const [combinations, setCombinations] = useState<TableCombination[]>([]);

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("19:00");
  const [covers, setCovers] = useState(2);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const snapshot = ensureMerchantDemoData();
    setEnquiries(snapshot.enquiries);
    setReservations(snapshot.reservations);
    setTables(snapshot.tables);
    setCombinations(snapshot.tableCombinations);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantEnquiries(enquiries);
  }, [enquiries, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantReservations(reservations);
  }, [hydrated, reservations]);

  const newEnquiries = useMemo(() => getNewEnquiries(enquiries), [enquiries]);
  const handledEnquiries = useMemo(
    () =>
      enquiries
        .filter((enquiry) => enquiry.status !== "new")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [enquiries],
  );

  const counts = useMemo(
    () => ({
      new: enquiries.filter((e) => e.status === "new").length,
      approved: enquiries.filter((e) => e.status === "approved").length,
      declined: enquiries.filter((e) => e.status === "declined").length,
    }),
    [enquiries],
  );

  function combinationName(id: string) {
    return combinations.find((combination) => combination.id === id)?.name ?? id;
  }

  function handleLogEnquiry() {
    if (!customerName.trim()) {
      toast.error("Enter the guest name.");
      return;
    }
    const enquiry: Enquiry = {
      id: createId("enq"),
      customerName: customerName.trim(),
      phone: phone.trim(),
      date,
      time,
      covers,
      notes: notes.trim() || undefined,
      status: "new",
      source: "phone",
      createdAt: new Date().toISOString(),
    };
    setEnquiries((current) => [enquiry, ...current]);
    toast.success("Enquiry logged.");
    setCustomerName("");
    setPhone("");
    setNotes("");
  }

  function handleApprove(enquiry: Enquiry) {
    const assignment = suggestPartyAssignment(
      tables,
      combinations,
      reservations,
      enquiry.date,
      enquiry.time,
      enquiry.covers,
    );
    if (!assignment) {
      toast.error(
        `Nothing free for ${enquiry.covers} at ${enquiry.time}. Adjust the slot or decline.`,
      );
      return;
    }

    const primaryTable =
      assignment.kind === "table"
        ? assignment.tableNumber
        : (combinations.find((c) => c.id === assignment.combinationId)
            ?.tableNumbers[0] ?? 0);

    const reservation: Reservation = {
      id: createId("res"),
      tableNumber: primaryTable,
      combinationId:
        assignment.kind === "combination"
          ? assignment.combinationId
          : undefined,
      customerName: enquiry.customerName,
      phone: enquiry.phone,
      date: enquiry.date,
      time: enquiry.time,
      covers: enquiry.covers,
      status: "confirmed",
      notes: enquiry.notes,
    };

    setReservations((current) => [...current, reservation]);
    setEnquiries((current) =>
      current.map((entry) =>
        entry.id === enquiry.id
          ? { ...entry, status: "approved", reservationId: reservation.id }
          : entry,
      ),
    );

    const label =
      assignment.kind === "table"
        ? `Table ${assignment.tableNumber}`
        : combinationName(assignment.combinationId);
    toast.success(`Approved — booked ${label} for ${enquiry.customerName}.`);
  }

  function handleDecline(enquiry: Enquiry) {
    setEnquiries((current) =>
      current.map((entry) =>
        entry.id === enquiry.id ? { ...entry, status: "declined" } : entry,
      ),
    );
    toast.success("Enquiry declined.");
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="New" value={counts.new} accent="text-amber-500" />
        <SummaryCard
          label="Approved"
          value={counts.approved}
          accent="text-emerald-500"
        />
        <SummaryCard
          label="Declined"
          value={counts.declined}
          accent="text-slate-400"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Log an enquiry</CardTitle>
            <CardDescription>
              Capture a phone or walk-in booking request. It lands in the inbox
              to approve and auto-assign a table.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Guest name">
                  <Input
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder="Wanjiru Kamau"
                  />
                </Field>
                <Field label="Phone (optional)">
                  <Input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+2547..."
                  />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Date">
                  <Input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </Field>
                <Field label="Time">
                  <Input
                    type="time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                  />
                </Field>
                <Field label="Covers">
                  <Input
                    type="number"
                    min="1"
                    value={covers}
                    onChange={(event) =>
                      setCovers(Number(event.target.value) || 1)
                    }
                  />
                </Field>
              </div>
              <Field label="Notes (optional)">
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Occasion, seating preference..."
                />
              </Field>
              <div className="flex justify-end">
                <Button type="button" onClick={handleLogEnquiry}>
                  Log enquiry
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-800">
              Inbox ({newEnquiries.length} new)
            </h3>
          </div>

          {newEnquiries.length === 0 ? (
            <Card className="border-dashed border-slate-300 bg-white/60">
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No new enquiries. New requests will appear here.
              </CardContent>
            </Card>
          ) : (
            newEnquiries.map((enquiry) => (
              <Card
                key={enquiry.id}
                className="border-l-4 border-amber-400 bg-white/90 shadow-sm"
              >
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">
                        {enquiry.customerName}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {enquiry.date} · {enquiry.time}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {enquiry.covers} covers
                        </span>
                        {enquiry.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {enquiry.phone}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        variant="outline"
                        className="border-slate-200 text-slate-500"
                      >
                        {enquiry.source}
                      </Badge>
                      <span className="text-[11px] text-slate-400">
                        {timeAgo(enquiry.createdAt)}
                      </span>
                    </div>
                  </div>
                  {enquiry.notes ? (
                    <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      {enquiry.notes}
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-rose-200 text-rose-600 hover:bg-rose-50"
                      onClick={() => handleDecline(enquiry)}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Decline
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleApprove(enquiry)}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          {handledEnquiries.length > 0 ? (
            <div className="space-y-3 pt-2">
              <h3 className="text-sm font-semibold text-slate-800">Handled</h3>
              {handledEnquiries.map((enquiry) => (
                <div
                  key={enquiry.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {enquiry.customerName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {enquiry.date} · {enquiry.time} · {enquiry.covers} covers
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      STATUS_STYLES[enquiry.status],
                    )}
                  >
                    {enquiry.status}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className={cn("font-mono text-2xl font-semibold", accent)}>{value}</p>
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
