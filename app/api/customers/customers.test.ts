import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true, email: "owner@example.com" }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: signedIn.email, method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

import { GET as listCustomers, POST as createCustomer } from "./route";
import { PATCH as updateCustomer } from "./[id]/route";
import { GET as getSuggestions } from "../entries/[id]/customer-suggestions/route";
import { POST as confirmCustomer } from "../entries/[id]/confirm-customer/route";
import { getPerson1Store } from "@/lib/person1-store";
import type { ExtractedEntry, ScanRecord } from "@/lib/person1-types";

describe("Customers Directory & Match Confirmation API", () => {
  beforeEach(() => {
    signedIn.value = true;
    signedIn.email = "owner@example.com";
  });

  it("POST & GET /api/customers: creates and lists directory customers", async () => {
    const postReq = new Request("http://localhost:3000/api/customers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Pak Ali (Bengkel)",
        email: "ali@example.com",
        phone: "+60123456789",
      }),
    });

    const createRes = await createCustomer(postReq);
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.name).toBe("Pak Ali (Bengkel)");
    expect(created.slug).toBe("pak-ali-bengkel");

    const getReq = new Request("http://localhost:3000/api/customers");
    const listRes = await listCustomers(getReq);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.some((c: { name: string }) => c.name === "Pak Ali (Bengkel)")).toBe(true);
  });

  it("PATCH /api/customers/[id]: updates customer contact details", async () => {
    const store = getPerson1Store();
    const custId = "cust-patch-test";
    await store.saveCustomer({
      id: custId,
      ownerEmail: "owner@example.com",
      name: "Mak Cik Siti",
      slug: "mak-cik-siti",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const patchReq = new Request(`http://localhost:3000/api/customers/${custId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "siti.new@example.com" }),
    });

    const res = await updateCustomer(patchReq, { params: Promise.resolve({ id: custId }) });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.email).toBe("siti.new@example.com");
  });

  it("GET /api/entries/[id]/customer-suggestions: returns matching customers", async () => {
    const store = getPerson1Store();
    const scanId = "scan-sug-test";
    const entryId = "entry-sug-test";

    await store.saveScan({
      id: scanId,
      ownerEmail: "owner@example.com",
      imageKey: "key",
      imageHash: "h1",
      mimeType: "image/jpeg",
      sizeBytes: 100,
      status: "completed",
      mode: "notebook",
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await store.saveEntries([
      {
        id: entryId,
        scanId,
        revision: 1,
        rawText: "Pak Ali 36.00",
        customerName: "Pak Ali",
        item: "Rokok",
        amountSen: 3600,
        rawAmountText: "36.00",
        date: "2026-10-18",
        classification: "debt",
        confidence: 0.9,
        isAmbiguous: false,
        included: true,
        sourceRef: { lineIndex: 1 },
        ownerEdited: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const req = new Request(`http://localhost:3000/api/entries/${entryId}/customer-suggestions`);
    const res = await getSuggestions(req, { params: Promise.resolve({ id: entryId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.suggestions)).toBe(true);
    expect(data.suggestions.length).toBeGreaterThan(0);
    expect(data.suggestions[0].customer.name).toBe("Pak Ali (Bengkel)");
  });

  it("POST /api/entries/[id]/confirm-customer: confirms identity and links entry", async () => {
    const store = getPerson1Store();
    const scanId = "scan-conf-test";
    const entryId = "entry-conf-test";
    const custId = "cust-conf-test";

    await store.saveScan({
      id: scanId,
      ownerEmail: "owner@example.com",
      imageKey: "key",
      imageHash: "h2",
      mimeType: "image/jpeg",
      sizeBytes: 100,
      status: "completed",
      mode: "notebook",
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await store.saveEntries([
      {
        id: entryId,
        scanId,
        revision: 1,
        rawText: "Ah Seng 39.90",
        customerName: "Ah Seng",
        item: "Susu",
        amountSen: 3990,
        rawAmountText: "39.90",
        date: "2026-10-18",
        classification: "debt",
        confidence: 0.9,
        isAmbiguous: false,
        included: true,
        sourceRef: { lineIndex: 1 },
        ownerEdited: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    await store.saveCustomer({
      id: custId,
      ownerEmail: "owner@example.com",
      name: "Ah Seng",
      slug: "ah-seng",
      email: "ahseng@example.com",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const req = new Request(`http://localhost:3000/api/entries/${entryId}/confirm-customer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId: custId }),
    });

    const res = await confirmCustomer(req, { params: Promise.resolve({ id: entryId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entry.confirmedCustomerId).toBe(custId);
    expect(data.customer.confirmedAt).toBeDefined();
  });
});
