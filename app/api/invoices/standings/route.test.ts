import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: "owner@example.com", method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

const db = vi.hoisted(() => ({ value: null as null | { latestFacts: ReturnType<typeof vi.fn>; webhookSeenSince?: ReturnType<typeof vi.fn> } }));
vi.mock("@/lib/payment-db", () => ({ paymentDb: () => db.value, within: <T,>(p: Promise<T>) => p }));

import { POST } from "./route";

function post(body: unknown) {
  return POST(new Request("http://x/api/invoices/standings", { method: "POST", body: JSON.stringify(body) }));
}

const FACTS = { id: "INV2-A", status: "PAID", currency: "MYR", billedCurrency: "MYR", totalSen: 1000, paidSen: 1000, dueSen: 0, checkedAt: "2026-10-15T11:00:00.000Z", checkedBy: "webhook" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.unstubAllEnvs();
  db.value = null;
  signedIn.value = true;
});

describe("POST /api/invoices/standings", () => {
  it("refuses anyone who isn't signed in", async () => {
    signedIn.value = false;
    expect((await post({ ids: ["INV2-A"] })).status).toBe(401);
  });

  it("refuses bad ids", async () => {
    expect((await post({ ids: [] })).status).toBe(400);
    expect((await post({ ids: ["../x"] })).status).toBe(400);
    expect((await post({ ids: Array.from({ length: 101 }, (_, i) => `INV2-${i}0000`) })).status).toBe(400);
  });

  it("says there's no database, so the app keeps asking PayPal", async () => {
    expect(await (await post({ ids: ["INV2-A"] })).json()).toEqual({ available: false, webhook: false, results: [] });
  });

  it("returns the stored answers, and says the webhook works once PayPal has called recently", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "WHID");
    db.value = { latestFacts: vi.fn().mockResolvedValue([FACTS]), webhookSeenSince: vi.fn().mockResolvedValue(true) };
    const body = await (await post({ ids: ["INV2-A", "INV2-A", "INV2-B"] })).json();
    expect(body).toEqual({ available: true, webhook: true, results: [FACTS] });
    expect(db.value.latestFacts).toHaveBeenCalledWith(["INV2-A", "INV2-B"]);
    expect(db.value.webhookSeenSince).toHaveBeenCalledWith(24);
  });

  it("doesn't count a webhook PayPal hasn't called, or one that isn't set up", async () => {
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "WHID");
    db.value = { latestFacts: vi.fn().mockResolvedValue([]), webhookSeenSince: vi.fn().mockResolvedValue(false) };
    expect((await (await post({ ids: ["INV2-A"] })).json()).webhook).toBe(false);
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
    db.value.webhookSeenSince = vi.fn().mockResolvedValue(true);
    expect((await (await post({ ids: ["INV2-A"] })).json()).webhook).toBe(false);
    expect(db.value.webhookSeenSince).not.toHaveBeenCalled();
  });

  it("answers 503 when the database fails", async () => {
    db.value = { latestFacts: vi.fn().mockRejectedValue(new Error("down")) };
    expect((await post({ ids: ["INV2-A"] })).status).toBe(503);
  });
});
