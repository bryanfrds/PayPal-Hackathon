import { beforeEach, describe, expect, it, vi } from "vitest";

const paypal = vi.hoisted(() => ({ getInvoice: vi.fn() }));

vi.mock("@/lib/paypal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal")>();
  return { ...actual, ...paypal };
});

import { PayPalError } from "@/lib/paypal";
import { GET } from "./route";

function get(id: string) {
  return GET(new Request(`http://x/api/invoices/${id}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/invoices/[id]", () => {
  it("returns the status, number and pay link", async () => {
    paypal.getInvoice.mockResolvedValue({ id: "INV2-1", status: "PAID", detail: { invoice_number: "0042", metadata: { recipient_view_url: "https://pay/1" } } });
    const res = await get("INV2-1");
    expect(await res.json()).toEqual({ status: "PAID", number: "0042", payerLink: "https://pay/1" });
  });

  it("refuses a malformed id without calling PayPal", async () => {
    const res = await get("../secret");
    expect(res.status).toBe(400);
    expect(paypal.getInvoice).not.toHaveBeenCalled();
  });

  it("maps PayPal failures to short messages", async () => {
    paypal.getInvoice.mockRejectedValue(new PayPalError("PAYPAL_CLIENT_ID is not set. x"));
    const res = await get("INV2-1");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("PayPal isn't connected on this server yet.");
  });
});
