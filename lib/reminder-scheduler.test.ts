import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryPerson1Store, type Person1Store } from "./person1-store";
import { processEligibleReminders, type SchedulerDeps } from "./reminder-scheduler";

describe("reminder-scheduler", () => {
  let store: Person1Store;
  const owner = "owner@example.com";
  const now = new Date("2026-10-18T02:00:00Z"); // Sunday 10am Malaysian time

  beforeEach(() => {
    store = createMemoryPerson1Store();
  });

  function makeDeps(overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
    return {
      store,
      now,
      getInvoices: async () => [
        {
          id: "INV-1",
          customerName: "Pak Ali",
          dueDate: "2026-10-10", // 8 days ago
          amountSen: 3600,
          status: "SENT",
          settlement: "open",
        },
      ],
      sendReminder: vi.fn().mockResolvedValue({ ok: true, message: "Reminder sent via PayPal" }),
      ...overrides,
    };
  }

  it("requests reminder for eligible overdue invoice", async () => {
    const deps = makeDeps();
    const result = await processEligibleReminders(owner, deps);

    expect(result.requested).toHaveLength(1);
    expect(result.requested[0].invoiceId).toBe("INV-1");
    expect(deps.sendReminder).toHaveBeenCalledWith("INV-1");

    const decisions = await store.listReminderDecisions(owner);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("requested");
  });

  it("atomically prevents concurrent jobs from sending the same reminder twice", async () => {
    const deps = makeDeps();
    await Promise.all([processEligibleReminders(owner, deps), processEligibleReminders(owner, deps)]);
    expect(deps.sendReminder).toHaveBeenCalledTimes(1);
  });

  it("skips paid or settled invoices", async () => {
    const deps = makeDeps({
      getInvoices: async () => [
        {
          id: "INV-PAID",
          customerName: "Pak Ali",
          dueDate: "2026-10-10",
          amountSen: 3600,
          status: "PAID",
          settlement: "paid",
        },
      ],
    });

    const result = await processEligibleReminders(owner, deps);
    expect(result.requested).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/paid|settled/i);
    expect(deps.sendReminder).not.toHaveBeenCalled();
    expect(await store.listReminderDecisions(owner)).toEqual([
      expect.objectContaining({ invoiceId: "INV-PAID", action: "skipped", attemptNumber: 1 }),
    ]);
  });

  it("only runs during the configured Malaysian reminder hour", async () => {
    const result = await processEligibleReminders(owner, makeDeps({ now: new Date("2026-10-18T03:00:00Z"), enforceSendHour: true }));
    expect(result.requested).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/configured reminder hour/i);
  });

  it("skips invoice before firstAfterDays has elapsed", async () => {
    const deps = makeDeps({
      getInvoices: async () => [
        {
          id: "INV-RECENT",
          customerName: "Ah Seng",
          dueDate: "2026-10-17", // Only 1 day ago (rules require 3)
          amountSen: 2000,
          status: "SENT",
          settlement: "open",
        },
      ],
    });

    const result = await processEligibleReminders(owner, deps);
    expect(result.requested).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/first after days/i);
  });

  it("respects maxAttempts limit and minIntervalDays between reminders", async () => {
    // Record a reminder sent yesterday
    await store.saveReminderDecision({
      id: "dec-prev",
      ownerEmail: owner,
      invoiceId: "INV-1",
      action: "requested",
      reason: "Eligible",
      idempotencyKey: "k-1",
      attemptNumber: 1,
      createdAt: "2026-10-17T10:00:00Z", // 1 day ago (min interval is 4)
    });

    const deps = makeDeps();
    const result = await processEligibleReminders(owner, deps);
    expect(result.requested).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/interval/i);
  });

  it("uses the invoice's complete attempt history even after 1,000 newer unrelated decisions", async () => {
    await store.saveReminderDecision({
      id: "dec-target",
      ownerEmail: owner,
      invoiceId: "INV-1",
      action: "requested",
      reason: "Eligible",
      idempotencyKey: "target-attempt",
      attemptNumber: 1,
      createdAt: "2026-10-17T10:00:00Z",
    });
    for (let index = 0; index < 1001; index += 1) {
      await store.saveReminderDecision({
        id: `dec-unrelated-${index}`,
        ownerEmail: owner,
        invoiceId: `INV-OTHER-${index}`,
        action: "skipped",
        reason: "Not eligible",
        idempotencyKey: `unrelated-${index}`,
        attemptNumber: 1,
        createdAt: `2026-10-18T01:${String(index % 60).padStart(2, "0")}:00Z`,
      });
    }

    const deps = makeDeps();
    const result = await processEligibleReminders(owner, deps);

    expect(result.requested).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/interval/i);
    expect(deps.sendReminder).not.toHaveBeenCalled();
  });

  it("counts a failed delivery as an attempt", async () => {
    await store.saveReminderDecision({
      id: "dec-failed",
      ownerEmail: owner,
      invoiceId: "INV-1",
      action: "failed",
      reason: "Delivery failed",
      idempotencyKey: "k-failed",
      attemptNumber: 1,
      createdAt: "2026-10-17T10:00:00Z",
    });

    const result = await processEligibleReminders(owner, makeDeps());

    expect(result.requested).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/interval/i);
  });

  it("audits a policy skip without consuming the next delivery attempt and deduplicates hourly runs", async () => {
    const recent = makeDeps({
      getInvoices: async () => [{ id: "INV-RECENT", customerName: "Ali", dueDate: "2026-10-17", amountSen: 1000, status: "SENT", settlement: "open" }],
    });
    await processEligibleReminders(owner, recent);
    await processEligibleReminders(owner, recent);
    expect(await store.listReminderDecisions(owner)).toEqual([
      expect.objectContaining({ invoiceId: "INV-RECENT", action: "skipped", attemptNumber: 1 }),
    ]);

    const later = await processEligibleReminders(owner, makeDeps({ now: new Date("2026-10-19T02:00:00Z") }));
    expect(later.requested[0].attemptNumber).toBe(1);
  });

  it("creates pending_approval decision when owner requires approval", async () => {
    await store.setReminderRules({
      ownerEmail: owner,
      enabled: true,
      firstAfterDays: 3,
      minIntervalDays: 4,
      maxAttempts: 3,
      sendHour: 10,
      skipFridayPrayers: true,
      requireApproval: true,
      updatedAt: "2026-10-18T00:00:00Z",
    });

    const deps = makeDeps();
    const result = await processEligibleReminders(owner, deps);
    expect(result.pendingApproval).toHaveLength(1);
    expect(result.requested).toHaveLength(0);
    expect(deps.sendReminder).not.toHaveBeenCalled();
  });

  it("keeps one pending approval per invoice across later scheduler days", async () => {
    await store.setReminderRules({
      ownerEmail: owner,
      enabled: true,
      firstAfterDays: 3,
      minIntervalDays: 4,
      maxAttempts: 3,
      sendHour: 10,
      skipFridayPrayers: true,
      requireApproval: true,
      updatedAt: "2026-10-18T00:00:00Z",
    });

    await processEligibleReminders(owner, makeDeps());
    const later = await processEligibleReminders(owner, makeDeps({ now: new Date("2026-10-19T02:00:00Z") }));
    const pending = (await store.listReminderDecisions(owner)).filter((decision) => decision.action === "pending_approval");

    expect(pending).toHaveLength(1);
    expect(later.pendingApproval).toHaveLength(0);
    expect(later.skipped[0].reason).toMatch(/pending approval/i);
  });

  it("defers reminders during Friday prayers (Friday 12:00-14:59)", async () => {
    const fridayNoon = new Date("2026-10-16T13:00:00+08:00"); // Friday 1pm Malaysian time
    const deps = makeDeps({ now: fridayNoon });

    const result = await processEligibleReminders(owner, deps);
    expect(result.requested).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/friday prayer/i);
  });
});
