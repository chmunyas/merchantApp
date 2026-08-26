import { describe, expect, it } from "vitest";

import {
  MAX_CHECKOUT_UPSELLS,
  isUpsellEligible,
  selectCartUpsells,
  selectCheckoutUpsells,
  selectProductUpsells,
  type UpsellItem,
  type UpsellLink,
} from "../../src/lib/menu-upsell";
import { safeMediaUrl } from "../../src/lib/menu-media";

const PHOTO = "https://cdn.test/pic.jpg";

const item = (over: Partial<UpsellItem> & { id: string }): UpsellItem => ({
  name: over.id,
  category: "Mains",
  price: 100,
  available: true,
  imageUrl: PHOTO,
  ...over,
});

const MENU: UpsellItem[] = [
  item({ id: "pizza", name: "Margherita pizza", category: "Mains", price: 900 }),
  item({ id: "coke", name: "Coke", category: "Drinks", price: 200 }),
  item({ id: "beer", name: "Beer", category: "Drinks", price: 350 }),
  item({ id: "fries", name: "Fries", category: "Sides", price: 300 }),
  item({ id: "cake", name: "Chocolate cake", category: "Desserts", price: 400 }),
  item({ id: "nophoto", name: "Soup", category: "Starters", price: 250, imageUrl: null }),
  item({ id: "soldout", name: "Oysters", category: "Starters", price: 800, available: false }),
];

const link = (itemId: string, suggestedItemId: string, displayOrder = 0): UpsellLink => ({
  itemId,
  suggestedItemId,
  displayOrder,
});

describe("isUpsellEligible — Sunday's publishing rules", () => {
  it("requires a photo: 'products without photos won't appear'", () => {
    expect(isUpsellEligible(item({ id: "a" }))).toBe(true);
    expect(isUpsellEligible(item({ id: "a", imageUrl: null }))).toBe(false);
    expect(isUpsellEligible(item({ id: "a", imageUrl: "   " }))).toBe(false);
  });

  it("requires the product to be orderable", () => {
    expect(isUpsellEligible(item({ id: "a", available: false }))).toBe(false);
  });

  it("handles a missing item", () => {
    expect(isUpsellEligible(undefined)).toBe(false);
  });
});

describe("selectProductUpsells — manual, product-level pairings", () => {
  it("suggests the configured product when its trigger is in the cart", () => {
    const links = [link("pizza", "coke")];
    const recs = selectProductUpsells(links, MENU, [{ id: "pizza" }]);
    expect(recs.map((r) => r.item.id)).toEqual(["coke"]);
    expect(recs[0].configured).toBe(true);
    expect(recs[0].triggeredBy).toBe("pizza");
    expect(recs[0].reason).toContain("Margherita pizza");
  });

  it("suggests nothing when the trigger product is not in the cart", () => {
    const links = [link("pizza", "coke")];
    expect(selectProductUpsells(links, MENU, [{ id: "fries" }])).toEqual([]);
  });

  it("honours the merchant's display order", () => {
    const links = [link("pizza", "beer", 0), link("pizza", "coke", 1)];
    expect(
      selectProductUpsells(links, MENU, [{ id: "pizza" }]).map((r) => r.item.id),
    ).toEqual(["beer", "coke"]);
  });

  it("never suggests something already in the cart", () => {
    const links = [link("pizza", "coke"), link("pizza", "beer")];
    const recs = selectProductUpsells(links, MENU, [{ id: "pizza" }, { id: "coke" }]);
    expect(recs.map((r) => r.item.id)).toEqual(["beer"]);
  });

  it("de-duplicates a product suggested by two different cart lines", () => {
    const links = [link("pizza", "coke"), link("fries", "coke")];
    const recs = selectProductUpsells(links, MENU, [{ id: "pizza" }, { id: "fries" }]);
    expect(recs.map((r) => r.item.id)).toEqual(["coke"]);
  });

  it("drops a configured product that has no photo", () => {
    const links = [link("pizza", "nophoto"), link("pizza", "coke")];
    expect(
      selectProductUpsells(links, MENU, [{ id: "pizza" }]).map((r) => r.item.id),
    ).toEqual(["coke"]);
  });

  it("drops a configured product that is unavailable", () => {
    const links = [link("pizza", "soldout")];
    expect(selectProductUpsells(links, MENU, [{ id: "pizza" }])).toEqual([]);
  });

  it("drops a configured product that no longer exists on the menu", () => {
    const links = [link("pizza", "ghost")];
    expect(selectProductUpsells(links, MENU, [{ id: "pizza" }])).toEqual([]);
  });

  it("respects the maximum", () => {
    const links = [
      link("pizza", "coke", 0),
      link("pizza", "beer", 1),
      link("pizza", "fries", 2),
    ];
    expect(selectProductUpsells(links, MENU, [{ id: "pizza" }], 2)).toHaveLength(2);
  });

  it("ignores cart lines with no id", () => {
    const links = [link("pizza", "coke")];
    expect(selectProductUpsells(links, MENU, [{ name: "Margherita pizza" }])).toEqual([]);
  });
});

