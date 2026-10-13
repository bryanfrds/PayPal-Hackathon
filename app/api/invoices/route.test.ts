import { beforeEach, describe, expect, it, vi } from "vitest";

const paypal = vi.hoisted(() => ({
  createDraftInvoice: vi.fn(),
  sendInvoice: vi.fn(),
  getInvoice: vi.fn(),
}));

vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return { ...actual, ...paypal };
});

import { PayPalError } from "@/lib/paypal";
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

beforeEach(() => {
  vi.resetAllMocks();
  paypal.getInvoice.mockResolvedValue({ id: "INV2-1", status: "SENT", detail: { invoice_number: "0042", metadata: { recipient_view_url: "https://pay/1" } } });
});

describe("POST /api/invoices", () => {
  it("creates the draft with the request id, sends it and returns the number and pay link", async () => {
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1", status: "DRAFT" });
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

  it("doesn't send again when a retry finds the invoice already sent", async () => {
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1", status: "SENT" });
    const res = await post(GOOD);
    expect(res.status).toBe(200);
    expect(paypal.sendInvoice).not.toHaveBeenCalled();
  });

  it("looks the status up when the draft comes back without one", async () => {
    paypal.createDraftInvoice.mockResolvedValue({ id: "INV2-1" });
    paypal.getInvoice.mockResolvedValueOnce({ id: "INV2-1", status: "DRAFT" });
    paypal.sendInvoice.mockResolvedValue(undefined);
    await post(GOOD);
    expect(paypal.sendInvoice).toHaveBeenCalledTimes(1);
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
    paypal.sendInvoice.mockRejectedValue(new PayPalError("PayPal sendInvoice failed (HTTP 422, UNPROCESSABLE_ENTITY) debug abc", { status: 422 }));
    const res = await post(GOOD);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("PayPal didn't accept this invoice. Check the email and amount.");
  });
});
