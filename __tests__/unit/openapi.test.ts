import { describe, it, expect } from "vitest";
import { handleOpenApiRoute } from "../../src/api/openapi";

const req = (path: string, method = "GET") =>
  new Request(`https://x.dev${path}`, { method });

describe("openapi route", () => {
  it("serves a valid OpenAPI 3.1 spec", async () => {
    const res = handleOpenApiRoute(req("/api/openapi.json"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const spec = await res!.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toContain("PesaSwap");
    // Core integration endpoints are documented.
    expect(spec.paths["/payments/create"].post).toBeTruthy();
    expect(spec.paths["/invoices"].get).toBeTruthy();
    expect(spec.paths["/fees/summary"].get).toBeTruthy();
    // Outbound webhook catalogue is present.
    expect(spec.webhooks["payment.succeeded"]).toBeTruthy();
    // Servers pin the versioned alias.
    expect(spec.servers[0].url).toBe("/api/v1");
  });

  it("serves the Swagger UI docs page", () => {
    const res = handleOpenApiRoute(req("/api/docs"));
    expect(res!.status).toBe(200);
    expect(res!.headers.get("content-type")).toContain("text/html");
  });

  it("handles CORS preflight", () => {
    const res = handleOpenApiRoute(req("/api/openapi.json", "OPTIONS"));
    expect(res!.status).toBe(204);
  });

  it("returns null for unrelated paths", () => {
    expect(handleOpenApiRoute(req("/api/payments/create"))).toBeNull();
  });
});
