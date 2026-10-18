import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true, email: "owner@example.com" }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: signedIn.email, method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

import { POST as createScan } from "./route";
import { GET as getScan } from "./[id]/route";
import { POST as retryScan } from "./[id]/retry/route";
import { POST as rescanScan } from "./[id]/rescan/route";
import { PATCH as updateEntry } from "./[id]/entries/[entryId]/route";

describe("Scans API", () => {
  const dummyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

  beforeEach(() => {
    signedIn.value = true;
    signedIn.email = "owner@example.com";
  });

  function makeUploadRequest(bytes: Uint8Array, mime = "image/jpeg", mode = "notebook") {
    const formData = new FormData();
    const blob = new Blob([bytes], { type: mime });
    formData.append("file", blob, "notebook.jpg");
    formData.append("mode", mode);
    return new Request("http://localhost:3000/api/scans", {
      method: "POST",
      body: formData,
    });
  }

  it("POST /api/scans: uploads image and extracts draft entries", async () => {
    const req = makeUploadRequest(dummyJpeg);
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
    const req1 = makeUploadRequest(dummyJpeg);
    await createScan(req1);

    // Second upload of same image
    const req2 = makeUploadRequest(dummyJpeg);
    const res2 = await createScan(req2);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.isDuplicate).toBe(true);
  });

  it("GET /api/scans/[id]: returns scan and draft entries", async () => {
    const createRes = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0x01])));
    const { scan } = await createRes.json();

    const getReq = new Request(`http://localhost:3000/api/scans/${scan.id}`);
    const res = await getScan(getReq, { params: Promise.resolve({ id: scan.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scan.id).toBe(scan.id);
    expect(data.entries.length).toBeGreaterThan(0);
  });

  it("PATCH /api/scans/[id]/entries/[entryId]: saves corrections to draft line", async () => {
    const createRes = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0x02])));
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
    const createRes = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0x03])));
    const { scan } = await createRes.json();

    const rescanReq = new Request(`http://localhost:3000/api/scans/${scan.id}/rescan`, {
      method: "POST",
    });
    const res = await rescanScan(rescanReq, { params: Promise.resolve({ id: scan.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scan.revision).toBe(2);
    expect(data.entries.every((e: { revision: number }) => e.revision === 2)).toBe(true);
  });
});
