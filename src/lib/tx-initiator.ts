// Agent Pay Gateway: classify a payment as human- or agent-initiated. Pure +
// unit-testable. Explicit metadata wins; otherwise the presence of an agent id
// or an A2A flow/channel marks it agent-initiated. Defaults to human.
export type Initiator = "human" | "agent";

export function resolveInitiator(
  meta: Record<string, unknown> | null | undefined,
): Initiator {
  if (!meta) return "human";
  const explicit =
    typeof meta.initiator === "string" ? meta.initiator.toLowerCase() : "";
  if (explicit === "agent" || explicit === "human") return explicit;
  if (meta.agent_id || meta.agentRef || meta.agent_ref) return "agent";
  const flow =
    typeof meta.flow_type === "string" ? meta.flow_type.toLowerCase() : "";
  const channel =
    typeof meta.channel === "string" ? meta.channel.toLowerCase() : "";
  if (flow === "a2a" || flow === "agent" || channel === "a2a") return "agent";
  return "human";
}
