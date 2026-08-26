import { describe, it, expect } from "vitest";

import {
  applyTemplate,
  buildReplyPrompt,
  clampRating,
  googleReviewUrl,
  isNegative,
  normalizeSettings,
  originShare,
  reviewTrend,
  routeRating,
  staffAttribution,
  summarizeReviews,
} from "../../src/lib/reviews";

describe("summarizeReviews", () => {
  const rows = [
    { id: "1", rating: 5, food: 5, service: 4, ambience: 5, value: 4, response: "thanks" },
    { id: "2", rating: 2, food: 2, service: 1, comment: "slow", response: "" },
    { id: "3", rating: 4, food: 4, service: 5 },
  ];

  it("computes average, distribution, dimensions, response rate and needsAttention", () => {
    const s = summarizeReviews(rows);
    expect(s.count).toBe(3);
    expect(s.average).toBe(3.67); // (5+2+4)/3 rounded to 2dp
    expect(s.distribution.find((d) => d.rating === 5)?.count).toBe(1);
    expect(s.distribution.find((d) => d.rating === 2)?.count).toBe(1);
    expect(s.dimensions.food).toBeCloseTo((5 + 2 + 4) / 3, 4);
    expect(s.dimensions.ambience).toBe(5); // only one non-null ambience
    expect(s.responseRate).toBe(0.33); // 1 of 3 answered
    expect(s.needsAttention).toBe(1); // the 2-star with no response
  });

  it("handles an empty set", () => {
    const s = summarizeReviews([]);
    expect(s.count).toBe(0);
    expect(s.average).toBeNull();
    expect(s.responseRate).toBeNull();
    expect(s.needsAttention).toBe(0);
  });
});

describe("clampRating", () => {
  it("keeps 1..5 and rejects the rest", () => {
    expect(clampRating(3)).toBe(3);
    expect(clampRating("4")).toBe(4);
    expect(clampRating(0)).toBeNull();
    expect(clampRating(6)).toBeNull();
    expect(clampRating(undefined)).toBeNull();
  });
});

describe("isNegative", () => {
  it("flags 1-2 star ratings", () => {
    expect(isNegative(1)).toBe(true);
    expect(isNegative(2)).toBe(true);
    expect(isNegative(3)).toBe(false);
  });
});

describe("buildReplyPrompt", () => {
  it("apologises on a low rating and thanks on a high one", () => {
    expect(buildReplyPrompt("Cafe", { rating: 1, comment: "bad" })[0].content).toMatch(
      /apolog/i,
    );
    expect(buildReplyPrompt("Cafe", { rating: 5 })[0].content).toMatch(/thank/i);
  });

  it("follows the venue threshold when one is supplied", () => {
    // A 3★ is positive under the legacy rule but low for a venue that only
    // publishes 4★ and up.
    expect(buildReplyPrompt("Cafe", { rating: 3 })[0].content).toMatch(/thank/i);
    expect(buildReplyPrompt("Cafe", { rating: 3 }, 4)[0].content).toMatch(
      /apolog/i,
    );
  });
});

// ---------------------------------------------------------------------------
// D6.2 / D6.8 — rating routing. This is the judgement call the product makes on
// the venue's behalf, so the boundaries are pinned down explicitly.
// ---------------------------------------------------------------------------

const connected = {
  publicRedirectEnabled: true,
  publicRedirectMinRating: 4,
  googlePlaceId: "ChIJtest",
};

describe("googleReviewUrl", () => {
  it("builds Google's documented write-review form for a place id", () => {
    expect(googleReviewUrl("ChIJtest")).toBe(
      "https://search.google.com/local/writereview?placeid=ChIJtest",
    );
  });

  it("url-encodes the place id and refuses an empty one", () => {
    expect(googleReviewUrl("a b/c")).toBe(
      "https://search.google.com/local/writereview?placeid=a%20b%2Fc",
    );
    expect(googleReviewUrl("")).toBeNull();
    expect(googleReviewUrl("   ")).toBeNull();
    expect(googleReviewUrl(null)).toBeNull();
  });
});

describe("routeRating", () => {
  it("sends a rating at the threshold to Google, and one below it privately", () => {
    expect(routeRating(4, connected)).toMatchObject({
      destination: "google",
      reason: "public_redirect",
      alertStaff: false,
    });
    expect(routeRating(3, connected)).toMatchObject({
      destination: "private",
      reason: "below_threshold",
      googleUrl: null,
      alertStaff: true,
    });
  });

  it("respects a threshold the venue moved", () => {
    const strict = { ...connected, publicRedirectMinRating: 5 };
    expect(routeRating(4, strict).destination).toBe("private");
    expect(routeRating(5, strict).destination).toBe("google");

    const lenient = { ...connected, publicRedirectMinRating: 1 };
    expect(routeRating(1, lenient).destination).toBe("google");
    expect(routeRating(1, lenient).alertStaff).toBe(false);
  });

  it("never redirects when the venue has no place id", () => {
    const route = routeRating(5, { ...connected, googlePlaceId: null });
    expect(route).toMatchObject({
      destination: "private",
      reason: "google_not_configured",
      googleUrl: null,
      alertStaff: false,
    });
  });

  it("never redirects when the venue switched the redirect off", () => {
    const route = routeRating(5, {
      ...connected,
      publicRedirectEnabled: false,
    });
    expect(route.destination).toBe("private");
    expect(route.reason).toBe("redirect_disabled");
  });

  it("falls back to the safe defaults for an unconfigured venue", () => {
    // No settings row at all: nothing may be pushed to a public profile.
    expect(routeRating(5, null).destination).toBe("private");
    expect(routeRating(5, null).reason).toBe("google_not_configured");
    expect(routeRating(2, undefined)).toMatchObject({
      destination: "private",
      reason: "below_threshold",
      alertStaff: true,
    });
  });

  it("treats an invalid rating as private without alerting", () => {
    expect(routeRating(0, connected).destination).toBe("private");
    expect(routeRating(9, connected).destination).toBe("private");
  });
});

