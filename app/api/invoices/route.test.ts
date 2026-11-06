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
const db = vi.hoisted(() => ({ value: null as null | { saveInvoice: ReturnType<typeof vi.fn> } }));
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
