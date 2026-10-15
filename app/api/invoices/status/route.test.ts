import { beforeEach, describe, expect, it, vi } from "vitest";

// Signed in as the shop owner unless a test says otherwise.
const signedIn = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: "owner@example.com", method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));


const paypal = vi.hoisted(() => ({ getInvoice: vi.fn() }));

vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return { ...actual, ...paypal };
});

const db = vi.hoisted(() => ({ value: null as null | { saveFacts: ReturnType<typeof vi.fn> } }));
vi.mock("@/lib/payment-db", () => ({ paymentDb: () => db.value, within: <T,>(p: Promise<T>) => p }));

import { PayPalError } from "@/lib/paypal";
import { POST } from "./route";

function post(body: unknown) {
  return POST(new Request("http://x/api/invoices/status", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  db.value = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/invoices/status", () => {
  it("refuses anyone who isn't signed in", async () => {
    signedIn.value = false;
    const res = await POST(new Request("http://localhost/api/invoices/status", { method: "POST", body: "{}" }));
    signedIn.value = true;
    expect(res.status).toBe(401);
  });

  it("returns each invoice's status and amounts in sen", async () => {
    paypal.getInvoice.mockImplementation(async (id: string) =>
      id === "INV2-PAID"
        ? { id, status: "PAID", amount: { currency_code: "MYR", value: "23.40" }, payments: { paid_amount: { value: "23.40" } }, due_amount: { value: "0.00" } }
        : { id, status: "SENT", amount: { value: "10.00" }, due_amount: { value: "10.00" } },
    );
    const res = await post({ ids: ["INV2-PAID", "INV2-OPEN"] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currency).toBe("MYR");
    expect(body.results).toEqual({
      "INV2-PAID": { ok: true, status: "PAID", currency: "MYR", totalSen: 2340, paidSen: 2340, dueSen: 0 },
      "INV2-OPEN": { ok: true, status: "SENT", totalSen: 1000, dueSen: 1000 },
    });
  });

  it("reports one failed invoice without failing the rest", async () => {
    paypal.getInvoice.mockImplementation(async (id: string) => {
      if (id === "INV2-BAD") throw new PayPalError("not found", { status: 404 });
      return { id, status: "SENT" };
    });
    const { results } = await (await post({ ids: ["INV2-BAD", "INV2-OK1"] })).json();
    expect(results["INV2-BAD"]).toEqual({ ok: false, error: "PayPal didn't answer. Try again." });
    expect(results["INV2-OK1"]).toEqual({ ok: true, status: "SENT" });
  });

  it("stops and says so once when PayPal isn't connected", async () => {
    paypal.getInvoice.mockRejectedValue(new PayPalError("PAYPAL_CLIENT_ID is not set. x"));
    const res = await post({ ids: ["INV2-1", "INV2-2", "INV2-3", "INV2-4", "INV2-5", "INV2-6", "INV2-7"] });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("PayPal isn't connected on this server yet.");
    expect(paypal.getInvoice.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("stops calling PayPal once it says to slow down", async () => {
    paypal.getInvoice.mockRejectedValue(new PayPalError("busy", { status: 429 }));
    const res = await post({ ids: ["INV2-1", "INV2-2", "INV2-3", "INV2-4", "INV2-5", "INV2-6", "INV2-7"] });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("PayPal is busy. Try again in a minute.");
    expect(paypal.getInvoice.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("refuses bad requests without calling PayPal", async () => {
    for (const body of [null, {}, { ids: [] }, { ids: ["../secret"] }, { ids: Array.from({ length: 26 }, (_, i) => `INV2-${i}`) }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(paypal.getInvoice).not.toHaveBeenCalled();
  });

  it("asks PayPal once per invoice even if an id is repeated", async () => {
    paypal.getInvoice.mockResolvedValue({ id: "INV2-1", status: "SENT" });
    await post({ ids: ["INV2-1", "INV2-1"] });
    expect(paypal.getInvoice).toHaveBeenCalledTimes(1);
  });

  it("saves each answer to the payments database, and still answers if that fails", async () => {
    db.value = { saveFacts: vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue("paid") };
    paypal.getInvoice.mockImplementation(async (id: string) => {
      if (id === "INV2-BAD") throw new PayPalError("not found", { status: 404 });
      return { id, status: "PAID", amount: { currency_code: "MYR", value: "10.00" } };
    });
    const res = await post({ ids: ["INV2-A", "INV2-B", "INV2-BAD"] });
    expect(res.status).toBe(200);
    expect(db.value.saveFacts).toHaveBeenCalledTimes(2);
    expect(db.value.saveFacts).toHaveBeenCalledWith("INV2-A", expect.objectContaining({ status: "PAID", totalSen: 1000 }), expect.any(Date), "app");
  });
});
