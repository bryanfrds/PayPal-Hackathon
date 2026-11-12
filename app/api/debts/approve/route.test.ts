import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true, email: "owner@example.com" }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: signedIn.email, method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

import { POST as approveDebts } from "./route";
import { getPerson1Store } from "@/lib/person1-store";

describe("POST /api/debts/approve", () => {
  const store = getPerson1Store();
  const owner = "owner@example.com";

  beforeEach(async () => {
    signedIn.value = true;
    signedIn.email = owner;

    await store.saveScan({
      id: "scan-appr-route",
      ownerEmail: owner,
      imageKey: "key",
      imageHash: "hash-route",
      mimeType: "image/jpeg",
      sizeBytes: 200,
      status: "completed",
      mode: "notebook",
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await store.saveCustomer({
      id: "cust-appr-route",
      ownerEmail: owner,
      name: "Kak Lina",
      slug: "kak-lina",
      email: "lina@example.com",
      confirmedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await store.saveEntries([
      {
        id: "entry-appr-route-1",
        scanId: "scan-appr-route",
        revision: 1,
        rawText: "Kak Lina 22.40",
        customerName: "Kak Lina",
        item: "Telur",
        amountSen: 2240,
        rawAmountText: "22.40",
        date: "2026-10-18",
        classification: "debt",
        confidence: 0.95,
        isAmbiguous: false,
        included: true,
        confirmedCustomerId: "cust-appr-route",
        sourceRef: { lineIndex: 1 },
        ownerEdited: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  });

  it("approves valid entries and returns structured payload for invoicing", async () => {
    const req = new Request("http://localhost:3000/api/debts/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryIds: ["entry-appr-route-1"] }),
    });

    const res = await approveDebts(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.approved).toHaveLength(1);
    expect(data.approved[0].amountSen).toBe(2240);
    expect(data.approved[0].customerEmail).toBe("lina@example.com");
  });

  it("returns 400 for invalid entryIds body", async () => {
    const req = new Request("http://localhost:3000/api/debts/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryIds: [] }),
    });

    const res = await approveDebts(req);
    expect(res.status).toBe(400);
  });
});
