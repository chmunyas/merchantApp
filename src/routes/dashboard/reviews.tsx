import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/reviews")({
  component: DashboardReviewsPage,
});

type LiveReview = {
  id: string;
  rating: number;
  comment: string | null;
  customer_name: string | null;
  source: string | null;
  staff_id: string | null;
  created_at: string;
  response: string | null;
};

type Template = { id: string; title: string; body: string };

type Analytics = {
  stats: {
    count: number;
    average: number | null;
    distribution: Array<{ rating: number; count: number }>;
    responseRate: number | null;
    needsAttention: number;
  };
  trend: Array<{ period: string; count: number; average: number | null }>;
  origin: {
    total: number;
    fromPayments: number;
    fromGoogle: number;
    share: number | null;
  };
  staff: Array<{
    staffId: string;
    name: string | null;
    count: number;
    average: number | null;
    fiveStar: number;
    negative: number;
  }>;
};

type GoogleStatus = {
  state: "not_configured" | "not_connected" | "connected";
  placeId: string | null;
  locationTitle: string | null;
  connectedAt: string | null;
  reviewUrl: string | null;
};

type Settings = {
  publicRedirectEnabled: boolean;
  publicRedirectMinRating: number;
  googlePlaceId: string | null;
};

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1 text-amber-400">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i < value ? "fill-current" : "text-slate-300"}`}
        />
      ))}
    </div>
  );
}

