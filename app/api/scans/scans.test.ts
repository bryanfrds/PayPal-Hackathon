import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true, email: "owner@example.com" }));
const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: signedIn.email, method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));
vi.mock("@vercel/blob", () => blob);

import { POST as createScan } from "./route";
import { GET as getScan } from "./[id]/route";
import { POST as retryScan } from "./[id]/retry/route";
import { POST as rescanScan } from "./[id]/rescan/route";
import { PATCH as updateEntry } from "./[id]/entries/[entryId]/route";
import { getPerson1Store } from "@/lib/person1-store";
import { scanImageKey } from "@/lib/image-storage";

describe("Scans API", () => {
  const dummyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

  beforeEach(() => {
    vi.stubEnv("ALLOW_SCAN_FIXTURES", "true");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-blob-token");
    blob.put.mockImplementation(async (pathname: string) => ({ pathname }));
    blob.get.mockImplementation(async () => ({ statusCode: 200, stream: new Blob([dummyJpeg]).stream() }));
    signedIn.value = true;
    signedIn.email = `owner-${Date.now()}-${Math.random()}@example.com`;
  });

  function makeUploadRequest(bytes: Uint8Array, mime = "image/jpeg", mode = "notebook", fixtureScenario?: string) {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(bytes)], { type: mime });
    formData.append("file", blob, "notebook.jpg");
    formData.append("mode", mode);
    if (fixtureScenario) {
      formData.append("fixtureScenario", fixtureScenario);
    }
    return new Request("http://localhost:3000/api/scans", {
      method: "POST",
      body: formData,
    });
  }

  it("POST /api/scans: returns 503 when AI is unconfigured and saves no fake entries", async () => {
    const unconfiguredJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x47]);
    const req = makeUploadRequest(unconfiguredJpeg);
    const res = await createScan(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toMatch(/AI document scanning is not configured/i);
    expect(data.scan.status).toBe("failed");
    expect(data.entries).toBeUndefined();
  });

  it("POST /api/scans: uploads image and extracts draft entries when fixture is provided", async () => {
    const req = makeUploadRequest(dummyJpeg, "image/jpeg", "notebook", "clear_handwriting");
    const res = await createScan(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.scan).toBeDefined();
    expect(data.scan.id).toBeDefined();
    expect(data.entries).toBeDefined();
    expect(data.entries.length).toBeGreaterThan(0);
    expect(data.isDuplicate).toBe(false);
  });

  it("POST /api/scans: detects duplicate upload with matching image hash", async () => {
    // First upload
    const req1 = makeUploadRequest(dummyJpeg, "image/jpeg", "notebook", "clear_handwriting");
    const res1 = await createScan(req1);
    expect(res1.status).toBe(201);
    const data1 = await res1.json();
    const firstScanId = data1.scan.id;
    const firstEntries = data1.entries;
    const putCallCount = blob.put.mock.calls.length;

    // Second upload of same image
    const req2 = makeUploadRequest(dummyJpeg, "image/jpeg", "notebook", "clear_handwriting");
    const res2 = await createScan(req2);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.isDuplicate).toBe(true);
    expect(data2.warning).toBeDefined();
    expect(data2.scan.id).toBe(firstScanId); // Same scan returned
    expect(data2.entries).toEqual(firstEntries); // Same entries, no re-extraction
    expect(blob.put.mock.calls.length).toBe(putCallCount); // No second storage call
  });

  it("POST /api/scans: atomically coalesces simultaneous identical uploads", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xeb, 0x00, 0x10]);
    const putCallCount = blob.put.mock.calls.length;
    blob.put.mockImplementationOnce(async (pathname: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { pathname };
    });
    const store = getPerson1Store();
    const findScanByHash = store.findScanByHash.bind(store);
    let initialReads = 0;
    const findSpy = vi.spyOn(store, "findScanByHash").mockImplementation(async (ownerEmail, imageHash) => {
      initialReads += 1;
      return initialReads <= 2 ? null : findScanByHash(ownerEmail, imageHash);
    });

    try {
      const [first, second] = await Promise.all([
        createScan(makeUploadRequest(bytes, "image/jpeg", "notebook", "clear_handwriting")),
        createScan(makeUploadRequest(bytes, "image/jpeg", "notebook", "clear_handwriting")),
      ]);
      const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);

      expect(firstBody.scan.id).toBe(secondBody.scan.id);
      expect(blob.put.mock.calls.length - putCallCount).toBe(1);
      expect([firstBody.isDuplicate, secondBody.isDuplicate].sort()).toEqual([false, true]);
      expect([first.status, second.status].sort()).toEqual([201, 409]);
    } finally {
      findSpy.mockRestore();
    }
  });

  it("POST /api/scans/[id]/retry: waits for an in-progress scan without extracting again", async () => {
    const store = getPerson1Store();
    const scanId = `scan-processing-${Date.now()}`;
    const now = new Date().toISOString();
    await store.saveScan({
      id: scanId,
      ownerEmail: signedIn.email,
      imageKey: scanImageKey(signedIn.email, scanId, "image/jpeg"),
      imageHash: `hash-${scanId}`,
      mimeType: "image/jpeg",
      sizeBytes: dummyJpeg.byteLength,
      status: "processing",
      mode: "notebook",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });

    const response = await retryScan(new Request(`http://localhost:3000/api/scans/${scanId}/retry`, { method: "POST" }), {
      params: Promise.resolve({ id: scanId }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ scan: { id: scanId, status: "processing" } });
  });

  it("POST /api/scans: retries storage for a previously failed hash claim", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xec, 0x00, 0x10]);
    const putCallCount = blob.put.mock.calls.length;
    blob.put.mockRejectedValueOnce(Object.assign(new Error("temporary blob failure"), { statusCode: 503 }));

    const first = await createScan(makeUploadRequest(bytes, "image/jpeg", "notebook", "clear_handwriting"));
    const second = await createScan(makeUploadRequest(bytes, "image/jpeg", "notebook", "clear_handwriting"));
    const body = await second.json();

    expect(first.status).toBe(503);
    expect(second.status).toBe(200);
    expect(body.entries.length).toBeGreaterThan(0);
    expect(blob.put.mock.calls.length - putCallCount).toBe(2);
  });

  it("GET /api/scans/[id]: returns scan and draft entries", async () => {
    const createRes = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]), "image/jpeg", "notebook", "clear_handwriting"));
    const { scan } = await createRes.json();

    const getReq = new Request(`http://localhost:3000/api/scans/${scan.id}`);
    const res = await getScan(getReq, { params: Promise.resolve({ id: scan.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scan.id).toBe(scan.id);
    expect(data.entries.length).toBeGreaterThan(0);
  });

  it("PATCH /api/scans/[id]/entries/[entryId]: saves corrections to draft line", async () => {
    const createRes = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe2]), "image/jpeg", "notebook", "clear_handwriting"));
    const { scan, entries } = await createRes.json();
    const entry = entries[0];

    const patchReq = new Request(
      `http://localhost:3000/api/scans/${scan.id}/entries/${entry.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName: "Pak Ali Corrected",
          amountSen: 5000,
          included: true,
        }),
      },
    );

    const res = await updateEntry(patchReq, {
      params: Promise.resolve({ id: scan.id, entryId: entry.id }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.customerName).toBe("Pak Ali Corrected");
    expect(updated.amountSen).toBe(5000);
    expect(updated.ownerEdited).toBe(true);
  });

  it("POST /api/scans/[id]/rescan: starts a new extraction revision", async () => {
    const createRes = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe3]), "image/jpeg", "notebook", "clear_handwriting"));
    const { scan } = await createRes.json();

    const rescanReq = new Request(`http://localhost:3000/api/scans/${scan.id}/rescan?fixtureScenario=clear_handwriting`, {
      method: "POST",
    });
    const res = await rescanScan(rescanReq, { params: Promise.resolve({ id: scan.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scan.revision).toBe(2);
    expect(data.entries.every((e: { revision: number }) => e.revision === 2)).toBe(true);
  });

  it("preserves owner corrections and customer confirmation on matching rescan lines", async () => {
    const createRes = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xea]), "image/jpeg", "notebook", "clear_handwriting"));
    const { scan, entries } = await createRes.json();
    const original = entries[0];
    const store = getPerson1Store();
    await store.saveCustomer({
      id: "cust-rescan",
      ownerEmail: signedIn.email,
      name: "Corrected Customer",
      slug: "corrected-customer",
      email: "corrected@example.com",
      confirmedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await store.updateEntry(signedIn.email, original.id, {
      customerName: "Corrected Customer",
      amountSen: 9876,
      included: false,
      confirmedCustomerId: "cust-rescan",
      ownerEdited: true,
    });

    const res = await rescanScan(
      new Request(`http://localhost:3000/api/scans/${scan.id}/rescan?fixtureScenario=clear_handwriting`, { method: "POST" }),
      { params: Promise.resolve({ id: scan.id }) },
    );
    const data = await res.json();
    const preserved = data.entries.find((entry: { sourceRef: { lineIndex: number } }) => entry.sourceRef.lineIndex === original.sourceRef.lineIndex);
    expect(preserved).toMatchObject({
      revision: 2,
      customerName: "Corrected Customer",
      amountSen: 9876,
      included: false,
      confirmedCustomerId: "cust-rescan",
      ownerEdited: true,
    });
    expect(preserved.id).not.toBe(original.id);
    expect(preserved.rawText).toBe(original.rawText);
  });

  it("rejects unknown fixtureScenario across create, rescan, and retry without saving fake entries", async () => {
    const badCreate = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe4]), "image/jpeg", "notebook", "bogus_scenario"));
    expect(badCreate.status).toBe(400);
    const badCreateData = await badCreate.json();
    expect(badCreateData.entries).toBeUndefined();

    const validCreate = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe5]), "image/jpeg", "notebook", "missing_date"));
    expect(validCreate.status).toBe(201);
    const { scan } = await validCreate.json();

    const badRescan = await rescanScan(
      new Request(`http://localhost:3000/api/scans/${scan.id}/rescan?fixtureScenario=bogus_scenario`, { method: "POST" }),
      { params: Promise.resolve({ id: scan.id }) },
    );
    expect(badRescan.status).toBe(400);

    const badRetry = await retryScan(
      new Request(`http://localhost:3000/api/scans/${scan.id}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureScenario: "bogus_scenario" }),
      }),
      { params: Promise.resolve({ id: scan.id }) },
    );
    expect(badRetry.status).toBe(400);
  });

  it("blocks fixtureScenario in production across create, rescan, and retry", async () => {
    const validCreate = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe9]), "image/jpeg", "notebook", "clear_handwriting"));
    expect(validCreate.status).toBe(201);
    const { scan } = await validCreate.json();

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_SCAN_FIXTURES", "");
    try {
      const prodCreate = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe8]), "image/jpeg", "notebook", "clear_handwriting"));
      expect(prodCreate.status).toBe(400);
      const prodCreateData = await prodCreate.json();
      expect(prodCreateData.entries).toBeUndefined();

      const prodRescan = await rescanScan(
        new Request(`http://localhost:3000/api/scans/${scan.id}/rescan?fixtureScenario=clear_handwriting`, { method: "POST" }),
        { params: Promise.resolve({ id: scan.id }) },
      );
      expect(prodRescan.status).toBe(400);

      const prodRetry = await retryScan(
        new Request(`http://localhost:3000/api/scans/${scan.id}/retry?fixtureScenario=clear_handwriting`, { method: "POST" }),
        { params: Promise.resolve({ id: scan.id }) },
      );
      expect(prodRetry.status).toBe(400);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
