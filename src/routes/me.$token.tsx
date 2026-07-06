import { createFileRoute } from "@tanstack/react-router";
import { Gift, Loader2, ReceiptText, Sparkles, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/me/$token")({
  component: CustomerPortalPage,
});

type Branding = {
  businessName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  reseller: { name: string; poweredBy: string | null; logoUrl: string | null } | null;
};

type Reward = {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
};

type Invoice = {
  id: string;
  number: string;
  amount: number | string;
  currency: string;
  description: string | null;
  status: string;
  pay_link: string | null;
  created_at: string;
};

type Payment = {
  id: string;
  amount: number | string;
  currency: string;
  status: string;
  reference: string | null;
  created_at: string;
};

type Redemption = {
  id: string;
  reward_name: string | null;
  points_spent: number;
  code: string | null;
  status: string;
  created_at: string;
};

type PortalPayload = {
  venue: string;
  branding: Branding;
  contact: { name: string; points: number; tier: string };
  progress?: {
    tier: string;
    nextTier: string | null;
    pointsToNext: number;
    progressPct: number;
    atTop: boolean;
  };
  invoices: Invoice[];
  payments: Payment[];
  rewards: Reward[];
  redemptions: Redemption[];
};

function formatKes(value: number | string): string {
  const amount = Number(value);
  return `KES ${(amount / 100).toLocaleString(undefined, {
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function CustomerPortalPage() {
  const { token } = Route.useParams();
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error("This portal link could not be loaded.");
      setPayload((await res.json()) as PortalPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portal unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function redeem(reward: Reward) {
    setRedeeming(reward.id);
    setCode(null);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rewardId: reward.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
      };
      if (!res.ok || !data.code) {
        throw new Error(data.error ?? "Could not redeem reward.");
      }
      setCode(data.code);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not redeem reward.");
    } finally {
      setRedeeming(null);
    }
  }

  if (loading && !payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </main>
    );
  }

  if (error && !payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-center text-white">
        <div>
          <p className="text-lg font-semibold">Portal unavailable</p>
          <p className="mt-2 text-sm text-slate-300">{error}</p>
        </div>
      </main>
    );
  }

  if (!payload) return null;
  const accent = payload.branding.primaryColor ?? "#059669";

  return (
    <main className="min-h-screen bg-slate-100 pb-10">
      <section
        className="rounded-b-[2rem] px-5 pb-8 pt-6 text-white shadow-xl"
        style={{ background: accent }}
      >
        <div className="mx-auto max-w-md">
          <div className="flex items-center gap-3">
            {payload.branding.logoUrl ? (
              <img
                src={payload.branding.logoUrl}
                alt=""
                className="h-12 w-12 rounded-2xl bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <Sparkles className="h-6 w-6" />
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-[0.2em] opacity-75">
                My rewards
              </p>
              <h1 className="text-2xl font-black">{payload.branding.businessName}</h1>
            </div>
          </div>
          <div className="mt-7 rounded-3xl bg-white/15 p-5 backdrop-blur">
            <p className="text-sm opacity-80">Welcome back, {payload.contact.name}</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <p className="text-5xl font-black">
                  {payload.contact.points.toLocaleString()}
                </p>
                <p className="text-sm font-semibold">available points</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-900">
                {payload.contact.tier}
              </span>
            </div>
            {payload.progress ? (
              <div className="mt-4">
                {payload.progress.atTop ? (
                  <p className="text-xs font-semibold opacity-90">
                    🎉 You&apos;re at our top tier
                  </p>
                ) : (
                  <>
                    <div className="flex justify-between text-[11px] font-semibold opacity-90">
                      <span>{payload.progress.tier}</span>
                      <span>
                        {payload.progress.pointsToNext.toLocaleString()} pts to{" "}
                        {payload.progress.nextTier}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/25">
                      <div
                        className="h-full rounded-full bg-white transition-all"
                        style={{ width: `${payload.progress.progressPct}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
          {payload.branding.reseller?.poweredBy ? (
            <p className="mt-4 text-xs opacity-75">
              {payload.branding.reseller.poweredBy}
            </p>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-md space-y-5 px-4 pt-5">
        {code ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <p className="text-sm font-semibold text-emerald-700">Show this code</p>
            <p className="mt-1 font-mono text-4xl font-black tracking-widest text-emerald-950">
              {code}
            </p>
          </div>
        ) : null}
        {error ? <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.2em] text-slate-500">
            <Gift className="h-4 w-4" /> Redeem rewards
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {payload.rewards.map((reward) => {
              const canRedeem = payload.contact.points >= reward.pointsCost;
              return (
                <article key={reward.id} className="rounded-3xl bg-white p-4 shadow-sm">
                  <h3 className="font-bold text-slate-950">{reward.name}</h3>
                  {reward.description ? (
                    <p className="mt-1 text-sm text-slate-500">{reward.description}</p>
                  ) : null}
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="font-mono text-sm font-black text-slate-700">
                      {reward.pointsCost} pts
                    </span>
                    <button
                      type="button"
                      disabled={!canRedeem || redeeming === reward.id}
                      onClick={() => redeem(reward)}
                      className="rounded-full px-4 py-2 text-sm font-black text-white disabled:opacity-40"
                      style={{ background: accent }}
                    >
                      {redeeming === reward.id ? "..." : "Redeem"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-black text-slate-950">
            <ReceiptText className="h-4 w-4" /> Recent invoices
          </h2>
          <div className="mt-3 divide-y">
            {payload.invoices.length === 0 ? (
              <p className="py-3 text-sm text-slate-500">No invoices yet.</p>
            ) : (
              payload.invoices.map((invoice) => (
                <div key={invoice.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold text-slate-900">{invoice.number}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(invoice.created_at)} · {invoice.status}
                    </p>
                  </div>
                  <p className="font-mono text-sm font-bold">{formatKes(invoice.amount)}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-black text-slate-950">
            <WalletCards className="h-4 w-4" /> Payment history
          </h2>
          <div className="mt-3 divide-y">
            {payload.payments.length === 0 ? (
              <p className="py-3 text-sm text-slate-500">No payments yet.</p>
            ) : (
              payload.payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {payment.reference ?? payment.id}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(payment.created_at)} · {payment.status}
                    </p>
                  </div>
                  <p className="font-mono text-sm font-bold">{formatKes(payment.amount)}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {payload.redemptions.length > 0 ? (
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="font-black text-slate-950">Recent redemptions</h2>
            <div className="mt-3 divide-y">
              {payload.redemptions.map((redemption) => (
                <div key={redemption.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {redemption.reward_name ?? "Reward"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(redemption.created_at)} · {redemption.status}
                    </p>
                  </div>
                  <p className="font-mono text-sm font-bold">{redemption.code}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <a
          href="/enquire"
          className="block rounded-3xl px-5 py-4 text-center text-sm font-black text-white shadow-sm"
          style={{ background: accent }}
        >
          Book again
        </a>
      </section>
    </main>
  );
}
