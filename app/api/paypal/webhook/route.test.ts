import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  saveInvoice: vi.fn(),
  saveFacts: vi.fn(),
  recordEvent: vi.fn(),
  finishEvent: vi.fn(),
  forgetEvent: vi.fn(),
  claimReminder: vi.fn(),
  releaseReminder: vi.fn(),
}));
const hasDb = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/payment-db", () => ({ paymentDb: () => (hasDb.value ? db : null) }));

const paypal = vi.hoisted(() => ({ getInvoice: vi.fn(), verifyWebhook: vi.fn() }));
vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return { ...actual, ...paypal };
});

import { PayPalError } from "@/lib/paypal";
import { POST } from "./route";

function event(type = "INVOICING.INVOICE.PAID", resource: unknown = { invoice: { id: "INV2-AAAA-BBBB-CCCC-DDDD" } }, id = "WH-1") {
  return JSON.stringify({ id, event_type: type, resource });
}

function deliver(body: string) {
  return POST(new Request("http://x/api/paypal/webhook", { method: "POST", body, headers: { "paypal-transmission-id": "t" } }));
}

const PAID = { id: "INV2-AAAA-BBBB-CCCC-DDDD", status: "PAID", amount: { currency_code: "MYR", value: "10.00" }, due_amount: { value: "0.00" } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "WHID");
  hasDb.value = true;
  paypal.verifyWebhook.mockResolvedValue(true);
  paypal.getInvoice.mockResolvedValue(PAID);
  db.recordEvent.mockResolvedValue(true);
  db.saveFacts.mockResolvedValue("paid");
  db.finishEvent.mockResolvedValue(undefined);
  db.forgetEvent.mockResolvedValue(undefined);
});

describe("POST /api/paypal/webhook", () => {
  it("records a verified payment from a fresh read of the invoice", async () => {
    const res = await deliver(event());
    expect(res.status).toBe(200);
    expect(paypal.verifyWebhook).toHaveBeenCalledWith(expect.objectContaining({ webhookId: "WHID", rawBody: event() }));
    expect(db.recordEvent).toHaveBeenCalledWith("WH-1", "INVOICING.INVOICE.PAID", "INV2-AAAA-BBBB-CCCC-DDDD");
    expect(paypal.getInvoice).toHaveBeenCalledWith("INV2-AAAA-BBBB-CCCC-DDDD");
    expect(db.saveFacts).toHaveBeenCalledWith("INV2-AAAA-BBBB-CCCC-DDDD", expect.objectContaining({ status: "PAID", totalSen: 1000, dueSen: 0 }), expect.any(Date), "webhook");
    expect(db.finishEvent).toHaveBeenCalledWith("WH-1", "paid");
  });

  it("finds the invoice id at resource.id too", async () => {
    await deliver(event("INVOICING.INVOICE.CANCELLED", { id: "INV2-AAAA-BBBB-CCCC-DDDD" }));
    expect(paypal.getInvoice).toHaveBeenCalledWith("INV2-AAAA-BBBB-CCCC-DDDD");
  });

  it("refuses a delivery PayPal doesn't vouch for, and touches nothing", async () => {
    paypal.verifyWebhook.mockResolvedValue(false);
    expect((await deliver(event())).status).toBe(400);
    expect(db.recordEvent).not.toHaveBeenCalled();
    expect(paypal.getInvoice).not.toHaveBeenCalled();
  });

  it("asks PayPal to retry when verification itself fails", async () => {
    paypal.verifyWebhook.mockRejectedValue(new PayPalError("down", { status: 503 }));
    expect((await deliver(event())).status).toBe(503);
    expect(db.recordEvent).not.toHaveBeenCalled();
  });

  it("does nothing for a repeat delivery", async () => {
    db.recordEvent.mockResolvedValue(false);
    const res = await deliver(event());
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect(paypal.getInvoice).not.toHaveBeenCalled();
  });

  it("forgets the event and asks for a retry when reading the invoice fails", async () => {
    paypal.getInvoice.mockRejectedValue(new PayPalError("busy", { status: 503 }));
    expect((await deliver(event())).status).toBe(500);
    expect(db.forgetEvent).toHaveBeenCalledWith("WH-1");
    expect(db.finishEvent).not.toHaveBeenCalled();
  });

  it("finishes an event for an invoice PayPal doesn't have, without a retry", async () => {
    paypal.getInvoice.mockRejectedValue(new PayPalError("gone", { status: 404 }));
    expect((await deliver(event())).status).toBe(200);
    expect(db.finishEvent).toHaveBeenCalledWith("WH-1", "invoice not found");
    expect(db.forgetEvent).not.toHaveBeenCalled();
  });

  it("notes events that aren't about an invoice without reading anything", async () => {
    await deliver(event("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-1" }));
    expect(db.recordEvent).toHaveBeenCalledWith("WH-1", "PAYMENT.CAPTURE.COMPLETED", null);
    expect(paypal.getInvoice).not.toHaveBeenCalled();
    expect(db.finishEvent).toHaveBeenCalledWith("WH-1", "ignored");
  });

  it("ignores an invoice id that doesn't look like PayPal's", async () => {
    await deliver(event("INVOICING.INVOICE.PAID", { invoice: { id: "../../etc" } }));
    expect(paypal.getInvoice).not.toHaveBeenCalled();
  });

  it("says it isn't set up without a webhook id or database, so PayPal retries later", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
    expect((await deliver(event())).status).toBe(503);
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "WHID");
    hasDb.value = false;
    expect((await deliver(event())).status).toBe(503);
    expect(paypal.verifyWebhook).not.toHaveBeenCalled();
  });

  it("refuses a body that isn't a PayPal event", async () => {
    expect((await deliver("nope")).status).toBe(400);
    expect((await deliver(JSON.stringify({ hello: 1 }))).status).toBe(400);
  });
});
