import { describe, expect, it } from "vitest";

import {
  buildPayoutRequest,
  kenyanNationalNumber,
  mapProviderStatus,
} from "../../src/lib/payout-provider";
import {
  canSubmit,
  canTransition,
  decideApproval,
  runIsComplete,
  salaryPeriodLabel,
} from "../../src/lib/payout-runs";
import { MAX_SALARY_MINOR, planSalaryRun, validateSalary } from "../../src/lib/payroll";
import { PESALINK_BANKS, bankName, isSupportedBankCode } from "../../src/lib/pesaswap-banks";

describe("payout runs — the gate that decides whether money may leave", () => {
  it("refuses to submit a run nobody has approved", () => {
    // This is the whole point. Before the gate, the weekly cron created payouts
    // and posted them to the live provider with no human in the loop.
    expect(canSubmit("pending_approval")).toBe(false);
    expect(canSubmit("rejected")).toBe(false);
    expect(canSubmit("cancelled")).toBe(false);
    expect(canSubmit(null)).toBe(false);
    expect(canSubmit(undefined)).toBe(false);
    // A payout with no run at all must never be submittable.
    expect(canSubmit("")).toBe(false);
  });

  it("allows submission only once approved, and again while submitting", () => {
    expect(canSubmit("approved")).toBe(true);
    // A partially failed batch must be finishable without a second approval,
    // or the people not yet paid are stranded.
    expect(canSubmit("submitted")).toBe(true);
  });

  it("never lets a decided run be re-decided", () => {
    expect(canTransition("rejected", "approved")).toBe(false);
    expect(canTransition("completed", "approved")).toBe(false);
    expect(canTransition("cancelled", "approved")).toBe(false);
    expect(canTransition("approved", "approved")).toBe(false);
    expect(canTransition("pending_approval", "approved")).toBe(true);
  });
});

describe("payout runs — approval decisions", () => {
  const base = {
    status: "pending_approval",
    staffCount: 3,
    totalAmount: 45_000,
    approverStaffId: "mgr-1",
    payeeStaffIds: ["a", "b", "c"],
  };

  it("approves a normal run and records it as not self-approved", () => {
    expect(decideApproval(base)).toEqual({ ok: true, selfApproved: false });
  });

  it("permits a manager to approve their own pay, but flags it", () => {
    // House policy allows this. It must never be invisible to an auditor.
    const decision = decideApproval({ ...base, payeeStaffIds: ["a", "mgr-1"] });
    expect(decision).toEqual({ ok: true, selfApproved: true });
  });

  it("does not flag self-approval when the approver has no staff identity", () => {
    const decision = decideApproval({ ...base, approverStaffId: null });
    expect(decision).toEqual({ ok: true, selfApproved: false });
  });

  it("refuses an empty run so no approval is recorded against nothing", () => {
    expect(decideApproval({ ...base, staffCount: 0 })).toEqual({
      ok: false,
      reason: "empty-run",
    });
    expect(decideApproval({ ...base, totalAmount: 0 })).toEqual({
      ok: false,
      reason: "empty-run",
    });
  });

  it("refuses to approve a run that is not awaiting approval", () => {
    for (const status of ["approved", "rejected", "submitted", "completed", "cancelled"]) {
      expect(decideApproval({ ...base, status })).toEqual({
        ok: false,
        reason: "not-pending",
      });
    }
  });
});

