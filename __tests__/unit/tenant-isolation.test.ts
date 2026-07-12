import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Defense-in-depth tenant-isolation guard. Reading the active venue straight
// from `?venue=` bypasses token pinning (venueFromPayload), so it is only ever
// safe on PUBLIC routes where the venue is a routing key, not an isolation
// boundary. This test freezes the set of files allowed to do that: any NEW file
// that reads the raw param must be consciously reviewed and added here (or, for
// an authenticated handler, switched to venueFromPayload). This is the "lighter
// guard/audit" that catches a forgotten WHERE venue = $1 before it ships.
const PUBLIC_RAW_VENUE_ALLOWLIST = new Set([
  "agentcommerce.ts", // public A2A catalogue discovery
  "branding.ts", // public pay/booking page branding (auth branch uses venueFromPayload)
  "manifest.ts", // public per-venue PWA manifest
  "multistore.ts", // cross-store team mgmt, gated by user_venues membership
  "omni.ts", // public web-chat widget (/api/chat/messages by opaque session)
  "portal.ts", // token-addressed customer portal
  "promo.ts", // public promo-code validation
  "push.ts", // public web-push subscribe / VAPID key
]);

describe("tenant isolation: raw ?venue= usage is confined to public routes", () => {
  it("no new file reads ?venue= without token pinning", () => {
    const apiDir = join(process.cwd(), "src", "api");
    const offenders: string[] = [];
    for (const file of readdirSync(apiDir)) {
      if (!file.endsWith(".ts")) continue;
      const src = readFileSync(join(apiDir, file), "utf8");
      if (/searchParams\.get\(["']venue["']\)/.test(src)) {
        if (!PUBLIC_RAW_VENUE_ALLOWLIST.has(file)) offenders.push(file);
      }
    }
    expect(
      offenders,
      `These files read ?venue= directly. Authenticated handlers must resolve the ` +
        `venue via venueFromPayload(payload, url) so a token cannot be pointed at ` +
        `another tenant. If a route is genuinely public, add it to the allowlist.`,
    ).toEqual([]);
  });
});
