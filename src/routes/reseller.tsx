import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authFetch, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/reseller")({
  component: ResellerPortal,
});

const kes = (minor: number) =>
  `KES ${(Number(minor) / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

type Merchant = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  created_at: string;
  users: number;
};

type OrgAnalytics = {
  commissionBps: number;
  currency: string;
  merchants: Array<{
    id: string;
    name: string;
    gross: number;
    tx: number;
    commission: number;
  }>;
  total: { gross: number; tx: number; commission: number };
};

type Org = {
  id: string;
  name: string;
  slug: string;
  branding: {
    logoUrl?: string | null;
    primaryColor?: string | null;
    poweredBy?: string | null;
  } | null;
};

function ResellerPortal() {
  const { user } = useAuth();
  const [org, setOrg] = useState<Org | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [analytics, setAnalytics] = useState<OrgAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const [mName, setMName] = useState("");
  const [mEmail, setMEmail] = useState("");
  const [mPassword, setMPassword] = useState("");
  const [onboarding, setOnboarding] = useState(false);

  const [poweredBy, setPoweredBy] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const [logoUrl, setLogoUrl] = useState("");
  const [savingBrand, setSavingBrand] = useState(false);

  async function load() {
    const [orgRes, merRes, anRes] = await Promise.all([
      authFetch("/api/org/me")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      authFetch("/api/org/merchants")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      authFetch("/api/org/analytics")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);
    if (orgRes?.org) {
      const o = orgRes.org as Org;
      setOrg(o);
      setPoweredBy(o.branding?.poweredBy ?? "");
      setPrimaryColor(o.branding?.primaryColor ?? "#2563eb");
      setLogoUrl(o.branding?.logoUrl ?? "");
    }
    setMerchants((merRes?.merchants as Merchant[]) ?? []);
    setAnalytics((anRes as OrgAnalytics) ?? null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onboard(e: React.FormEvent) {
    e.preventDefault();
    if (!mName || !mEmail.includes("@") || mPassword.length < 8) {
      toast.error("Business name, a valid email and password (8+) are required");
      return;
    }
    setOnboarding(true);
    try {
      const res = await authFetch("/api/org/merchants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessName: mName,
          email: mEmail,
          password: mPassword,
        }),
      });
      if (res.ok) {
        toast.success("Merchant onboarded");
        setMName("");
        setMEmail("");
        setMPassword("");
        void load();
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error ?? "Could not onboard merchant");
      }
    } finally {
      setOnboarding(false);
    }
  }

  function handleLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > 512 * 1024) {
      toast.error("Logo must be under 512KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoUrl(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function saveBrand() {
    setSavingBrand(true);
    try {
      const res = await authFetch("/api/org", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          logoUrl: logoUrl || undefined,
          primaryColor,
          poweredBy,
        }),
      });
      if (res.ok) toast.success("Brand saved");
      else toast.error("Could not save brand");
    } finally {
      setSavingBrand(false);
    }
  }

  if (user && user.role !== "reseller_admin") {
    return (
      <div className="p-8 text-muted-foreground">
        This area is for reseller (bank) admins.
      </div>
    );
  }
  if (loading) return <div className="p-8">Loading…</div>;
  if (!org)
    return (
      <div className="p-8 text-muted-foreground">
        No reseller organization is linked to this account.
      </div>
    );

  const revById = new Map(
    (analytics?.merchants ?? []).map((m) => [m.id, m] as const),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <header
        className="rounded-2xl border border-border bg-card p-6"
        style={{ borderTop: `4px solid ${primaryColor}` }}
      >
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              className="h-10 w-auto max-w-[160px] object-contain"
              alt={org.name}
            />
          ) : null}
          <div>
            <h1 className="text-2xl font-bold">{org.name}</h1>
            <p className="text-sm text-muted-foreground">
              Reseller portal · {merchants.length} merchant(s) · signup link{" "}
              <code>/get-started?org={org.slug}</code>
            </p>
          </div>
        </div>
      </header>

      {analytics ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Processed volume (30d)"
            value={kes(analytics.total.gross)}
          />
          <StatCard
            label="Transactions (30d)"
            value={String(analytics.total.tx)}
          />
          <StatCard
            label={`Your commission (${(analytics.commissionBps / 100).toFixed(2)}%)`}
            value={kes(analytics.total.commission)}
            accent
          />
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Onboard a merchant</h2>
          <form className="mt-4 space-y-3" onSubmit={onboard}>
            <Input
              placeholder="Business name"
              value={mName}
              onChange={(e) => setMName(e.target.value)}
            />
            <Input
              placeholder="Owner email"
              type="email"
              value={mEmail}
              onChange={(e) => setMEmail(e.target.value)}
            />
            <Input
              placeholder="Temporary password (8+)"
              type="password"
              value={mPassword}
              onChange={(e) => setMPassword(e.target.value)}
            />
            <Button type="submit" disabled={onboarding}>
              {onboarding ? "Onboarding…" : "Onboard merchant"}
            </Button>
          </form>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Your brand</h2>
          <div className="mt-4 space-y-3">
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={(e) => handleLogo(e.target.files?.[0] ?? undefined)}
              className="text-sm"
            />
            <div className="flex items-center gap-3">
              <label className="text-sm">Primary colour</label>
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-9 w-16 rounded border border-border"
              />
            </div>
            <Input
              placeholder="Powered by …"
              value={poweredBy}
              onChange={(e) => setPoweredBy(e.target.value)}
            />
            <Button onClick={saveBrand} disabled={savingBrand}>
              {savingBrand ? "Saving…" : "Save brand"}
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Merchants</h2>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-2">Name</th>
              <th>Code</th>
              <th>Users</th>
              <th className="text-right">Gross (30d)</th>
              <th className="text-right">Commission</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {merchants.map((m) => {
              const r = revById.get(m.id);
              return (
                <tr key={m.id} className="border-t border-border">
                  <td className="py-2 font-medium">{m.name}</td>
                  <td>{m.code}</td>
                  <td>{m.users}</td>
                  <td className="text-right tabular-nums">
                    {r ? kes(r.gross) : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {r ? kes(r.commission) : "—"}
                  </td>
                  <td>{m.active ? "Active" : "Inactive"}</td>
                </tr>
              );
            })}
            {merchants.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-muted-foreground">
                  No merchants yet — onboard your first above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border bg-card p-4 ${accent ? "border-emerald-300" : "border-border"}`}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
