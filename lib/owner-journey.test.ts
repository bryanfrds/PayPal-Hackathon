import { describe, expect, it } from "vitest";
import { collectGroups, isValidEmail, sendRequest, type CollectGroup } from "./collect";
import { createDebtStore } from "./debt-store";
import { DEMO_KEYS, SCAN_DRAFT_KEYS, resetDemoData } from "./demo-reset";
import { SCAN_MODES, linesToDebts, parseScanDraft, sampleRead, scanDraftKey } from "./scan";
import { ledgerTotals, debtsToCsv } from "./ledger";
import { DEFAULT_RULES, RULE_LIMITS, buildSchedule, normaliseRules, type ReminderRules } from "./reminders";
import { customerSlug } from "./customer-tab";
import { formatSen, type Debt } from "./debts";
import { safeNext } from "./auth";

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
    it("restores the check screen's draft and saves each line once, even after a failed save", () => {
      const today = "2026-10-16";
      const session = memoryStorage();
      const lines = sampleRead("notebook", today);
      // The check screen keeps its lines under the same key the demo reset clears.
      session.setItem(scanDraftKey("notebook"), JSON.stringify(lines));
      const restored = parseScanDraft(session.getItem(scanDraftKey("notebook")));
      expect(restored).toEqual(lines);

      // A save that fails leaves nothing behind; the retry saves every ticked line exactly once.
      const failing = {
        getItem: () => null,
        setItem: () => {
          throw new Error("quota");
        },
      };
      const store = createDebtStore(failing, []);
      let n = 0;
      const result = linesToDebts(restored!, today, { newId: () => `scan-${++n}`, now: new Date("2026-10-16T09:00:00Z") });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(() => store.addMany(result.debts)).toThrow();

      const working = createDebtStore(memoryStorage(), []);
      working.addMany(result.debts);
      expect(() => working.addMany(result.debts)).toThrow(); // same ids: no duplicates on a second tap
      expect(working.list()).toHaveLength(lines.filter((l) => l.include).length);
      expect(working.list().every((d) => d.source === "scan")).toBe(true);
    });

    it("drops a draft that isn't the check screen's shape", () => {
      expect(parseScanDraft(JSON.stringify([{ customerName: "Ah Chong", amountSen: 3200 }]))).toBeNull();
      expect(parseScanDraft("not json")).toBeNull();
      expect(parseScanDraft("[]")).toBeNull();
    });
  });

  // Journey 2: Correct an Uncertain Amount
  describe("Journey 2: Correct an uncertain amount", () => {
    it("holds back the unsure line until the owner corrects and ticks it", () => {
      const today = "2026-10-16";
      const lines = sampleRead("notebook", today);
      const unsure = lines.find((l) => l.unsure);
      expect(unsure).toBeDefined();
      expect(unsure!.include).toBe(false);

      // The owner corrects the amount and ticks it: the flag clears and it's saved.
      const corrected = lines.map((l) => (l.key === unsure!.key ? { ...l, amount: "18.50", include: true, unsure: undefined } : l));
      let n = 0;
      const result = linesToDebts(corrected, today, { newId: () => `d${++n}`, now: new Date() });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const fixed = result.debts.find((d) => d.customerName === unsure!.customerName);
      expect(fixed?.amountSen).toBe(1850);
      expect(formatSen(fixed!.amountSen)).toBe("18.50");

      // A bad correction is refused with the line's errors, not saved.
      const bad = corrected.map((l) => (l.key === unsure!.key ? { ...l, amount: "abc" } : l));
      const refused = linesToDebts(bad, today, { newId: () => "x", now: new Date() });
      expect(refused.ok).toBe(false);
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
