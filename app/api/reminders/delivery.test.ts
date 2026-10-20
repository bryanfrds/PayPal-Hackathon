// The scheduler's routes deliver through lib/remind.ts in-process: no HTTP call back into the
// app (so no Host header to trust and no forwarded cookie), and the invoice id is checked first.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const owner = "delivery-owner@example.com";
const signedIn = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value ? { email: owner, method: "email", exp: 9999999999 } : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

const paypal = vi.hoisted(() => ({ getInvoice: vi.fn(), remindInvoice: vi.fn() }));
vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return { ...actual, ...paypal };
});
vi.mock("@/lib/payment-db", () => ({ paymentDb: () => null }));

import { getPerson1Store } from "@/lib/person1-store";
import { POST as approve } from "./[id]/approve/route";
import { POST as processReminders } from "./process/route";

const store = getPerson1Store();
const fetchSpy = vi.fn();

function owed(id: string) {
  return { id, status: "SENT", amount: { currency_code: "MYR", value: "10.00" }, due_amount: { value: "10.00" } };
}

async function rules(requireApproval: boolean) {
  await store.setReminderRules({
    ownerEmail: owner,
    enabled: true,
    firstAfterDays: 1,
    minIntervalDays: 1,
    maxAttempts: 3,
    sendHour: 10,
    skipFridayPrayers: false,
    requireApproval,
    updatedAt: new Date().toISOString(),
  });
}

function processRequest(id: unknown) {
  return new Request("http://evil.example/api/reminders/process", {
    method: "POST",
    headers: { host: "evil.example", cookie: "buku_session=secret", "content-type": "application/json" },
    body: JSON.stringify({
      candidateInvoices: [{ id, customerName: "Pak Ali", dueDate: "2026-01-01", amountSen: 1000, status: "SENT", settlement: "open" }],
    }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  signedIn.value = true;
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("reminder delivery from the scheduler", () => {
  it("process: reminds through PayPal directly, whatever the Host header says", async () => {
    await rules(false);
    paypal.getInvoice.mockResolvedValue(owed("INV2-PROC-0001"));
    paypal.remindInvoice.mockResolvedValue(undefined);
    const res = await processReminders(processRequest("INV2-PROC-0001"));
    const outcome = await res.json();
    expect(outcome.requested).toHaveLength(1);
    expect(paypal.remindInvoice).toHaveBeenCalledWith("INV2-PROC-0001");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("process: refuses an invoice id that isn't one, without calling PayPal", async () => {
    await rules(false);
    const res = await processReminders(processRequest("../../tabs/publish"));
    const outcome = await res.json();
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0].reason).toBe("Unknown invoice.");
    expect(paypal.getInvoice).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("process: refuses an id that isn't text", async () => {
    await rules(false);
    const outcome = await (await processReminders(processRequest(["INV2-PROC-0002"]))).json();
    expect(outcome.failed[0].reason).toBe("Unknown invoice.");
    expect(paypal.getInvoice).not.toHaveBeenCalled();
  });

  it("process: counts a reminder that may have gone out as sent, so it isn't repeated too soon", async () => {
    await rules(false);
    paypal.getInvoice.mockResolvedValue(owed("INV2-PROC-0003"));
    paypal.remindInvoice.mockRejectedValue(new Error("network down"));
    const outcome = await (await processReminders(processRequest("INV2-PROC-0003"))).json();
    expect(outcome.requested).toHaveLength(1);
    expect(outcome.requested[0].deliveryResult).toMatch(/may have gone out/);
  });

  it("both routes refuse a signed-out caller before reaching PayPal", async () => {
    signedIn.value = false;
    expect((await processReminders(processRequest("INV2-PROC-0004"))).status).toBe(401);
    const req = new Request("http://x/api/reminders/dec-x/approve", { method: "POST" });
    expect((await approve(req, { params: Promise.resolve({ id: "dec-x" }) })).status).toBe(401);
    expect(paypal.getInvoice).not.toHaveBeenCalled();
  });

  it("approve: sends the approved reminder directly and records it", async () => {
    await rules(true);
    const decisionId = `dec-test-${Math.random().toString(36).slice(2, 8)}`;
    await store.saveReminderDecision({
      id: decisionId,
      ownerEmail: owner,
      invoiceId: "INV2-APPR-0001",
      action: "pending_approval",
      reason: "test",
      idempotencyKey: "k",
      attemptNumber: 1,
      createdAt: new Date().toISOString(),
    });
    paypal.getInvoice.mockResolvedValue(owed("INV2-APPR-0001"));
    paypal.remindInvoice.mockResolvedValue(undefined);
    const req = new Request(`http://evil.example/api/reminders/${decisionId}/approve`, { method: "POST", headers: { host: "evil.example" } });
    const res = await approve(req, { params: Promise.resolve({ id: decisionId }) });
    expect(res.status).toBe(200);
    expect(paypal.remindInvoice).toHaveBeenCalledWith("INV2-APPR-0001");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await store.getReminderDecision(owner, decisionId))?.action).toBe("requested");
  });
});
