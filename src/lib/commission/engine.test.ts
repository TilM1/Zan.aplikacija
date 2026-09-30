import { describe, expect, it } from "vitest";
import {
  agentCommissionTotal,
  buildAgentCommission,
  buildCallerCommission,
  buildPolicyCommissions,
  callerCommissionTotal,
  firstPayoutDate,
  installmentDueDate,
  nextPayoutDayOnOrAfter,
  splitByShares,
} from "./engine";
import { COMMISSION_RULES } from "./rules";
import { centsToDecimal, toCents } from "@/lib/money";

describe("agent commission", () => {
  it("100 € × 12 × 10 years × 10% = 1,200 €", () => {
    expect(agentCommissionTotal(toCents("100"), 10, 1000)).toBe(120000);
  });

  it("splits 1,200 € into 660 / 240 / 300", () => {
    const plan = buildAgentCommission({ monthlyPremium: "100.00", durationYears: 10, policyDate: "2026-10-23", agentRatePercent: "10" });
    expect(plan.total_amount).toBe("1200.00");
    expect(plan.installments.map((i) => i.amount)).toEqual(["660.00", "240.00", "300.00"]);
    expect(plan.installments.map((i) => i.share_percent)).toEqual(["55.00", "20.00", "25.00"]);
    expect(plan.rate_percent).toBe("10.00");
  });

  it("installments always sum exactly to the total (rounding remainder goes to the last one)", () => {
    for (const [premium, years, rate] of [
      ["33.33", 7, "9.75"],
      ["12.01", 3, "11.11"],
      ["199.99", 25, "12.5"],
      ["0.01", 1, "1"],
    ] as const) {
      const plan = buildAgentCommission({ monthlyPremium: premium, durationYears: years, policyDate: "2026-01-10", agentRatePercent: rate });
      const sum = plan.installments.reduce((acc, i) => acc + toCents(i.amount), 0);
      expect(sum).toBe(toCents(plan.total_amount));
    }
  });

  it("rounds half-up on cents like PostgreSQL round(numeric, 2)", () => {
    // 10.05 × 12 × 1 × 12.5% = 15.075 → 15.08
    expect(centsToDecimal(agentCommissionTotal(toCents("10.05"), 1, 1250))).toBe("15.08");
  });

  it("rejects invalid inputs", () => {
    expect(() => agentCommissionTotal(0, 10, 1000)).toThrow();
    expect(() => agentCommissionTotal(100, 0, 1000)).toThrow();
    expect(() => agentCommissionTotal(100, 1.5, 1000)).toThrow();
    expect(() => agentCommissionTotal(100, 10, 10001)).toThrow();
    expect(() => toCents("12.345")).toThrow();
    expect(toCents("-660.00")).toBe(-66000); // stored deductions
    expect(() => agentCommissionTotal(toCents("-5"), 10, 1000)).toThrow();
  });
});

describe("caller commission", () => {
  it("100 € × 1.5 = 150 €, paid in full once", () => {
    expect(callerCommissionTotal(toCents("100"), 1500)).toBe(15000);
    const plan = buildCallerCommission({ monthlyPremium: "100", policyDate: "2026-10-23", callerMultiplier: "1.5" });
    expect(plan.total_amount).toBe("150.00");
    expect(plan.installments).toHaveLength(1);
    expect(plan.installments[0]).toMatchObject({ amount: "150.00", share_percent: "100.00", due_date: "2026-11-16" });
  });

  it("rounds half-up (33.33 × 1.5 = 49.995 → 50.00)", () => {
    expect(centsToDecimal(callerCommissionTotal(toCents("33.33"), 1500))).toBe("50.00");
  });

  it("uses the caller's own multiplier (e.g. ×2 or ×1.75)", () => {
    expect(buildCallerCommission({ monthlyPremium: "100", policyDate: "2026-10-23", callerMultiplier: "2" }).total_amount).toBe("200.00");
    const p = buildCallerCommission({ monthlyPremium: "80", policyDate: "2026-10-23", callerMultiplier: "1,75" });
    expect(p.total_amount).toBe("140.00");
    expect(p.caller_multiplier).toBe("1.75");
    expect(p.calculation.expression).toBe("80.00 × 1.75");
    expect(() => buildCallerCommission({ monthlyPremium: "80", policyDate: "2026-10-23", callerMultiplier: "-1" })).toThrow();
  });
});

describe("payout cutoff (24th) → 16th", () => {
  it.each([
    ["2026-10-23", "2026-11-16"],
    ["2026-10-24", "2026-11-16"],
    ["2026-10-25", "2026-12-16"],
    ["2026-10-01", "2026-11-16"],
    ["2026-10-31", "2026-12-16"],
    ["2026-11-25", "2027-01-16"], // year rollover
    ["2026-12-24", "2027-01-16"],
    ["2026-12-25", "2027-02-16"],
    ["2028-02-29", "2028-04-16"], // leap day, after cutoff
  ])("policy %s → first payout %s", (policyDate, expected) => {
    expect(firstPayoutDate(policyDate)).toBe(expected);
  });

  it("second (20%) and third (25%) installments at +12 / +24 months from the first payout (months 13 and 25)", () => {
    expect(installmentDueDate("2026-10-23", 12)).toBe("2027-11-16");
    expect(installmentDueDate("2026-10-23", 24)).toBe("2028-11-16");
    expect(installmentDueDate("2026-10-25", 12)).toBe("2027-12-16");
    expect(installmentDueDate("2026-10-25", 24)).toBe("2028-12-16");
    const plan = buildAgentCommission({ monthlyPremium: "100", durationYears: 10, policyDate: "2026-10-25", agentRatePercent: "10" });
    expect(plan.installments.map((i) => i.due_date)).toEqual(["2026-12-16", "2027-12-16", "2028-12-16"]);
  });

  it("caller payout date equals the agent's first payout date", () => {
    for (const d of ["2026-10-23", "2026-10-24", "2026-10-25"]) {
      const plan = buildPolicyCommissions({ monthlyPremium: "100", durationYears: 10, policyDate: d, agentRatePercent: "10", callerMultiplier: "1.5" });
      expect(plan.caller!.installments[0].due_date).toBe(plan.agent.installments[0].due_date);
    }
  });

  it("rejects impossible dates", () => {
    expect(() => firstPayoutDate("2026-02-30")).toThrow();
    expect(() => firstPayoutDate("23.10.2026")).toThrow();
  });
});

