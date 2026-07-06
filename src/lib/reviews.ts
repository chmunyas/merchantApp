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
): { role: "system" | "user"; content: string }[] {
  const tone = isNegative(review.rating)
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
