import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { customerNames, entriesToLines, includedTotalSen, isNewCustomer, linesToDebts, sampleRead, type ReadEntry, type ScanLine } from "./scan";

const TODAY = "2026-10-12";

function known(name: string): Debt {
  return { id: name, customerName: name, item: "", amountSen: 100, date: TODAY, status: "unpaid", source: "manual", createdAt: `${TODAY}T00:00:00.000Z` };
}

function ids() {
  let n = 0;
  return () => `D-${++n}`;
}

describe("sampleRead", () => {
  it("reads a notebook page as several lines, leaving unsure ones unticked", () => {
    const lines = sampleRead("notebook", TODAY);
    expect(lines.length).toBeGreaterThan(1);
    const unsure = lines.filter((l) => l.unsure);
    expect(unsure.length).toBeGreaterThan(0);
    expect(unsure.every((l) => !l.include)).toBe(true);
    expect(lines.every((l) => l.date === TODAY)).toBe(true);
  });

  it("reads a receipt as one line with no customer", () => {
    const lines = sampleRead("receipt", TODAY);
    expect(lines).toHaveLength(1);
    expect(lines[0].customerName).toBe("");
  });
});

describe("isNewCustomer", () => {
  const names = ["Mak Cik Siti", "Mr. Raj"];
  it("ignores case and extra spaces", () => {
    expect(isNewCustomer("mak  cik siti ", names)).toBe(false);
  });
  it("flags names not on the ledger", () => {
    expect(isNewCustomer("Abang Joe", names)).toBe(true);
  });
  it("doesn't flag an empty name", () => {
    expect(isNewCustomer("  ", names)).toBe(false);
  });
});

describe("customerNames", () => {
  it("lists each customer once, A–Z", () => {
    expect(customerNames([known("Uncle Tan"), known("ah seng"), known("Ah Seng"), known("Kak Lina")])).toEqual([
      "ah seng",
      "Kak Lina",
      "Uncle Tan",
    ]);
  });
});

describe("includedTotalSen", () => {
  it("adds only ticked lines with a readable amount", () => {
    const lines: ScanLine[] = [
      { key: "a", customerName: "A", item: "", amount: "10.00", date: TODAY, include: true },
      { key: "b", customerName: "B", item: "", amount: "5.50", date: TODAY, include: false },
      { key: "c", customerName: "C", item: "", amount: "abc", date: TODAY, include: true },
      { key: "d", customerName: "", item: "", amount: "2", date: TODAY, include: true },
    ];
    expect(includedTotalSen(lines, TODAY)).toBe(1200);
  });

  it("matches the notebook sample's ticked lines", () => {
    expect(includedTotalSen(sampleRead("notebook", TODAY), TODAY)).toBe(18210);
  });
});

