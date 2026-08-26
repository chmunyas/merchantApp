import { envVar } from "@/lib/env";

export type RuntimeMode = "development" | "sandbox" | "production";

export type RuntimeSecurityResult = {
  mode: RuntimeMode;
  errors: string[];
};

export function envFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off";
}

export function runtimeMode(env: unknown): RuntimeMode {
  const configured = envVar(env, "APP_ENV")?.trim().toLowerCase();
  if (configured === "production" || configured === "prod") return "production";
  if (configured === "sandbox" || configured === "test") return "sandbox";
  // A Hyperdrive binding indicates a deployed Worker. Unknown deployed profiles
  // fail toward production rather than silently enabling development behavior.
  if ((env as { HYPERDRIVE?: unknown } | null)?.HYPERDRIVE) return "production";
  return "development";
}

export function isProductionRuntime(env: unknown): boolean {
  return runtimeMode(env) === "production";
}

export function simulatorsAllowed(env: unknown): boolean {
  return !isProductionRuntime(env) && envFlag(envVar(env, "ALLOW_SIMULATORS"));
}

export function otpDebugAllowed(env: unknown): boolean {
  return !isProductionRuntime(env) && envFlag(envVar(env, "AUTH_OTP_DEBUG"));
}

// A password-less session for a fixed test account. Two independent gates: the
// runtime must not be production (which unknown deployed profiles resolve to),
// and the flag must be set explicitly.
export function sandboxAutoLoginAllowed(env: unknown): boolean {
  return (
    !isProductionRuntime(env) && envFlag(envVar(env, "SANDBOX_AUTO_LOGIN"))
  );
}

export function sandboxAutoLoginEmail(env: unknown): string | null {
  if (!sandboxAutoLoginAllowed(env)) return null;
  const email = envVar(env, "SANDBOX_AUTO_LOGIN_EMAIL")?.trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

export function validateRuntimeSecurity(env: unknown): RuntimeSecurityResult {
  const mode = runtimeMode(env);
  const errors: string[] = [];
  if (mode !== "production") return { mode, errors };

  if (!envFlag(envVar(env, "AUTH_REQUIRE_LOGIN"))) {
    errors.push("AUTH_REQUIRE_LOGIN must be 1 in production");
  }
  if (envFlag(envVar(env, "AUTH_OTP_DEBUG"))) {
    errors.push("AUTH_OTP_DEBUG must be 0 in production");
  }
  if (envFlag(envVar(env, "PAYMENTS_TEST_MODE"))) {
    errors.push("PAYMENTS_TEST_MODE must be 0 in production");
  }
  if (envFlag(envVar(env, "ALLOW_SIMULATORS"))) {
    errors.push("ALLOW_SIMULATORS must be 0 in production");
  }
  if (envFlag(envVar(env, "SANDBOX_AUTO_LOGIN"))) {
    errors.push("SANDBOX_AUTO_LOGIN must be 0 in production");
  }
  if (!envVar(env, "JWT_SECRET")) {
    errors.push("JWT_SECRET is required in production");
  }
  if (!envVar(env, "PESASWAP_API_KEY")) {
    errors.push("PESASWAP_API_KEY is required in production");
  }
  if (!envVar(env, "PESASWAP_WEBHOOK_SECRET")) {
    errors.push("PESASWAP_WEBHOOK_SECRET is required in production");
  }
  if (!envVar(env, "TURNSTILE_SECRET")) {
    errors.push("TURNSTILE_SECRET is required in production");
  }
  const cors = envVar(env, "CORS_ALLOWED_ORIGIN")?.trim();
  if (!cors || cors === "*") {
    errors.push("CORS_ALLOWED_ORIGIN must be a restricted origin in production");
  }

  const bridgeUrl = envVar(env, "WHATSAPP_BRIDGE_URL");
  if (bridgeUrl && !envVar(env, "WHATSAPP_BRIDGE_TOKEN")) {
    errors.push("WHATSAPP_BRIDGE_TOKEN is required when WHATSAPP_BRIDGE_URL is set");
  }
  if (bridgeUrl && !envVar(env, "WHATSAPP_BRIDGE_VENUE")) {
    errors.push("WHATSAPP_BRIDGE_VENUE is required when WHATSAPP_BRIDGE_URL is set");
  }

  return { mode, errors };
}

export function runtimeSecurityResponse(env: unknown): Response | null {
  const result = validateRuntimeSecurity(env);
  if (result.errors.length === 0) return null;
  console.error("[security] Refusing insecure production configuration", result.errors);
  return new Response(
    JSON.stringify({ error: "service unavailable: insecure production configuration" }),
    {
      status: 503,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}