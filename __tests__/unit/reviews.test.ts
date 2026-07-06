import { describe, it, expect } from "vitest";

import {
  buildReplyPrompt,
  clampRating,
  isNegative,
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
});
