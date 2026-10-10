import { describe, expect, it } from "vitest";
import { policyCashflow } from "./owner-cashflow";

describe("owner cashflow by payout date", () => {
  it("own sale, standard product: 55 / 20 / 25 % over three years", () => {
    const e = policyCashflow({ policyDate: "2026-07-09", agencyCents: 60497, agencyModel: "standard", soldByOwner: true, payouts: [
      { type: "agent", dueDate: "2026-08-16", cents: 33273 }, { type: "agent", dueDate: "2027-08-16", cents: 12099 }, { type: "agent", dueDate: "2028-08-16", cents: 15125 },
    ] });
    expect(e.map((x) => [x.date, x.number, x.ownerCents])).toEqual([["2026-08-16", 1, 33273], ["2027-08-16", 2, 12099], ["2028-08-16", 3, 15125]]);
    expect(e.reduce((a, x) => a + x.ownerCents, 0)).toBe(60497);
  });

  it("another agent and a caller are deducted when their installments are due", () => {
    // 100 € × 12 × 10 × 6 % = 720 agency; agent 3.5 % = 420 (231 / 84 / 105); caller 150 once
    const e = policyCashflow({ policyDate: "2026-10-01", agencyCents: 72000, agencyModel: "standard", soldByOwner: false, payouts: [
      { type: "agent", dueDate: "2026-11-16", cents: 23100 }, { type: "agent", dueDate: "2027-11-16", cents: 8400 }, { type: "agent", dueDate: "2028-11-16", cents: 10500 },
      { type: "caller", dueDate: "2026-11-16", cents: 15000 },
    ] });
    expect(e.map((x) => [x.date, x.agencyCents, x.agentCents, x.callerCents, x.ownerCents])).toEqual([
      ["2026-11-16", 39600, 23100, 15000, 1500],
      ["2027-11-16", 14400, 8400, 0, 6000],
      ["2028-11-16", 18000, 10500, 0, 7500],
    ]);
  });

  it("Specialisti: 11 monthly installments; a deduction on another date gets its own line", () => {
    const e = policyCashflow({ policyDate: "2026-10-01", agencyCents: 30750, agencyModel: "agent_multiplier", soldByOwner: true, payouts: [{ type: "caller", dueDate: "2027-01-05", cents: -4500 }] });
    expect(e).toHaveLength(12);
    expect(e[0]).toMatchObject({ date: "2026-11-16", number: 1, agencyCents: 15375 });
    expect(e.find((x) => x.date === "2027-01-05")).toMatchObject({ number: null, callerCents: -4500, ownerCents: 4500 });
    expect(e.reduce((a, x) => a + x.agencyCents, 0)).toBe(30750);
  });
});
