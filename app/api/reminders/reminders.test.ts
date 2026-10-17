import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true, email: "owner@example.com" }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: signedIn.email, method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

import { GET as getRules, PUT as updateRules } from "../reminder-rules/route";
import { POST as processReminders } from "./process/route";
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

    const processReq = new Request("http://localhost:3000/api/reminders/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidateInvoices: [
          {
            id: "INV-ACT-1",
            customerName: "Pak Ali",
            dueDate: "2026-10-10",
            amountSen: 3000,
            status: "SENT",
            settlement: "open",
          },
        ],
      }),
    });

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
});
