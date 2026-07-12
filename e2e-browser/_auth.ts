import type { Page } from "@playwright/test";

// Deterministically sign a browser test in as a REAL venue by pre-seeding the
// exact localStorage the app writes on a successful launch-token adoption
// (adoptLaunchToken -> setToken + applyTenant + writeUser). addInitScript runs
// BEFORE any app code, so the app boots already authenticated on the merchant's
// own venue — no adoptLaunchToken/demo-session race (which is timing-sensitive on
// a cold CI server).
export async function seedAuth(
  page: Page,
  opts: { token: string; venue: string; name: string },
): Promise<void> {
  const { token, venue, name } = opts;
  const code =
    venue.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "VEN";
  const user = {
    id: "e2e",
    name,
    email: "e2e@e2e.test",
    role: "merchant",
    merchantId: venue,
  };
  await page.addInitScript(
    ({ token, venue, name, code, user }) => {
      try {
        localStorage.setItem("pesaswap.auth.jwt", token);
        localStorage.setItem(
          "fxengine.merchant.currentVenue",
          JSON.stringify(venue),
        );
        localStorage.setItem(
          "fxengine.merchant.venues",
          JSON.stringify([
            { id: venue, name: name || "My Business", code, active: true },
          ]),
        );
        localStorage.setItem("pesaswap.auth.demo-user", JSON.stringify(user));
      } catch {
        /* storage unavailable — the test will surface it */
      }
    },
    { token, venue, name, code, user },
  );
}
