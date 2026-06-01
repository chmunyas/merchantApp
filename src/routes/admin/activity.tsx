import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ensureAdminDemoData,
  getActivityLog,
  getMerchants,
  type AdminActivity,
  type MerchantAccount,
} from "@/lib/admin";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/activity")({
  component: AdminActivityPage,
});

const actionTypes = [
  "merchant_created",
  "merchant_approved",
  "merchant_suspended",
  "feature_enabled",
  "feature_disabled",
  "payout_approved",
  "settings_changed",
] as const;

function AdminActivityPage() {
  const [activity, setActivity] = useState<AdminActivity[]>([]);
  const [merchants, setMerchants] = useState<MerchantAccount[]>([]);
  const [action, setAction] = useState("all");
  const [merchantId, setMerchantId] = useState("all");
  const [adminEmail, setAdminEmail] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    ensureAdminDemoData();
    setActivity(getActivityLog());
    setMerchants(getMerchants());
  }, []);

  const adminOptions = useMemo(
    () => Array.from(new Set(activity.map((entry) => entry.adminEmail))),
    [activity],
  );

  const merchantMap = useMemo(
    () =>
      new Map(
        merchants.map((merchant) => [merchant.id, merchant.businessName]),
      ),
    [merchants],
  );

  const filtered = useMemo(() => {
    return activity.filter((entry) => {
      const entryDate = new Date(entry.timestamp);
      const matchesAction = action === "all" || entry.action === action;
      const matchesMerchant =
        merchantId === "all" || entry.targetMerchant === merchantId;
      const matchesAdmin =
        adminEmail === "all" || entry.adminEmail === adminEmail;
      const matchesStart =
        !startDate || entryDate >= new Date(`${startDate}T00:00:00`);
      const matchesEnd =
        !endDate || entryDate <= new Date(`${endDate}T23:59:59`);
      return (
        matchesAction &&
        matchesMerchant &&
        matchesAdmin &&
        matchesStart &&
        matchesEnd
      );
    });
  }, [action, activity, adminEmail, endDate, merchantId, startDate]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        <SummaryCard label="Total events" value={activity.length.toString()} />
        <SummaryCard
          label="Filtered results"
          value={filtered.length.toString()}
        />
        <SummaryCard
          label="Admins active"
          value={adminOptions.length.toString()}
        />
        <SummaryCard
          label="Merchants tracked"
          value={merchants.length.toString()}
        />
      </div>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <h3 className="text-2xl font-semibold text-white">Audit log</h3>
          <p className="mt-2 text-sm text-slate-400">
            Filter operator actions by event type, merchant, admin, or date
            range.
          </p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-5">
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100">
              <SelectValue placeholder="Action type" />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-slate-900 text-slate-100">
              <SelectItem value="all">All actions</SelectItem>
              {actionTypes.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={merchantId} onValueChange={setMerchantId}>
            <SelectTrigger className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100">
              <SelectValue placeholder="Merchant" />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-slate-900 text-slate-100">
              <SelectItem value="all">All merchants</SelectItem>
              {merchants.map((merchant) => (
                <SelectItem key={merchant.id} value={merchant.id}>
                  {merchant.businessName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={adminEmail} onValueChange={setAdminEmail}>
            <SelectTrigger className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100">
              <SelectValue placeholder="Admin" />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-slate-900 text-slate-100">
              <SelectItem value="all">All admins</SelectItem>
              {adminOptions.map((email) => (
                <SelectItem key={email} value={email}>
                  {email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="space-y-2 text-sm text-slate-300">
            <span>Start date</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100"
            />
          </label>
          <label className="space-y-2 text-sm text-slate-300">
            <span>End date</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100"
            />
          </label>
        </div>
      </section>

      <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="px-4 text-slate-400">Timestamp</TableHead>
              <TableHead className="text-slate-400">Admin</TableHead>
              <TableHead className="text-slate-400">Action</TableHead>
              <TableHead className="text-slate-400">Target merchant</TableHead>
              <TableHead className="pr-4 text-slate-400">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((entry, index) => (
              <TableRow
                key={entry.id}
                className={cn(
                  "border-slate-800 hover:bg-slate-800/30",
                  index % 2 === 0 ? "bg-slate-900" : "bg-slate-950/40",
                )}
              >
                <TableCell className="px-4 text-slate-300">
                  {format(new Date(entry.timestamp), "dd MMM yyyy · HH:mm")}
                </TableCell>
                <TableCell className="text-slate-300">
                  {entry.adminEmail}
                </TableCell>
                <TableCell className="text-slate-300">{entry.action}</TableCell>
                <TableCell className="text-slate-300">
                  {entry.targetMerchant
                    ? (merchantMap.get(entry.targetMerchant) ??
                      entry.targetMerchant)
                    : "—"}
                </TableCell>
                <TableCell className="pr-4 text-slate-300">
                  {entry.details}
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length ? (
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableCell
                  colSpan={5}
                  className="px-4 py-12 text-center text-slate-500"
                >
                  No audit entries match the current filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}
