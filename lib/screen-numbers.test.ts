// Every screen shows the same overdue and not-invoiced numbers for the demo data: the sample
// tabs a first visit (or Settings → Reset demo data) starts from. A judge flips between Home,
// the ledger, Collect, Customers, Insights and a customer's own page; none may disagree.

import { describe, expect, it } from "vitest";
import { SAMPLE_DEBTS, SAMPLE_EMAILS } from "@/app/ledger/sample-data";
import { collectGroups } from "./collect";
import { customerTab } from "./customer-tab";
import { customerRows, customerTotals } from "./customers";
import { homeOverview, owedBoard } from "./home";
import { toInsightRows } from "./insights";
import { filterByStatus, ledgerTotals } from "./ledger";
import { buildNudgeContext } from "./nudge";
import { DEFAULT_RULES, buildSchedule } from "./reminders";
import { notInvoicedTally, overdueTally } from "./tab-status";

const TODAY = "2026-10-20";
const debts = SAMPLE_DEBTS;
const schedule = buildSchedule(debts, [], DEFAULT_RULES, {}, TODAY);
const home = homeOverview(debts, schedule, TODAY);
const ledger = ledgerTotals(debts, TODAY);
const groups = collectGroups(debts, SAMPLE_EMAILS, {}, TODAY);
const customers = customerRows(debts, SAMPLE_EMAILS, new Map(), {}, TODAY);
const insights = toInsightRows(debts, TODAY);
const sumSen = (rows: { amount: number }[]) => Math.round(rows.reduce((s, r) => s + r.amount * 100, 0));

describe("demo data: overdue", () => {
  const overdue = overdueTally(debts, TODAY);

  it("is 4 tabs, RM 146.80, on the shared rule", () => {
    expect(overdue).toMatchObject({ tabs: 4, sen: 14680 });
    expect(overdue.names).toEqual(["Mak Cik Siti", "Pak Ali (Bengkel)", "Ah Seng", "Kak Lina"]);
  });

  it("matches on Home, the ledger's Overdue chip, Insights and Customers", () => {
    expect([home.overdueTabs, home.overdueSen]).toEqual([4, 14680]);
    expect([ledger.counts.overdue, ledger.sen.overdue]).toEqual([4, 14680]);
    expect(filterByStatus(debts, "overdue", TODAY)).toHaveLength(4);
    const lateRows = insights.filter((r) => r.overdue === 1);
    expect([lateRows.length, sumSen(lateRows)]).toEqual([4, 14680]);
    expect(customers.reduce((n, c) => n + c.overdueCount, 0)).toBe(4);
  });

  it("shows Kak Lina as invoice sent and late everywhere, never one or the other", () => {
    const lina = owedBoard(debts, TODAY).find((r) => r.slug === "kak-lina")!;
    expect(lina).toMatchObject({ status: "overdue", daysLate: 10, next: "remind" });
    const row = customers.find((c) => c.slug === "kak-lina")!;
    expect(row).toMatchObject({ sentCount: 1, overdueCount: 1, notInvoicedCount: 1 });
    const t1004 = debts.find((d) => d.id === "T-1004")!;
    expect(filterByStatus(debts, "sent", TODAY)).toContain(t1004);
    expect(filterByStatus(debts, "overdue", TODAY)).toContain(t1004);
    expect(insights.find((r) => r.customer === "Kak Lina" && r.item.startsWith("Telur"))).toMatchObject({ status: "Invoice sent", overdue: 1 });
    // Her own page: September's bill is overdue.
    expect(customerTab(debts, "kak-lina", TODAY)?.toPay.map((b) => [b.month, b.status])).toEqual([
      ["2026-09", "overdue"],
      ["2026-10", "due"],
    ]);
  });
});

describe("demo data: not invoiced", () => {
  const waiting = notInvoicedTally(debts);

  it("is 7 tabs, RM 165.50, from 7 customers", () => {
    expect(waiting).toMatchObject({ tabs: 7, sen: 16550, customers: 7 });
  });

  it("matches Home's to-do, the ledger's Not sent chip and button, Collect and Customers", () => {
    expect(home.notInvoiced).toMatchObject({ count: 7, sen: 16550, customers: 7 });
    expect([ledger.counts.unpaid, ledger.sen.unpaid]).toEqual([7, 16550]);
    // Collect's hero ("Ready to invoice", "7 customers not invoiced yet") and the ledger's
    // "Invoice 7 customers" button both come from collectGroups.
    expect(groups).toHaveLength(7);
    expect(groups.reduce((s, g) => s + g.totalSen, 0)).toBe(16550);
    expect(customerTotals(customers).readyToInvoice).toBe(7);
    expect(groups.map((g) => g.slug).sort()).toEqual(customers.filter((c) => c.notInvoicedCount > 0).map((c) => c.slug).sort());
  });

  it("sends Mak Cik Siti and Pak Ali to Collect, not Reminders: they have no invoice yet", () => {
    const board = owedBoard(debts, TODAY);
    for (const slug of ["mak-cik-siti", "pak-ali-bengkel"]) {
      expect(board.find((r) => r.slug === slug)).toMatchObject({ status: "overdue", next: "invoice" });
      expect(groups.some((g) => g.slug === slug)).toBe(true);
      expect(schedule.some((i) => i.slug === slug)).toBe(false);
    }
    expect(home.remindNow).toEqual(["Kak Lina"]);
    const nudge = buildNudgeContext("Kedai", debts, [], schedule, TODAY);
    expect(nudge.customers.find((c) => c.slug === "mak-cik-siti")?.status).toBe("Not sent");
  });
});

describe("demo data: totals agree", () => {
  it("still owed is the same on Home, the ledger and Customers", () => {
    expect(home.owedSen).toBe(ledger.owedSen);
    expect(customerTotals(customers).owedSen).toBe(home.owedSen);
    // Invoice sent and Not sent split what's owed; Overdue sits inside it.
    expect(ledger.sen.sent + ledger.sen.unpaid).toBe(ledger.owedSen);
  });
});