describe("payout runs — completion", () => {
  it("is not complete while any line is still in flight", () => {
    expect(runIsComplete(["confirmed", "processing"])).toBe(false);
    expect(runIsComplete(["pending"])).toBe(false);
    expect(runIsComplete(["unknown"])).toBe(false);
  });

  it("is complete when every line has settled one way or another", () => {
    expect(runIsComplete(["confirmed", "failed", "held"])).toBe(true);
  });

  it("treats a run with no lines as unfinished rather than done", () => {
    expect(runIsComplete([])).toBe(false);
  });

  it("labels a salary period as YYYY-MM", () => {
    expect(salaryPeriodLabel(new Date("2026-08-25T00:00:00Z"))).toBe("2026-08");
    expect(salaryPeriodLabel(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
});

describe("PesaSwap channels — wallet and Pesalink", () => {
  const common = { amountMinor: 25_000, profileId: "prof_1", metadata: { venue_id: "v1" } };

  it("routes M-Pesa on a national number with the country code separate", () => {
    const result = buildPayoutRequest({
      ...common,
      destination: { method: "mpesa", accountNumber: "+254712345678" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.payout_type).toBe("wallet");
    expect(result.body.phone).toBe("712345678");
    expect(result.body.phone_country_code).toBe("254");
  });

  it("normalises the three ways a Kenyan number gets typed", () => {
    expect(kenyanNationalNumber("+254712345678")).toBe("712345678");
    expect(kenyanNationalNumber("0712345678")).toBe("712345678");
    expect(kenyanNationalNumber("254712345678")).toBe("712345678");
  });

  it("routes a bank payout over Pesalink using the bank code", () => {
    const result = buildPayoutRequest({
      ...common,
      destination: { method: "bank", accountNumber: "0712345678", bankCode: "68" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.payout_type).toBe("bank");
    expect(result.body.payout_method_data).toEqual({
      bank: { payout_method: "pesalink", bank_code: "68", account_number: "0712345678" },
    });
  });

  it("holds a bank payout with no code rather than guessing one", () => {
    // Guessing a bank from a typed name routes someone's wages to the wrong bank.
    const result = buildPayoutRequest({
      ...common,
      destination: { method: "bank", accountNumber: "0712345678", bankCode: null },
    });
    expect(result).toEqual({ ok: false, heldReason: "bank_code_missing" });
  });

  it("holds a bank payout whose code is not on the supported list", () => {
    const result = buildPayoutRequest({
      ...common,
      destination: { method: "bank", accountNumber: "0712345678", bankCode: "99" },
    });
    expect(result).toEqual({ ok: false, heldReason: "bank_code_missing" });
  });

  it("holds rather than sends when there is no account number", () => {
    const result = buildPayoutRequest({
      ...common,
      destination: { method: "mpesa", accountNumber: "" },
    });
    expect(result).toEqual({ ok: false, heldReason: "no_payout_details" });
  });

  it("keeps an unrecognised provider status in flight instead of assuming success", () => {
    expect(mapProviderStatus("success")).toBe("confirmed");
    expect(mapProviderStatus("failed")).toBe("failed");
    expect(mapProviderStatus("unknown")).toBe("processing");
    expect(mapProviderStatus("")).toBe("processing");
  });
});

describe("Pesalink bank list", () => {
  it("carries the published codes and rejects anything else", () => {
    expect(isSupportedBankCode("68")).toBe(true);
    expect(bankName("68")).toBe("Equity Bank Kenya");
    expect(isSupportedBankCode("99")).toBe(false);
    expect(isSupportedBankCode(null)).toBe(false);
    expect(bankName("99")).toBeNull();
  });

  it("has no duplicate codes", () => {
    const codes = PESALINK_BANKS.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses two-digit codes, matching the database constraint", () => {
    for (const bank of PESALINK_BANKS) {
      expect(bank.code, bank.name).toMatch(/^\d{2}$/);
    }
  });
});

describe("payroll — fixed salary per period", () => {
  const staff = [
    { staffId: "a", name: "Amina", active: true, salaryAmount: 50_000, salaryPeriod: "monthly" as const },
    { staffId: "b", name: "Brian", active: true, salaryAmount: 40_000, salaryPeriod: "monthly" as const },
    { staffId: "c", name: "Carol", active: false, salaryAmount: 30_000, salaryPeriod: "monthly" as const },
    { staffId: "d", name: "Dan", active: true, salaryAmount: null, salaryPeriod: null },
    { staffId: "e", name: "Eve", active: true, salaryAmount: 20_000, salaryPeriod: "weekly" as const },
  ];

  it("pays active staff on the period being run, once each", () => {
    const plan = planSalaryRun(staff, "monthly");
    expect(plan.lines.map((l) => l.staffId)).toEqual(["a", "b"]);
    expect(plan.total).toBe(90_000);
  });

  it("names everyone it left out, so a missing wage is visible not silent", () => {
    const plan = planSalaryRun(staff, "monthly");
    expect(plan.excluded).toEqual([
      { staffId: "c", name: "Carol", reason: "inactive" },
      { staffId: "d", name: "Dan", reason: "no-salary" },
      { staffId: "e", name: "Eve", reason: "no-salary" },
    ]);
  });

  it("never pays somebody on a different pay period", () => {
    const plan = planSalaryRun(staff, "weekly");
    expect(plan.lines.map((l) => l.staffId)).toEqual(["e"]);
    expect(plan.total).toBe(20_000);
  });

  it("produces an empty plan rather than throwing when nobody qualifies", () => {
    expect(planSalaryRun([], "monthly")).toEqual({ lines: [], total: 0, excluded: [] });
  });
});

describe("payroll — salary validation", () => {
  it("accepts a whole minor-unit amount on a known period", () => {
    expect(validateSalary({ amountMinor: 5_000_000, period: "monthly" })).toEqual({
      ok: true,
      amount: 5_000_000,
      period: "monthly",
    });
  });

  it("rejects zero, negative and fractional amounts", () => {
    for (const amount of [0, -1, 1.5]) {
      expect(validateSalary({ amountMinor: amount, period: "monthly" }).ok).toBe(false);
    }
  });

  it("catches a fat-finger that would pay someone a fortune", () => {
    const result = validateSalary({ amountMinor: MAX_SALARY_MINOR + 1, period: "monthly" });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown pay period", () => {
    expect(validateSalary({ amountMinor: 1000, period: "fortnightly" }).ok).toBe(false);
    expect(validateSalary({ amountMinor: 1000, period: null }).ok).toBe(false);
  });
});
