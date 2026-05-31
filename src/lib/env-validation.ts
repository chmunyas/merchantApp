/**
 * Environment validation — fails fast if required env vars are missing.
 * Call this on app startup to catch misconfigurations early.
 */

type EnvSchema = {
  key: string;
  required: boolean;
  clientSide: boolean; // VITE_ prefixed vars are exposed to client
  description: string;
};

const ENV_SCHEMA: EnvSchema[] = [
  {
    key: "VITE_PESASWAP_PUBLISHABLE_KEY",
    required: true,
    clientSide: true,
    description: "PesaSwap publishable key for client SDK (starts with pk_)",
  },
  {
    key: "VITE_BACKEND_URL",
    required: false,
    clientSide: true,
    description: "Backend API URL (empty = same origin)",
  },
  {
    key: "PESASWAP_API_KEY",
    required: true,
    clientSide: false,
    description: "PesaSwap server-side secret API key",
  },
  {
    key: "PESASWAP_URL",
    required: true,
    clientSide: false,
    description: "PesaSwap API endpoint URL",
  },
  {
    key: "PESASWAP_WEBHOOK_SECRET",
    required: false,
    clientSide: false,
    description: "Webhook signature verification secret",
  },
];

export function validateEnv(context: "client" | "server" = "client"): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const schema of ENV_SCHEMA) {
    // Skip server-only vars when validating client
    if (context === "client" && !schema.clientSide) continue;

    const value =
      context === "client"
        ? import.meta.env[schema.key]
        : process.env[schema.key];

    if (schema.required && !value) {
      errors.push(
        `Missing required env: ${schema.key} — ${schema.description}`,
      );
    } else if (!schema.required && !value) {
      warnings.push(
        `Optional env not set: ${schema.key} — ${schema.description}`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("[PesaSwap] Environment validation failed:");
    errors.forEach((e) => console.error(`  ✗ ${e}`));
  }

  if (warnings.length > 0 && context === "server") {
    warnings.forEach((w) => console.warn(`  ⚠ ${w}`));
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate and throw on missing required env vars.
 * Use in server entry to fail fast.
 */
export function requireEnv(context: "client" | "server" = "server"): void {
  const result = validateEnv(context);
  if (!result.valid) {
    throw new Error(
      `Environment validation failed:\n${result.errors.join("\n")}\n\nSee .env.example for required variables.`,
    );
  }
}
