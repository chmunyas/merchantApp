// Read a config value from the Worker `env` binding (workerd) or process.env
// (Node dev). Returns undefined when absent so callers can degrade gracefully.
export function envVar(env: unknown, key: string): string | undefined {
  const e = env as Record<string, unknown> | undefined;
  if (e && typeof e[key] === "string") return e[key] as string;
  if (
    typeof process !== "undefined" &&
    typeof process.env?.[key] === "string"
  ) {
    return process.env[key];
  }
  return undefined;
}
