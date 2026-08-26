// C5.1 — turning a provider's payload into a check we can charge against.
//
// Pure and total: every function here takes untrusted provider JSON and returns
// something safe, or refuses. No network, no database, so the rules below are
// unit-testable without a POS.
//
// The load-bearing rule is `reconcileTotals`. A POS is the authority on what a
// guest owes, but a payload can still arrive incomplete — a connector may omit
// the total, or send components that do not add up. We never invent money:
// a check whose parts contradict its stated total keeps the POS's total and is
// flagged, because charging a guest our arithmetic instead of the POS's is how
// an unreconcilable payment is born.

import type { PosCheck, PosCheckLine, PosModifier } from "@/lib/pos/types";

/**
 * Provider amounts arrive as major units, minor units or strings.
 *
 * The `toPrecision(15)` is load-bearing, not decoration: `1.005 * 100` evaluates
 * to `100.49999999999999` in binary floating point, so rounding it directly
 * takes a cent off a real bill. Normalising at 15 significant digits first undoes
 * the representation error, then we round to the cent.
 */
export function toMinor(value: unknown, unit: "major" | "minor"): number {
  const n = typeof value === "string" ? Number(value) : Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  if (unit === "minor") return Math.round(n);
  return Math.round(Number((n * 100).toPrecision(15)));
}

export function text(value: unknown, max = 250): string | null {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function nonNegative(value: number): number {
  return value > 0 ? value : 0;
}

function quantity(value: unknown): number {
  const n = Number(value ?? 1);
  if (!Number.isFinite(n) || n <= 0) return 1;
  // Three decimals: enough for weighed items, bounded so a bad payload cannot
  // produce an unbillable fraction.
  return Math.round(n * 1000) / 1000;
}

export function normalizeModifiers(value: unknown, unit: "major" | "minor"): PosModifier[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = (entry ?? {}) as Record<string, unknown>;
      const name = text(raw.name ?? raw.label, 120);
      if (!name) return null;
      return { name, priceMinor: toMinor(raw.price ?? raw.amount ?? 0, unit) };
    })
    .filter((entry): entry is PosModifier => entry !== null)
    .slice(0, 30);
}

/**
 * A line without a stable provider id cannot be reconciled or re-synced, so it
 * is dropped rather than given a generated id that changes on the next pull.
 */
export function normalizeLine(
  value: unknown,
  unit: "major" | "minor",
): PosCheckLine | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  const posLineId = text(raw.id ?? raw.guid ?? raw.lineId, 120);
  const name = text(raw.name ?? raw.displayName ?? raw.itemName, 250);
  if (!posLineId || !name) return null;

  const qty = quantity(raw.quantity ?? raw.qty);
  const unitPriceMinor = nonNegative(
    toMinor(raw.unitPrice ?? raw.price ?? raw.unit_price, unit),
  );
  const modifiers = normalizeModifiers(raw.modifiers ?? raw.options, unit);
  const modifierTotal = modifiers.reduce((sum, m) => sum + nonNegative(m.priceMinor), 0);
  const statedTotal = toMinor(raw.total ?? raw.totalPrice ?? raw.amount, unit);

  return {
    posLineId,
    posItemId: text(raw.itemId ?? raw.menuItemId ?? raw.sku, 120),
    name,
    category: text(raw.category ?? raw.group, 120),
    qty,
    unitPriceMinor,
    // Trust the provider's line total when it sent one; otherwise derive it.
    totalMinor:
      statedTotal > 0
        ? statedTotal
        : Math.round(unitPriceMinor * qty) + modifierTotal,
    modifiers,
    voided: Boolean(raw.voided ?? raw.isVoided ?? false),
  };
}

export type TotalsInput = {
  subtotalMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  discountMinor: number;
  statedTotalMinor: number;
  lineTotalMinor: number;
};

export type TotalsVerdict = {
  subtotalMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  discountMinor: number;
  totalMinor: number;
  /** Set when the parts do not reconcile to the total the POS reported. */
  discrepancyMinor: number;
  trusted: boolean;
};

