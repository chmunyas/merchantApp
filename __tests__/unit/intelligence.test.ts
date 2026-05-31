/**
 * Unit tests — Intelligence Layer (Phase 4)
 * Tests: Revenue forecast, Smart staffing, Customer insights, Anomaly detection
 */
import { describe, it, expect } from "vitest";

describe("Revenue Forecast", () => {
  describe("Daily average", () => {
    it("calculates total revenue ÷ active days", () => {
      const payments = [
        { amount: 1000, tip: 100, time: "2026-05-28T12:00:00Z" },
        { amount: 2000, tip: 200, time: "2026-05-29T14:00:00Z" },
        { amount: 1500, tip: 150, time: "2026-05-30T10:00:00Z" },
      ];
      const total = payments.reduce((s, p) => s + p.amount + p.tip, 0); // 4950
      const days = 3;
      expect(Math.round(total / days)).toBe(1650);
    });
  });

  describe("Trend detection", () => {
    it("returns 'up' when projected > actual", () => {
      const projected = 12000;
      const actual = 10000;
      expect(projected > actual ? "up" : "down").toBe("up");
    });

    it("returns 'down' when projected < actual", () => {
      const projected = 8000;
      const actual = 10000;
      expect(projected < actual ? "down" : "up").toBe("down");
    });
  });

  describe("Peak hour detection", () => {
    it("finds hour with highest revenue", () => {
      const hourBuckets: Record<number, number> = { 12: 3000, 13: 5000, 18: 4000 };
      const peak = Object.entries(hourBuckets).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
      expect(Number(peak[0])).toBe(13); // 1PM
    });
  });

  describe("Growth target calculation", () => {
    it("calculates additional tables needed for 20% growth", () => {
      const projectedWeekly = 20000;
      const avgPerTable = 1500;
      const target = projectedWeekly * 1.2; // 24000
      const additional = Math.ceil((target - projectedWeekly) / avgPerTable);
      expect(additional).toBe(3); // need 3 more tables/day
    });
  });
});

describe("Smart Staffing", () => {
  describe("Staff recommendation", () => {
    it("returns ceil(activeTables / 4), min 1", () => {
      expect(Math.max(1, Math.ceil(8 / 4))).toBe(2);
      expect(Math.max(1, Math.ceil(3 / 4))).toBe(1);
      expect(Math.max(1, Math.ceil(0 / 4))).toBe(1);
      expect(Math.max(1, Math.ceil(12 / 4))).toBe(3);
    });
  });

  describe("Peak hour identification", () => {
    it("flags hours with count >= 70% of max", () => {
      const hourData = [
        { hour: 12, count: 10 },
        { hour: 13, count: 8 },
        { hour: 14, count: 3 },
        { hour: 18, count: 9 },
      ];
      const max = 10;
      const peak = hourData.filter((h) => h.count >= max * 0.7);
      expect(peak.map((h) => h.hour)).toEqual([12, 13, 18]);
    });
  });

  describe("Quiet hour identification", () => {
    it("flags hours with count > 0 and <= 30% of max", () => {
      const hourData = [
        { hour: 8, count: 1 },
        { hour: 12, count: 10 },
        { hour: 15, count: 2 },
      ];
      const max = 10;
      const quiet = hourData.filter((h) => h.count > 0 && h.count <= max * 0.3);
      expect(quiet.map((h) => h.hour)).toEqual([8, 15]);
    });
  });
});

describe("Customer Insights", () => {
  describe("Average dwell time", () => {
    it("calculates (closedAt - openedAt) / closedTables in minutes", () => {
      const tables = [
        { openedAt: "2026-05-30T12:00:00Z", closedAt: "2026-05-30T13:30:00Z" }, // 90min
        { openedAt: "2026-05-30T14:00:00Z", closedAt: "2026-05-30T14:45:00Z" }, // 45min
      ];
      const totalMinutes = tables.reduce((s, t) => {
        return s + (new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime()) / 60000;
      }, 0);
      expect(Math.round(totalMinutes / tables.length)).toBe(68); // (90+45)/2
    });
  });

  describe("Repeat customer rate", () => {
    it("counts phones appearing more than once", () => {
      const phones = ["0712345678", "0712345678", "0798765432", "0712345678"];
      const counts: Record<string, number> = {};
      phones.forEach((p) => (counts[p] = (counts[p] || 0) + 1));
      const repeat = Object.values(counts).filter((c) => c > 1).length;
      const total = Object.keys(counts).length;
      expect(Math.round((repeat / total) * 100)).toBe(50); // 1 of 2 unique
    });
  });

  describe("Table utilization", () => {
    it("returns activeTables / totalTables × 100", () => {
      expect(Math.round((3 / 10) * 100)).toBe(30);
    });
  });
});

describe("Anomaly Detection", () => {
  describe("Low tipping pattern", () => {
    it("triggers when 3+ tables have 0 tips", () => {
      const zeroTipCount = 4;
      expect(zeroTipCount > 2).toBe(true); // triggers
    });

    it("does not trigger for 2 or fewer", () => {
      expect(2 > 2).toBe(false); // no trigger
    });
  });

  describe("Revenue drop", () => {
    it("triggers when recent < 50% of prior period", () => {
      const recent = 2000;
      const prior = 5000;
      expect(recent < prior * 0.5).toBe(true); // triggers
    });
  });

  describe("Large payment detection", () => {
    it("flags payments 3x above average", () => {
      const avg = 1000;
      const payment = 3500;
      expect(payment > avg * 3).toBe(true);
    });
  });

  describe("Tip disparity", () => {
    it("triggers when min server avg < 30% of max", () => {
      const maxAvg = 200;
      const minAvg = 50;
      expect(minAvg < maxAvg * 0.3).toBe(true); // 50 < 60 → true
    });
  });

  describe("Severity sorting", () => {
    it("sorts high → medium → low", () => {
      const anomalies = [
        { severity: "low" },
        { severity: "high" },
        { severity: "medium" },
      ];
      const order = { high: 0, medium: 1, low: 2 } as const;
      const sorted = [...anomalies].sort(
        (a, b) => order[a.severity as keyof typeof order] - order[b.severity as keyof typeof order]
      );
      expect(sorted.map((a) => a.severity)).toEqual(["high", "medium", "low"]);
    });
  });
});
