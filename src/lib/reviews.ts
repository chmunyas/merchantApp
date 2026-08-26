// Reputation & guest-insights helpers. Pure functions (no DB/network) so the
// review maths + AI-reply prompt are unit-testable.

export type ReviewRow = {
  id: string;
  rating: number;
  food?: number | null;
  service?: number | null;
  ambience?: number | null;
  value?: number | null;
  comment?: string | null;
  response?: string | null;
  created_at?: string | Date;
  // Provenance + attribution (db/71). `source` is where the rating was captured
  // ('pay' | 'qr' | 'table' | 'app' | 'google'); 'google' means imported from
  // the connected Business Profile rather than earned through our payment flow.
  source?: string | null;
  staff_id?: string | null;
  google_review_id?: string | null;
};

const avg = (nums: number[]): number | null =>
  nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null;

function dimensionAverage(rows: ReviewRow[], key: keyof ReviewRow): number | null {
  const vals = rows
    .map((r) => Number(r[key]))
    .filter((n) => Number.isFinite(n) && n > 0);
  return avg(vals);
}

// Aggregate a set of reviews into the guest-insights summary the dashboard shows:
// overall average, 5→1 star distribution, the four dimension averages, response
// rate, and the count of unanswered low (<=2) ratings needing attention.
export function summarizeReviews(rows: ReviewRow[]) {
  const count = rows.length;
  const average = avg(rows.map((r) => Number(r.rating) || 0));
  const distribution = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: rows.filter((r) => Number(r.rating) === rating).length,
  }));
  const responded = rows.filter((r) => (r.response ?? "").trim().length > 0).length;
  const needsAttention = rows.filter(
    (r) => Number(r.rating) <= 2 && !(r.response ?? "").trim(),
  ).length;
  return {
    count,
    average: average == null ? null : Math.round(average * 100) / 100,
    distribution,
    dimensions: {
      food: dimensionAverage(rows, "food"),
      service: dimensionAverage(rows, "service"),
      ambience: dimensionAverage(rows, "ambience"),
      value: dimensionAverage(rows, "value"),
    },
    responseRate: count ? Math.round((responded / count) * 100) / 100 : null,
    needsAttention,
  };
}

export function isNegative(rating: number): boolean {
  return Number(rating) > 0 && Number(rating) <= 2;
}

// ---------------------------------------------------------------------------
// D6.2 / D6.8 — where a rating goes next.
//
// Sunday: "when a guest pays they're instantly prompted to leave a rating from
// 1 to 5 stars. DEPENDING ON YOUR SETUP they're redirected to your restaurant's
// Google page." We make "your setup" explicit: a venue-configured minimum
// rating. At or above it the guest is sent to the public Google review form; a
// rating below it is kept private and raises a staff alert for service recovery
// instead of being pushed onto a public profile.
// ---------------------------------------------------------------------------

export const DEFAULT_PUBLIC_REDIRECT_MIN_RATING = 4;

export type ReputationSettings = {
  publicRedirectEnabled: boolean;
  publicRedirectMinRating: number;
  googlePlaceId: string | null;
};

export const DEFAULT_REPUTATION_SETTINGS: ReputationSettings = {
  publicRedirectEnabled: true,
  publicRedirectMinRating: DEFAULT_PUBLIC_REDIRECT_MIN_RATING,
  googlePlaceId: null,
};

export type RatingRouteReason =
  | "public_redirect"
  | "below_threshold"
  | "redirect_disabled"
  | "google_not_configured";

export type RatingRoute = {
  // "google" = show the guest the public review form. "private" = keep the
  // feedback in-house and alert the team.
  destination: "google" | "private";
  reason: RatingRouteReason;
  googleUrl: string | null;
  // True whenever the team should be told about it (any privately-held rating
  // below the venue's public threshold).
  alertStaff: boolean;
};

