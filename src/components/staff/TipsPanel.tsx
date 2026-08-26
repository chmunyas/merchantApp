import { Fragment, useCallback, useEffect, useState } from "react";
import { AlertTriangle, Coins, Loader2, PiggyBank, SlidersHorizontal } from "lucide-react";

import { authFetch } from "@/lib/auth";

/**
 * Sunday's Tips tab (roadmap D5.1, D5.2, D5.6–D5.11).
 *
 * Three sections, in Sunday's order: Collection (what came in, split direct vs
 * jar and by capture channel), Distribution (the weekly jar, its cadence and its
 * history), and Rules (per-server percentages, edit actions and per-server
 * history).
 *
 * D5.10 substitution: Sunday's banner warns when a server has no POS account. We
 * have no POS connector yet (that is C5), so the banner warns on the thing that
 * actually blocks a payout here — a server with no payout details on file.
 */

type CollectionResponse = {
  period: { from: string; to: string };
  model: string;
  totals: { gross: number; net: number; direct: number; jar: number; payments: number };
  byChannel: Array<{ channel: string; net: number; direct: number; jar: number; payments: number }>;
  byServer: Array<{
    staffId: string | null;
    name: string | null;
    net: number;
    direct: number;
    jar: number;
    payments: number;
  }>;
};

type JarResponse = {
  model: string;
  jarMethod: "by_hours" | "fixed";
  week: {
    weekStart: string;
    collectionStart: string;
    collectionEnd: string;
    opensAt: string;
    onTimeDeadline: string;
    scheduledPayoutAt: string;
  };
  isOpen: boolean;
  available: number;
  distributed: {
    at: string;
    by: string | null;
    method: string | null;
    scheduledPayoutAt: string | null;
    weeksLate: number | null;
  } | null;
  payoutIfDistributedNow: string;
  weeksLateIfDistributedNow: number;
  history: Array<{
    poolId: string;
    weekStart: string;
    jarTips: number;
    distributedAt: string;
    method: string | null;
    scheduledPayoutAt: string | null;
    weeksLate: number | null;
    recipients: number;
  }>;
  unbankedStaff: Array<{ staffId: string; name: string }>;
};

type RulesResponse = {
  settings: {
    model: "direct" | "jar" | "split";
    defaultDirectPct: number;
    jarMethod: "by_hours" | "fixed";
  };
  servers: Array<{
    staffId: string;
    name: string;
    role: string;
    active: boolean;
    directPct: number;
    jarPct: number;
    source: string;
    payoutMethod: string | null;
    payoutAccount: string | null;
    canBePaid: boolean;
    lastPaidAt: string | null;
    lifetimeDirect: number;
    lifetimeJar: number;
  }>;
};

type ServerHistory = {
  staffId: string;
  history: Array<{
    id: string;
    amount: number;
    stream: string;
    weekStart: string | null;
    createdAt: string;
    payoutStatus: string | null;
    scheduledFor: string | null;
    heldReason: string | null;
  }>;
};

const MODEL_COPY: Record<string, string> = {
  direct: "100% direct to servers — paid automatically every Monday.",
  jar: "100% tip jar — you distribute it, staff are paid the following Monday.",
  split: "Split — each server keeps their percentage, the rest goes to the jar.",
};