/**
 * The POS's stated total always wins. We report the arithmetic gap rather than
 * closing it: an unexplained difference is a reconciliation signal (C3), and
 * quietly rebalancing it would destroy the only evidence that something is wrong.
 */
export function reconcileTotals(input: TotalsInput): TotalsVerdict {
  const subtotalMinor = nonNegative(
    input.subtotalMinor > 0 ? input.subtotalMinor : input.lineTotalMinor,
  );
  const taxMinor = nonNegative(input.taxMinor);
  const serviceChargeMinor = nonNegative(input.serviceChargeMinor);
  const discountMinor = nonNegative(input.discountMinor);
  const derived = Math.max(
    0,
    subtotalMinor + taxMinor + serviceChargeMinor - discountMinor,
  );
  const totalMinor = input.statedTotalMinor > 0 ? input.statedTotalMinor : derived;
  return {
    subtotalMinor,
    taxMinor,
    serviceChargeMinor,
    discountMinor,
    totalMinor,
    discrepancyMinor: totalMinor - derived,
    trusted: totalMinor === derived,
  };
}

export type CheckSource = {
  posBillId: unknown;
  posCheckNumber?: unknown;
  posTableRef?: unknown;
  posServerId?: unknown;
  posServerName?: unknown;
  revenueCentre?: unknown;
  service?: unknown;
  covers?: unknown;
  currency?: unknown;
  subtotal?: unknown;
  tax?: unknown;
  serviceCharge?: unknown;
  discount?: unknown;
  total?: unknown;
  paid?: unknown;
  openedAt?: unknown;
  closedAt?: unknown;
  lines?: unknown;
  raw?: Record<string, unknown>;
};

function isoOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function covers(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < 1000 ? n : null;
}

/**
 * Normalize one provider check. Returns null when it has no bill id — an
 * unidentifiable check cannot be paid against or reconciled, and inventing an
 * id would make it un-matchable on the next pull.
 */
export function normalizeCheck(
  source: CheckSource,
  unit: "major" | "minor" = "major",
): PosCheck | null {
  const posBillId = text(source.posBillId, 120);
  if (!posBillId) return null;

  const lines = Array.isArray(source.lines)
    ? source.lines
        .map((line) => normalizeLine(line, unit))
        .filter((line): line is PosCheckLine => line !== null)
    : [];
  const lineTotalMinor = lines
    .filter((line) => !line.voided)
    .reduce((sum, line) => sum + line.totalMinor, 0);

  const totals = reconcileTotals({
    subtotalMinor: toMinor(source.subtotal, unit),
    taxMinor: toMinor(source.tax, unit),
    serviceChargeMinor: toMinor(source.serviceCharge, unit),
    discountMinor: toMinor(source.discount, unit),
    statedTotalMinor: toMinor(source.total, unit),
    lineTotalMinor,
  });

  return {
    posBillId,
    posCheckNumber: text(source.posCheckNumber, 60),
    posTableRef: text(source.posTableRef, 120),
    posServerId: text(source.posServerId, 120),
    posServerName: text(source.posServerName, 120),
    revenueCentre: text(source.revenueCentre, 120),
    service: text(source.service, 60),
    covers: covers(source.covers),
    currency: (text(source.currency, 3) ?? "KES").toUpperCase(),
    subtotalMinor: totals.subtotalMinor,
    taxMinor: totals.taxMinor,
    serviceChargeMinor: totals.serviceChargeMinor,
    discountMinor: totals.discountMinor,
    totalMinor: totals.totalMinor,
    paidMinor: nonNegative(toMinor(source.paid, unit)),
    openedAt: isoOrNull(source.openedAt),
    closedAt: isoOrNull(source.closedAt),
    lines,
    raw: source.raw ?? {},
  };
}

/** What a guest still owes on a POS check. Never negative. */
export function outstandingMinor(check: PosCheck): number {
  return Math.max(0, check.totalMinor - check.paidMinor);
}