describe("linesToDebts", () => {
  it("makes unpaid scan debts from ticked lines only", () => {
    const result = linesToDebts(sampleRead("notebook", TODAY), TODAY, { newId: ids(), now: new Date("2026-10-12T10:00:00Z") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debts).toHaveLength(7);
    expect(result.debts.every((d) => d.source === "scan" && d.status === "unpaid")).toBe(true);
    expect(result.debts[0]).toMatchObject({ id: "D-1", customerName: "Mak Cik Siti", amountSen: 4850, date: TODAY });
  });

  it("is all or nothing, listing every line to fix", () => {
    const lines: ScanLine[] = [
      { key: "ok", customerName: "A", item: "", amount: "10", date: TODAY, include: true },
      { key: "noname", customerName: " ", item: "", amount: "10", date: TODAY, include: true },
      { key: "badamt", customerName: "B", item: "", amount: "12,50", date: TODAY, include: true },
      { key: "skipped", customerName: "", item: "", amount: "", date: TODAY, include: false },
    ];
    const result = linesToDebts(lines, TODAY, { newId: ids(), now: new Date() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.key)).toEqual(["noname", "badamt"]);
    expect(result.problems[0].errors.customerName).toBeTruthy();
    expect(result.problems[1].errors.amount).toBeTruthy();
  });

  it("refuses a future date", () => {
    const lines: ScanLine[] = [{ key: "f", customerName: "A", item: "", amount: "1", date: "2026-10-13", include: true }];
    const result = linesToDebts(lines, TODAY, { newId: ids(), now: new Date() });
    expect(result.ok).toBe(false);
  });
});

function entry(over: Partial<ReadEntry>): ReadEntry {
  return {
    id: "e1",
    customerName: "Ah Seng",
    item: "Susu",
    amountSen: 3990,
    rawAmountText: "39.90",
    date: TODAY,
    classification: "debt",
    isAmbiguous: false,
    included: true,
    ...over,
  };
}

describe("entriesToLines", () => {
  it("turns clear debt lines into ticked check lines", () => {
    const lines = entriesToLines([entry({}), entry({ customerName: "  Kak Lina ", item: "Gula", amountSen: 2240 })], "notebook", TODAY);
    expect(lines).toEqual([
      { key: "l1", customerName: "Ah Seng", item: "Susu", amount: "39.90", date: TODAY, include: true, unsure: undefined },
      { key: "l2", customerName: "Kak Lina", item: "Gula", amount: "22.40", date: TODAY, include: true, unsure: undefined },
    ]);
  });

  it("leaves crossed-out lines, repayments and unsure lines unticked, saying why", () => {
    const lines = entriesToLines(
      [
        entry({ classification: "crossed_out", included: false }),
        entry({ classification: "repayment", included: false }),
        entry({ classification: "ambiguous", isAmbiguous: true, ambiguityReason: "13.50 or 18.50", included: false }),
        entry({ isAmbiguous: true, included: false }),
      ],
      "notebook",
      TODAY,
    );
    expect(lines.map((l) => l.include)).toEqual([false, false, false, false]);
    // Crossed out and repaid lines are notes, with no amount to fix; unsure lines can be fixed.
    expect(lines.map((l) => Boolean(l.skipped))).toEqual([true, true, false, false]);
    expect(lines.map((l) => l.unsure)).toEqual([
      "Crossed out in the book",
      "Looks like a repayment, not a new debt",
      "13.50 or 18.50",
      "The reader wasn't sure about this line",
    ]);
  });

  it("keeps the amount as read when it couldn't be turned into money", () => {
    const [line] = entriesToLines([entry({ amountSen: 0, rawAmountText: "RM1?.50", isAmbiguous: true })], "notebook", TODAY);
    expect(line.amount).toBe("1.50");
  });

  it("uses today when a line has no date", () => {
    const [line] = entriesToLines([entry({ date: "" })], "notebook", TODAY);
    expect(line.date).toBe(TODAY);
  });

  it("reads a receipt as one purchase with no customer, skipping crossed-out lines", () => {
    const lines = entriesToLines(
      [entry({ item: "Milo 1kg", amountSen: 1890 }), entry({ item: "Gula", amountSen: 580 }), entry({ classification: "crossed_out", item: "Rokok", amountSen: 1700 })],
      "receipt",
      TODAY,
    );
    expect(lines).toEqual([{ key: "r1", customerName: "", item: "Milo 1kg, Gula", amount: "24.70", date: TODAY, include: true, unsure: undefined }]);
  });

  it("returns no lines when nothing was read", () => {
    expect(entriesToLines([], "notebook", TODAY)).toEqual([]);
    expect(entriesToLines([entry({ classification: "repayment" })], "receipt", TODAY)).toEqual([]);
  });

  it("makes debts from read lines once the owner has checked them", () => {
    const lines = entriesToLines([entry({}), entry({ classification: "crossed_out", included: false })], "notebook", TODAY);
    const result = linesToDebts(lines, TODAY, { newId: ids(), now: new Date("2026-10-12T10:00:00Z") });
    expect(result.ok && result.debts.map((d) => [d.customerName, d.amountSen, d.source])).toEqual([["Ah Seng", 3990, "scan"]]);
  });
});