// Google's public "write a review" form. This is the ONLY prefill Google
// supports on this URL: it opens the review composer for the given place with
// the star widget focused. The star value itself is NOT a documented query
// parameter — see the D6.2 note in the roadmap.
export function googleReviewUrl(placeId: string | null | undefined): string | null {
  const id = (placeId ?? "").trim();
  if (!id) return null;
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}`;
}

export function normalizeSettings(
  input: Partial<ReputationSettings> | null | undefined,
): ReputationSettings {
  const min = Math.round(Number(input?.publicRedirectMinRating));
  return {
    publicRedirectEnabled: input?.publicRedirectEnabled ?? true,
    publicRedirectMinRating:
      Number.isFinite(min) && min >= 1 && min <= 5
        ? min
        : DEFAULT_PUBLIC_REDIRECT_MIN_RATING,
    googlePlaceId: (input?.googlePlaceId ?? "").trim() || null,
  };
}

// Pure routing decision. Order matters: an explicitly disabled redirect and a
// venue with no Google place id can never leak a rating to a public profile,
// whatever the number of stars.
export function routeRating(
  rating: number,
  settings: Partial<ReputationSettings> | null | undefined,
): RatingRoute {
  const s = normalizeSettings(settings);
  const stars = clampRating(rating);
  const belowThreshold = stars == null || stars < s.publicRedirectMinRating;
  const priv = (reason: RatingRouteReason): RatingRoute => ({
    destination: "private",
    reason,
    googleUrl: null,
    alertStaff: belowThreshold,
  });

  if (belowThreshold) return priv("below_threshold");
  if (!s.publicRedirectEnabled) return priv("redirect_disabled");
  const url = googleReviewUrl(s.googlePlaceId);
  if (!url) return priv("google_not_configured");
  return {
    destination: "google",
    reason: "public_redirect",
    googleUrl: url,
    alertStaff: false,
  };
}

// ---------------------------------------------------------------------------
// D6.4 — review analytics.
// ---------------------------------------------------------------------------

export type TrendPoint = {
  period: string; // YYYY-MM
  count: number;
  average: number | null;
};

function monthKey(value: string | Date | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Average rating per calendar month, oldest first — Sunday's "evolution".
export function reviewTrend(rows: ReviewRow[], months = 12): TrendPoint[] {
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const key = monthKey(r.created_at);
    const stars = clampRating(r.rating);
    if (!key || stars == null) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(stars);
    else buckets.set(key, [stars]);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-Math.max(1, months))
    .map(([period, values]) => ({
      period,
      count: values.length,
      average: Math.round((avg(values) as number) * 100) / 100,
    }));
}

// Sunday's "share coming from sunday": of every review we hold for this venue,
// how many were captured by our own payment flow rather than imported from the
// Google profile. This is the number that proves the product is working.
export function originShare(rows: ReviewRow[]): {
  total: number;
  fromPayments: number;
  fromGoogle: number;
  share: number | null;
} {
  const total = rows.length;
  const fromGoogle = rows.filter((r) => r.source === "google").length;
  const fromPayments = total - fromGoogle;
  return {
    total,
    fromPayments,
    fromGoogle,
    share: total ? Math.round((fromPayments / total) * 1000) / 1000 : null,
  };
}

// D6.9 — per-server rating, review count and 5-star count. Feeds D4 staff
// performance. Reviews with no staff attribution are excluded rather than
// bucketed into a fake "unassigned" server.
export type StaffReviewStats = {
  staffId: string;
  count: number;
  average: number | null;
  fiveStar: number;
  negative: number;
};

export function staffAttribution(
  rows: ReviewRow[],
  minRating = DEFAULT_PUBLIC_REDIRECT_MIN_RATING,
): StaffReviewStats[] {
  const byStaff = new Map<string, number[]>();
  for (const r of rows) {
    const id = (r.staff_id ?? "").trim();
    const stars = clampRating(r.rating);
    if (!id || stars == null) continue;
    const bucket = byStaff.get(id);
    if (bucket) bucket.push(stars);
    else byStaff.set(id, [stars]);
  }
  return [...byStaff.entries()]
    .map(([staffId, values]) => ({
      staffId,
      count: values.length,
      average: Math.round((avg(values) as number) * 100) / 100,
      fiveStar: values.filter((v) => v === 5).length,
      negative: values.filter((v) => v < minRating).length,
    }))
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0) || b.count - a.count);
}

// ---------------------------------------------------------------------------
// D6.6 — reply templates.
// ---------------------------------------------------------------------------

// Sunday ships "a handful covering feedback linked to service, staff, and
// food". These are read-only starters offered alongside a venue's own saved
// templates; they are not written to the database.
export const DEFAULT_REPLY_TEMPLATES: ReadonlyArray<{
  id: string;
  title: string;
  body: string;
}> = [
  {
    id: "builtin:thanks",
    title: "Thank you",
    body: "Thank you so much @customer_name@ — it means a lot. We can't wait to welcome you back to @venue_name@!",
  },
  {
    id: "builtin:food",
    title: "Food praise",
    body: "Thanks @customer_name@! We'll pass this straight to the kitchen — they'll be delighted. See you soon at @venue_name@.",
  },
  {
    id: "builtin:service",
    title: "Service praise",
    body: "Thank you @customer_name@ — our team works hard to get service right, and hearing it lands is the best feedback there is. @venue_name@",
  },
  {
    id: "builtin:slow-service",
    title: "Slow service apology",
    body: "We're sorry @customer_name@ — the wait you had isn't the standard we set. We've shared this with the floor team and would love the chance to put it right. @venue_name@",
  },
  {
    id: "builtin:missing-item",
    title: "Missing or wrong dish",
    body: "Sorry @customer_name@ — getting your order wrong is on us. Please reach out so we can make it right on your next visit. @venue_name@",
  },
];

// Sunday's placeholder syntax: @customer_name@ and @venue_name@. Unknown
// placeholders are left untouched so a typo is visible rather than silently
// blanking part of a public reply.
export function applyTemplate(
  body: string,
  vars: { customerName?: string | null; venueName?: string | null },
): string {
  return body
    .replaceAll("@customer_name@", (vars.customerName ?? "").trim() || "there")
    .replaceAll("@venue_name@", (vars.venueName ?? "").trim() || "our team");
}

// Clamp a rating to the 1..5 range, or null if absent/invalid.
export function clampRating(value: unknown): number | null {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

// Build the chat prompt for an AI public reply to a review, tuned to be warm,
// short, and to recover gracefully on a negative rating.
export function buildReplyPrompt(
  venue: string,
  review: { rating: number; comment?: string | null },
  // Below this the reply is a recovery message. Defaults to the legacy 1-2★
  // definition so existing callers are unchanged; the API passes the venue's
  // own public-redirect threshold so tone and routing agree.
  negativeBelow?: number,
): { role: "system" | "user"; content: string }[] {
  const low =
    typeof negativeBelow === "number"
      ? Number(review.rating) < negativeBelow
      : isNegative(review.rating);
  const tone = low
    ? "The rating is LOW — sincerely apologise, take responsibility, and offer to make it right (invite them back)."
    : "The rating is positive — thank them warmly and invite them back.";
  return [
    {
      role: "system",
      content:
        "You are the owner of a hospitality venue writing a SHORT public reply to a customer review. " +
        "1-2 sentences, warm, human, professional, first person plural ('we'). No emojis unless natural, no hashtags. " +
        tone,
    },
    {
      role: "user",
      content: `Venue: ${venue}\nRating: ${review.rating}/5\nReview: "${(review.comment ?? "").slice(0, 500) || "(no comment)"}"\n\nWrite the reply:`,
    },
  ];
}
