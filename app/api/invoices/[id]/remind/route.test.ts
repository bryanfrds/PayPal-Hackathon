import { beforeEach, describe, expect, it, vi } from "vitest";

// Signed in as the shop owner unless a test says otherwise.
const signedIn = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: "owner@example.com", method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

const paypal = vi.hoisted(() => ({ getInvoice: vi.fn(), remindInvoice: vi.fn() }));
vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return { ...actual, ...paypal };
});

import { PayPalError } from "@/lib/paypal";
import { POST } from "./route";

// The route remembers reminded invoices, so each test uses its own invoice id.
function remind(id: string) {
  return POST(new Request(`http://x/api/invoices/${id}/remind`, { method: "POST" }), { params: Promise.resolve({ id }) });
}

function owed(id: string, status = "SENT") {
  return { id, status, amount: { currency_code: "MYR", value: "10.00" }, due_amount: { value: "10.00" } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/invoices/[id]/remind", () => {
  it("refuses anyone who isn't signed in, without calling PayPal", async () => {
    signedIn.value = false;
    const res = await remind("INV2-SIGNED-OUT");
    signedIn.value = true;
    expect(res.status).toBe(401);
    expect(paypal.getInvoice).not.toHaveBeenCalled();
  });

  it("refuses a malformed id", async () => {
    const res = await remind("../x");
    expect(res.status).toBe(400);
  });

  it("reminds about an invoice that's still owed", async () => {
    paypal.getInvoice.mockResolvedValue(owed("INV2-OWED"));
    const res = await remind("INV2-OWED");
    expect(res.status).toBe(200);
    expect(paypal.remindInvoice).toHaveBeenCalledWith("INV2-OWED");
  });

  it("reminds about a partly paid invoice", async () => {
    paypal.getInvoice.mockResolvedValue({ ...owed("INV2-PART", "PARTIALLY_PAID"), due_amount: { value: "4.00" } });
    expect((await remind("INV2-PART")).status).toBe(200);
  });

  it.each([
    ["PAID", "paid"],
    ["MARKED_AS_PAID", "paid"],
    ["PAID_EXTERNAL", "paid"],
    ["CANCELLED", "closed"],
    ["REFUNDED", "closed"],
    ["PAYMENT_PENDING", "pending"],
    ["DRAFT", "unknown"],
    ["SOMETHING_NEW", "unknown"],
  ])("never reminds about a %s invoice", async (status, reason) => {
    const id = `INV2-NO-${status.replaceAll("_", "-")}`;
    paypal.getInvoice.mockResolvedValue(owed(id, status));
    const res = await remind(id);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe(reason);
    expect(paypal.remindInvoice).not.toHaveBeenCalled();
  });

  it("never reminds when PayPal says nothing is due", async () => {
    paypal.getInvoice.mockResolvedValue({ ...owed("INV2-ZERO"), due_amount: { value: "0.00" } });
    expect((await remind("INV2-ZERO")).status).toBe(409);
    expect(paypal.remindInvoice).not.toHaveBeenCalled();
  });

  it("holds back a second reminder for the same invoice", async () => {
    paypal.getInvoice.mockResolvedValue(owed("INV2-TWICE"));
    expect((await remind("INV2-TWICE")).status).toBe(200);
    const again = await remind("INV2-TWICE");
    expect(again.status).toBe(429);
    expect(paypal.remindInvoice).toHaveBeenCalledTimes(1);
  });

  it("lets the owner try again after PayPal clearly refused", async () => {
    paypal.getInvoice.mockResolvedValue(owed("INV2-RETRY"));
    paypal.remindInvoice.mockRejectedValueOnce(new PayPalError("busy", { status: 503 }));
    expect((await remind("INV2-RETRY")).status).toBe(502);
    expect((await remind("INV2-RETRY")).status).toBe(200);
  });

  it("treats no answer from PayPal as maybe sent, and holds back a retry", async () => {
    paypal.getInvoice.mockResolvedValue(owed("INV2-SILENT"));
    paypal.remindInvoice.mockRejectedValueOnce(new PayPalError("Could not reach PayPal"));
    const res = await remind("INV2-SILENT");
    expect(res.status).toBe(502);
    expect((await res.json()).maybeSent).toBe(true);
    expect((await remind("INV2-SILENT")).status).toBe(429);
  });

  it("says when PayPal has no such invoice", async () => {
    paypal.getInvoice.mockRejectedValue(new PayPalError("not found", { status: 404 }));
    expect((await remind("INV2-GONE")).status).toBe(404);
    expect(paypal.remindInvoice).not.toHaveBeenCalled();
  });
});
