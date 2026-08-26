// C5.1 / C5.10 — which connector answers for a venue, and what to say when none
// does.
//
// The registry separates two questions the UI must never conflate:
//   * `POS_PROVIDERS` — what this POS could do (published capability profile).
//   * `connectorFor()` — whether we can actually talk to it today.
// A venue on Zelty is told "we know your POS, we have not built the connector",
// not shown an empty page.

import { simulatorsAllowed } from "@/lib/runtime-security";
import { toastConnector, toastCredentials } from "@/lib/pos/toast";
import { simulatorConnector } from "@/lib/pos/simulator";
import {
  POS_PROVIDERS,
  capabilityVerdict,
  type CapabilityVerdict,
  type PosCapability,
  type PosConnector,
  type PosProvider,
} from "@/lib/pos/types";

export function connectorFor(
  provider: PosProvider,
  env: unknown,
): PosConnector | null {
  if (provider === "simulator") {
    return simulatorsAllowed(env) ? simulatorConnector : null;
  }
  if (provider === "toast") return toastConnector;
  return null;
}

/** Secrets a connector needs, read at call time and never persisted. */
export function credentialsFor(
  provider: PosProvider,
  env: unknown,
): Record<string, string> | null {
  if (provider === "simulator") return simulatorsAllowed(env) ? {} : null;
  if (provider === "toast") return toastCredentials(env);
  return null;
}

export type ProviderStatus = {
  provider: PosProvider;
  label: string;
  via: string | null;
  /** A connector exists in this build. */
  implemented: boolean;
  /** The operator has supplied its secrets. */
  configured: boolean;
  capabilities: Record<PosCapability, CapabilityVerdict>;
};

function verdicts(
  provider: PosProvider,
  connector: PosConnector | null,
): Record<PosCapability, CapabilityVerdict> {
  const out = {} as Record<PosCapability, CapabilityVerdict>;
  for (const capability of POS_PROVIDERS[provider].capabilities) {
    out[capability] = capabilityVerdict(provider, connector, capability);
  }
  return out;
}

export function providerStatus(
  provider: PosProvider,
  env: unknown,
): ProviderStatus {
  const connector = connectorFor(provider, env);
  return {
    provider,
    label: POS_PROVIDERS[provider].label,
    via: POS_PROVIDERS[provider].via ?? null,
    implemented: connector !== null,
    configured: connector !== null && credentialsFor(provider, env) !== null,
    capabilities: verdicts(provider, connector),
  };
}

/** The in-product compatibility matrix (C5.10). */
export function compatibilityMatrix(env: unknown): ProviderStatus[] {
  return (Object.keys(POS_PROVIDERS) as PosProvider[])
    .filter((provider) => provider !== "simulator" || simulatorsAllowed(env))
    .map((provider) => providerStatus(provider, env));
}
