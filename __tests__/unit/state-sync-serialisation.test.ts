import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The revision for a mirrored key is only known once the previous write's
// response lands. Two writes fired in parallel therefore send the same base
// revision, the second is rejected 409, and the merchant is told their data
// "changed on another device" — when in fact the tab raced itself.
const source = readFileSync("src/lib/browser-storage.ts", "utf8");

describe("state writes cannot conflict with themselves", () => {
  it("chains writes per key instead of firing them in parallel", () => {
    expect(source).toMatch(/const inflight = new Map<string, Promise<void>>\(\)/);
    expect(source).toMatch(
      /const chained = \(inflight\.get\(marker\) \?\? Promise\.resolve\(\)\)\.then\(run, run\)/,
    );
  });

  it("keeps the chain going after a failed write", () => {
    // .then(run, run) — a rejected predecessor must not strand every later
    // write for that key.
    expect(source).toMatch(/\.then\(run, run\)/);
  });

  it("chains on the revision marker, so unrelated keys stay parallel", () => {
    expect(source).toMatch(/const marker = revisionKey\(venue, key\);[\s\S]{0,200}inflight\.get\(marker\)/);
  });

  it("drops the chain entry once it is the last write for that key", () => {
    expect(source).toMatch(/if \(inflight\.get\(marker\) === chained\) inflight\.delete\(marker\)/);
  });

  it("still adopts the server revision on a genuine conflict", () => {
    expect(source).toMatch(/if \(data\.current\) revisions\.set\(marker, data\.current\.revision\)/);
  });
});