describe("normalizeSettings", () => {
  it("clamps a nonsense threshold back to the default", () => {
    expect(normalizeSettings({ publicRedirectMinRating: 0 }).publicRedirectMinRating).toBe(4);
    expect(normalizeSettings({ publicRedirectMinRating: 9 }).publicRedirectMinRating).toBe(4);
    expect(normalizeSettings(null).publicRedirectMinRating).toBe(4);
    expect(normalizeSettings({ publicRedirectMinRating: 2 }).publicRedirectMinRating).toBe(2);
  });

  it("treats a blank place id as absent", () => {
    expect(normalizeSettings({ googlePlaceId: "  " }).googlePlaceId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D6.4 / D6.9 — analytics maths.
// ---------------------------------------------------------------------------

describe("reviewTrend", () => {
  const rows = [
    { id: "a", rating: 5, created_at: "2026-01-10T10:00:00Z" },
    { id: "b", rating: 3, created_at: "2026-01-20T10:00:00Z" },
    { id: "c", rating: 4, created_at: "2026-02-02T10:00:00Z" },
  ];

  it("averages by calendar month, oldest first", () => {
    expect(reviewTrend(rows)).toEqual([
      { period: "2026-01", count: 2, average: 4 },
      { period: "2026-02", count: 1, average: 4 },
    ]);
  });

  it("keeps only the most recent N months and ignores undated rows", () => {
    expect(reviewTrend(rows, 1)).toEqual([
      { period: "2026-02", count: 1, average: 4 },
    ]);
    expect(reviewTrend([{ id: "x", rating: 5 }])).toEqual([]);
    expect(reviewTrend([])).toEqual([]);
  });
});

describe("originShare", () => {
  it("counts what our own payment flow produced versus imported Google rows", () => {
    const share = originShare([
      { id: "1", rating: 5, source: "pay" },
      { id: "2", rating: 4, source: "qr" },
      { id: "3", rating: 2, source: "google" },
      { id: "4", rating: 5, source: null },
    ]);
    expect(share).toEqual({
      total: 4,
      fromPayments: 3,
      fromGoogle: 1,
      share: 0.75,
    });
  });

  it("returns a null share rather than 0% when there is nothing to divide", () => {
    expect(originShare([])).toEqual({
      total: 0,
      fromPayments: 0,
      fromGoogle: 0,
      share: null,
    });
  });
});

describe("staffAttribution", () => {
  const rows = [
    { id: "1", rating: 5, staff_id: "s1" },
    { id: "2", rating: 5, staff_id: "s1" },
    { id: "3", rating: 3, staff_id: "s1" },
    { id: "4", rating: 4, staff_id: "s2" },
    { id: "5", rating: 5, staff_id: null },
    { id: "6", rating: 5 },
  ];

  it("reports count, average, 5-star count and sub-threshold count per server, best first", () => {
    const stats = staffAttribution(rows, 4);
    expect(stats).toEqual([
      { staffId: "s1", count: 3, average: 4.33, fiveStar: 2, negative: 1 },
      { staffId: "s2", count: 1, average: 4, fiveStar: 0, negative: 0 },
    ]);
  });

  it("excludes unattributed reviews rather than inventing a server", () => {
    expect(staffAttribution([{ id: "1", rating: 5 }])).toEqual([]);
  });
});

describe("applyTemplate", () => {
  it("substitutes Sunday's placeholders", () => {
    expect(
      applyTemplate("Thanks @customer_name@! — @venue_name@", {
        customerName: "Amina",
        venueName: "Java House",
      }),
    ).toBe("Thanks Amina! — Java House");
  });

  it("degrades to a neutral greeting when the guest is anonymous", () => {
    expect(
      applyTemplate("Hi @customer_name@ from @venue_name@", {
        customerName: "  ",
        venueName: null,
      }),
    ).toBe("Hi there from our team");
  });

  it("leaves an unknown placeholder visible instead of blanking it", () => {
    expect(applyTemplate("Hi @first_name@", { customerName: "A" })).toBe(
      "Hi @first_name@",
    );
  });
});
