import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  canUseCapability,
  capabilityForPath,
  normalizeTier,
  normalizeVertical,
  offerableCapabilities,
  resolveCapabilities,
  tierAtLeast,
  upgradeLockedCapabilities,
  type VenueProfile,
} from "../../src/lib/verticals";

const profile = (over: Partial<VenueProfile> = {}): VenueProfile => ({
  vertical: "restaurant",
  tier: "enterprise",
  ...over,
});

describe("vertical is a default", () => {
  it("gives a restaurant its kitchen display but not the retail counter", () => {
    const caps = resolveCapabilities(profile({ vertical: "restaurant" }));
    expect(caps.has("restaurant.kds")).toBe(true);
    expect(caps.has("retail.counter")).toBe(false);
    expect(caps.has("services.catalogue")).toBe(false);
  });

  it("gives a shop the counter but not the kitchen display or floorplan", () => {
    const caps = resolveCapabilities(profile({ vertical: "retail" }));
    expect(caps.has("retail.counter")).toBe(true);
    expect(caps.has("retail.inventory")).toBe(true);
    expect(caps.has("restaurant.kds")).toBe(false);
    expect(caps.has("restaurant.floorplan")).toBe(false);
  });

  it("gives a salon its service catalogue and bookings, not a counter", () => {
    const caps = resolveCapabilities(profile({ vertical: "services" }));
    expect(caps.has("services.catalogue")).toBe(true);
    expect(caps.has("services.bookings")).toBe(true);
    expect(caps.has("retail.counter")).toBe(false);
    expect(caps.has("restaurant.menu")).toBe(false);
  });

  it("keeps shared commerce available to every vertical", () => {
    for (const vertical of ["restaurant", "retail", "services", "hospitality"] as const) {
      const caps = resolveCapabilities(profile({ vertical }));
      expect(caps.has("core.payments")).toBe(true);
      expect(caps.has("core.contacts")).toBe(true);
      expect(caps.has("engage.reviews")).toBe(true);
    }
  });
});

describe("tier is a limit", () => {
  it("withholds growth features from a starter plan", () => {
    const caps = resolveCapabilities(profile({ tier: "starter" }));
    expect(caps.has("insights.analytics")).toBe(true);
    expect(caps.has("insights.copilot")).toBe(false);
    expect(caps.has("core.accounting")).toBe(false);
  });

  it("leaves a free plan only the free capabilities", () => {
    const caps = resolveCapabilities(profile({ tier: "free" }));
    expect(caps.has("core.payments")).toBe(true);
    expect(caps.has("core.qr")).toBe(true);
    expect(caps.has("insights.analytics")).toBe(false);
    expect(caps.has("engage.inbox")).toBe(false);
  });

  it("ranks tiers in commercial order", () => {
    expect(tierAtLeast("growth", "starter")).toBe(true);
    expect(tierAtLeast("starter", "growth")).toBe(false);
    expect(tierAtLeast("free", "free")).toBe(true);
  });
});

describe("overrides", () => {
  it("lets a café opt in to the retail counter despite its vertical", () => {
    const caps = resolveCapabilities(
      profile({ vertical: "restaurant", overrides: { "retail.counter": true } }),
    );
    expect(caps.has("retail.counter")).toBe(true);
  });

  it("lets a venue switch off something its vertical includes", () => {
    const caps = resolveCapabilities(
      profile({ vertical: "restaurant", overrides: { "restaurant.floorplan": false } }),
    );
    expect(caps.has("restaurant.floorplan")).toBe(false);
  });

  it("cannot buy an unentitled capability — the paywall is absolute", () => {
    expect(
      canUseCapability("insights.copilot", {
        vertical: "restaurant",
        tier: "starter",
        overrides: { "insights.copilot": true },
      }),
    ).toBe(false);
  });

  it("ignores an override for a capability that does not exist", () => {
    expect(
      canUseCapability("not.a.capability", profile({ overrides: { "not.a.capability": true } })),
    ).toBe(false);
  });
});

describe("path resolution", () => {
  it("maps a dashboard route to the capability that governs it", () => {
    expect(capabilityForPath("/dashboard/retail")?.key).toBe("retail.counter");
    expect(capabilityForPath("/dashboard/orders")?.key).toBe("restaurant.kds");
  });

  it("resolves a nested route to its parent capability", () => {
    expect(capabilityForPath("/dashboard/menu/item-42")?.key).toBe("restaurant.menu");
  });

  it("does not let the overview swallow every nested route", () => {
    expect(capabilityForPath("/dashboard")?.key).toBe("core.overview");
    expect(capabilityForPath("/dashboard/unknown-page")).toBeNull();
  });
});

describe("normalisation", () => {
  it("maps the legacy hospital label onto hospitality", () => {
    expect(normalizeVertical("hospital")).toBe("hospitality");
  });

  it("falls back safely on unknown input", () => {
    expect(normalizeVertical("casino")).toBe("restaurant");
    expect(normalizeVertical(undefined)).toBe("restaurant");
    expect(normalizeTier("platinum")).toBe("free");
  });
});

describe("commercial surfaces", () => {
  it("offers an owner everything their tier entitles them to", () => {
    const offerable = offerableCapabilities(profile({ tier: "starter" }));
    expect(offerable.every((c) => tierAtLeast("starter", c.minTier))).toBe(true);
    expect(offerable.some((c) => c.key === "insights.copilot")).toBe(false);
  });

  it("reports what an upgrade would unlock for this vertical only", () => {
    const locked = upgradeLockedCapabilities({ vertical: "retail", tier: "free" });
    const keys = locked.map((c) => c.key);
    expect(keys).toContain("retail.counter");
    expect(keys).not.toContain("restaurant.kds");
  });

  it("keeps every capability key unique", () => {
    const keys = CAPABILITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
