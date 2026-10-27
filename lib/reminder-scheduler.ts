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
  enforceSendHour?: boolean;
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
  if (!fromDay || !toDay) return NaN;
  const d1 = new Date(`${fromDay.slice(0, 10)}T00:00:00Z`).getTime();
  const d2 = new Date(`${toDay.slice(0, 10)}T00:00:00Z`).getTime();
  if (isNaN(d1) || isNaN(d2)) return NaN;
  return Math.floor((d2 - d1) / (24 * 60 * 60 * 1000));
}

function getLocalShopTime(date: Date): { dayStr: string; hour: number; dayOfWeek: number } {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const dayStr = `${map.year}-${map.month}-${map.day}`;
    const hour = parseInt(map.hour || "0", 10);
    const dayOfWeek = new Date(`${dayStr}T12:00:00Z`).getUTCDay();
    return { dayStr, hour, dayOfWeek };
  } catch {
    // Fallback if timezone formatting fails
    const utcDay = date.toISOString().slice(0, 10);
    return { dayStr: utcDay, hour: date.getUTCHours(), dayOfWeek: date.getUTCDay() };
  }
}

export async function processEligibleReminders(
  ownerEmail: string,
  deps: SchedulerDeps,
): Promise<SchedulerProcessResult> {
  const { store, getInvoices, sendReminder } = deps;
  const now = deps.now || new Date();
  const { dayStr: todayStr, hour, dayOfWeek } = getLocalShopTime(now);

  const rules = await store.getReminderRules(ownerEmail);
  const result: SchedulerProcessResult = {
    requested: [],
    pendingApproval: [],
    skipped: [],
    failed: [],
  };

  const recordSkip = (invoiceId: string, reason: string) => {
    result.skipped.push({ invoiceId, reason });
  };

  if (!rules.enabled) {
    recordSkip("all", "Reminders are disabled by owner rules.");
    return result;
  }

  // Friday prayer suppression: Friday between 12:00 and 14:59 Malaysian time (Asia/Kuala_Lumpur)
  if (rules.skipFridayPrayers && dayOfWeek === 5 && hour >= 12 && hour < 15) {
    recordSkip("all", "Suppressed during Friday prayer hours (12:00-15:00).");
    return result;
  }

  if (deps.enforceSendHour && hour !== rules.sendHour) {
    recordSkip("all", `Outside the configured reminder hour (${rules.sendHour}:00 Malaysia time).`);
    return result;
  }

  const invoices = await getInvoices();
  const priorDecisions = await store.listReminderDecisions(ownerEmail, 1000);

  for (const inv of invoices) {
    // Check settlement: skip paid, closed, or check
    if (inv.settlement === "paid" || inv.status === "PAID") {
      recordSkip(inv.id, "Invoice is already paid or settled.");
      continue;
    }

    if (inv.settlement === "closed") {
      recordSkip(inv.id, "Invoice was cancelled or refunded.");
      continue;
    }

    // Overdue days check
    const overdueDays = daysBetween(inv.dueDate, todayStr);
    if (isNaN(overdueDays) || overdueDays < rules.firstAfterDays) {
      recordSkip(inv.id, isNaN(overdueDays)
        ? "Invalid or missing due date on invoice."
        : `Only ${overdueDays} days overdue, below first after days threshold (${rules.firstAfterDays}).`);
      continue;
    }

    // History check for this invoice
    const invDecisions = priorDecisions.filter((d) => d.invoiceId === inv.id);

    const attemptsCount = invDecisions.length;
    if (attemptsCount >= rules.maxAttempts) {
      recordSkip(inv.id, `Reached maximum allowed reminder attempts (${rules.maxAttempts}).`);
      continue;
    }

    // Interval check from last reminder
    if (invDecisions.length > 0) {
      const lastAttempt = invDecisions[0]; // sorted newest first
      const lastDay = lastAttempt.createdAt.slice(0, 10);
      const gapDays = daysBetween(lastDay, todayStr);
      if (gapDays < rules.minIntervalDays) {
        recordSkip(inv.id, `Only ${gapDays} days since last reminder, below minimum interval (${rules.minIntervalDays} days).`);
        continue;
      }
    }

    const nextAttemptNum = attemptsCount + 1;
    const idempotencyKey = `remind:${ownerEmail.trim().toLowerCase()}:${inv.id}:${nextAttemptNum}:${todayStr}`;

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
      if (!(await store.claimReminderRequest(decision))) {
        result.skipped.push({ invoiceId: inv.id, reason: "Reminder request was already claimed by another job." });
        continue;
      }
      result.pendingApproval.push(decision);
      continue;
    }

    const claimedDecision: ReminderDecision = {
      id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ownerEmail,
      invoiceId: inv.id,
      action: "requested",
      reason: `Eligible: ${overdueDays} days overdue, attempt #${nextAttemptNum}`,
      idempotencyKey,
      attemptNumber: nextAttemptNum,
      deliveryResult: "Claimed for delivery",
      createdAt: now.toISOString(),
    };
    if (!(await store.claimReminderRequest(claimedDecision))) {
      result.skipped.push({ invoiceId: inv.id, reason: "Reminder request was already claimed by another job." });
      continue;
    }

    // Safe execution delegating to Person 2
    try {
      const delivery = await sendReminder(inv.id);
      if (delivery.ok) {
        await store.updateReminderDecisionAction(ownerEmail, claimedDecision.id, "requested", delivery.message || "Delivered");
        result.requested.push({ ...claimedDecision, deliveryResult: delivery.message || "Delivered" });
      } else {
        const failed = { ...claimedDecision, action: "failed" as const, reason: delivery.error || "Delivery failed" };
        await store.updateReminderDecisionAction(ownerEmail, claimedDecision.id, "failed", failed.reason);
        result.failed.push(failed);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Delivery error";
      const failed = { ...claimedDecision, action: "failed" as const, reason: errorMsg };
      await store.updateReminderDecisionAction(ownerEmail, claimedDecision.id, "failed", errorMsg);
      result.failed.push(failed);
    }
  }

  return result;
}
