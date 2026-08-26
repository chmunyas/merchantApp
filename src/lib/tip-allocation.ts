export type TipAllocationRule = "direct" | "equal" | "by_hours" | "fixed";

export type WeightedTipParticipant = {
  staffId: string;
  weight: number;
};

/**
 * Split one payment's net tip between the server's direct share and the tip jar
 * (roadmap D5.7). The direct share is floored, so the sub-cent remainder always
 * falls to the jar: `direct + jar === net` for every input, and no cent is
 * created or destroyed by the model choice.
 */
export function splitDirectJar(
  net: number,
  directPct: number,
): { direct: number; jar: number } {
  const amount = Math.round(Number(net));
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("invalid tip amount");
  const pct = Number(directPct);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    throw new Error("direct percentage must be an integer 0-100");
  }
  const direct = Math.floor((amount * pct) / 100);
  return { direct, jar: amount - direct };
}

export function allocateWeightedTips(
  total: number,
  participants: WeightedTipParticipant[],
): Array<{ staffId: string; amount: number }> {
  const amount = Math.round(Number(total));
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("invalid tip total");
  const unique = new Map<string, number>();
  for (const participant of participants) {
    if (!participant.staffId || unique.has(participant.staffId)) {
      throw new Error("participants must have unique staff ids");
    }
    const weight = Number(participant.weight);
    if (!Number.isFinite(weight) || weight < 0) throw new Error("invalid participant weight");
    unique.set(participant.staffId, weight);
  }
  const sorted = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b));
  const weightTotal = sorted.reduce((sum, [, weight]) => sum + weight, 0);
  if (amount > 0 && weightTotal <= 0) throw new Error("positive weight required");
  const allocated = sorted.map(([staffId, weight]) => {
    const exact = weightTotal > 0 ? amount * weight / weightTotal : 0;
    const floor = Math.floor(exact);
    return { staffId, amount: floor, remainder: exact - floor };
  });
  let remainder = amount - allocated.reduce((sum, row) => sum + row.amount, 0);
  for (const row of [...allocated].sort((a, b) =>
    b.remainder - a.remainder || a.staffId.localeCompare(b.staffId))) {
    if (remainder <= 0) break;
    row.amount += 1;
    remainder -= 1;
  }
  return allocated.map(({ staffId, amount: allocatedAmount }) => ({
    staffId,
    amount: allocatedAmount,
  }));
}

export function allocateFixedTips(
  total: number,
  entries: Array<{ staffId: string; amount: number }>,
): Array<{ staffId: string; amount: number }> {
  const expected = Math.round(Number(total));
  const seen = new Set<string>();
  const normalized = entries.map((entry) => {
    const amount = Math.round(Number(entry.amount));
    if (!entry.staffId || seen.has(entry.staffId) || !Number.isSafeInteger(amount) || amount < 0) {
      throw new Error("invalid fixed allocation");
    }
    seen.add(entry.staffId);
    return { staffId: entry.staffId, amount };
  });
  if (normalized.reduce((sum, entry) => sum + entry.amount, 0) !== expected) {
    throw new Error("fixed allocations must sum to net tips");
  }
  return normalized.sort((a, b) => a.staffId.localeCompare(b.staffId));
}