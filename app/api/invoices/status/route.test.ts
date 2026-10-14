import { beforeEach, describe, expect, it, vi } from "vitest";

const paypal = vi.hoisted(() => ({ getInvoice: vi.fn() }));

vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return { ...actual, ...paypal };
});

import { PayPalError } from "@/lib/paypal";
import { POST } from "./route";

function post(body: unknown) {
  return POST(new Request("http://x/api/invoices/status", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/invoices/status", () => {
  it("returns each invoice's status and amounts in sen", async () => {
    paypal.getInvoice.mockImplementation(async (id: string) =>
      id === "INV2-PAID"
        ? { id, status: "PAID", amount: { currency_code: "MYR", value: "23.40" }, payments: { paid_amount: { value: "23.40" } }, due_amount: { value: "0.00" } }
        : { id, status: "SENT", amount: { value: "10.00" }, due_amount: { value: "10.00" } },
    );
    const res = await post({ ids: ["INV2-PAID", "INV2-OPEN"] });
    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual({
      "INV2-PAID": { ok: true, status: "PAID", totalSen: 2340, paidSen: 2340, dueSen: 0 },
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
});
