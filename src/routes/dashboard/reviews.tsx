import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { ArrowUpRight, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth";
import {
  ensureMerchantDemoData,
  loadMerchantSnapshot,
  saveMerchantReviews,
  type MerchantReview,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";

export const Route = createFileRoute("/dashboard/reviews")({
  component: DashboardReviewsPage,
});

const templates = ["Thank you!", "Sorry to hear...", "We'll improve..."];

function generateDemoData() {
  return ensureMerchantDemoData();
}

function DashboardReviewsPage() {
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);
  const [ratingFilter, setRatingFilter] = useState<number | "all">("all");
  const [selectedTemplate, setSelectedTemplate] = useState<
    Record<string, string>
  >({});
  const [liveReviews, setLiveReviews] = useState<
    Array<{
      id: string;
      rating: 1 | 2 | 3 | 4 | 5;
      comment: string | null;
      customer_name: string | null;
      created_at: string;
      response: string | null;
    }>
  >([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch("/api/reviews");
        if (res.ok) {
          const data = (await res.json()) as { reviews?: typeof liveReviews };
          setLiveReviews(data.reviews ?? []);
        }
      } catch {
        /* live reviews are additive to the demo view */
      }
    })();
  }, []);

  async function aiReply(id: string) {
    try {
      const res = await authFetch(`/api/reviews/${id}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { response: string };
      setLiveReviews((cur) =>
        cur.map((r) => (r.id === id ? { ...r, response: data.response } : r)),
      );
      toast.success("AI reply posted");
    } catch {
      toast.error("Couldn't generate a reply");
    }
  }

  useEffect(() => {
    generateDemoData();
    setSnapshot(loadMerchantSnapshot());
  }, []);

  const reviews = useMemo(() => {
    if (!snapshot) return [];
    const live = liveReviews.map((r) => ({
      id: r.id,
      paymentId: "",
      rating: r.rating,
      comment: r.comment ?? "",
      customerName: r.customer_name ?? "Guest",
      tableNumber: 0,
      server: "",
      date: r.created_at,
      response: r.response ?? undefined,
      real: true,
    }));
    const demo = snapshot.reviews.map((r) => ({ ...r, real: false }));
    return [...live, ...demo].filter(
      (review) => ratingFilter === "all" || review.rating === ratingFilter,
    );
  }, [snapshot, liveReviews, ratingFilter]);

  const stats = useMemo(() => {
    if (!snapshot || !snapshot.reviews.length) return null;
    const average =
      snapshot.reviews.reduce((sum, review) => sum + review.rating, 0) /
      snapshot.reviews.length;
    const recentAverage =
      snapshot.reviews
        .slice(0, Math.ceil(snapshot.reviews.length / 2))
        .reduce((sum, review) => sum + review.rating, 0) /
      Math.ceil(snapshot.reviews.length / 2);
    const olderAverage =
      snapshot.reviews
        .slice(Math.ceil(snapshot.reviews.length / 2))
        .reduce((sum, review) => sum + review.rating, 0) /
      Math.max(1, Math.floor(snapshot.reviews.length / 2));
    const distribution = [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      count: snapshot.reviews.filter((review) => review.rating === rating)
        .length,
    }));
    return { average, delta: recentAverage - olderAverage, distribution };
  }, [snapshot]);

  function applyTemplate(review: MerchantReview) {
    if (!snapshot) return;
    const response = selectedTemplate[review.id];
    if (!response) return;
    const message =
      response === "Thank you!"
        ? "Thank you for the lovely feedback. We are glad the PesaSwap experience felt effortless."
        : response === "Sorry to hear..."
          ? "Sorry to hear this missed the mark. We have shared the feedback with the service team immediately."
          : "Thank you for the feedback. We are already tightening service steps and menu timing.";

    const nextReviews = snapshot.reviews.map((item) =>
      item.id === review.id ? { ...item, response: message } : item,
    );
    saveMerchantReviews(nextReviews);
    setSnapshot({ ...snapshot, reviews: nextReviews });
    toast.success("Response saved");
  }

  if (!snapshot || !stats) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        Loading reviews…
      </div>
    );
  }

  const googleReviewLink = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(`${snapshot.settings.businessProfile.name}-${snapshot.settings.businessProfile.tillNumber}`)}`;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Average rating</p>
          <div className="mt-4 flex items-end gap-3">
            <p className="font-mono text-5xl font-semibold">
              {stats.average.toFixed(1)}
            </p>
            <div
              className={`mb-2 flex items-center gap-1 text-sm ${stats.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}
            >
              <ArrowUpRight
                className={`h-4 w-4 ${stats.delta < 0 ? "rotate-90" : ""}`}
              />{" "}
              {Math.abs(stats.delta).toFixed(1)} vs prior period
            </div>
          </div>
          <div className="mt-3 flex gap-1 text-amber-400">
            {Array.from({ length: 5 }).map((_, index) => (
              <Star
                key={index}
                className={`h-5 w-5 ${index < Math.round(stats.average) ? "fill-current" : "text-slate-300"}`}
              />
            ))}
          </div>
          <a
            href={googleReviewLink}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Open Google review link
          </a>
          <p className="mt-3 text-sm text-muted-foreground">
            {snapshot.reviews.length} review signals generated from successful
            payment events.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Rating distribution</h3>
            <select
              value={ratingFilter}
              onChange={(event) =>
                setRatingFilter(
                  event.target.value === "all"
                    ? "all"
                    : Number(event.target.value),
                )
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="all">All ratings</option>
              <option value="5">5 stars</option>
              <option value="4">4 stars</option>
              <option value="3">3 stars</option>
              <option value="2">2 stars</option>
              <option value="1">1 star</option>
            </select>
          </div>
          <div className="space-y-4">
            {stats.distribution.map((entry) => (
              <div key={entry.rating}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>{entry.rating} stars</span>
                  <span>{entry.count}</span>
                </div>
                <div className="h-3 rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-amber-400"
                    style={{
                      width: `${(entry.count / snapshot.reviews.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {reviews.map((review) => (
          <div
            key={review.id}
            className="rounded-2xl border border-border bg-card p-6"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-1 text-amber-400">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star
                      key={index}
                      className={`h-4 w-4 ${index < review.rating ? "fill-current" : "text-slate-300"}`}
                    />
                  ))}
                </div>
                <p className="mt-3 max-w-3xl text-sm text-slate-700">
                  {review.comment}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {review.customerName} · Table {review.tableNumber} ·{" "}
                  {format(new Date(review.date), "dd MMM yyyy")}
                </p>
                {review.response ? (
                  <p className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm">
                    Response: {review.response}
                  </p>
                ) : null}
              </div>
              <div className="flex w-full max-w-sm flex-col gap-2">
                {review.real ? (
                  <Button onClick={() => aiReply(review.id)}>
                    ✨ AI reply
                  </Button>
                ) : null}
                <select
                  value={selectedTemplate[review.id] || ""}
                  onChange={(event) =>
                    setSelectedTemplate((current) => ({
                      ...current,
                      [review.id]: event.target.value,
                    }))
                  }
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Response template</option>
                  {templates.map((template) => (
                    <option key={template} value={template}>
                      {template}
                    </option>
                  ))}
                </select>
                <Button variant="outline" onClick={() => applyTemplate(review)}>
                  Apply response
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
