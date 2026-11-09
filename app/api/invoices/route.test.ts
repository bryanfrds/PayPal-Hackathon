import { beforeEach, describe, expect, it, vi } from "vitest";

// Signed in as the shop owner unless a test says otherwise.
const signedIn = vi.hoisted(() => ({ value: true, email: "owner@example.com" }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: signedIn.email, method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));


const paypal = vi.hoisted(() => ({
  createDraftInvoice: vi.fn(),
  sendInvoice: vi.fn(),
  getInvoice: vi.fn(),
}));

vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return { ...actual, ...paypal };
});

// No payments database unless a test gives it one.
const db = vi.hoisted(() => ({ value: null as null | { saveInvoice: ReturnType<typeof vi.fn>; listOwnerInvoices?: ReturnType<typeof vi.fn> } }));
vi.mock("@/lib/payment-db", () => ({ paymentDb: () => db.value, within: <T,>(p: Promise<T>) => p }));

import { PayPalError } from "@/lib/paypal";
import { getPerson1Store } from "@/lib/person1-store";
import { POST } from "./route";

const GOOD = {
  customerName: "Mak Cik Siti",
  email: "siti@gmail.com",
  lines: [{ name: "Beras 10kg (2026-08-02)", amountSen: 4850 }],
  requestId: "buku-0123456789abcdef",
};

function post(body: unknown) {
  return POST(new Request("http://x/api/invoices", { method: "POST", body: JSON.stringify(body) }));
}

const SENT = { id: "INV2-1", status: "SENT", detail: { invoice_number: "0042", metadata: { recipient_view_url: "https://pay/1" } } };

beforeEach(() => {
  vi.resetAllMocks();
  signedIn.value = true;
  signedIn.email = "owner@example.com";
  db.value = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  paypal.getInvoice.mockResolvedValue(SENT);
});

