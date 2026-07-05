import { describe, it, expect } from "vitest";

import { parseBookingIntent } from "../../src/lib/agent";

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

describe("parseBookingIntent", () => {
  it("parses 'book 6 tonight at 7' as 6 covers, today, 19:00", () => {
    expect(parseBookingIntent("book 6 tonight at 7")).toEqual({
      covers: 6,
      date: today,
      time: "19:00",
    });
  });

  it("parses explicit pm time and tomorrow", () => {
    expect(parseBookingIntent("table for 4 tomorrow at 8pm")).toEqual({
      covers: 4,
      date: tomorrow,
      time: "20:00",
    });
  });

  it("keeps lunchtime am/pm minutes without a date", () => {
    expect(parseBookingIntent("reservation for 2 at 12:30pm")).toEqual({
      covers: 2,
      date: null,
      time: "12:30",
    });
  });

  it("extracts covers from 'party of 8' with no date/time", () => {
    expect(parseBookingIntent("party of 8")).toEqual({
      covers: 8,
      date: null,
      time: null,
    });
  });

  it("extracts covers from the 'N people' phrasing", () => {
    expect(parseBookingIntent("we are 5 people").covers).toBe(5);
  });

  it("returns all nulls for non-booking chatter", () => {
    expect(parseBookingIntent("hi, what are your opening hours?")).toEqual({
      covers: null,
      date: null,
      time: null,
    });
  });
});
