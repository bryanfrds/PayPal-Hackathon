import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true, email: "owner@example.com" }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: signedIn.email, method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

import { GET as getApprovedDebts } from "./route";
import { getPerson1Store } from "@/lib/person1-store";
import type { ApprovedDebtRecord } from "@/lib/person1-types";

describe("GET /api/debts/approved", () => {
  beforeEach(() => {
    signedIn.value = true;
    signedIn.email = "owner@example.com";
  });

  it("returns only the signed-in owner's approved debts", async () => {
    const store = getPerson1Store();

    const ownerDebt: ApprovedDebtRecord = {
      id: "debt-1",
      ownerEmail: "owner@example.com",
      sourceEntryId: "entry-1",
      scanId: "scan-1",
      customerId: "cust-1",
      customerName: "Pak Ali",
      customerEmail: "ali@example.com",
      amountSen: 3600,
      currency: "MYR",
      item: "Rokok",
      date: "2026-10-18",
      approvedAt: new Date().toISOString(),
      handoffKey: "handoff-1",
    };

    const otherOwnerDebt: ApprovedDebtRecord = {
      id: "debt-2",
      ownerEmail: "other@example.com",
      sourceEntryId: "entry-2",
      scanId: "scan-2",
      customerId: "cust-2",
      customerName: "Mak Siti",
      customerEmail: "siti@example.com",
      amountSen: 5000,
      currency: "MYR",
      item: "Beras",
      date: "2026-10-19",
      approvedAt: new Date().toISOString(),
      handoffKey: "handoff-2",
    };

    await store.saveApprovedDebts([ownerDebt, otherOwnerDebt]);

    const res = await getApprovedDebts();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.approvedDebts).toHaveLength(1);
    expect(data.approvedDebts[0].id).toBe("debt-1");
    expect(data.approvedDebts[0].ownerEmail).toBe("owner@example.com");
  });

  it("returns empty array when no approved debts exist", async () => {
    // Use a unique owner to ensure isolation from other tests
    signedIn.email = "empty-owner@example.com";
    const res = await getApprovedDebts();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.approvedDebts)).toBe(true);
    expect(data.approvedDebts.length).toBe(0);
  });

  it("requires authentication", async () => {
    signedIn.value = false;
    const res = await getApprovedDebts();
    expect(res.status).toBe(401);
  });
});
