import { describe, expect, it } from "vitest";

import { presentItem, toUpsellItems } from "../../src/lib/live-menu";
import type { MenuItem } from "../../src/lib/menu";

const base: MenuItem = {
  id: "item-1",
  name: "CHK BRGR 2X",
  category: "Mains",
  price: 950,
  currency: "KES",
  dietary: ["halal"],
  available: true,
  revision: 1,
  displayName: null,
  description: null,
  allergens: [],
  tags: [],
  imageUrl: null,
  imageAlt: null,
  videoUrl: null,
  videoDescription: null,
};

const item = (over: Partial<MenuItem>): MenuItem => ({ ...base, ...over });

describe("presentItem — the guest projection", () => {
  it("shows the merchant's override name and keeps the operational one", () => {
    const out = presentItem(item({ displayName: "Chicken burger" }));
    expect(out.name).toBe("Chicken burger");
    expect(out.operationalName).toBe("CHK BRGR 2X");
  });

  it("falls back to the operational name when no override is written", () => {
    expect(presentItem(base).name).toBe("CHK BRGR 2X");
  });

  it("treats a blank override as no override", () => {
    expect(presentItem(item({ displayName: "   " })).name).toBe("CHK BRGR 2X");
  });

  it("always carries both price units, and they agree", () => {
    const out = presentItem(item({ price: 12.5 }));
    expect(out.price).toBe(12.5);
    expect(out.priceMinor).toBe(1250);
  });

  it("rounds minor units rather than leaving a fraction of a cent", () => {
    expect(presentItem(item({ price: 0.005 })).priceMinor).toBe(1);
  });

  it("carries allergens and tags as words, not flags", () => {
    const out = presentItem(item({ allergens: ["peanuts"], tags: ["spicy"] }));
    expect(out.allergens).toEqual(["peanuts"]);
    expect(out.tags).toEqual(["spicy"]);
  });

  it("uses the merchant's alt text for an image", () => {
    const out = presentItem(
      item({ imageUrl: "https://cdn.test/a.jpg", imageAlt: "A stacked burger" }),
    );
    expect(out.imageAlt).toBe("A stacked burger");
  });

  it("substitutes a usable alt text when the merchant wrote none", () => {
    const out = presentItem(
      item({ imageUrl: "https://cdn.test/a.jpg", displayName: "Chicken burger" }),
    );
    expect(out.imageAlt).toBe("Chicken burger");
  });

  it("emits no alt text at all when there is no image to describe", () => {
    expect(presentItem(base).imageAlt).toBeNull();
    expect(presentItem(base).videoDescription).toBeNull();
  });

  it("describes a video against the guest-facing name", () => {
    const out = presentItem(
      item({
        imageUrl: "https://cdn.test/a.jpg",
        videoUrl: "https://cdn.test/a.mp4",
        displayName: "Chicken burger",
      }),
    );
    expect(out.videoDescription).toBe("Video of Chicken burger");
  });
});

describe("toUpsellItems", () => {
  it("offers the guest-facing name to the recommender, not the till name", () => {
    const [out] = toUpsellItems([item({ displayName: "Chicken burger" })]);
    expect(out.name).toBe("Chicken burger");
  });

  it("carries availability and photo through, which decide eligibility", () => {
    const [out] = toUpsellItems([
      item({ available: false, imageUrl: "https://cdn.test/a.jpg" }),
    ]);
    expect(out.available).toBe(false);
    expect(out.imageUrl).toBe("https://cdn.test/a.jpg");
  });
});
