import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true, email: "owner@example.com" }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: signedIn.email, method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

const payments = vi.hoisted(() => ({
  listOwnerInvoices: vi.fn(), getOwnerInvoice: vi.fn(), claimReminder: vi.fn(), releaseReminder: vi.fn(),
}));
vi.mock("@/lib/payment-db", () => ({ paymentDb: () => payments }));

const remindMock = vi.hoisted(() => ({
  deliverScheduledReminder: vi.fn(),
}));
vi.mock("@/lib/remind", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/remind")>();
  return { ...actual, deliverScheduledReminder: remindMock.deliverScheduledReminder };
});

import { GET as getRules, PUT as updateRules } from "../reminder-rules/route";
import { GET as cronProcessReminders, POST as processReminders } from "./process/route";
import { GET as getActivity } from "./activity/route";
import { POST as approveReminder } from "./[id]/approve/route";
import { POST as rejectReminder } from "./[id]/reject/route";
import { getPerson1Store } from "@/lib/person1-store";

describe("Reminder Orchestration APIs", () => {
  const store = getPerson1Store();
  const owner = "owner@example.com";

  beforeEach(() => {
    signedIn.value = true;
    signedIn.email = owner;
    vi.resetAllMocks();
    payments.listOwnerInvoices.mockResolvedValue([]);
    remindMock.deliverScheduledReminder.mockResolvedValue({ ok: true, message: "Sent" });
  });

  it("GET & PUT /api/reminder-rules: gets and updates owner rules", async () => {
    const getRes = await getRules();
    expect(getRes.status).toBe(200);
    const initial = await getRes.json();
    expect(initial.enabled).toBe(true);

    const putReq = new Request("http://localhost:3000/api/reminder-rules", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstAfterDays: 5,
        maxAttempts: 4,
        requireApproval: true,
      }),
    });

    const putRes = await updateRules(putReq);
    expect(putRes.status).toBe(200);
    const updated = await putRes.json();
    expect(updated.firstAfterDays).toBe(5);
    expect(updated.maxAttempts).toBe(4);
    expect(updated.requireApproval).toBe(true);
  });

  it("POST /api/reminders/process & GET /api/reminders/activity: runs batch and logs activity", async () => {
    // Set rules to standard
    await store.setReminderRules({
      ownerEmail: owner,
      enabled: true,
      firstAfterDays: 2,
      minIntervalDays: 3,
      maxAttempts: 3,
      sendHour: 10,
      skipFridayPrayers: false,
      requireApproval: true,
      updatedAt: new Date().toISOString(),
    });

    payments.listOwnerInvoices.mockResolvedValue([{ id: "INV-ACT-1", ownerEmail: owner, customerName: "Pak Ali", amountSen: 3000, currency: "MYR", sentAt: "2026-10-10T00:00:00Z", status: "SENT", settlement: "open" }]);
    const processReq = new Request("http://localhost:3000/api/reminders/process", { method: "POST" });

    const processRes = await processReminders(processReq);
    expect(processRes.status).toBe(200);
    const outcome = await processRes.json();
    expect(outcome.pendingApproval).toHaveLength(1);

    const pendingId = outcome.pendingApproval[0].id;

    // Check activity log
    const actReq = new Request("http://localhost:3000/api/reminders/activity");
    const actRes = await getActivity(actReq);
    expect(actRes.status).toBe(200);
    const { activity } = await actRes.json();
    expect(activity.some((a: { id: string }) => a.id === pendingId)).toBe(true);

    // Reject the pending reminder
    const rejectReq = new Request(`http://localhost:3000/api/reminders/${pendingId}/reject`, {
      method: "POST",
    });
    const rejRes = await rejectReminder(rejectReq, { params: Promise.resolve({ id: pendingId }) });
    expect(rejRes.status).toBe(200);
    const rejData = await rejRes.json();
    expect(rejData.status).toBe("skipped");

    const updatedDec = await store.getReminderDecision(owner, pendingId);
    expect(updatedDec?.action).toBe("skipped");
  });

  it("POST /api/reminders/process with candidateInvoices: drops invoices belonging to another owner", async () => {
    await store.setReminderRules({
      ownerEmail: owner,
      enabled: true,
      firstAfterDays: 2,
      minIntervalDays: 3,
      maxAttempts: 3,
      sendHour: 10,
      skipFridayPrayers: false,
      requireApproval: false,
      updatedAt: new Date().toISOString(),
    });

    // Only INV-MINE belongs to this owner
    payments.listOwnerInvoices.mockResolvedValue([
      {
        id: "INV-MINE",
        ownerEmail: owner,
        customerName: "Pak Ali",
        amountSen: 3000,
        currency: "MYR",
        sentAt: "2026-10-01T00:00:00Z",
        status: "SENT",
        settlement: "open",
      },
    ]);

    const req = new Request("http://localhost:3000/api/reminders/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidateInvoices: [
          {
            id: "INV-MINE",
            customerName: "Pak Ali",
            dueDate: "2026-10-01",
            amountSen: 3000,
            status: "SENT",
            settlement: "open",
          },
          {
            id: "INV-OTHER-OWNER",
            customerName: "Stranger",
            dueDate: "2026-10-01",
            amountSen: 5000,
            status: "SENT",
            settlement: "open",
          },
        ],
      }),
    });

    const res = await processReminders(req);
    expect(res.status).toBe(200);
    const outcome = await res.json();
    expect(outcome.requested.map((d: { invoiceId: string }) => d.invoiceId)).toEqual(["INV-MINE"]);
    expect(remindMock.deliverScheduledReminder).toHaveBeenCalledTimes(1);
    expect(remindMock.deliverScheduledReminder).toHaveBeenCalledWith("INV-MINE");
    expect(remindMock.deliverScheduledReminder).not.toHaveBeenCalledWith("INV-OTHER-OWNER");
  });

  describe("POST /api/reminders/[id]/approve conflict handling", () => {
    it("returns 409 when the decision is no longer pending_approval and does not call delivery", async () => {
      const decId = `dec-already-handled-${Date.now()}`;
      await store.saveReminderDecision({
        id: decId,
        ownerEmail: owner,
        invoiceId: "INV-ALREADY-SENT",
        action: "requested",
        reason: "Already approved",
        idempotencyKey: `remind:${owner}:INV-ALREADY-SENT:1:2026-10-20`,
        attemptNumber: 1,
        createdAt: new Date().toISOString(),
      });

      const res = await approveReminder(
        new Request(`http://localhost:3000/api/reminders/${decId}/approve`, { method: "POST" }),
        { params: Promise.resolve({ id: decId }) },
      );
      expect(res.status).toBe(409);
      expect(remindMock.deliverScheduledReminder).not.toHaveBeenCalled();
    });

    it("returns 409 when claimPendingReminder loses a concurrent claim and does not call delivery", async () => {
      const decId = `dec-race-${Date.now()}`;
      await store.saveReminderDecision({
        id: decId,
        ownerEmail: owner,
        invoiceId: "INV-RACE-APPROVE",
        action: "pending_approval",
        reason: "Pending owner approval",
        idempotencyKey: `remind:${owner}:INV-RACE-APPROVE:1:2026-10-20`,
        attemptNumber: 1,
        createdAt: new Date().toISOString(),
      });

      const claimSpy = vi.spyOn(store, "claimPendingReminder").mockResolvedValueOnce(false);
      try {
        const res = await approveReminder(
          new Request(`http://localhost:3000/api/reminders/${decId}/approve`, { method: "POST" }),
          { params: Promise.resolve({ id: decId }) },
        );
        expect(res.status).toBe(409);
        expect(remindMock.deliverScheduledReminder).not.toHaveBeenCalled();
      } finally {
        claimSpy.mockRestore();
      }
    });
  });

  describe("GET /api/reminders/process (Cron)", () => {
    it("returns 401 when CRON_SECRET is unset or empty, even if Authorization header is supplied", async () => {
      vi.stubEnv("CRON_SECRET", "");
      try {
        const res = await cronProcessReminders(
          new Request("http://localhost:3000/api/reminders/process", {
            headers: { authorization: "Bearer some-secret" },
          }),
        );
        expect(res.status).toBe(401);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("returns 401 when Authorization header is missing or has a wrong bearer secret", async () => {
      vi.stubEnv("CRON_SECRET", "super-secret-cron-token");
      try {
        const missingRes = await cronProcessReminders(
          new Request("http://localhost:3000/api/reminders/process"),
        );
        expect(missingRes.status).toBe(401);

        const wrongRes = await cronProcessReminders(
          new Request("http://localhost:3000/api/reminders/process", {
            headers: { authorization: "Bearer wrong-token" },
          }),
        );
        expect(wrongRes.status).toBe(401);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("loops over every enabled owner and records an outcome for each, isolating per-owner failures", async () => {
      vi.stubEnv("CRON_SECRET", "super-secret-cron-token");
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-26T01:00:00Z")); // 09:00 in Malaysia
      const ownerA = "cron-owner-a@example.com";
      const ownerB = "cron-owner-b@example.com";
      try {
        await store.setReminderRules({
          ownerEmail: ownerA,
          enabled: true,
          firstAfterDays: 2,
          minIntervalDays: 3,
          maxAttempts: 3,
          sendHour: 9,
          skipFridayPrayers: false,
          requireApproval: false,
          updatedAt: new Date().toISOString(),
        });
        await store.setReminderRules({
          ownerEmail: ownerB,
          enabled: true,
          firstAfterDays: 2,
          minIntervalDays: 3,
          maxAttempts: 3,
          sendHour: 9,
          skipFridayPrayers: false,
          requireApproval: false,
          updatedAt: new Date().toISOString(),
        });

        payments.listOwnerInvoices.mockImplementation(async (email: string) => {
          if (email === ownerA) {
            throw new Error("DB error for owner A");
          }
          if (email === ownerB) {
            return [
              {
                id: "INV-CRON-B",
                ownerEmail: ownerB,
                customerName: "Siti",
                amountSen: 2500,
                currency: "MYR",
                sentAt: "2026-10-01T00:00:00Z",
                status: "SENT",
                settlement: "open",
              },
            ];
          }
          return [];
        });

        const res = await cronProcessReminders(
          new Request("http://localhost:3000/api/reminders/process", {
            headers: { authorization: "Bearer super-secret-cron-token" },
          }),
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.processedOwners).toBeGreaterThanOrEqual(2);

        const resultA = data.results.find((r: { ownerEmail: string }) => r.ownerEmail === ownerA);
        const resultB = data.results.find((r: { ownerEmail: string }) => r.ownerEmail === ownerB);

        expect(resultA).toMatchObject({
          ownerEmail: ownerA,
          ok: false,
          error: "DB error for owner A",
        });
        expect(resultB).toMatchObject({
          ownerEmail: ownerB,
          ok: true,
        });
        expect(resultB.outcome.requested.map((d: { invoiceId: string }) => d.invoiceId)).toContain("INV-CRON-B");
      } finally {
        vi.useRealTimers();
        vi.unstubAllEnvs();
      }
    });

    it("enforces each owner's configured send hour", async () => {
      vi.stubEnv("CRON_SECRET", "super-secret-cron-token");
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-26T01:00:00Z")); // 09:00 in Malaysia
      const cronOwner = "cron-hour-owner@example.com";
      try {
        await store.setReminderRules({
          ownerEmail: cronOwner,
          enabled: true,
          firstAfterDays: 0,
          minIntervalDays: 1,
          maxAttempts: 3,
          sendHour: 10,
          skipFridayPrayers: false,
          requireApproval: false,
          updatedAt: new Date().toISOString(),
        });
        payments.listOwnerInvoices.mockImplementation(async (email: string) =>
          email === cronOwner
            ? [{
                id: "INV-WRONG-HOUR",
                ownerEmail: cronOwner,
                customerName: "Siti",
                amountSen: 2500,
                currency: "MYR",
                sentAt: "2026-10-01T00:00:00Z",
                status: "SENT",
                settlement: "open",
              }]
            : [],
        );

        const res = await cronProcessReminders(
          new Request("http://localhost:3000/api/reminders/process", {
            headers: { authorization: "Bearer super-secret-cron-token" },
          }),
        );
        const data = await res.json();
        const result = data.results.find((item: { ownerEmail: string }) => item.ownerEmail === cronOwner);

        expect(result.outcome.requested).toHaveLength(0);
        expect(result.outcome.skipped[0].reason).toMatch(/configured reminder hour/i);
        expect(remindMock.deliverScheduledReminder).not.toHaveBeenCalledWith("INV-WRONG-HOUR");
      } finally {
        vi.useRealTimers();
        vi.unstubAllEnvs();
      }
    });
  });
});