describe("Specialisti (agent multiplier model)", () => {
  const plan = buildAgentCommission({ agentModel: "agent_multiplier", agentMultiplier: "12", agentRatePercent: null, monthlyPremium: "30", durationYears: 5, policyDate: "2026-10-23" });

  it("total = monthly premium × agent's number (30 × 12 = 360 €)", () => {
    expect(plan).toMatchObject({ calc_model: "agent_multiplier", agent_multiplier: "12", rate_percent: null, total_amount: "360.00" });
    expect(plan.calculation.expression).toBe("30.00 × 12");
  });

  it("pays 50 / 15 / 10 / 5 / 5 / 6 × 2.5 % monthly from the first payout", () => {
    expect(plan.installments.map((i) => i.share_percent)).toEqual(["50.00", "15.00", "10.00", "5.00", "5.00", "2.50", "2.50", "2.50", "2.50", "2.50", "2.50"]);
    expect(plan.installments.map((i) => i.amount)).toEqual(["180.00", "54.00", "36.00", "18.00", "18.00", "9.00", "9.00", "9.00", "9.00", "9.00", "9.00"]);
    expect(plan.installments.map((i) => i.due_date)).toEqual([
      "2026-11-16", "2026-12-16", "2027-01-16", "2027-02-16", "2027-03-16", "2027-04-16",
      "2027-05-16", "2027-06-16", "2027-07-16", "2027-08-16", "2027-09-16",
    ]);
  });

  it("cutoff still applies (policy on the 25th → first payout two months later)", () => {
    const late = buildAgentCommission({ agentModel: "agent_multiplier", agentMultiplier: "10", agentRatePercent: null, monthlyPremium: "19.99", durationYears: 1, policyDate: "2026-10-25" });
    expect(late.installments[0].due_date).toBe("2026-12-16");
    const sum = late.installments.reduce((a, i) => a + toCents(i.amount), 0);
    expect(sum).toBe(toCents(late.total_amount)); // 199.90, rounding remainder in the last installment
  });

  it("the caller commission is unchanged for Specialisti", () => {
    const p = buildPolicyCommissions({ agentModel: "agent_multiplier", agentMultiplier: "12", agentRatePercent: null, monthlyPremium: "30", durationYears: 5, policyDate: "2026-10-23", callerMultiplier: "1.5" });
    expect(p.caller!.total_amount).toBe("45.00");
  });
});

describe("storno deduction date", () => {
  it.each([
    ["2026-10-01", "2026-10-16"],
    ["2026-10-16", "2026-10-16"],
    ["2026-10-17", "2026-11-16"],
    ["2026-12-20", "2027-01-16"],
  ])("%s → %s", (d, e) => expect(nextPayoutDayOnOrAfter(d)).toBe(e));
});

describe("multiple policies from one consultation", () => {
  it("calculates agent and caller commission separately for each policy", () => {
    const policies = [
      { monthlyPremium: "100", durationYears: 10 },
      { monthlyPremium: "50", durationYears: 20 },
      { monthlyPremium: "35.50", durationYears: 15 },
    ].map((p) => buildPolicyCommissions({ ...p, policyDate: "2026-10-23", agentRatePercent: "10", callerMultiplier: "1.5" }));

    expect(policies.map((p) => p.agent.total_amount)).toEqual(["1200.00", "1200.00", "639.00"]);
    expect(policies.map((p) => p.caller!.total_amount)).toEqual(["150.00", "75.00", "53.25"]);
  });

  it("omits caller commission when the appointment has no caller", () => {
    const plan = buildPolicyCommissions({ monthlyPremium: "100", durationYears: 10, policyDate: "2026-10-23", agentRatePercent: "10", callerMultiplier: null });
    expect(plan.caller).toBeNull();
  });
});

describe("snapshots", () => {
  it("a plan is fully determined by its snapshotted inputs", () => {
    const old = buildAgentCommission({ monthlyPremium: "100", durationYears: 10, policyDate: "2026-10-23", agentRatePercent: "10" });
    // Agent later gets 12%: only new calculations use it; the old plan is unchanged
    const newer = buildAgentCommission({ monthlyPremium: "100", durationYears: 10, policyDate: "2026-11-02", agentRatePercent: "12" });
    expect(old.total_amount).toBe("1200.00");
    expect(newer.total_amount).toBe("1440.00");
    expect(old.calculation).toMatchObject({ rate_percent: "10.00", expression: "100.00 × 12 × 10 × 10.00%" });
    expect(old.rule_version).toBe(COMMISSION_RULES.version);
  });
});

describe("splitByShares", () => {
  it("requires shares summing to 100", () => {
    expect(() => splitByShares(100, [50, 40])).toThrow();
  });
  it("handles odd cents", () => {
    expect(splitByShares(1, [55, 20, 25])).toEqual([1, 0, 0]);
    expect(splitByShares(3, [55, 20, 25])).toEqual([2, 1, 0]);
  });
});