describe("selectCheckoutUpsells", () => {
  it("keeps the merchant's order and caps at five", () => {
    const ids = ["coke", "beer", "fries", "cake", "pizza", "coke"];
    const recs = selectCheckoutUpsells(ids, MENU, []);
    expect(recs).toHaveLength(MAX_CHECKOUT_UPSELLS);
    expect(recs.map((r) => r.item.id)).toEqual(["coke", "beer", "fries", "cake", "pizza"]);
  });

  it("skips products already in the cart", () => {
    expect(
      selectCheckoutUpsells(["coke", "beer"], MENU, [{ id: "coke" }]).map((r) => r.item.id),
    ).toEqual(["beer"]);
  });

  it("applies the same photo and availability rules", () => {
    expect(selectCheckoutUpsells(["nophoto", "soldout"], MENU, [])).toEqual([]);
  });
});

describe("selectCartUpsells — manual first, deterministic top-up", () => {
  it("puts the merchant's configured pairing ahead of the generic engine", () => {
    const links = [link("pizza", "beer")];
    const recs = selectCartUpsells(links, MENU, [{ id: "pizza", category: "Mains" }], {
      max: 3,
    });
    expect(recs[0].item.id).toBe("beer");
    expect(recs[0].configured).toBe(true);
    expect(recs.length).toBeGreaterThan(1);
    expect(recs.slice(1).every((r) => r.configured === false)).toBe(true);
  });

  it("never repeats a manually configured product in the top-up", () => {
    const links = [link("pizza", "cake")];
    const recs = selectCartUpsells(links, MENU, [{ id: "pizza", category: "Mains" }], {
      max: 3,
    });
    const ids = recs.map((r) => r.item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("still suggests something when the venue has configured nothing", () => {
    const recs = selectCartUpsells([], MENU, [{ id: "pizza", category: "Mains" }], {
      max: 2,
    });
    expect(recs).toHaveLength(2);
    expect(recs.every((r) => r.configured === false)).toBe(true);
  });

  it("excludes photo-less products from the visual surface", () => {
    const recs = selectCartUpsells([], MENU, [{ id: "pizza", category: "Mains" }], {
      max: 5,
      requirePhoto: true,
    });
    expect(recs.map((r) => r.item.id)).not.toContain("nophoto");
  });

  it("allows photo-less products for the text surface the agent uses", () => {
    const textOnly: UpsellItem[] = [item({ id: "soup", category: "Starters", imageUrl: null })];
    const recs = selectCartUpsells([], textOnly, [{ id: "pizza", category: "Mains" }], {
      max: 3,
      requirePhoto: false,
    });
    expect(recs.map((r) => r.item.id)).toEqual(["soup"]);
  });

  it("clamps the maximum to the supported range", () => {
    expect(selectCartUpsells([], MENU, [{ id: "pizza" }], { max: 99 }).length)
      .toBeLessThanOrEqual(5);
    expect(selectCartUpsells([], MENU, [{ id: "pizza" }], { max: 0 }).length)
      .toBeLessThanOrEqual(1);
  });
});

describe("safeMediaUrl — media is a validated URL, not an upload", () => {
  it("accepts absolute https media", () => {
    expect(safeMediaUrl("https://cdn.test/a.jpg", "image")).toBe("https://cdn.test/a.jpg");
    expect(safeMediaUrl("https://cdn.test/a.mp4", "video")).toBe("https://cdn.test/a.mp4");
  });

  it("accepts an extension-less image CDN URL", () => {
    expect(safeMediaUrl("https://cdn.test/img?id=7&w=800", "image")).toBeTruthy();
  });

  it("rejects anything that is not https", () => {
    expect(safeMediaUrl("http://cdn.test/a.jpg", "image")).toBeNull();
    expect(safeMediaUrl("javascript:alert(1)", "image")).toBeNull();
    expect(safeMediaUrl("data:image/png;base64,AAAA", "image")).toBeNull();
    expect(safeMediaUrl("//cdn.test/a.jpg", "image")).toBeNull();
    expect(safeMediaUrl("https://localhost/a.jpg", "image")).toBeNull();
  });

  it("rejects a video in the image slot and an image in the video slot", () => {
    expect(safeMediaUrl("https://cdn.test/a.mp4", "image")).toBeNull();
    expect(safeMediaUrl("https://cdn.test/a.jpg", "video")).toBeNull();
  });

  it("requires a known container for video", () => {
    expect(safeMediaUrl("https://cdn.test/stream?id=1", "video")).toBeNull();
  });

  it("rejects blank and oversized values", () => {
    expect(safeMediaUrl("", "image")).toBeNull();
    expect(safeMediaUrl(`https://cdn.test/${"a".repeat(3000)}.jpg`, "image")).toBeNull();
  });
});
