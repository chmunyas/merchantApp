// Turns each staff member's fixed salary into the lines of one payroll run.
//
// Fixed amount per period, not hours x rate: shifts record a cash Z-report, not
// an attested timesheet, so a wage derived from them is one the venue could not
// defend if challenged.

export type SalaryStaff = {
  staffId: string;
  name: string;
  active: boolean;
  salaryAmount: number | null;
  salaryPeriod: "weekly" | "biweekly" | "monthly" | null;
};

export type SalaryLine = { staffId: string; name: string; amount: number };

export type SalaryPlan = {
  lines: readonly SalaryLine[];
  total: number;
  /** Named so a manager can see who was left out and why, rather than guessing. */
  excluded: readonly { staffId: string; name: string; reason: "inactive" | "no-salary" }[];
};

/**
 * Builds the lines for a run. Everyone with a positive salary on the period
 * being paid is included exactly once; everyone else is reported as excluded so
 * a missing person is visible rather than silent.
 */
export function planSalaryRun(
  staff: readonly SalaryStaff[],
  period: "weekly" | "biweekly" | "monthly",
): SalaryPlan {
  const lines: SalaryLine[] = [];
  const excluded: { staffId: string; name: string; reason: "inactive" | "no-salary" }[] = [];

  for (const person of staff) {
    if (!person.active) {
      excluded.push({ staffId: person.staffId, name: person.name, reason: "inactive" });
      continue;
    }
    const amount = Math.round(Number(person.salaryAmount ?? 0));
    if (!Number.isFinite(amount) || amount <= 0 || person.salaryPeriod !== period) {
      excluded.push({ staffId: person.staffId, name: person.name, reason: "no-salary" });
      continue;
    }
    lines.push({ staffId: person.staffId, name: person.name, amount });
  }

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.amount, 0),
    excluded,
  };
}

export type SalaryValidation =
  | { ok: true; amount: number; period: "weekly" | "biweekly" | "monthly" }
  | { ok: false; error: string };

/** KES 10,000,000 a period. A cap that a typo will hit and a real wage will not. */
export const MAX_SALARY_MINOR = 1_000_000_000;

export function validateSalary(input: {
  amountMinor: unknown;
  period: unknown;
}): SalaryValidation {
  const amount = Number(input.amountMinor);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: "Salary must be a whole amount greater than zero." };
  }
  if (amount > MAX_SALARY_MINOR) {
    return { ok: false, error: "That salary looks like a typo — it exceeds the per-period cap." };
  }
  const period = String(input.period ?? "");
  if (!["weekly", "biweekly", "monthly"].includes(period)) {
    return { ok: false, error: "Pay period must be weekly, biweekly or monthly." };
  }
  return { ok: true, amount, period: period as "weekly" | "biweekly" | "monthly" };
}
