import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import { customerNames, includedTotalSen, isNewCustomer, linesToDebts, sampleRead, type ScanLine } from "./scan";

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
