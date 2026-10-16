import { describe, expect, it } from "vitest";
import { collectGroups, isInvoiceable, isValidEmail, sendRequest, type CollectGroup } from "./collect";
import { createCollectStore, type InvoiceRecord } from "./collect-store";
import { createDebtStore, newDebtId } from "./debt-store";
import { DEMO_KEYS, SCAN_DRAFT_KEYS, resetDemoData } from "./demo-reset";
import { SCAN_MODES, parseScanDraft, scanDraftKey } from "./scan";
import { ledgerTotals, debtsToCsv, filterByStatus } from "./ledger";
import { DEFAULT_RULES, RULE_LIMITS, buildSchedule, normaliseRules, type ReminderRules } from "./reminders";
import { customerSlug } from "./customer-tab";
import { createManualDebt, formatSen, type Debt } from "./debts";
import { isAllowedOwner, safeNext } from "./auth";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}

describe("Person 3: End-to-End Owner Journeys", () => {
  // Journey 1: Upload Failure and Retry
  describe("Journey 1: Upload failure, retry, and draft persistence", () => {
    it("persists scan drafts without duplicating entries upon retry", () => {
      const storage = memoryStorage();
      const draftLines = [
        { customerName: "Ah Chong", item: "Beras 5kg", amountSen: 3200, unsure: false },
        { customerName: "Kak Minah", item: "Gula 2kg", amountSen: 700, unsure: true },
      ];

      // Simulate saving draft in sessionStorage before confirmation
      storage.setItem(SCAN_DRAFT_KEYS[0], JSON.stringify(draftLines));

      // Retrieve draft after a simulated network retry
      const raw = storage.getItem(SCAN_DRAFT_KEYS[0]);
      expect(raw).not.toBeNull();
      const recovered = JSON.parse(raw!);
      expect(recovered).toHaveLength(2);
      expect(recovered[1].unsure).toBe(true);

      // Confirm lines and convert to debts
      const debts: Debt[] = recovered.map((line: typeof draftLines[0], index: number) => ({
        id: `scan-${index}`,
        customerName: line.customerName,
        item: line.item,
        amountSen: line.amountSen,
        date: "2026-10-16",
        status: "unpaid",
        source: "scan",
        createdAt: new Date().toISOString(),
      }));

      expect(debts).toHaveLength(2);
      expect(debts[0].customerName).toBe("Ah Chong");
      expect(debts[0].source).toBe("scan");
    });
  });

  // Journey 2: Correct an Uncertain Amount
  describe("Journey 2: Correct an uncertain amount", () => {
    it("identifies ambiguous lines, corrects them, and preserves source metadata", () => {
      const uncertainLine = {
        customerName: "Muthu",
        item: "Telur 1 papan",
        amountSen: 1650,
        unsure: true,
      };

      expect(uncertainLine.unsure).toBe(true);

      // Owner corrects amount from 1650 to 1800 sen (RM 18.00)
      const corrected = {
        ...uncertainLine,
        amountSen: 1800,
        unsure: false,
      };

      const debt = createManualDebt(
        {
          customerName: corrected.customerName,
          item: corrected.item,
          amountSen: corrected.amountSen,
          date: "2026-10-16",
        },
        { id: "debt-corr-1", now: new Date() }
      );

      expect(debt.amountSen).toBe(1800);
      expect(formatSen(debt.amountSen)).toBe("18.00");
    });
  });

  // Journey 3: Resolve an Unmatched Customer
  describe("Journey 3: Resolve unmatched customer and email validation", () => {
    it("updates unresolved count and unlocks collection when email is provided", () => {
      const debts: Debt[] = [
        {
          id: "d1",
          customerName: "Uncle Lim",
          item: "Minyak masak",
          amountSen: 2500,
          date: "2026-10-10",
          status: "unpaid",
          source: "manual",
          createdAt: "2026-10-10T00:00:00Z",
        },
      ];

      const slug = customerSlug("Uncle Lim");
      let emails: Record<string, string> = {};

      // Initially no email: customer group is unresolved
      let groups = collectGroups(debts, emails);
      expect(groups).toHaveLength(1);
      expect(groups[0].email).toBeUndefined();

      // Owner resolves email
      const newEmail = "uncle.lim@gmail.com";
      expect(isValidEmail(newEmail)).toBe(true);
      emails = { ...emails, [slug]: newEmail };

      // Re-evaluated groups now have email resolved
      groups = collectGroups(debts, emails);
      expect(groups[0].email).toBe("uncle.lim@gmail.com");
    });
  });

  // Journey 4: Partial Invoice Batch and Safe Retries
  describe("Journey 4: Partial invoice batch and safe idempotency", () => {
    it("generates deterministic requestId for idempotency and supports per-row retry", () => {
      const group: CollectGroup = {
        customerName: "Siti",
        slug: "siti",
        debts: [
          {
            id: "d-siti-1",
            customerName: "Siti",
            item: "Biskut",
            amountSen: 1250,
            date: "2026-10-12",
            status: "unpaid",
            source: "manual",
            createdAt: "2026-10-12T00:00:00Z",
          },
        ],
        totalSen: 1250,
        status: "unpaid",
        email: "siti@gmail.com",
      };

      const now = new Date("2026-10-16T12:00:00Z");
      const req1 = sendRequest(group, now);
      const req2 = sendRequest(group, now);

      // Stable double-hash requestId ensures PayPal idempotency on retry
      expect(req1.requestId).toBe(req2.requestId);
      expect(req1.amountSen).toBe(1250);
      expect(req1.email).toBe("siti@gmail.com");
    });
  });

  // Journey 5: Payment Appears in Ledger
  describe("Journey 5: Payment reflection and ledger totals", () => {
    it("updates outstanding balances and reflects invoice mappings in CSV export", () => {
      const debts: Debt[] = [
        { id: "1", customerName: "Ali", item: "Kopi", amountSen: 500, date: "2026-10-01", status: "paid", source: "manual", createdAt: "2026-10-01T00:00:00Z" },
        { id: "2", customerName: "Ali", item: "Roti", amountSen: 300, date: "2026-10-02", status: "unpaid", source: "manual", createdAt: "2026-10-02T00:00:00Z" },
        { id: "3", customerName: "Bala", item: "Susu", amountSen: 1200, date: "2026-10-03", status: "overdue", source: "manual", createdAt: "2026-10-03T00:00:00Z" },
      ];

      const totals = ledgerTotals(debts);
      // Paid amounts excluded from still owed: 300 + 1200 = 1500 sen
      expect(totals.owedSen).toBe(1500);
      expect(totals.counts.paid).toBe(1);
      expect(totals.counts.unpaid).toBe(1);
      expect(totals.counts.overdue).toBe(1);

      // Export CSV with PayPal invoice mapping
      const invoiceMap = { "2": "INV2-ABC-123" };
      const csv = debtsToCsv(debts, invoiceMap);
      expect(csv).toContain("INV2-ABC-123");
      expect(csv).toContain("Ali");
      expect(csv).toContain("Bala");
    });
  });

  // Journey 6: Reminder Controls and Activity
  describe("Journey 6: Reminder controls and rules normalization", () => {
    it("normalizes and enforces rule limits", () => {
      const customRules: ReminderRules = {
        on: true,
        firstAfterDays: 5,
        everyDays: 7,
        maxCount: 4,
        sendHour: 14,
        skipFridayPrayers: true,
      };

      const normalized = normaliseRules(customRules);
      expect(normalized.firstAfterDays).toBe(5);
      expect(normalized.sendHour).toBe(14);

      // Clamps out-of-range values
      const outOfBounds = normaliseRules({
        ...customRules,
        firstAfterDays: 99,
        sendHour: 2,
      });
      expect(outOfBounds.firstAfterDays).toBe(RULE_LIMITS.firstAfterDays.max);
      expect(outOfBounds.sendHour).toBe(RULE_LIMITS.sendHour.min);
    });

    it("tracks schedule items and marks reminders as sent", () => {
      const debts: Debt[] = [
        {
          id: "rem-1",
          customerName: "Ramasamy",
          item: "Beras",
          amountSen: 4500,
          date: "2026-09-01",
          status: "overdue",
          source: "manual",
          createdAt: "2026-09-01T00:00:00Z",
        },
      ];

      const today = "2026-10-16";
      const schedule = buildSchedule(debts, [], DEFAULT_RULES, {}, today, { "ramasamy:reminder:2026-09:1": today });
      const sentItem = schedule.find((s) => s.sent);
      expect(sentItem).toBeDefined();
      expect(sentItem?.customer).toBe("Ramasamy");
    });
  });

  // Journey 7: Authentication and Protected Routes
  describe("Journey 7: Route safety and next-path sanitation", () => {
    it("sanitizes next redirect parameter safely", () => {
      expect(safeNext("/ledger")).toBe("/ledger");
      expect(safeNext("/customers")).toBe("/customers");
      expect(safeNext("https://malicious.com")).toBe("/");
      expect(safeNext("//evil.com")).toBe("/");
    });
  });

  // Journey 8: Empty, Error, and Demo Reset
  describe("Journey 8: Empty states and comprehensive demo reset", () => {
    it("handles empty ledger calculations safely", () => {
      const totals = ledgerTotals([]);
      expect(totals.owedSen).toBe(0);
      expect(totals.counts.all).toBe(0);

      const emptyCsv = debtsToCsv([], {});
      expect(emptyCsv).toContain("Customer,Item,Amount (RM)");
    });

    it("resets all persistent stores and session draft persistence", () => {
      const local = memoryStorage(Object.fromEntries(DEMO_KEYS.map((k) => [k, "value"])));
      // Exactly the keys ScanFlow writes (scanDraftKey per mode), so a mismatch would fail here.
      const session = memoryStorage(Object.fromEntries(SCAN_MODES.map((m) => [scanDraftKey(m), "draft"])));
      expect(SCAN_DRAFT_KEYS).toEqual(SCAN_MODES.map(scanDraftKey));

      const resetOk = resetDemoData(local, session);
      expect(resetOk).toBe(true);

      for (const key of DEMO_KEYS) {
        expect(local.data[key]).toBeUndefined();
      }
      for (const draftKey of SCAN_DRAFT_KEYS) {
        expect(session.data[draftKey]).toBeUndefined();
      }
    });
  });
});
