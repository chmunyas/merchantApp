import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  sandboxAutoLoginAllowed,
  sandboxAutoLoginEmail,
  validateRuntimeSecurity,
} from "../../src/lib/runtime-security";

// A password-less session for a fixed account is a real risk if it ever reaches
// production, so it has to be impossible to enable there by accident.

const ON = { SANDBOX_AUTO_LOGIN: "1", SANDBOX_AUTO_LOGIN_EMAIL: "merchant@demo.com" };

describe("sandbox auto-login cannot escape the sandbox", () => {
  it("is off unless explicitly enabled", () => {
    expect(sandboxAutoLoginAllowed({ APP_ENV: "sandbox" })).toBe(false);
  });

  it("works in sandbox and development", () => {
    expect(sandboxAutoLoginAllowed({ APP_ENV: "sandbox", ...ON })).toBe(true);
    expect(sandboxAutoLoginAllowed({ APP_ENV: "development", ...ON })).toBe(true);
  });

  it("is refused in production even when the flag is set", () => {
    expect(sandboxAutoLoginAllowed({ APP_ENV: "production", ...ON })).toBe(false);
  });

  it("is refused on an unknown deployed profile, which resolves to production", () => {
    // runtimeMode() treats a Hyperdrive binding as deployed and fails toward
    // production, so a mis-set APP_ENV does not open the door.
    expect(sandboxAutoLoginAllowed({ HYPERDRIVE: {}, ...ON })).toBe(false);
  });

  it("fails production startup if the flag is left on", () => {
    const result = validateRuntimeSecurity({
      APP_ENV: "production",
      AUTH_REQUIRE_LOGIN: "1",
      JWT_SECRET: "s",
      PESASWAP_API_KEY: "k",
      ...ON,
    });
    expect(result.errors).toContain("SANDBOX_AUTO_LOGIN must be 0 in production");
  });

  it("needs a real email, not just the flag", () => {
    expect(sandboxAutoLoginEmail({ APP_ENV: "sandbox", SANDBOX_AUTO_LOGIN: "1" })).toBeNull();
    expect(
      sandboxAutoLoginEmail({ APP_ENV: "sandbox", SANDBOX_AUTO_LOGIN: "1", SANDBOX_AUTO_LOGIN_EMAIL: "nope" }),
    ).toBeNull();
    expect(sandboxAutoLoginEmail({ APP_ENV: "sandbox", ...ON })).toBe("merchant@demo.com");
  });

  it("returns no email in production regardless of configuration", () => {
    expect(sandboxAutoLoginEmail({ APP_ENV: "production", ...ON })).toBeNull();
  });
});

const authSource = readFileSync("src/api/auth.ts", "utf8");
const policySource = readFileSync("src/lib/route-policy.ts", "utf8");
const wrangler = readFileSync("wrangler.toml", "utf8");

describe("the endpoint cannot be used to escalate", () => {
  it("refuses to mint a session for the admin", () => {
    expect(authSource).toMatch(/sandbox auto-login cannot target the admin/);
    expect(authSource).toMatch(/if \(String\(user\.role\) === "admin"\)/);
  });

  it("derives claims from the stored account, not from the request", () => {
    // No role/venue is read off the body — the account decides what it gets.
    expect(authSource).toMatch(
      /sandbox-session[\s\S]{0,2200}authoritativeVenueClaims\(sql, \{/,
    );
  });

  it("404s rather than hinting the feature exists", () => {
    expect(authSource).toMatch(/const email = sandboxAutoLoginEmail\(env\);\s*\n\s*if \(!email\) return json\(\{ error: "not available" \}, 404\);/);
  });

  it("is registered in the default-deny route policy", () => {
    expect(policySource).toMatch(/auth\.sandbox-session[\s\S]{0,120}\/api\/auth\/sandbox-session/);
  });

  it("stays off in the production vars block", () => {
    expect(wrangler).toMatch(/ALLOW_SIMULATORS = "0"\s*[\r\n]+SANDBOX_AUTO_LOGIN = "0"/);
  });
});
