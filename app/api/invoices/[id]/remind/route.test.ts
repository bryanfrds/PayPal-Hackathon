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

// In-memory holds unless a test gives the route a payments database.
const db = vi.hoisted(() => ({
  value: null as null | {
    claimReminder: ReturnType<typeof vi.fn>;
    releaseReminder: ReturnType<typeof vi.fn>;
    getOwnerInvoice?: ReturnType<typeof vi.fn>;
    invoiceExists?: ReturnType<typeof vi.fn>;
  },
}));
vi.mock("@/lib/payment-db", () => ({ paymentDb: () => db.value }));

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
  db.value = null;
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
    expect(again.status).toBe(409);
    expect((await again.json()).alreadySent).toBe(true);
    expect(paypal.remindInvoice).toHaveBeenCalledTimes(1);
  });

  it("holds back a second request that arrives while the first is still with PayPal", async () => {
    let finish: () => void = () => {};
    paypal.getInvoice.mockResolvedValue(owed("INV2-RACE"));
    paypal.remindInvoice.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const first = remind("INV2-RACE");
    const second = await remind("INV2-RACE");
    finish();
    expect((await first).status).toBe(200);
    expect(second.status).toBe(409);
    expect(paypal.remindInvoice).toHaveBeenCalledTimes(1);
  });

  it.each([400, 422, 429])("lets the owner try again after PayPal clearly refused (%i)", async (status) => {
    const id = `INV2-RETRY-${status}`;
    paypal.getInvoice.mockResolvedValue(owed(id));
    paypal.remindInvoice.mockRejectedValueOnce(new PayPalError("refused", { status }));
    const res = await remind(id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).maybeSent).toBeUndefined();
    expect((await remind(id)).status).toBe(200);
  });

  it("lets the owner try again when the lookup failed, since nothing was sent", async () => {
    paypal.getInvoice.mockRejectedValueOnce(new PayPalError("busy", { status: 503 })).mockResolvedValue(owed("INV2-LOOKUP"));
    expect((await remind("INV2-LOOKUP")).status).toBe(502);
    expect((await remind("INV2-LOOKUP")).status).toBe(200);
  });

  it("treats a PayPal server error on the send as maybe sent, and holds back a retry", async () => {
    paypal.getInvoice.mockResolvedValue(owed("INV2-5XX"));
    paypal.remindInvoice.mockRejectedValueOnce(new PayPalError("gateway", { status: 504 }));
    const res = await remind("INV2-5XX");
    expect((await res.json()).maybeSent).toBe(true);
    expect((await remind("INV2-5XX")).status).toBe(409);
    expect(paypal.remindInvoice).toHaveBeenCalledTimes(1);
  });

  it("treats no answer from PayPal as maybe sent, and holds back a retry", async () => {
    paypal.getInvoice.mockResolvedValue(owed("INV2-SILENT"));
    paypal.remindInvoice.mockRejectedValueOnce(new PayPalError("Could not reach PayPal"));
    const res = await remind("INV2-SILENT");
    expect(res.status).toBe(502);
    expect((await res.json()).maybeSent).toBe(true);
    expect((await remind("INV2-SILENT")).status).toBe(409);
  });

  it("says when PayPal has no such invoice", async () => {
    paypal.getInvoice.mockRejectedValue(new PayPalError("not found", { status: 404 }));
    expect((await remind("INV2-GONE")).status).toBe(404);
    expect(paypal.remindInvoice).not.toHaveBeenCalled();
  });

  it("never holds back an invoice it refused to remind about", async () => {
    paypal.getInvoice.mockResolvedValueOnce(owed("INV2-LATER", "PAYMENT_PENDING")).mockResolvedValue(owed("INV2-LATER"));
    expect((await remind("INV2-LATER")).status).toBe(409);
    expect((await remind("INV2-LATER")).status).toBe(200);
  });

  describe("with the payments database", () => {
    it("does not reveal or remind another owner's invoice (returns 404 when invoice exists in db under another owner)", async () => {
      db.value = {
        claimReminder: vi.fn(),
        releaseReminder: vi.fn(),
        getOwnerInvoice: vi.fn().mockResolvedValue(null),
        invoiceExists: vi.fn().mockResolvedValue(true),
      };
      const res = await remind("INV2-NOT-MINE");
      expect(res.status).toBe(404);
      expect(db.value?.invoiceExists).toHaveBeenCalledWith("INV2-NOT-MINE");
      expect(paypal.getInvoice).not.toHaveBeenCalled();
    });

    it("reminds successfully when getOwnerInvoice returns the owner's row", async () => {
      db.value = {
        claimReminder: vi.fn().mockResolvedValue(true),
        releaseReminder: vi.fn(),
        getOwnerInvoice: vi.fn().mockResolvedValue({ id: "INV2-MINE", ownerEmail: "owner@example.com" }),
        invoiceExists: vi.fn().mockResolvedValue(true),
      };
      paypal.getInvoice.mockResolvedValue(owed("INV2-MINE"));
      const res = await remind("INV2-MINE");
      expect(res.status).toBe(200);
      expect(paypal.remindInvoice).toHaveBeenCalledWith("INV2-MINE");
    });

    it("reminds successfully for an unrecorded invoice (getOwnerInvoice null, invoiceExists false)", async () => {
      db.value = {
        claimReminder: vi.fn().mockResolvedValue(true),
        releaseReminder: vi.fn(),
        getOwnerInvoice: vi.fn().mockResolvedValue(null),
        invoiceExists: vi.fn().mockResolvedValue(false),
      };
      paypal.getInvoice.mockResolvedValue(owed("INV2-UNRECORDED"));
      const res = await remind("INV2-UNRECORDED");
      expect(res.status).toBe(200);
      expect(db.value?.invoiceExists).toHaveBeenCalledWith("INV2-UNRECORDED");
      expect(paypal.remindInvoice).toHaveBeenCalledWith("INV2-UNRECORDED");
    });
    it("holds the invoice in the database, across server instances", async () => {
      db.value = { claimReminder: vi.fn().mockResolvedValue(false), releaseReminder: vi.fn().mockResolvedValue(undefined) };
      const res = await remind("INV2-DB-HELD");
      expect(res.status).toBe(409);
      expect((await res.json()).alreadySent).toBe(true);
      expect(db.value.claimReminder).toHaveBeenCalledWith("INV2-DB-HELD", 12 * 60 * 60 * 1000);
      expect(paypal.getInvoice).not.toHaveBeenCalled();
    });

    it("releases the database hold when PayPal clearly refused", async () => {
      db.value = { claimReminder: vi.fn().mockResolvedValue(true), releaseReminder: vi.fn().mockResolvedValue(undefined) };
      paypal.getInvoice.mockResolvedValue(owed("INV2-DB-PAID", "PAID"));
      expect((await remind("INV2-DB-PAID")).status).toBe(409);
      expect(db.value.releaseReminder).toHaveBeenCalledWith("INV2-DB-PAID");
    });

    it("finishes letting go of the hold before it answers", async () => {
      let released = false;
      db.value = {
        claimReminder: vi.fn().mockResolvedValue(true),
        releaseReminder: vi.fn(() => new Promise<void>((resolve) => setTimeout(() => ((released = true), resolve()), 20))),
      };
      paypal.getInvoice.mockResolvedValue(owed("INV2-DB-SLOW", "CANCELLED"));
      await remind("INV2-DB-SLOW");
      expect(released).toBe(true);
    });

    it("sends nothing when the hold can't be checked", async () => {
      db.value = { claimReminder: vi.fn().mockRejectedValue(new Error("db down")), releaseReminder: vi.fn() };
      expect((await remind("INV2-DB-DOWN")).status).toBe(503);
      expect(paypal.remindInvoice).not.toHaveBeenCalled();
    });
  });
});
