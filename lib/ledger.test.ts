import { describe, expect, it } from "vitest";
import type { Debt } from "./debts";
import type { T } from "./i18n";
import type { InvoiceRecord } from "./collect-store";
import { csvCell, debtsToCsv, filterByStatus, latestInvoiceByDebt, ledgerTotals } from "./ledger";

const d = (id: string, status: Debt["status"], amountSen: number): Debt => ({
  id,
  customerName: "X",
  item: "",
  amountSen,
  date: "2026-10-01",
  status,
  source: "manual",
  createdAt: "2026-10-01T00:00:00.000Z",
});

const DEBTS = [d("a", "overdue", 1000), d("b", "overdue", 500), d("c", "sent", 200), d("d", "unpaid", 300), d("e", "paid", 900)];

describe("ledgerTotals", () => {
  it("counts and sums each status, and leaves paid out of what's owed", () => {
    expect(ledgerTotals(DEBTS)).toEqual({
      counts: { all: 5, overdue: 2, sent: 1, unpaid: 1, paid: 1 },
      sen: { overdue: 1500, sent: 200, unpaid: 300, paid: 900 },
      owedSen: 2000,
    });
  });

  it("is all zeros with no tabs", () => {
    expect(ledgerTotals([]).owedSen).toBe(0);
  });
});

describe("filterByStatus", () => {
  it("keeps everything for All and only one status otherwise", () => {
    expect(filterByStatus(DEBTS, "all")).toHaveLength(5);
    expect(filterByStatus(DEBTS, "overdue").map((x) => x.id)).toEqual(["a", "b"]);
    expect(filterByStatus(DEBTS, "paid").map((x) => x.id)).toEqual(["e"]);
  });
});

describe("debtsToCsv", () => {
  const HEADER = '"Customer","Item","Amount (RM)","Date","Status","Source","Invoice ID"';

  it("starts with a UTF-8 byte order mark, then the header", () => {
    const csv = debtsToCsv([], {});
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(HEADER);
  });

  it("quotes every cell in the header and debt rows", () => {
    const csv = debtsToCsv(DEBTS.slice(0, 2), { a: "INV2-123" });
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe('"X","Shop items","10.00","2026-10-01","overdue","manual","INV2-123"');
    expect(lines[2]).toBe('"X","Shop items","5.00","2026-10-01","overdue","manual",""');
  });

  it("words a blank item with the t it is given", () => {
    const t = ((key: string) => (key === "ledger.noItem" ? "Barang kedai" : key)) as T;
    expect(debtsToCsv([d("a", "unpaid", 100)], {}, t)).toContain('"Barang kedai"');
  });

  it.each(["=", "+", "-", "@", "\t", "\r"])("prefixes a cell starting with %j so it isn't run as a formula", (start) => {
    const debt = { ...d("a", "unpaid", 100), customerName: `${start}HYPERLINK("x")` };
    const row = debtsToCsv([debt]).slice(1).split("\r\n")[1];
    expect(row.startsWith(`"'${start}HYPERLINK(""x"")"`)).toBe(true);
  });

  it.each(["  =1+1", " +SUM(A1)", "\u00a0-2", "\n@cmd"])("prefixes %j, whose first non-space character starts a formula", (value) => {
    expect(csvCell(value)).toBe(`"'${value}"`);
  });

  it("doesn't prefix leading spaces before ordinary text", () => {
    expect(csvCell("  Ah Seng")).toBe('"  Ah Seng"');
  });

  it("leaves a formula character in the middle of a cell alone", () => {
    expect(csvCell("Ah Seng = 2kg")).toBe('"Ah Seng = 2kg"');
  });

  it("escapes quotes and keeps commas and newlines inside one quoted cell", () => {
    const debt = { ...d("a", "unpaid", 100), customerName: 'Kedai "Ali", Jalan 1', item: "Milo\nGula" };
    const csv = debtsToCsv([debt]);
    expect(csv).toContain('"Kedai ""Ali"", Jalan 1","Milo\nGula"');
  });
});

describe("latestInvoiceByDebt", () => {
  it("maps each debt to its newest invoice", () => {
    const inv = (id: string, sentAt: string, debtIds: string[]) =>
      ({ id, sentAt, debtIds, customerName: "A", slug: "a", email: "a@x.co", amountSen: 100 }) as InvoiceRecord;
    const map = latestInvoiceByDebt([inv("NEW", "2026-10-09T00:00:00Z", ["d1"]), inv("OLD", "2026-10-01T00:00:00Z", ["d1", "d2"])]);
    expect(map.d1.id).toBe("NEW");
    expect(map.d2.id).toBe("OLD");
    expect(latestInvoiceByDebt([])).toEqual({});
  });
});