describe("POST /api/invoices", () => {
  it("refuses anyone who isn't signed in", async () => {
    signedIn.value = false;
    const res = await POST(new Request("http://localhost/api/invoices", { method: "POST", body: "{}" }));
    signedIn.value = true;
    expect(res.status).toBe(401);
  });

  it("creates the draft with the request id, sends it and returns the number and pay link", async () => {
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1", status: "DRAFT" });
    paypal.getInvoice.mockResolvedValueOnce({ id: "INV2-1", status: "DRAFT" });
    paypal.sendInvoice.mockResolvedValue("https://pay/1");
    const res = await post(GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "INV2-1", number: "0042", payerLink: "https://pay/1" });
    expect(paypal.createDraftInvoice).toHaveBeenCalledWith({
      recipientEmail: "siti@gmail.com",
      recipientName: "Mak Cik Siti",
      items: [{ name: "Beras 10kg (2026-08-02)", amount: 48.5 }],
      requestId: "buku-0123456789abcdef",
    });
    expect(paypal.sendInvoice).toHaveBeenCalledWith("INV2-1");
  });

  it("resolves an approved debt server-side and ignores conflicting browser fields", async () => {
    const store = getPerson1Store();
    await store.saveScan({ id: "scan-authority-1", ownerEmail: signedIn.email, imageKey: "x", imageHash: "h", mimeType: "image/jpeg", sizeBytes: 1, status: "completed", mode: "notebook", revision: 1, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z" });
    await store.saveCustomer({ id: "cust-authority-1", ownerEmail: signedIn.email, name: "Trusted Name", slug: "trusted-name", email: "trusted@example.com", confirmedAt: "2026-10-18T00:00:00Z", createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z" });
    await store.saveEntries([{ id: "entry-authority-1", scanId: "scan-authority-1", revision: 1, rawText: "Trusted", customerName: "Trusted Name", item: "Trusted item", amountSen: 3600, rawAmountText: "36.00", date: "2026-10-18", classification: "debt", confidence: 1, isAmbiguous: false, included: true, sourceRef: { lineIndex: 1 }, ownerEdited: true, confirmedCustomerId: "cust-authority-1", createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z" }]);
    await store.saveApprovedDebts([{
      id: "approved-authority-1",
      ownerEmail: signedIn.email,
      sourceEntryId: "entry-authority-1",
      scanId: "scan-authority-1",
      customerId: "cust-authority-1",
      customerName: "Trusted Name",
      customerEmail: "trusted@example.com",
      amountSen: 3600,
      currency: "MYR",
      item: "Trusted item",
      date: "2026-10-18",
      approvedAt: "2026-10-18T00:00:00Z",
      handoffKey: "trusted-key",
    }]);
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1", status: "SENT" });

    const res = await post({
      approvedDebtId: "approved-authority-1",
      requestId: GOOD.requestId,
      customerName: "Attacker",
      email: "attacker@example.com",
      lines: [{ name: "Changed", amountSen: 1 }],
    });

    expect(res.status).toBe(200);
    expect(paypal.createDraftInvoice).toHaveBeenCalledWith({
      recipientEmail: "trusted@example.com",
      recipientName: "Trusted Name",
      items: [{ name: "Trusted item", amount: 36 }],
      requestId: expect.stringMatching(/^buku-[0-9a-f]{16}$/),
    });
    expect(paypal.createDraftInvoice.mock.calls[0][0].requestId).not.toBe(GOOD.requestId);
  });

  describe("a corrected approved debt", () => {
    const now = "2026-10-18T00:00:00Z";
    const baseDebt = { id: "approved-stable-request", ownerEmail: "owner@example.com", sourceEntryId: "entry-stable-request", scanId: "scan-stable-request", customerId: "cust-stable-request", customerName: "Stable", customerEmail: "stable@example.com", amountSen: 1000, currency: "MYR", item: "Old item", date: "2026-10-18", approvedAt: now, handoffKey: "stable-old" };
    const onPayPal = (status: string, value = "10.00", email = "stable@example.com") => ({ ...SENT, id: "INV2-OLD", status, amount: { currency_code: "MYR", value }, primary_recipients: [{ billing_info: { email_address: email } }] });

    beforeEach(async () => {
      const store = getPerson1Store();
      await store.saveScan({ id: "scan-stable-request", ownerEmail: signedIn.email, imageKey: "x", imageHash: "stable-request-hash", mimeType: "image/jpeg", sizeBytes: 1, status: "completed", mode: "notebook", revision: 1, createdAt: now, updatedAt: now });
      await store.saveCustomer({ id: "cust-stable-request", ownerEmail: signedIn.email, name: "Stable", slug: "stable", email: "stable@example.com", confirmedAt: now, createdAt: now, updatedAt: now });
      await store.saveEntries([{ id: "entry-stable-request", scanId: "scan-stable-request", revision: 1, rawText: "Stable", customerName: "Stable", item: "Old item", amountSen: 1000, rawAmountText: "10", date: "2026-10-18", classification: "debt", confidence: 1, isAmbiguous: false, included: true, sourceRef: { lineIndex: 1 }, ownerEdited: true, confirmedCustomerId: "cust-stable-request", createdAt: now, updatedAt: now }]);
      await store.saveApprovedDebts([baseDebt]);
      await store.replaceApprovedDebt(baseDebt); // forgets invoices recorded by earlier tests
    });

    it("saves PayPal's amount, and refuses a correction once that invoice went out, even with no database link", async () => {
      db.value = { saveInvoice: vi.fn().mockResolvedValue(undefined), listOwnerInvoices: vi.fn().mockResolvedValue([]) };
      paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-OLD", status: "SENT" });
      paypal.getInvoice.mockResolvedValue(onPayPal("SENT"));

      expect((await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId })).status).toBe(200);
      expect(db.value.saveInvoice).toHaveBeenCalledWith(expect.objectContaining({ amountSen: 1000 }));
      await getPerson1Store().saveApprovedDebts([{ ...baseDebt, amountSen: 2000, handoffKey: "stable-new" }]);
      const res = await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId });

      expect(res.status).toBe(409);
      expect(paypal.createDraftInvoice).toHaveBeenCalledTimes(1);
    });

    it("never sends again after a corrected invoice went out but its database save failed", async () => {
      // Version 1's send fails, leaving a draft. Version 2 goes out, and the save fails.
      db.value = { saveInvoice: vi.fn().mockRejectedValue(new Error("db down")), listOwnerInvoices: vi.fn().mockResolvedValue([]) };
      const store = getPerson1Store();
      await store.addApprovedDebtInvoiceId(signedIn.email, baseDebt.id, "INV2-OLD");
      await store.addApprovedDebtInvoiceId(signedIn.email, baseDebt.id, "INV2-NEW");
      paypal.getInvoice.mockImplementation(async (id: string) => (id === "INV2-OLD" ? onPayPal("DRAFT", "10.00") : { ...onPayPal("SENT", "20.00"), id }));

      // Corrected back to version 1, whose old draft would match again.
      expect((await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId })).status).toBe(409);
      expect(paypal.createDraftInvoice).not.toHaveBeenCalled();
      expect(paypal.sendInvoice).not.toHaveBeenCalled();

      // Corrected to version 2 itself: the retry gets that invoice, and the missing link is repaired.
      db.value.saveInvoice.mockResolvedValue(undefined);
      await store.saveApprovedDebts([{ ...baseDebt, amountSen: 2000, handoffKey: "stable-new" }]);
      const retry = await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId });
      expect((await retry.json()).id).toBe("INV2-NEW");
      expect(db.value.saveInvoice).toHaveBeenLastCalledWith(expect.objectContaining({ id: "INV2-NEW", debtIds: [baseDebt.id], amountSen: 2000 }));
      expect(paypal.sendInvoice).not.toHaveBeenCalled();
    });

    it("sends nothing if the new invoice can't be recorded against the debt", async () => {
      const spy = vi.spyOn(getPerson1Store(), "addApprovedDebtInvoiceId").mockRejectedValueOnce(new Error("db down"));
      paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-FRESH", status: "DRAFT" });
      paypal.getInvoice.mockResolvedValue({ id: "INV2-FRESH", status: "DRAFT" });

      expect((await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId })).status).toBeGreaterThanOrEqual(500);
      expect(paypal.sendInvoice).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("bills again when PayPal says a linked invoice was cancelled and the webhook missed it", async () => {
      const saveFacts = vi.fn().mockResolvedValue("closed");
      db.value = { saveInvoice: vi.fn().mockResolvedValue(undefined), saveFacts, listOwnerInvoices: vi.fn().mockResolvedValue([{ id: "INV2-OLD", amountSen: 1000, currency: "MYR", settlement: "open", debtIds: [baseDebt.id] }]) } as never;
      paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-NEW", status: "SENT" });
      paypal.getInvoice.mockImplementation(async (id: string) => (id === "INV2-OLD" ? onPayPal("CANCELLED") : { ...onPayPal("SENT"), id }));

      const res = await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId });

      expect((await res.json()).id).toBe("INV2-NEW");
      expect(saveFacts).toHaveBeenCalledWith("INV2-OLD", expect.objectContaining({ status: "CANCELLED" }), expect.any(Date), "app");
    });

    it("refuses when PayPal's sent invoice went to a different recipient", async () => {
      paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-OLD", status: "SENT" });
      paypal.getInvoice.mockResolvedValue(onPayPal("SENT", "10.00", "old@example.com"));
      expect((await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId })).status).toBe(409);
    });

    it("leaves a stale draft unsent and sends the corrected details on a new one", async () => {
      await getPerson1Store().saveApprovedDebts([{ ...baseDebt, amountSen: 2000, handoffKey: "stable-new" }]);
      paypal.createDraftInvoice.mockResolvedValueOnce({ id: "INV2-OLD", status: "DRAFT" }).mockResolvedValueOnce({ id: "INV2-NEW", status: "DRAFT" });
      paypal.getInvoice.mockImplementation(async (id: string) => (id === "INV2-OLD" ? onPayPal("DRAFT") : { ...onPayPal(calledSend() ? "SENT" : "DRAFT", "20.00"), id: "INV2-NEW" }));
      function calledSend() {
        return paypal.sendInvoice.mock.calls.length > 0;
      }

      const res = await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId });

      expect(res.status).toBe(200);
      expect((await res.json()).id).toBe("INV2-NEW");
      expect(paypal.sendInvoice.mock.calls).toEqual([["INV2-NEW"]]);
      expect(paypal.createDraftInvoice.mock.calls[0][0].requestId).not.toBe(paypal.createDraftInvoice.mock.calls[1][0].requestId);
    });

    it("doesn't send a stale draft whose amount is right but whose item name is old", async () => {
      paypal.createDraftInvoice.mockResolvedValueOnce({ id: "INV2-OLD", status: "DRAFT" }).mockResolvedValueOnce({ id: "INV2-NEW", status: "DRAFT" });
      paypal.getInvoice.mockImplementation(async (id: string) =>
        id === "INV2-OLD" ? { ...onPayPal("DRAFT"), items: [{ name: "Older item" }] } : { ...onPayPal(paypal.sendInvoice.mock.calls.length ? "SENT" : "DRAFT"), id: "INV2-NEW", items: [{ name: "Old item" }] },
      );

      const res = await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId });

      expect(res.status).toBe(200);
      expect(paypal.sendInvoice.mock.calls).toEqual([["INV2-NEW"]]);
    });

    it("gives a retry the invoice the database has, without asking PayPal to create one", async () => {
      db.value = { saveInvoice: vi.fn(), listOwnerInvoices: vi.fn().mockResolvedValue([{ id: "INV2-OLD", amountSen: 1000, settlement: "open", debtIds: [baseDebt.id] }]) };
      paypal.getInvoice.mockResolvedValue(onPayPal("SENT"));

      const res = await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "INV2-OLD", number: "0042", payerLink: "https://pay/1" });
      expect(paypal.createDraftInvoice).not.toHaveBeenCalled();
      expect(db.value.saveInvoice).not.toHaveBeenCalled();
    });

    it("refuses a debt that changed after the database linked it to an invoice", async () => {
      await getPerson1Store().saveApprovedDebts([{ ...baseDebt, amountSen: 2000, handoffKey: "stable-new" }]);
      db.value = { saveInvoice: vi.fn(), listOwnerInvoices: vi.fn().mockResolvedValue([{ id: "INV2-OLD", amountSen: 1000, settlement: "open", debtIds: [baseDebt.id] }]) };
      paypal.getInvoice.mockResolvedValue(onPayPal("SENT"));

      expect((await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId })).status).toBe(409);
      expect(paypal.createDraftInvoice).not.toHaveBeenCalled();
    });

    it("bills again under a new request id after the linked invoice was cancelled", async () => {
      paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-NEW", status: "SENT" });
      await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId });
      await getPerson1Store().replaceApprovedDebt(baseDebt); // the first post only gave us its request id
      db.value = { saveInvoice: vi.fn().mockResolvedValue(undefined), listOwnerInvoices: vi.fn().mockResolvedValue([{ id: "INV2-OLD", amountSen: 1000, settlement: "closed", debtIds: [baseDebt.id] }]) };
      const res = await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId });

      expect(res.status).toBe(200);
      expect(paypal.createDraftInvoice.mock.calls[0][0].requestId).not.toBe(paypal.createDraftInvoice.mock.calls[1][0].requestId);
    });

    it("sends nothing when the database can't say whether the debt has an invoice", async () => {
      db.value = { saveInvoice: vi.fn(), listOwnerInvoices: vi.fn().mockRejectedValue(new Error("db down")) };
      expect((await post({ approvedDebtId: baseDebt.id, requestId: GOOD.requestId })).status).toBe(503);
      expect(paypal.createDraftInvoice).not.toHaveBeenCalled();
    });
  });

  it("rejects unknown and wrong-owner approved debt ids", async () => {
    expect((await post({ approvedDebtId: "approved-missing", requestId: GOOD.requestId })).status).toBe(404);

    await getPerson1Store().saveApprovedDebts([{
      id: "approved-other-owner",
      ownerEmail: "other@example.com",
      sourceEntryId: "entry-other",
      scanId: "scan-other",
      customerId: "cust-other",
      customerName: "Other Owner",
      customerEmail: "other@example.com",
      amountSen: 1000,
      currency: "MYR",
      item: "Other item",
      date: "2026-10-18",
      approvedAt: "2026-10-18T00:00:00Z",
      handoffKey: "other-key",
    }]);
    expect((await post({ approvedDebtId: "approved-other-owner", requestId: GOOD.requestId })).status).toBe(404);
    expect(paypal.createDraftInvoice).not.toHaveBeenCalled();
  });

  it("doesn't send again when a retry's replayed create says DRAFT but PayPal says it's sent", async () => {
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1", status: "DRAFT" }); // replay of the first try
    const res = await post(GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "INV2-1", number: "0042", payerLink: "https://pay/1" });
    expect(paypal.sendInvoice).not.toHaveBeenCalled();
  });

  it("treats a send that fails because it already went out as success", async () => {
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1" });
    paypal.getInvoice.mockResolvedValueOnce({ id: "INV2-1", status: "DRAFT" });
    paypal.sendInvoice.mockRejectedValue(new PayPalError("already sent", { status: 422 }));
    const res = await post(GOOD);
    expect(res.status).toBe(200);
  });

  it("fails a send that PayPal rejects while the invoice is still a draft", async () => {
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1" });
    paypal.getInvoice.mockResolvedValue({ id: "INV2-1", status: "DRAFT" });
    paypal.sendInvoice.mockRejectedValue(new PayPalError("bad", { status: 422 }));
    const res = await post(GOOD);
    expect(res.status).toBe(422);
  });

  it("refuses to report a cancelled invoice as sent", async () => {
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1" });
    paypal.getInvoice.mockResolvedValue({ id: "INV2-1", status: "CANCELLED" });
    const res = await post(GOOD);
    expect(res.status).toBe(409);
    expect(paypal.sendInvoice).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...GOOD, email: "siti@" }],
    [{ ...GOOD, customerName: " " }],
    [{ ...GOOD, lines: [] }],
    [{ ...GOOD, lines: [{ name: "x", amountSen: 12.5 }] }],
    [{ ...GOOD, requestId: "random" }],
    ["not json"],
  ])("refuses a bad request %#", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(paypal.createDraftInvoice).not.toHaveBeenCalled();
  });

  it("says plainly when PayPal isn't set up on the server", async () => {
    paypal.createDraftInvoice.mockRejectedValue(new PayPalError("PAYPAL_CLIENT_ID is not set. Copy .env.example to .env.local and add your sandbox keys."));
    const res = await post(GOOD);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("PayPal isn't connected on this server yet.");
  });

  it("turns a PayPal rejection into a message without PayPal's details", async () => {
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1", status: "DRAFT" });
    paypal.getInvoice.mockResolvedValue({ id: "INV2-1", status: "DRAFT" });
    paypal.sendInvoice.mockRejectedValue(new PayPalError("PayPal sendInvoice failed (HTTP 422, UNPROCESSABLE_ENTITY) debug abc", { status: 422 }));
    const res = await post(GOOD);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("PayPal didn't accept this invoice. Check the email and amount.");
  });

  it("records the sent invoice in the payments database", async () => {
    db.value = { saveInvoice: vi.fn().mockResolvedValue(undefined) };
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1", status: "SENT" });
    const res = await post({ ...GOOD, debtIds: ["T-1001", "D-ab12"] });
    expect(res.status).toBe(200);
    expect(db.value.saveInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "INV2-1",
        ownerEmail: "owner@example.com",
        number: "0042",
        customerName: "Mak Cik Siti",
        slug: "mak-cik-siti",
        debtIds: ["T-1001", "D-ab12"],
        amountSen: 4850,
        payerLink: "https://pay/1",
      }),
    );
  });

  it("still answers sent when the database can't save it", async () => {
    db.value = { saveInvoice: vi.fn().mockRejectedValue(new Error("db down")) };
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1", status: "SENT" });
    const res = await post(GOOD);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("INV2-1");
  });

  it("refuses malformed debt ids", async () => {
    expect((await post({ ...GOOD, debtIds: ["../x"] })).status).toBe(400);
    expect((await post({ ...GOOD, debtIds: [1] })).status).toBe(400);
  });
});
