import { describe, expect, it } from "vitest";
import {
  createManualDebt,
  formatSen,
  isDebt,
  outstanding,
  parseRmToSen,
  sortDebts,
  todayLocal,
  validateDebtInput,
  type Debt,
  type DebtInput,
} from "./debts";

const TODAY = "2026-10-11";
const good: DebtInput = { customerName: "Ah Seng", item: "Milo 1kg", amount: "12.50", date: TODAY };

function debt(over: Partial<Debt>): Debt {
  return {
    id: "d1",
    customerName: "A",
    item: "",
    amountSen: 100,
    date: "2026-10-01",
    status: "unpaid",
    source: "manual",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

describe("parseRmToSen", () => {
  it("reads plain, prefixed and comma amounts into whole sen", () => {
    expect(parseRmToSen("12")).toBe(1200);
    expect(parseRmToSen("12.5")).toBe(1250);
    expect(parseRmToSen("12.05")).toBe(1205);
    expect(parseRmToSen(" RM 0.10 ")).toBe(10);
    expect(parseRmToSen("rm1,250.00")).toBe(125000);
  });

  it("refuses anything that isn't a plain amount with at most two decimals", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1.", ".5", "1e3", "12.5.0", "RM", "5 ringgit"]) {
      expect(parseRmToSen(bad), bad).toBeNull();
    }
  });
});

describe("formatSen", () => {
  it("shows two decimals", () => {
    expect(formatSen(1250)).toBe("12.50");
    expect(formatSen(5)).toBe("0.05");
    expect(formatSen(0)).toBe("0.00");
    expect(formatSen(100000)).toBe("1000.00");
  });
});

describe("validateDebtInput", () => {
  it("accepts a normal entry and tidies spaces", () => {
    const r = validateDebtInput({ ...good, customerName: "  Ah   Seng ", item: " Milo  1kg " }, TODAY);
    expect(r).toEqual({
      ok: true,
      value: { customerName: "Ah Seng", item: "Milo 1kg", amountSen: 1250, date: TODAY },
    });
  });

  it("allows an empty item", () => {
    expect(validateDebtInput({ ...good, item: "" }, TODAY).ok).toBe(true);
  });

  const errorFor = (input: Partial<DebtInput>) => {
    const r = validateDebtInput({ ...good, ...input }, TODAY);
    return r.ok ? {} : r.errors;
  };

  it("needs a name, and not just spaces", () => {
    expect(errorFor({ customerName: "" }).customerName).toMatch(/name/);
    expect(errorFor({ customerName: "   " }).customerName).toMatch(/name/);
    expect(errorFor({ customerName: "x".repeat(61) }).customerName).toMatch(/60/);
  });

  it("refuses RM 0, negatives, three decimals, junk and huge amounts", () => {
    expect(errorFor({ amount: "0" }).amount).toMatch(/more than RM 0/);
    expect(errorFor({ amount: "0.00" }).amount).toMatch(/more than RM 0/);
    expect(errorFor({ amount: "-5" }).amount).toMatch(/2 decimals/);
    expect(errorFor({ amount: "1.234" }).amount).toMatch(/2 decimals/);
    expect(errorFor({ amount: "abc" }).amount).toMatch(/2 decimals/);
    expect(errorFor({ amount: "" }).amount).toMatch(/how much/);
    expect(errorFor({ amount: "10000.01" }).amount).toMatch(/over RM 10000.00/);
    expect(errorFor({ amount: "10000" }).amount).toBeUndefined();
    expect(errorFor({ amount: "0.01" }).amount).toBeUndefined();
  });

  it("refuses future, missing and impossible dates", () => {
    expect(errorFor({ date: "2026-10-12" }).date).toMatch(/future/);
    expect(errorFor({ date: "" }).date).toMatch(/Pick/);
    expect(errorFor({ date: "2026-02-30" }).date).toMatch(/Pick/);
    expect(errorFor({ date: TODAY }).date).toBeUndefined();
  });

  it("reports every problem at once", () => {
    const r = validateDebtInput({ customerName: "", item: "", amount: "0", date: "" }, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["amount", "customerName", "date"]);
  });
});

describe("createManualDebt", () => {
  it("starts unpaid, marked manual, stamped with the time", () => {
    const now = new Date("2026-10-11T10:00:00.000Z");
    const d = createManualDebt({ customerName: "A", item: "", amountSen: 500, date: TODAY }, { id: "x", now });
    expect(d).toEqual({
      customerName: "A",
      item: "",
      amountSen: 500,
      date: TODAY,
      id: "x",
      status: "unpaid",
      source: "manual",
      createdAt: "2026-10-11T10:00:00.000Z",
    });
    expect(isDebt(d)).toBe(true);
  });
});

describe("outstanding", () => {
  it("adds every unpaid debt in whole sen, with no float error", () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in sen it's exactly 30.
    const total = outstanding([debt({ amountSen: 10 }), debt({ amountSen: 20 })]);
    expect(total).toEqual({ totalSen: 30, count: 2 });
    const many = Array.from({ length: 1000 }, () => debt({ amountSen: 1 }));
    expect(outstanding(many).totalSen).toBe(1000);
  });

  it("leaves paid debts out", () => {
    expect(outstanding([debt({ amountSen: 500, status: "paid" }), debt({ amountSen: 300, status: "overdue" })])).toEqual(
      { totalSen: 300, count: 1 },
    );
  });
});

describe("sortDebts", () => {
  it("puts overdue first, then by status, oldest first within a status", () => {
    const sorted = sortDebts([
      debt({ id: "paid", status: "paid", date: "2026-01-01" }),
      debt({ id: "unpaid-new", status: "unpaid", date: "2026-10-02" }),
      debt({ id: "unpaid-old", status: "unpaid", date: "2026-09-01" }),
      debt({ id: "overdue", status: "overdue", date: "2026-10-05" }),
      debt({ id: "sent", status: "sent" }),
    ]);
    expect(sorted.map((d) => d.id)).toEqual(["overdue", "sent", "unpaid-old", "unpaid-new", "paid"]);
  });
});

describe("isDebt", () => {
  it("rejects records with a float amount or unknown status", () => {
    expect(isDebt(debt({}))).toBe(true);
    expect(isDebt({ ...debt({}), amountSen: 12.5 })).toBe(false);
    expect(isDebt({ ...debt({}), status: "cancelled" })).toBe(false);
    expect(isDebt(null)).toBe(false);
  });
});

describe("todayLocal", () => {
  it("formats the local date", () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