function kes(minor: number): string {
  return `KES ${(Number(minor || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function day(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function dayTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TipsPanel() {
  const [collection, setCollection] = useState<CollectionResponse | null>(null);
  const [jar, setJar] = useState<JarResponse | null>(null);
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<ServerHistory | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const [collectionRes, jarRes, rulesRes] = await Promise.all([
        authFetch("/api/tips/collection"),
        authFetch("/api/tips/jar"),
        authFetch("/api/tips/rules"),
      ]);
      if (!collectionRes.ok || !jarRes.ok || !rulesRes.ok) {
        setUnavailable(true);
        return;
      }
      setCollection(await collectionRes.json());
      setJar(await jarRes.json());
      setRules(await rulesRes.json());
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openHistory = useCallback(async (staffId: string) => {
    setExpanded((current) => (current === staffId ? null : staffId));
    setHistory(null);
    const res = await authFetch(`/api/tips/rules?staff=${encodeURIComponent(staffId)}`);
    if (res.ok) setHistory(await res.json());
  }, []);

  const saveRules = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await authFetch("/api/tips/rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(res.ok ? "Rules saved." : (data.error ?? "Could not save the rules."));
        if (res.ok) {
          setDrafts({});
          await load();
        }
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const distribute = useCallback(async () => {
    if (!jar) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await authFetch("/api/tips/jar/distribute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `jar:${jar.week.weekStart}`,
        },
        body: JSON.stringify({ weekStart: jar.week.weekStart, method: jar.jarMethod }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(
        res.ok
          ? `Jar distributed. Staff are paid on ${day(jar.payoutIfDistributedNow)}.`
          : (data.error ?? "The jar could not be distributed."),
      );
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  }, [jar, load]);

  if (unavailable) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
        Tips management is unavailable. Apply migration 70 and make sure this account has
        the manager role.
      </div>
    );
  }

  if (!collection || !jar || !rules) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
        <Loader2 className="size-4 animate-spin" /> Loading tips…
      </div>
    );
  }

  const unbanked = jar.unbankedStaff ?? [];

  return (
    <div className="space-y-6">
      {unbanked.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">
              {unbanked.length} {unbanked.length === 1 ? "server has" : "servers have"} no
              payout details
            </p>
            <p className="mt-1">
              {unbanked.map((staff) => staff.name).join(", ")} cannot be paid. Their tips
              are held, not lost — ask them to add their details in the staff app.
            </p>
          </div>
        </div>
      )}

      {message && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          {message}
        </div>
      )}

      {/* ---------------- 1. Collection ---------------- */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="flex items-center gap-2">
          <Coins className="size-5 text-amber-500" />
          <h3 className="text-lg font-semibold">Collection</h3>
          <span className="ml-auto text-xs text-slate-500">
            {day(collection.period.from)} → {day(collection.period.to)}
          </span>
        </header>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Collected</p>
            <p className="mt-1 text-2xl font-bold">{kes(collection.totals.net)}</p>
            <p className="text-xs text-slate-500">
              {collection.totals.payments} payment
              {collection.totals.payments === 1 ? "" : "s"}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Direct to servers</p>
            <p className="mt-1 text-2xl font-bold">{kes(collection.totals.direct)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">To the tip jar</p>
            <p className="mt-1 text-2xl font-bold">{kes(collection.totals.jar)}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              By capture channel
            </p>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {collection.byChannel.length === 0 ? (
                  <tr>
                    <td className="py-2 text-slate-500">No tips in this period.</td>
                  </tr>
                ) : (
                  collection.byChannel.map((row) => (
                    <tr key={row.channel} className="border-t border-slate-100">
                      <td className="py-2 capitalize">{row.channel}</td>
                      <td className="py-2 text-right text-slate-500">{row.payments}</td>
                      <td className="py-2 text-right font-medium">{kes(row.net)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              By server
            </p>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {collection.byServer.length === 0 ? (
                  <tr>
                    <td className="py-2 text-slate-500">No tips in this period.</td>
                  </tr>
                ) : (
                  collection.byServer.map((row) => (
                    <tr key={row.staffId ?? "unassigned"} className="border-t border-slate-100">
                      <td className="py-2">{row.name ?? "Unassigned"}</td>
                      <td className="py-2 text-right text-slate-500">
                        {kes(row.direct)} direct
                      </td>
                      <td className="py-2 text-right font-medium">{kes(row.net)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------------- 2. Distribution ---------------- */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="flex items-center gap-2">
          <PiggyBank className="size-5 text-emerald-600" />
          <h3 className="text-lg font-semibold">Distribution</h3>
        </header>

        {rules.settings.model === "direct" ? (
          <p className="mt-3 text-sm text-slate-600">
            This venue pays 100% direct to servers, so there is no jar to distribute.
            Tips are paid automatically on the Monday after each week closes.
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Available to distribute
                </p>
                <p className="mt-1 text-2xl font-bold">{kes(jar.available)}</p>
                <p className="text-xs text-slate-500">Week of {day(jar.week.weekStart)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Jar opens</p>
                <p className="mt-1 text-sm font-semibold">{dayTime(jar.week.opensAt)}</p>
                <p className="text-xs text-slate-500">
                  {jar.isOpen ? "Open now — distribute any time up to Sunday." : "Not open yet."}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Paid to staff on
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {day(jar.payoutIfDistributedNow)}
                </p>
                <p className="text-xs text-slate-500">
                  {jar.weeksLateIfDistributedNow > 0
                    ? `${jar.weeksLateIfDistributedNow} week${jar.weeksLateIfDistributedNow === 1 ? "" : "s"} later than promised (S+${jar.weeksLateIfDistributedNow + 1}).`
                    : "On the promised Monday."}
                </p>
              </div>
            </div>

            {jar.distributed ? (
              <p className="mt-4 text-sm text-slate-600">
                Distributed {dayTime(jar.distributed.at)} by {jar.distributed.method}. Staff
                are paid on {day(jar.distributed.scheduledPayoutAt)}.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!jar.isOpen || busy || jar.available <= 0}
                  onClick={() => void distribute()}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Distributing…" : `Distribute by ${jar.jarMethod === "fixed" ? "fixed amount" : "hours worked"}`}
                </button>
                <span className="text-xs text-slate-500">
                  Change the method in Rules below.
                </span>
              </div>
            )}

            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Distribution history
              </p>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-1">Week</th>
                    <th>Distributed</th>
                    <th>Method</th>
                    <th>Paid</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {jar.history.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-2 text-slate-500">
                        Nothing distributed yet.
                      </td>
                    </tr>
                  ) : (
                    jar.history.map((row) => (
                      <tr key={row.poolId} className="border-t border-slate-100">
                        <td className="py-2">{day(row.weekStart)}</td>
                        <td>{dayTime(row.distributedAt)}</td>
                        <td>{row.method === "fixed" ? "Fixed amount" : "Hours worked"}</td>
                        <td>
                          {day(row.scheduledPayoutAt)}
                          {row.weeksLate ? ` (S+${row.weeksLate + 1})` : ""}
                        </td>
                        <td className="text-right font-medium">{kes(row.jarTips)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ---------------- 3. Rules ---------------- */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="flex items-center gap-2">
          <SlidersHorizontal className="size-5 text-slate-500" />
          <h3 className="text-lg font-semibold">Rules</h3>
        </header>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="text-xs uppercase tracking-wide text-slate-500">Model</span>
            <select
              value={rules.settings.model}
              onChange={(event) => void saveRules({ model: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            >
              <option value="direct">100% direct to servers</option>
              <option value="jar">100% tip jar</option>
              <option value="split">Split direct / jar</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Default direct %
            </span>
            <input
              type="number"
              min={0}
              max={100}
              defaultValue={rules.settings.defaultDirectPct}
              disabled={rules.settings.model !== "split"}
              onBlur={(event) =>
                void saveRules({ defaultDirectPct: Number(event.target.value) })
              }
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 disabled:bg-slate-100"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Jar distribution
            </span>
            <select
              value={rules.settings.jarMethod}
              onChange={(event) => void saveRules({ jarMethod: event.target.value })}
              disabled={rules.settings.model === "direct"}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 disabled:bg-slate-100"
            >
              <option value="by_hours">By hours worked</option>
              <option value="fixed">Fixed amount per employee</option>
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">{MODEL_COPY[rules.settings.model]}</p>

        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1">Server</th>
              <th>Direct %</th>
              <th>Jar %</th>
              <th>Payout to</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.servers.map((server) => (
              <Fragment key={server.staffId}>
                <tr className="border-t border-slate-100">
                  <td className="py-2">
                    <span className="font-medium">{server.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{server.role}</span>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={drafts[server.staffId] ?? server.directPct}
                      disabled={rules.settings.model !== "split"}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [server.staffId]: Number(event.target.value),
                        }))
                      }
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 disabled:bg-slate-100"
                    />
                  </td>
                  <td>{100 - (drafts[server.staffId] ?? server.directPct)}%</td>
                  <td>
                    {server.payoutAccount ? (
                      <span>
                        {server.payoutAccount}
                        <span className="ml-1 text-xs text-slate-500">
                          {server.payoutMethod}
                        </span>
                      </span>
                    ) : (
                      <span className="text-amber-700">Not set</span>
                    )}
                  </td>
                  <td className="space-x-2 text-right">
                    {drafts[server.staffId] != null &&
                      drafts[server.staffId] !== server.directPct && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void saveRules({
                              servers: [
                                {
                                  staffId: server.staffId,
                                  directPct: drafts[server.staffId],
                                },
                              ],
                            })
                          }
                          className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white"
                        >
                          Save
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={() => void openHistory(server.staffId)}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    >
                      History
                    </button>
                  </td>
                </tr>
                {expanded === server.staffId && (
                  <tr className="bg-slate-50">
                    <td colSpan={5} className="p-3">
                      {!history ? (
                        <span className="text-xs text-slate-500">Loading history…</span>
                      ) : history.history.length === 0 ? (
                        <span className="text-xs text-slate-500">
                          No allocations yet for {server.name}.
                        </span>
                      ) : (
                        <table className="w-full text-xs">
                          <tbody>
                            {history.history.map((row) => (
                              <tr key={row.id} className="border-t border-slate-200">
                                <td className="py-1">{day(row.weekStart)}</td>
                                <td className="capitalize">{row.stream}</td>
                                <td>{row.payoutStatus ?? "unpaid"}</td>
                                <td>{day(row.scheduledFor)}</td>
                                <td className="text-right font-medium">{kes(row.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">
          A server appears here as soon as you add them to the team. They set their own
          payout details in the staff app — you only ever see the last four digits.
        </p>
      </section>
    </div>
  );
}
