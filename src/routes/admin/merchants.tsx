import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  CircleAlert,
  Eye,
  LockKeyhole,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteMerchant,
  ensureAdminDemoData,
  getActivityLog,
  getFeatureFlags,
  getGlobalFeatureState,
  getMerchants,
  getMerchantUsageStats,
  getTierDefaults,
  logActivity,
  saveMerchant,
  setMerchantFeature,
  type AdminActivity,
  type MerchantAccount,
  type MerchantStatus,
  type MerchantVertical,
  type SubscriptionTier,
} from "@/lib/admin";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/auth";

// Map a real tenant row from /api/admin/merchants onto the admin UI's account
// shape (vertical/location aren't tracked server-side yet, so they're best-effort).
type RealMerchant = {
  id: string;
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  phone: string;
  plan: string;
  active: boolean;
  onboardedAt: string;
  txCount: number;
  txOk: number;
  grossMinor: number;
  lastTxAt: string | null;
};

function toMerchantAccount(m: RealMerchant): MerchantAccount {
  const gross = (m.grossMinor / 100).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
  const last = m.lastTxAt
    ? ` · last ${new Date(m.lastTxAt).toLocaleDateString()}`
    : "";
  return {
    id: m.id,
    businessName: m.businessName,
    ownerName: m.ownerName || m.ownerEmail || "—",
    phone: m.phone || "",
    email: m.ownerEmail || "",
    vertical: "retail",
    status: m.active ? "active" : "suspended",
    tier: m.plan === "pro" ? "growth" : "free",
    location: "",
    features: {},
    onboardedAt: m.onboardedAt,
    notes: `${m.txOk}/${m.txCount} paid · KES ${gross}${last}`,
  };
}

export const Route = createFileRoute("/admin/merchants")({
  component: AdminMerchantsPage,
});

const money = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const verticalOptions: Array<{ value: MerchantVertical; label: string }> = [
  { value: "restaurant", label: "Restaurant" },
  { value: "retail", label: "Retail / Duka" },
  { value: "services", label: "Services" },
  { value: "hospital", label: "Hospital" },
];

const tierOptions: Array<{ value: SubscriptionTier; label: string }> = [
  { value: "free", label: "Free" },
  { value: "starter", label: "Starter · KES 2,000/mo" },
  { value: "growth", label: "Growth · KES 5,000/mo" },
  { value: "enterprise", label: "Enterprise · KES 15,000/mo" },
];

const featureGroups = [
  "Payments",
  "Restaurant",
  "Retail",
  "Services",
  "Staff",
  "Analytics",
  "Admin",
];

type MerchantFormState = {
  businessName: string;
  ownerName: string;
  phone: string;
  email: string;
  vertical: MerchantVertical;
  tier: SubscriptionTier;
  location: string;
  notes: string;
};

const emptyForm: MerchantFormState = {
  businessName: "",
  ownerName: "",
  phone: "",
  email: "",
  vertical: "restaurant",
  tier: "starter",
  location: "",
  notes: "",
};

