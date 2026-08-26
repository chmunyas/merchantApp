import { describe, expect, it } from "vitest";

import {
  applyTranslations,
  normalizeLanguageList,
  normalizeLanguageTag,
  planTranslation,
  translationSourceHash,
  type CachedTranslation,
} from "../../src/lib/menu-translation";

const entry = (id: string, name: string, description: string | null = null) => ({
  id,
  name,
  description,
});

describe("normalizeLanguageTag", () => {
  it("accepts a two-letter tag and a region subtag", () => {
    expect(normalizeLanguageTag("FR")).toBe("fr");
    expect(normalizeLanguageTag(" sw ")).toBe("sw");
    expect(normalizeLanguageTag("pt-BR")).toBe("pt-BR");
  });

  it("rejects anything else rather than guessing", () => {
    expect(normalizeLanguageTag("")).toBeNull();
    expect(normalizeLanguageTag("french")).toBeNull();
    expect(normalizeLanguageTag("f")).toBeNull();
    expect(normalizeLanguageTag(null)).toBeNull();
    expect(normalizeLanguageTag("../etc/passwd")).toBeNull();
  });

  it("de-duplicates and caps a configured language list", () => {
    expect(normalizeLanguageList(["fr", "FR", "sw", "bogus"])).toEqual(["fr", "sw"]);
    expect(normalizeLanguageList("not-an-array")).toEqual([]);
    expect(normalizeLanguageList(["a1", "b2", "c3"])).toEqual([]);
  });
});

describe("translationSourceHash", () => {
  it("is stable for identical source text", () => {
    expect(translationSourceHash(entry("1", "Pizza", "Cheesy"))).toBe(
      translationSourceHash(entry("1", "Pizza", "Cheesy")),
    );
  });

  it("changes when the name or the description changes", () => {
    const base = translationSourceHash(entry("1", "Pizza", "Cheesy"));
    expect(translationSourceHash(entry("1", "Pizzas", "Cheesy"))).not.toBe(base);
    expect(translationSourceHash(entry("1", "Pizza", "Very cheesy"))).not.toBe(base);
  });

  it("does not confuse a name/description boundary shift", () => {
    expect(translationSourceHash(entry("1", "ab", "c"))).not.toBe(
      translationSourceHash(entry("1", "a", "bc")),
    );
  });
});

describe("planTranslation", () => {
  const entries = [entry("1", "Pizza"), entry("2", "Coke")];

  it("treats an empty cache as entirely stale", () => {
    const plan = planTranslation(entries, []);
    expect(plan.fresh.size).toBe(0);
    expect(plan.stale.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("reuses a cached row whose source hash still matches", () => {
    const cached: CachedTranslation[] = [
      {
        entityId: "1",
        sourceHash: translationSourceHash(entries[0]),
        name: "Pizza",
        description: null,
      },
    ];
    const plan = planTranslation(entries, cached);
    expect(Array.from(plan.fresh.keys())).toEqual(["1"]);
    expect(plan.stale.map((e) => e.id)).toEqual(["2"]);
  });

  it("re-translates only the item the merchant edited", () => {
    const cached: CachedTranslation[] = entries.map((e) => ({
      entityId: e.id,
      sourceHash: translationSourceHash(e),
      name: `${e.name}-fr`,
      description: null,
    }));
    const edited = [entry("1", "Pizza Napoletana"), entries[1]];
    const plan = planTranslation(edited, cached);
    expect(plan.stale.map((e) => e.id)).toEqual(["1"]);
    expect(Array.from(plan.fresh.keys())).toEqual(["2"]);
  });

  it("does not trust a cached row with no translated name", () => {
    const cached: CachedTranslation[] = [
      {
        entityId: "1",
        sourceHash: translationSourceHash(entries[0]),
        name: null,
        description: null,
      },
    ];
    expect(planTranslation(entries, cached).stale.map((e) => e.id)).toEqual(["1", "2"]);
  });
});

describe("applyTranslations — graceful degradation", () => {
  const entries = [entry("1", "Pizza", "Cheesy"), entry("2", "Coke", "Cold")];

  it("returns the original menu when nothing is translated", () => {
    expect(applyTranslations(entries, new Map())).toEqual(entries);
  });

  it("overlays only the items it has, leaving the rest in the original language", () => {
    const out = applyTranslations(
      entries,
      new Map([["1", { name: "Pizza (fr)", description: "Fromage" }]]),
    );
    expect(out[0]).toEqual({ id: "1", name: "Pizza (fr)", description: "Fromage" });
    expect(out[1]).toEqual(entries[1]);
  });

  it("never blanks a name with an empty translation", () => {
    const out = applyTranslations(entries, new Map([["1", { name: "   ", description: "x" }]]));
    expect(out[0].name).toBe("Pizza");
  });

  it("keeps the original description when the translated one is empty", () => {
    const out = applyTranslations(
      entries,
      new Map([["1", { name: "Pizza (fr)", description: "" }]]),
    );
    expect(out[0].description).toBe("Cheesy");
  });
});
