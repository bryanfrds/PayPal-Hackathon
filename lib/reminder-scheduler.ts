// Person 1 Reminder Orchestration Scheduler
import type { Person1Store } from "./person1-store";
import type { ReminderDecision } from "./person1-types";

export type InvoiceCandidate = {
  id: string;
  customerName: string;
  dueDate: string;
  amountSen: number;
  status: string;
  settlement: "paid" | "open" | "closed" | "check";
};

export type SchedulerDeps = {
  store: Person1Store;
  now?: Date;
  getInvoices: () => Promise<InvoiceCandidate[]>;
  sendReminder: (invoiceId: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
};

export type SchedulerProcessResult = {
  requested: ReminderDecision[];
  pendingApproval: ReminderDecision[];
  skipped: Array<{ invoiceId: string; reason: string }>;
  failed: ReminderDecision[];
};

function daysBetween(fromDay: string, toDay: string): number {
  const d1 = new Date(`${fromDay}T00:00:00Z`).getTime();
  const d2 = new Date(`${toDay}T00:00:00Z`).getTime();
  return Math.floor((d2 - d1) / (24 * 60 * 60 * 1000));
}

export async function processEligibleReminders(
  ownerEmail: string,
  deps: SchedulerDeps,
): Promise<SchedulerProcessResult> {
  const { store, getInvoices, sendReminder } = deps;
  const now = deps.now || new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay(); // 5 = Friday

  const rules = await store.getReminderRules(ownerEmail);
  const result: SchedulerProcessResult = {
    requested: [],
    pendingApproval: [],
    skipped: [],
    failed: [],
  };

  if (!rules.enabled) {
    result.skipped.push({ invoiceId: "all", reason: "Reminders are disabled by owner rules." });
    return result;
  }

  // Friday prayer suppression: Friday between 12:00 and 14:59 UTC/local
  if (rules.skipFridayPrayers && dayOfWeek === 5 && hour >= 12 && hour < 15) {
    result.skipped.push({ invoiceId: "all", reason: "Suppressed during Friday prayer hours (12:00-15:00)." });
    return result;
  }

  const invoices = await getInvoices();
  const priorDecisions = await store.listReminderDecisions(ownerEmail, 500);

  for (const inv of invoices) {
    // Check settlement: skip paid, closed, or check
    if (inv.settlement === "paid" || inv.status === "PAID") {
      result.skipped.push({ invoiceId: inv.id, reason: "Invoice is already paid or settled." });
      continue;
    }

    if (inv.settlement === "closed") {
      result.skipped.push({ invoiceId: inv.id, reason: "Invoice was cancelled or refunded." });
      continue;
    }

    // Overdue days check
    const overdueDays = daysBetween(inv.dueDate, todayStr);
    if (overdueDays < rules.firstAfterDays) {
      result.skipped.push({
        invoiceId: inv.id,
        reason: `Only ${overdueDays} days overdue, below first after days threshold (${rules.firstAfterDays}).`,
      });
      continue;
    }

    // History check for this invoice
    const invDecisions = priorDecisions.filter(
      (d) => d.invoiceId === inv.id && (d.action === "requested" || d.action === "pending_approval"),
    );

    const attemptsCount = invDecisions.length;
    if (attemptsCount >= rules.maxAttempts) {
      result.skipped.push({
        invoiceId: inv.id,
        reason: `Reached maximum allowed reminder attempts (${rules.maxAttempts}).`,
      });
      continue;
    }

    // Interval check from last reminder
    if (invDecisions.length > 0) {
      const lastAttempt = invDecisions[0]; // sorted newest first
      const lastDay = lastAttempt.createdAt.slice(0, 10);
      const gapDays = daysBetween(lastDay, todayStr);
      if (gapDays < rules.minIntervalDays) {
        result.skipped.push({
          invoiceId: inv.id,
          reason: `Only ${gapDays} days since last reminder, below minimum interval (${rules.minIntervalDays} days).`,
        });
        continue;
      }
    }

    const nextAttemptNum = attemptsCount + 1;
    const idempotencyKey = `remind:${ownerEmail}:${inv.id}:${nextAttemptNum}:${todayStr}`;

    // Approval requirement
    if (rules.requireApproval) {
      const decision: ReminderDecision = {
        id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerEmail,
        invoiceId: inv.id,
        action: "pending_approval",
        reason: `Pending owner approval for attempt #${nextAttemptNum}`,
        idempotencyKey,
        attemptNumber: nextAttemptNum,
        createdAt: now.toISOString(),
      };
      await store.saveReminderDecision(decision);
      result.pendingApproval.push(decision);
      continue;
    }

    // Safe execution delegating to Person 2
    try {
      const delivery = await sendReminder(inv.id);
      if (delivery.ok) {
        const decision: ReminderDecision = {
          id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ownerEmail,
          invoiceId: inv.id,
          action: "requested",
          reason: `Eligible: ${overdueDays} days overdue, attempt #${nextAttemptNum}`,
          idempotencyKey,
          attemptNumber: nextAttemptNum,
          deliveryResult: delivery.message || "Delivered",
          createdAt: now.toISOString(),
        };
        await store.saveReminderDecision(decision);
        result.requested.push(decision);
      } else {
        const decision: ReminderDecision = {
          id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ownerEmail,
          invoiceId: inv.id,
          action: "failed",
          reason: delivery.error || "Delivery failed",
          idempotencyKey,
          attemptNumber: nextAttemptNum,
          createdAt: now.toISOString(),
        };
        await store.saveReminderDecision(decision);
        result.failed.push(decision);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Delivery error";
      const decision: ReminderDecision = {
        id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerEmail,
        invoiceId: inv.id,
        action: "failed",
        reason: errorMsg,
        idempotencyKey,
        attemptNumber: nextAttemptNum,
        createdAt: now.toISOString(),
      };
      await store.saveReminderDecision(decision);
      result.failed.push(decision);
    }
  }

  return result;
}
