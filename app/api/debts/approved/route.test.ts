import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true, email: "owner@example.com" }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: signedIn.email, method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

// No payments database unless a test gives it one.
const db = vi.hoisted(() => ({ value: null as null | { listOwnerInvoices: ReturnType<typeof vi.fn> } }));
vi.mock("@/lib/payment-db", () => ({ paymentDb: () => db.value, within: <T,>(p: Promise<T>) => p }));

const paypal = vi.hoisted(() => ({ getInvoice: vi.fn() }));
vi.mock("@/lib/paypal", () => paypal);

import { GET as getApprovedDebts } from "./route";
import { getPerson1Store } from "@/lib/person1-store";
import type { ApprovedDebtRecord } from "@/lib/person1-types";

describe("GET /api/debts/approved", () => {
  beforeEach(() => {
    signedIn.value = true;
    signedIn.email = "owner@example.com";
    db.value = null;
  });

  it("leaves out debts the payments database has an invoice for, unless it was cancelled", async () => {
    signedIn.email = "invoiced-owner@example.com";
    const debt = (id: string): ApprovedDebtRecord => ({ id, ownerEmail: signedIn.email, sourceEntryId: `entry-${id}`, scanId: "scan-i", customerId: "cust-i", customerName: "Pak Ali", customerEmail: "ali@example.com", amountSen: 3600, currency: "MYR", item: "Rokok", date: "2026-10-18", approvedAt: "2026-10-18T00:00:00Z", handoffKey: id });
    await getPerson1Store().saveApprovedDebts([debt("to-send"), debt("invoiced"), debt("cancelled")]);
    db.value = {
      listOwnerInvoices: vi.fn().mockResolvedValue([
        { id: "INV-1", settlement: "open", debtIds: ["invoiced"] },
        { id: "INV-2", settlement: "closed", debtIds: ["cancelled"] },
      ]),
    };

    const data = await (await getApprovedDebts()).json();

    expect(data.approvedDebts.map((d: ApprovedDebtRecord) => d.id).sort()).toEqual(["cancelled", "to-send"]);
    expect(data.invoiced.map((i: { debt: ApprovedDebtRecord; invoice: { id: string } }) => [i.debt.id, i.invoice.id])).toEqual([["invoiced", "INV-1"]]);
    expect(data.withdrawnDebtIds).toEqual([]);
  });

  it("frees a debt when PayPal says its invoice was cancelled and the webhook missed it", async () => {
    signedIn.email = "missed-webhook-owner@example.com";
    await getPerson1Store().saveApprovedDebts([{ id: "missed", ownerEmail: signedIn.email, sourceEntryId: "entry-missed", scanId: "scan-m", customerId: "cust-m", customerName: "Pak Ali", customerEmail: "ali@example.com", amountSen: 3600, currency: "MYR", item: "Rokok", date: "2026-10-18", approvedAt: "2026-10-18T00:00:00Z", handoffKey: "missed" }]);
    const listOwnerInvoices = vi.fn()
      .mockResolvedValueOnce([{ id: "INV-M", amountSen: 3600, currency: "MYR", settlement: "open", debtIds: ["missed"] }])
      .mockResolvedValue([{ id: "INV-M", amountSen: 3600, currency: "MYR", settlement: "closed", debtIds: ["missed"] }]);
    const saveFacts = vi.fn().mockResolvedValue("closed");
    db.value = { listOwnerInvoices, saveFacts } as never;
    paypal.getInvoice.mockResolvedValueOnce({ id: "INV-M", status: "CANCELLED", amount: { value: "36.00", currency_code: "MYR" } });

    const data = await (await getApprovedDebts()).json();

    expect(saveFacts).toHaveBeenCalled();
    expect(data.approvedDebts.map((d: ApprovedDebtRecord) => d.id)).toEqual(["missed"]);
    expect(data.invoiced).toEqual([]);
  });

  it("still lists an invoiced debt when PayPal can't be reached", async () => {
    signedIn.email = "paypal-down-owner@example.com";
    await getPerson1Store().saveApprovedDebts([{ id: "down", ownerEmail: signedIn.email, sourceEntryId: "entry-down", scanId: "scan-d", customerId: "cust-d", customerName: "Pak Ali", customerEmail: "ali@example.com", amountSen: 3600, currency: "MYR", item: "Rokok", date: "2026-10-18", approvedAt: "2026-10-18T00:00:00Z", handoffKey: "down" }]);
    db.value = { listOwnerInvoices: vi.fn().mockResolvedValue([{ id: "INV-D", amountSen: 3600, currency: "MYR", settlement: "open", debtIds: ["down"] }]) };
    paypal.getInvoice.mockRejectedValueOnce(new Error("PayPal down"));

    const data = await (await getApprovedDebts()).json();

    expect(data.approvedDebts).toEqual([]);
    expect(data.invoiced).toHaveLength(1);
  });

  it("holds back a debt whose line the owner unticked after approving it", async () => {
    signedIn.email = "withdrawn-owner@example.com";
    const store = getPerson1Store();
    const now = "2026-10-18T00:00:00Z";
    await store.saveScan({ id: "scan-w", ownerEmail: signedIn.email, imageKey: "x", imageHash: "hash-w", mimeType: "image/jpeg", sizeBytes: 1, status: "completed", mode: "notebook", revision: 1, createdAt: now, updatedAt: now });
    await store.saveEntries([{ id: "entry-w", scanId: "scan-w", revision: 1, rawText: "x", customerName: "Pak Ali", item: "Rokok", amountSen: 3600, rawAmountText: "36", date: "2026-10-18", classification: "debt", confidence: 1, isAmbiguous: false, included: false, sourceRef: { lineIndex: 1 }, ownerEdited: true, createdAt: now, updatedAt: now }]);
    await store.saveApprovedDebts([{ id: "appr-w", ownerEmail: signedIn.email, sourceEntryId: "entry-w", scanId: "scan-w", customerId: "cust-w", customerName: "Pak Ali", customerEmail: "ali@example.com", amountSen: 3600, currency: "MYR", item: "Rokok", date: "2026-10-18", approvedAt: now, handoffKey: "w" }]);

    const data = await (await getApprovedDebts()).json();

    expect(data.approvedDebts).toEqual([]);
    expect(data.withdrawnDebtIds).toEqual(["appr-w"]);
  });

  it("answers 503 rather than offering debts it can't check", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    db.value = { listOwnerInvoices: vi.fn().mockRejectedValue(new Error("db down")) };
    expect((await getApprovedDebts()).status).toBe(503);
  });

  it("returns only the signed-in owner's approved debts", async () => {
    const store = getPerson1Store();

    const ownerDebt: ApprovedDebtRecord = {
      id: "debt-1",
      ownerEmail: "owner@example.com",
      sourceEntryId: "entry-1",
      scanId: "scan-1",
      customerId: "cust-1",
      customerName: "Pak Ali",
      customerEmail: "ali@example.com",
      amountSen: 3600,
      currency: "MYR",
      item: "Rokok",
      date: "2026-10-18",
      approvedAt: new Date().toISOString(),
      handoffKey: "handoff-1",
    };

    const otherOwnerDebt: ApprovedDebtRecord = {
      id: "debt-2",
      ownerEmail: "other@example.com",
      sourceEntryId: "entry-2",
      scanId: "scan-2",
      customerId: "cust-2",
      customerName: "Mak Siti",
      customerEmail: "siti@example.com",
      amountSen: 5000,
      currency: "MYR",
      item: "Beras",
      date: "2026-10-19",
      approvedAt: new Date().toISOString(),
      handoffKey: "handoff-2",
    };

    await store.saveApprovedDebts([ownerDebt, otherOwnerDebt]);

    const res = await getApprovedDebts();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.approvedDebts).toHaveLength(1);
    expect(data.approvedDebts[0].id).toBe("debt-1");
    expect(data.approvedDebts[0].ownerEmail).toBe("owner@example.com");
  });

  it("returns empty array when no approved debts exist", async () => {
    // Use a unique owner to ensure isolation from other tests
    signedIn.email = "empty-owner@example.com";
    const res = await getApprovedDebts();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.approvedDebts)).toBe(true);
    expect(data.approvedDebts.length).toBe(0);
  });

  it("requires authentication", async () => {
    signedIn.value = false;
    const res = await getApprovedDebts();
    expect(res.status).toBe(401);
  });
});
