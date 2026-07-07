// Inventory auto-reorder. Pure + unit-testable — the analytical core of the
// reorder agent. It turns current stock + recent consumption velocity into a
// stockout forecast and a supplier-grouped draft purchase order. Quantities are in
// stock units; cost is whole KES per unit. It recommends — it never writes stock.

export type InventoryStat = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  stock: number;
  reorderLevel: number;
  cost: number; // whole KES per unit
  supplier: string | null;
  consumedInWindow: number; // units that left stock over the window
};

export type ReorderStatus = "critical" | "low" | "ok" | "overstocked";

export type ReorderLine = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  supplier: string | null;
  stock: number;
  reorderLevel: number;
  dailyVelocity: number;
  daysLeft: number | null; // null = no recent consumption
  status: ReorderStatus;
  suggestedQty: number;
  cost: number;
  lineCost: number;
  reason: string;
};

export type SupplierOrder = {
  supplier: string;
  lines: ReorderLine[];
  totalCost: number;
};

export type ReorderPlan = {
  windowDays: number;
  leadTimeDays: number;
  coverDays: number;
  lines: ReorderLine[];
  toOrder: ReorderLine[];
  bySupplier: SupplierOrder[];
  totalReorderCost: number;
  counts: Record<ReorderStatus, number>;
};

export type ReorderOptions = {
  windowDays?: number;
  leadTimeDays?: number;
  coverDays?: number;
};

const STATUS_RANK: Record<ReorderStatus, number> = {
  critical: 0,
  low: 1,
  ok: 2,
  overstocked: 3,
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function planReorder(
  items: InventoryStat[],
  opts: ReorderOptions = {},
): ReorderPlan {
  const windowDays = Math.max(1, opts.windowDays ?? 30);
  const leadTimeDays = Math.max(0, opts.leadTimeDays ?? 3);
  const coverDays = Math.max(1, opts.coverDays ?? 14);

  const counts: Record<ReorderStatus, number> = {
    critical: 0,
    low: 0,
    ok: 0,
    overstocked: 0,
  };

  const lines: ReorderLine[] = items.map((it) => {
    const dailyVelocity = Math.max(0, it.consumedInWindow) / windowDays;
    const daysLeft = dailyVelocity > 0 ? it.stock / dailyVelocity : null;
    const belowReorderLevel = it.reorderLevel > 0 && it.stock <= it.reorderLevel;

    let status: ReorderStatus;
    if (it.stock <= 0) {
      status = "critical";
    } else if (daysLeft !== null && daysLeft <= leadTimeDays) {
      status = "critical"; // will run out before a restock can arrive
    } else if (
      (daysLeft !== null && daysLeft <= leadTimeDays + coverDays) ||
      belowReorderLevel
    ) {
      status = "low";
    } else if (
      daysLeft !== null &&
      daysLeft > 3 * (leadTimeDays + coverDays)
    ) {
      status = "overstocked";
    } else {
      status = "ok";
    }

    // Top up to a target that covers the lead time plus the desired cover window,
    // but never below the merchant's manual reorder level.
    const target = Math.max(
      dailyVelocity * (leadTimeDays + coverDays),
      it.reorderLevel,
    );
    const suggestedQty =
      status === "critical" || status === "low"
        ? Math.max(0, Math.ceil(target - it.stock))
        : 0;

    let reason: string;
    if (status === "critical") {
      reason =
        it.stock <= 0
          ? "Out of stock."
          : `Only ${round1(daysLeft ?? 0)} days left — less than the ${leadTimeDays}-day lead time.`;
    } else if (status === "low") {
      reason =
        daysLeft !== null
          ? `About ${round1(daysLeft)} days of stock left.`
          : `At or below the reorder level (${it.reorderLevel}).`;
    } else if (status === "overstocked") {
      reason = `~${round1(daysLeft ?? 0)} days of stock — likely overstocked.`;
    } else {
      reason = "Healthy.";
    }

    counts[status] += 1;
    return {
      id: it.id,
      name: it.name,
      sku: it.sku,
      unit: it.unit,
      supplier: it.supplier,
      stock: it.stock,
      reorderLevel: it.reorderLevel,
      dailyVelocity: round1(dailyVelocity),
      daysLeft: daysLeft === null ? null : round1(daysLeft),
      status,
      suggestedQty,
      cost: it.cost,
      lineCost: suggestedQty * it.cost,
      reason,
    };
  });

  const toOrder = lines
    .filter((l) => l.suggestedQty > 0)
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity),
    );

  const supplierMap = new Map<string, ReorderLine[]>();
  for (const line of toOrder) {
    const key = line.supplier?.trim() || "Unassigned";
    if (!supplierMap.has(key)) supplierMap.set(key, []);
    supplierMap.get(key)!.push(line);
  }
  const bySupplier: SupplierOrder[] = [...supplierMap.entries()]
    .map(([supplier, supplierLines]) => ({
      supplier,
      lines: supplierLines,
      totalCost: supplierLines.reduce((s, l) => s + l.lineCost, 0),
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  return {
    windowDays,
    leadTimeDays,
    coverDays,
    lines,
    toOrder,
    bySupplier,
    totalReorderCost: toOrder.reduce((s, l) => s + l.lineCost, 0),
    counts,
  };
}
