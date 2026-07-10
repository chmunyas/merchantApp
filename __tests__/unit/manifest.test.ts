import { describe, it, expect } from "vitest";

import { handleManifestRoute } from "../../src/api/manifest";

describe("handleManifestRoute", () => {
  it("returns the default PesaSwap manifest when no venue/org is given", async () => {
    const res = await handleManifestRoute(
      new Request("https://app.example.com/api/manifest"),
      {},
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(res!.headers.get("content-type")).toContain("application/manifest+json");
    const m = (await res!.json()) as Record<string, unknown>;
    expect(m.name).toBe("PesaSwap Merchant");
    expect(m.start_url).toBe("/");
    expect(Array.isArray(m.icons)).toBe(true);
    expect((m.icons as unknown[]).length).toBeGreaterThan(0);
  });

  it("ignores non-manifest paths", async () => {
    expect(
      await handleManifestRoute(new Request("https://app.example.com/api/other"), {}),
    ).toBeNull();
  });

  it("ignores non-GET methods", async () => {
    expect(
      await handleManifestRoute(
        new Request("https://app.example.com/api/manifest", { method: "POST" }),
        {},
      ),
    ).toBeNull();
  });
});