function DashboardReviewsPage() {
  const [reviews, setReviews] = useState<LiveReview[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [builtin, setBuiltin] = useState<Template[]>([]);
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ratingFilter, setRatingFilter] = useState<number | "all">("all");
  const [answered, setAnswered] = useState<"all" | "yes" | "no">("all");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [placeId, setPlaceId] = useState("");
  const [newTemplate, setNewTemplate] = useState({ title: "", body: "" });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [listRes, statsRes, tplRes, setRes] = await Promise.all([
        authFetch("/api/reviews"),
        authFetch("/api/reviews/analytics"),
        authFetch("/api/reviews/templates"),
        authFetch("/api/reviews/settings"),
      ]);
      if (listRes.ok) {
        const data = (await listRes.json()) as { reviews?: LiveReview[] };
        setReviews(data.reviews ?? []);
      }
      if (statsRes.ok) setAnalytics((await statsRes.json()) as Analytics);
      if (tplRes.ok) {
        const data = (await tplRes.json()) as {
          templates?: Template[];
          builtin?: Template[];
        };
        setTemplates(data.templates ?? []);
        setBuiltin(data.builtin ?? []);
      }
      if (setRes.ok) {
        const data = (await setRes.json()) as {
          settings: Settings;
          google: GoogleStatus;
        };
        setSettings(data.settings);
        setGoogle(data.google);
        setPlaceId(data.settings.googlePlaceId ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      reviews.filter(
        (r) =>
          (ratingFilter === "all" || r.rating === ratingFilter) &&
          (answered === "all" ||
            (answered === "yes" ? Boolean(r.response) : !r.response)),
      ),
    [reviews, ratingFilter, answered],
  );

  async function reply(id: string, templateId?: string) {
    try {
      const res = await authFetch(`/api/reviews/${id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(templateId ? { templateId } : {}),
      });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as {
        response: string;
        googleSynced: boolean;
        googleError: string | null;
      };
      setReviews((cur) =>
        cur.map((r) => (r.id === id ? { ...r, response: data.response } : r)),
      );
      toast.success(
        data.googleSynced ? "Reply posted to Google" : "Reply saved",
      );
      if (data.googleError) toast.error(`Google: ${data.googleError}`);
    } catch {
      toast.error("Couldn't post the reply");
    }
  }

  async function saveSettings(patch: Partial<Settings>) {
    const res = await authFetch("/api/reviews/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toast.error("Couldn't save reputation settings");
      return;
    }
    const data = (await res.json()) as {
      settings: Settings;
      google: GoogleStatus;
    };
    setSettings(data.settings);
    setGoogle(data.google);
    toast.success("Saved");
  }

  async function connectGoogle() {
    const res = await authFetch("/api/reviews/google/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const data = (await res.json().catch(() => ({}))) as {
      authorizeUrl?: string;
      message?: string;
      error?: string;
    };
    if (!res.ok || !data.authorizeUrl) {
      toast.error(data.message ?? data.error ?? "Google is not configured");
      return;
    }
    window.open(data.authorizeUrl, "_blank", "noopener,noreferrer");
  }

  async function syncGoogle() {
    const res = await authFetch("/api/reviews/google/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const data = (await res.json().catch(() => ({}))) as {
      imported?: number;
      error?: string;
    };
    if (!res.ok) {
      toast.error(data.error ?? "Google sync unavailable");
      return;
    }
    toast.success(`Imported ${data.imported ?? 0} Google reviews`);
    void load();
  }

  async function createTemplate() {
    if (!newTemplate.title.trim() || !newTemplate.body.trim()) return;
    const res = await authFetch("/api/reviews/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newTemplate),
    });
    if (!res.ok) {
      toast.error("Couldn't save the template");
      return;
    }
    setNewTemplate({ title: "", body: "" });
    toast.success("Template saved");
    void load();
  }

  async function deleteTemplate(id: string) {
    const res = await authFetch(`/api/reviews/templates/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Couldn't delete the template");
      return;
    }
    void load();
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        Loading reviews…
      </div>
    );
  }

  const stats = analytics?.stats;
  const trend = analytics?.trend ?? [];
  const trendDelta =
    trend.length >= 2
      ? (trend[trend.length - 1].average ?? 0) -
        (trend[trend.length - 2].average ?? 0)
      : null;

  return (
    <div className="space-y-6">
      {/* D6.4 — average rating, evolution, and the share coming from us. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Average rating</p>
          <p className="mt-3 font-mono text-5xl font-semibold">
            {stats?.average?.toFixed(2) ?? "—"}
          </p>
          <div className="mt-3">
            <Stars value={Math.round(stats?.average ?? 0)} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {stats?.count ?? 0} reviews
            {trendDelta == null
              ? ""
              : ` · ${trendDelta >= 0 ? "+" : ""}${trendDelta.toFixed(2)} vs last month`}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Share originating from PesaSwap
          </p>
          <p className="mt-3 font-mono text-5xl font-semibold">
            {analytics?.origin.share == null
              ? "—"
              : `${Math.round(analytics.origin.share * 100)}%`}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {analytics?.origin.fromPayments ?? 0} captured at payment ·{" "}
            {analytics?.origin.fromGoogle ?? 0} imported from Google
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Evolution</p>
          <div className="mt-4 flex h-24 items-end gap-1">
            {trend.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No reviews yet — the trend appears once guests start rating.
              </p>
            ) : (
              trend.map((t) => (
                <div
                  key={t.period}
                  className="flex-1"
                  title={`${t.period}: ${t.average ?? 0} (${t.count})`}
                >
                  <div
                    className="w-full rounded-t bg-amber-400"
                    style={{ height: `${((t.average ?? 0) / 5) * 96}px` }}
                  />
                </div>
              ))
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Monthly average, last {trend.length} month
            {trend.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* D6.3 — Google Reputation connection. */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Google Reputation</h3>
            {google?.state === "connected" ? (
              <p className="mt-1 text-sm text-emerald-600">
                Connected
                {google.locationTitle ? ` · ${google.locationTitle}` : ""}
                {google.connectedAt
                  ? ` · since ${format(new Date(google.connectedAt), "dd MMM yyyy")}`
                  : ""}
              </p>
            ) : google?.state === "not_connected" ? (
              <p className="mt-1 text-sm text-amber-600">
                Not connected — authorise Google and pick this venue&apos;s
                location to read and reply to Google reviews here.
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Not configured — this deployment has no Google OAuth
                credentials, so Google reviews cannot be read or replied to.
                Guests can still be sent to your review page below.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => void connectGoogle()}
              disabled={google?.state === "not_configured"}
            >
              {google?.state === "connected" ? "Reconnect" : "Connect"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void syncGoogle()}
              disabled={google?.state !== "connected"}
            >
              Sync reviews
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="text-muted-foreground">Google Place ID</span>
            <input
              value={placeId}
              onChange={(e) => setPlaceId(e.target.value)}
              onBlur={() => void saveSettings({ googlePlaceId: placeId })}
              placeholder="ChIJ…"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Used to build your review link. Without it, guests are never sent
              to Google.
            </span>
          </label>
          <div className="text-sm">
            <span className="text-muted-foreground">Guest review link</span>
            {google?.reviewUrl ? (
              <a
                href={google.reviewUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs underline"
              >
                {google.reviewUrl}
              </a>
            ) : (
              <p className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                Add a Place ID to generate the link.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* D6.2 / D6.8 — where a rating goes. */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">After a guest rates</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Ratings at or above your threshold are sent to your Google review
          page. Anything below is kept private and raises a staff alert so you
          can fix it before it becomes public.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="text-sm">
            <span className="text-muted-foreground">Send to Google from</span>
            <select
              value={settings?.publicRedirectMinRating ?? 4}
              onChange={(e) =>
                void saveSettings({
                  publicRedirectMinRating: Number(e.target.value),
                })
              }
              className="ml-2 rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} star{n === 1 ? "" : "s"} and up
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.publicRedirectEnabled ?? true}
              onChange={(e) =>
                void saveSettings({ publicRedirectEnabled: e.target.checked })
              }
            />
            Redirect happy guests to Google
          </label>
        </div>
      </div>

      {/* D6.9 — per-server attribution. */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Ratings by server</h3>
        {analytics?.staff.length ? (
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Server</th>
                <th className="py-2">Reviews</th>
                <th className="py-2">Average</th>
                <th className="py-2">5★</th>
                <th className="py-2">Below threshold</th>
              </tr>
            </thead>
            <tbody>
              {analytics.staff.map((s) => (
                <tr key={s.staffId} className="border-t border-border">
                  <td className="py-2">{s.name ?? s.staffId.slice(0, 8)}</td>
                  <td className="py-2 font-mono">{s.count}</td>
                  <td className="py-2 font-mono">{s.average?.toFixed(2)}</td>
                  <td className="py-2 font-mono">{s.fiveStar}</td>
                  <td className="py-2 font-mono">{s.negative}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No attributed reviews yet. Ratings taken on a staff-served payment
            carry the server automatically.
          </p>
        )}
      </div>

      {/* D6.6 — reply templates. */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Reply templates</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Use <code>@customer_name@</code> and <code>@venue_name@</code> to
          personalise a reply automatically.
        </p>
        <div className="mt-4 space-y-2">
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex items-start justify-between gap-4 rounded-xl border border-border p-3"
            >
              <div>
                <p className="text-sm font-medium">{t.title}</p>
                <p className="text-xs text-muted-foreground">{t.body}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => void deleteTemplate(t.id)}
              >
                Delete
              </Button>
            </div>
          ))}
          {builtin.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-dashed border-border p-3"
            >
              <p className="text-sm font-medium">
                {t.title}{" "}
                <span className="text-xs text-muted-foreground">
                  (built-in)
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{t.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-[240px_1fr_auto]">
          <input
            value={newTemplate.title}
            onChange={(e) =>
              setNewTemplate((t) => ({ ...t, title: e.target.value }))
            }
            placeholder="Template title"
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          />
          <input
            value={newTemplate.body}
            onChange={(e) =>
              setNewTemplate((t) => ({ ...t, body: e.target.value }))
            }
            placeholder="Thanks @customer_name@! — @venue_name@"
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          />
          <Button onClick={() => void createTemplate()}>Add</Button>
        </div>
      </div>

      {/* D6.5 — the review list + reply. */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Reviews</h3>
          <div className="flex gap-2">
            <select
              value={ratingFilter}
              onChange={(e) =>
                setRatingFilter(
                  e.target.value === "all" ? "all" : Number(e.target.value),
                )
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="all">All ratings</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} star{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
            <select
              value={answered}
              onChange={(e) =>
                setAnswered(e.target.value as "all" | "yes" | "no")
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="all">Answered &amp; unanswered</option>
              <option value="no">Without answer</option>
              <option value="yes">Answered</option>
            </select>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reviews match this filter.
            </p>
          ) : null}
          {filtered.map((review) => (
            <div
              key={review.id}
              className="rounded-2xl border border-border p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <Stars value={review.rating} />
                  <p className="mt-2 max-w-3xl text-sm text-slate-700">
                    {review.comment ?? "(no comment)"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {review.customer_name ?? "Guest"} ·{" "}
                    {review.source === "google" ? "Google" : "PesaSwap"} ·{" "}
                    {format(new Date(review.created_at), "dd MMM yyyy")}
                  </p>
                  {review.response ? (
                    <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm">
                      Response: {review.response}
                    </p>
                  ) : null}
                </div>
                <div className="flex w-full max-w-sm flex-col gap-2">
                  <Button onClick={() => void reply(review.id)}>
                    ✨ AI reply
                  </Button>
                  <select
                    value={chosen[review.id] ?? ""}
                    onChange={(e) =>
                      setChosen((c) => ({ ...c, [review.id]: e.target.value }))
                    }
                    className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Reply template…</option>
                    {[...templates, ...builtin].map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    disabled={!chosen[review.id]}
                    onClick={() => void reply(review.id, chosen[review.id])}
                  >
                    Apply template
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