function AdminMerchantsPage() {
  const [merchants, setMerchants] = useState<MerchantAccount[]>([]);
  const [activity, setActivity] = useState<AdminActivity[]>([]);
  const [search, setSearch] = useState("");
  const [vertical, setVertical] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<MerchantFormState>(emptyForm);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    ensureAdminDemoData();
    setActivity(getActivityLog());
    // Prefer REAL tenant accounts from the server (self-serve signups); fall back
    // to the local demo dataset when the API is unavailable or empty (offline/dev).
    void (async () => {
      try {
        const res = await authFetch("/api/admin/merchants");
        if (res.ok) {
          const data = (await res.json()) as { merchants?: RealMerchant[] };
          const real = (data.merchants ?? []).map(toMerchantAccount);
          if (real.length > 0) {
            setMerchants(real);
            return;
          }
        }
      } catch {
        /* fall through to demo data */
      }
      setMerchants(getMerchants());
    })();
  }

  const globalFeatures = useMemo(
    () => getGlobalFeatureState(),
    [merchants, activity],
  );
  const featureFlags = useMemo(() => getFeatureFlags(), []);

  const filteredMerchants = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return merchants.filter((merchant) => {
      const matchesSearch =
        !needle ||
        merchant.businessName.toLowerCase().includes(needle) ||
        merchant.ownerName.toLowerCase().includes(needle) ||
        merchant.phone.toLowerCase().includes(needle) ||
        merchant.email.toLowerCase().includes(needle);
      const matchesVertical =
        vertical === "all" || merchant.vertical === vertical;
      const matchesStatus = status === "all" || merchant.status === status;
      return matchesSearch && matchesVertical && matchesStatus;
    });
  }, [merchants, search, vertical, status]);

  const selectedMerchant = useMemo(
    () => merchants.find((merchant) => merchant.id === selectedId) ?? null,
    [merchants, selectedId],
  );

  const selectedStats = useMemo(
    () => (selectedMerchant ? getMerchantUsageStats(selectedMerchant) : null),
    [selectedMerchant],
  );

  const selectedActivity = useMemo(
    () =>
      selectedMerchant
        ? activity
            .filter((entry) => entry.targetMerchant === selectedMerchant.id)
            .slice(0, 10)
        : [],
    [activity, selectedMerchant],
  );

  function openDetails(merchant: MerchantAccount, tab: string = "overview") {
    setSelectedId(merchant.id);
    setDetailTab(tab);
    setDetailOpen(true);
  }

  function updateStatus(merchant: MerchantAccount, nextStatus: MerchantStatus) {
    const nextMerchant = { ...merchant, status: nextStatus };
    saveMerchant(nextMerchant);
    logActivity(
      nextStatus === "active" ? "merchant_approved" : "merchant_suspended",
      `${merchant.businessName} marked as ${nextStatus}.`,
      merchant.id,
    );
    refresh();
    toast.success(`${merchant.businessName} updated`);
  }

  function handleCreateMerchant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextMerchant: MerchantAccount = {
      id: `merchant-${Date.now()}`,
      businessName: form.businessName.trim(),
      ownerName: form.ownerName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim().toLowerCase(),
      vertical: form.vertical,
      status: "pending",
      tier: form.tier,
      location: form.location.trim(),
      notes: form.notes.trim(),
      onboardedAt: new Date().toISOString(),
      features: getTierDefaults(form.tier),
    };

    if (
      !nextMerchant.businessName ||
      !nextMerchant.ownerName ||
      !nextMerchant.phone ||
      !nextMerchant.email
    ) {
      toast.error("Fill in the required merchant fields first.");
      return;
    }

    saveMerchant(nextMerchant);
    logActivity(
      "merchant_created",
      `${nextMerchant.businessName} added to onboarding queue with ${form.tier} tier defaults.`,
      nextMerchant.id,
    );
    setForm(emptyForm);
    setCreateOpen(false);
    refresh();
    toast.success("Merchant created in pending review");
  }

  function handleDeleteMerchant(merchant: MerchantAccount) {
    if (
      !window.confirm(`Delete ${merchant.businessName}? This cannot be undone.`)
    ) {
      return;
    }
    deleteMerchant(merchant.id);
    logActivity(
      "settings_changed",
      `${merchant.businessName} deleted from admin console.`,
      merchant.id,
    );
    if (selectedId === merchant.id) {
      setDetailOpen(false);
      setSelectedId(null);
    }
    refresh();
    toast.success("Merchant deleted");
  }

  function handleResetPassword(merchant: MerchantAccount) {
    logActivity(
      "settings_changed",
      `Password reset initiated for ${merchant.businessName}.`,
      merchant.id,
    );
    refresh();
    toast.success("Password reset logged");
  }

  function handleFeatureToggle(
    merchant: MerchantAccount,
    featureKey: string,
    enabled: boolean,
  ) {
    setMerchantFeature(merchant.id, featureKey, enabled);
    const featureName =
      featureFlags.find((feature) => feature.key === featureKey)?.name ??
      featureKey;
    logActivity(
      enabled ? "feature_enabled" : "feature_disabled",
      `${featureName} ${enabled ? "enabled" : "disabled"} for ${merchant.businessName}.`,
      merchant.id,
    );
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-2xl font-semibold text-white">
            Merchant operations
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Review onboarding, manage account health, and tailor feature access
            per merchant.
          </p>
        </div>
        <Button
          className="rounded-xl bg-violet-500 text-white hover:bg-violet-400"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" /> Onboard new merchant
        </Button>
      </div>

      <div className="grid gap-4 rounded-3xl border border-slate-800 bg-slate-900 p-5 xl:grid-cols-[1.4fr_0.8fr_0.8fr]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search merchant, owner, phone, or email"
            className="h-11 rounded-xl border-slate-700 bg-slate-950 pl-10 text-slate-100"
          />
        </div>
        <Select value={vertical} onValueChange={setVertical}>
          <SelectTrigger className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100">
            <SelectValue placeholder="All verticals" />
          </SelectTrigger>
          <SelectContent className="border-slate-700 bg-slate-900 text-slate-100">
            <SelectItem value="all">All verticals</SelectItem>
            {verticalOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent className="border-slate-700 bg-slate-900 text-slate-100">
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="px-4 text-slate-400">
                Business Name
              </TableHead>
              <TableHead className="text-slate-400">Owner</TableHead>
              <TableHead className="text-slate-400">Phone</TableHead>
              <TableHead className="text-slate-400">Email</TableHead>
              <TableHead className="text-slate-400">Vertical</TableHead>
              <TableHead className="text-slate-400">Status</TableHead>
              <TableHead className="text-slate-400">Onboarded</TableHead>
              <TableHead className="text-right text-slate-400">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMerchants.map((merchant, index) => (
              <TableRow
                key={merchant.id}
                className={cn(
                  "border-slate-800 hover:bg-slate-800/40",
                  index % 2 === 0 ? "bg-slate-900" : "bg-slate-950/40",
                )}
              >
                <TableCell className="px-4">
                  <div>
                    <div className="font-medium text-slate-100">
                      {merchant.businessName}
                    </div>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      {merchant.tier}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-slate-300">
                  {merchant.ownerName}
                </TableCell>
                <TableCell className="text-slate-300">
                  {merchant.phone}
                </TableCell>
                <TableCell className="text-slate-300">
                  {merchant.email}
                </TableCell>
                <TableCell className="capitalize text-slate-300">
                  {merchant.vertical}
                </TableCell>
                <TableCell>{renderStatusBadge(merchant.status)}</TableCell>
                <TableCell className="text-slate-300">
                  {format(new Date(merchant.onboardedAt), "dd MMM yyyy")}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {merchant.status !== "active" ? (
                      <Button
                        size="sm"
                        className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
                        onClick={() => updateStatus(merchant, "active")}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Approve
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                        onClick={() => updateStatus(merchant, "suspended")}
                      >
                        <CircleAlert className="h-3.5 w-3.5" /> Suspend
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800"
                      onClick={() => openDetails(merchant, "overview")}
                    >
                      <Eye className="h-3.5 w-3.5" /> View details
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl border-violet-500/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20"
                      onClick={() => openDetails(merchant, "features")}
                    >
                      <Settings2 className="h-3.5 w-3.5" /> Edit features
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!filteredMerchants.length ? (
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableCell
                  colSpan={8}
                  className="px-4 py-12 text-center text-slate-500"
                >
                  No merchants match the current search and filter criteria.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl rounded-3xl border-slate-800 bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>Onboard new merchant</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create a merchant account in pending review. Approval moves the
              account to active.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={handleCreateMerchant}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Business name">
                <Input
                  value={form.businessName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      businessName: event.target.value,
                    }))
                  }
                  className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100"
                />
              </Field>
              <Field label="Owner name">
                <Input
                  value={form.ownerName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      ownerName: event.target.value,
                    }))
                  }
                  className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100"
                />
              </Field>
              <Field label="Phone (M-Pesa number)">
                <Input
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                  className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100"
                />
              </Field>
              <Field label="Business type">
                <Select
                  value={form.vertical}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      vertical: value as MerchantVertical,
                    }))
                  }
                >
                  <SelectTrigger className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-900 text-slate-100">
                    {verticalOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Subscription tier">
                <Select
                  value={form.tier}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      tier: value as SubscriptionTier,
                    }))
                  }
                >
                  <SelectTrigger className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-slate-700 bg-slate-900 text-slate-100">
                    {tierOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Location">
              <Input
                value={form.location}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
                className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100"
              />
            </Field>
            <Field label="Notes">
              <Textarea
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                className="min-h-28 rounded-2xl border-slate-700 bg-slate-950 text-slate-100"
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button className="rounded-xl bg-violet-500 text-white hover:bg-violet-400">
                Create pending merchant
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-hidden rounded-3xl border-slate-800 bg-slate-900 text-slate-100">
          {selectedMerchant ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3">
                  <span>{selectedMerchant.businessName}</span>
                  {renderStatusBadge(selectedMerchant.status)}
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  {selectedMerchant.ownerName} · {selectedMerchant.location} ·{" "}
                  {selectedMerchant.email}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-wrap gap-3">
                <Button
                  className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
                  onClick={() => updateStatus(selectedMerchant, "active")}
                >
                  <ShieldCheck className="h-4 w-4" /> Activate
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                  onClick={() => updateStatus(selectedMerchant, "suspended")}
                >
                  <CircleAlert className="h-4 w-4" /> Suspend
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-800"
                  onClick={() => handleResetPassword(selectedMerchant)}
                >
                  <LockKeyhole className="h-4 w-4" /> Reset password
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                  onClick={() => handleDeleteMerchant(selectedMerchant)}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </div>

              <Tabs
                value={detailTab}
                onValueChange={setDetailTab}
                className="mt-2"
              >
                <TabsList className="bg-slate-950 text-slate-400">
                  <TabsTrigger
                    value="overview"
                    className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
                  >
                    Overview
                  </TabsTrigger>
                  <TabsTrigger
                    value="features"
                    className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
                  >
                    Features
                  </TabsTrigger>
                  <TabsTrigger
                    value="activity"
                    className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
                  >
                    Activity
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-4 space-y-6">
                  <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
                      <h4 className="text-lg font-semibold text-white">
                        Business info
                      </h4>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <InfoTile
                          label="Business name"
                          value={selectedMerchant.businessName}
                        />
                        <InfoTile
                          label="Owner"
                          value={selectedMerchant.ownerName}
                        />
                        <InfoTile
                          label="Phone"
                          value={selectedMerchant.phone}
                        />
                        <InfoTile
                          label="Email"
                          value={selectedMerchant.email}
                        />
                        <InfoTile
                          label="Vertical"
                          value={selectedMerchant.vertical}
                        />
                        <InfoTile label="Tier" value={selectedMerchant.tier} />
                        <InfoTile
                          label="Location"
                          value={selectedMerchant.location}
                        />
                        <InfoTile
                          label="Onboarded"
                          value={format(
                            new Date(selectedMerchant.onboardedAt),
                            "dd MMM yyyy",
                          )}
                        />
                      </div>
                      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">
                        {selectedMerchant.notes ||
                          "No additional notes captured yet."}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
                      <h4 className="text-lg font-semibold text-white">
                        Usage stats
                      </h4>
                      {selectedStats ? (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <StatTile
                            label="Transactions"
                            value={selectedStats.transactions.toLocaleString()}
                          />
                          <StatTile
                            label="Revenue"
                            value={money.format(selectedStats.revenue)}
                          />
                          <StatTile
                            label="Active staff"
                            value={selectedStats.activeStaff.toString()}
                          />
                          <StatTile
                            label="Catalogue items"
                            value={selectedStats.catalogueItems.toString()}
                          />
                        </div>
                      ) : null}
                      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-400">
                        <div>
                          Last login:{" "}
                          {selectedMerchant.lastLoginAt
                            ? format(
                                new Date(selectedMerchant.lastLoginAt),
                                "dd MMM yyyy · HH:mm",
                              )
                            : "No login recorded"}
                        </div>
                        {selectedStats ? (
                          <div className="mt-2">
                            Last transaction:{" "}
                            {format(
                              new Date(selectedStats.lastTransactionAt),
                              "dd MMM yyyy · HH:mm",
                            )}
                          </div>
                        ) : null}
                        <div className="mt-2">
                          Feature usage footprint:{" "}
                          {selectedStats?.featureUsage ?? 0} enabled features
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="features" className="mt-4">
                  <ScrollArea className="h-[52vh] rounded-3xl border border-slate-800 bg-slate-950/70">
                    <div className="space-y-5 p-5">
                      {featureGroups.map((group) => {
                        const groupedFeatures = featureFlags.filter(
                          (feature) => feature.category === group,
                        );
                        if (!groupedFeatures.length) return null;
                        return (
                          <div
                            key={group}
                            className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5"
                          >
                            <h4 className="text-lg font-semibold text-white">
                              {group}
                            </h4>
                            <div className="mt-4 space-y-3">
                              {groupedFeatures.map((feature) => {
                                const enabled = Boolean(
                                  selectedMerchant.features[feature.key],
                                );
                                const globallyEnabled = Boolean(
                                  globalFeatures[feature.key],
                                );
                                return (
                                  <div
                                    key={feature.key}
                                    className="flex flex-col gap-3 rounded-2xl border border-slate-800 px-4 py-3 md:flex-row md:items-center md:justify-between"
                                  >
                                    <div>
                                      <div className="font-medium text-slate-100">
                                        {feature.name}
                                      </div>
                                      <div className="text-sm text-slate-400">
                                        {feature.description}
                                      </div>
                                      {!globallyEnabled ? (
                                        <div className="mt-1 text-xs uppercase tracking-[0.2em] text-amber-300">
                                          Platform flag is currently off
                                        </div>
                                      ) : null}
                                    </div>
                                    <Switch
                                      checked={enabled}
                                      onCheckedChange={(checked) =>
                                        handleFeatureToggle(
                                          selectedMerchant,
                                          feature.key,
                                          checked,
                                        )
                                      }
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="activity" className="mt-4 space-y-4">
                  <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
                    <h4 className="text-lg font-semibold text-white">
                      Recent merchant activity
                    </h4>
                    <div className="mt-4 space-y-3">
                      {selectedActivity.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium text-slate-100">
                              {entry.details}
                            </div>
                            <div className="text-xs text-slate-500">
                              {format(
                                new Date(entry.timestamp),
                                "dd MMM · HH:mm",
                              )}
                            </div>
                          </div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">
                            {entry.action.replaceAll("_", " ")} ·{" "}
                            {entry.adminEmail}
                          </div>
                        </div>
                      ))}
                      {!selectedActivity.length ? (
                        <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-6 text-sm text-slate-500">
                          No activity has been logged for this merchant yet.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-2 text-sm text-slate-300">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-slate-100">{value}</div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-2 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function renderStatusBadge(status: MerchantStatus) {
  const styles = {
    active: "border-emerald-500/30 bg-emerald-500/15 text-emerald-200",
    pending: "border-amber-500/30 bg-amber-500/15 text-amber-200",
    suspended: "border-rose-500/30 bg-rose-500/15 text-rose-200",
  } as const;

  return (
    <Badge
      className={cn(
        "rounded-full border px-3 py-1 text-xs capitalize",
        styles[status],
      )}
    >
      {status}
    </Badge>
  );
}
