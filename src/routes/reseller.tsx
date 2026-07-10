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
  require_invite?: boolean;
};

type Invite = {
  token: string;
  email: string | null;
  used_at: string | null;
  used_venue: string | null;
  expires_at: string;
};

function ResellerPortal() {
  const { user } = useAuth();
  const [org, setOrg] = useState<Org | null>(null);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [analytics, setAnalytics] = useState<OrgAnalytics | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [requireInvite, setRequireInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [mName, setMName] = useState("");
  const [mEmail, setMEmail] = useState("");
  const [mPassword, setMPassword] = useState("");
  const [onboarding, setOnboarding] = useState(false);

  const [poweredBy, setPoweredBy] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#2563eb");
  const [logoUrl, setLogoUrl] = useState("");
  const [savingBrand, setSavingBrand] = useState(false);

  // Enterprise OIDC SSO connection for this org.
  const [sso, setSso] = useState<{
    issuer?: string;
    enabled?: boolean;
    email_domain?: string | null;
  } | null>(null);
  const [ssoForm, setSsoForm] = useState({
    issuer: "",
    clientId: "",
    clientSecret: "",
    authorizeUrl: "",
    tokenUrl: "",
    jwksUrl: "",
    emailDomain: "",
    defaultRole: "reseller_admin",
  });
  const [savingSso, setSavingSso] = useState(false);

  async function load() {
    const [orgRes, merRes, anRes, invRes, ledRes, ssoRes] = await Promise.all([
      authFetch("/api/org/me")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      authFetch("/api/org/merchants")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      authFetch("/api/org/analytics")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      authFetch("/api/org/invites")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      authFetch("/api/org/ledger")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      authFetch("/api/org/sso")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);
    if (orgRes?.org) {
      const o = orgRes.org as Org;
      setOrg(o);
      setPoweredBy(o.branding?.poweredBy ?? "");
      setPrimaryColor(o.branding?.primaryColor ?? "#2563eb");
      setLogoUrl(o.branding?.logoUrl ?? "");
      setRequireInvite(Boolean(o.require_invite));
    }
    setMerchants((merRes?.merchants as Merchant[]) ?? []);
    setAnalytics((anRes as OrgAnalytics) ?? null);
    setInvites((invRes?.invites as Invite[]) ?? []);
    setLedgerTotal(Number((ledRes as { total?: number })?.total ?? 0));
    const conn = (ssoRes as { connection?: Record<string, unknown> })?.connection;
    setSso(conn ? (conn as typeof sso) : null);
    if (conn) {
      setSsoForm((f) => ({
        ...f,
        issuer: (conn.issuer as string) ?? "",
        clientId: (conn.client_id as string) ?? "",
        authorizeUrl: (conn.authorize_url as string) ?? "",
        tokenUrl: (conn.token_url as string) ?? "",
        jwksUrl: (conn.jwks_url as string) ?? "",
        emailDomain: (conn.email_domain as string) ?? "",
        defaultRole: (conn.default_role as string) ?? "reseller_admin",
      }));
    }
    setLoading(false);
  }

  async function saveSso() {
    setSavingSso(true);
    try {
      const res = await authFetch("/api/org/sso", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ssoForm),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error ?? "Could not save SSO connection.");
        return;
      }
      toast.success("SSO connection saved.");
      await load();
    } finally {
      setSavingSso(false);
    }
  }

  async function generateInvite() {
    setGenBusy(true);
    try {
      const res = await authFetch("/api/org/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        invite?: { token: string };
        error?: string;
      };
      if (res.ok && data.invite) {
        toast.success("Invite created");
        setInviteEmail("");
        void load();
      } else {
        toast.error(data.error ?? "Could not create invite");
      }
    } finally {
      setGenBusy(false);
    }
  }

  async function toggleRequireInvite(next: boolean) {
    setRequireInvite(next);
    await authFetch("/api/org", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requireInvite: next }),
    }).catch(() => {});
  }

  function inviteLink(token: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/get-started?org=${org?.slug ?? ""}&invite=${token}`;
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
  const origin = typeof window !== "undefined" ? window.location.origin : "";

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
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Processed volume (30d)"
            value={kes(analytics.total.gross)}
          />
          <StatCard
            label="Transactions (30d)"
            value={String(analytics.total.tx)}
          />
          <StatCard
            label={`Commission (30d · ${(analytics.commissionBps / 100).toFixed(2)}%)`}
            value={kes(analytics.total.commission)}
            accent
          />
          <StatCard
            label="Commission posted (all-time)"
            value={kes(ledgerTotal)}
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

      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Signup invites</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requireInvite}
              onChange={(e) => void toggleRequireInvite(e.target.checked)}
            />
            Invite-only signup (block open <code>?org={org.slug}</code>)
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Input
            placeholder="Bind to email (optional)"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="max-w-xs"
          />
          <Button onClick={generateInvite} disabled={genBusy}>
            {genBusy ? "Generating…" : "Generate invite"}
          </Button>
        </div>
        {invites.length > 0 ? (
          <ul className="mt-4 space-y-2 text-sm">
            {invites.slice(0, 8).map((inv) => (
              <li
                key={inv.token}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span className="truncate">
                  {inv.email ?? "any email"} ·{" "}
                  {inv.used_at ? (
                    <span className="text-muted-foreground">used</span>
                  ) : new Date(inv.expires_at) < new Date() ? (
                    <span className="text-muted-foreground">expired</span>
                  ) : (
                    <span className="text-emerald-600">active</span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={Boolean(inv.used_at)}
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(inviteLink(inv.token))
                      .then(() => toast.success("Signup link copied"));
                  }}
                  className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40"
                >
                  Copy link
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No invites yet. Generate one to share a private signup link.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Enterprise SSO (OIDC)</h2>
          {sso ? (
            <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {sso.enabled === false ? "Configured (disabled)" : "Active"}
            </span>
          ) : (
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Not configured
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your identity provider (Okta, Entra ID, Google Workspace, Auth0…)
          so your team signs in with corporate credentials.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ["Issuer", "issuer", "https://your-idp.com"],
            ["Client ID", "clientId", "client id"],
            ["Client secret", "clientSecret", sso ? "•••••• (unchanged)" : "client secret"],
            ["Authorize URL", "authorizeUrl", "https://your-idp.com/authorize"],
            ["Token URL", "tokenUrl", "https://your-idp.com/token"],
            ["JWKS URL", "jwksUrl", "https://your-idp.com/jwks"],
            ["Email domain (optional)", "emailDomain", "company.com"],
          ].map(([label, key, placeholder]) => (
            <label key={key} className="block space-y-1 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <Input
                type={key === "clientSecret" ? "password" : "text"}
                value={(ssoForm as Record<string, string>)[key]}
                onChange={(e) =>
                  setSsoForm((f) => ({ ...f, [key]: e.target.value }))
                }
                placeholder={placeholder}
              />
            </label>
          ))}
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Role for SSO users</span>
            <select
              value={ssoForm.defaultRole}
              onChange={(e) =>
                setSsoForm((f) => ({ ...f, defaultRole: e.target.value }))
              }
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="reseller_admin">Reseller admin</option>
              <option value="manager">Manager</option>
              <option value="staff">Staff</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={saveSso} disabled={savingSso}>
            {savingSso ? "Saving…" : sso ? "Update SSO" : "Save SSO"}
          </Button>
        </div>
        <div className="mt-4 space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">
              Redirect URI (register at your IdP):
            </span>
            <code className="break-all">{origin}/api/auth/sso/callback</code>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Staff sign-in link:</span>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(`${origin}/api/auth/sso/${org.slug}/start`)
                  .then(() => toast.success("SSO link copied"))
              }
              className="break-all text-left underline decoration-dotted"
            >
              {origin}/api/auth/sso/{org.slug}/start
            </button>
          </div>
        </div>
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
