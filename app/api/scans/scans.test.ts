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
    vi.stubEnv("ALLOW_SCAN_FIXTURES", "true");
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
    await createScan(req1);

    // Second upload of same image
    const req2 = makeUploadRequest(dummyJpeg, "image/jpeg", "notebook", "clear_handwriting");
    const res2 = await createScan(req2);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.isDuplicate).toBe(true);
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

  it("blocks fixtureScenario in production unless ALLOW_SCAN_FIXTURES=true across create, rescan, and retry", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_SCAN_FIXTURES", "");
    try {
      const prodCreate = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe8]), "image/jpeg", "notebook", "clear_handwriting"));
      expect(prodCreate.status).toBe(400);
      const prodCreateData = await prodCreate.json();
      expect(prodCreateData.entries).toBeUndefined();

      vi.stubEnv("ALLOW_SCAN_FIXTURES", "true");
      const validCreate = await createScan(makeUploadRequest(new Uint8Array([0xff, 0xd8, 0xff, 0xe9]), "image/jpeg", "notebook", "clear_handwriting"));
      expect(validCreate.status).toBe(201);
      const { scan } = await validCreate.json();

      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ALLOW_SCAN_FIXTURES", "");

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

      vi.stubEnv("ALLOW_SCAN_FIXTURES", "true");
      const allowedRetry = await retryScan(
        new Request(`http://localhost:3000/api/scans/${scan.id}/retry?fixtureScenario=clear_handwriting`, { method: "POST" }),
        { params: Promise.resolve({ id: scan.id }) },
      );
      expect(allowedRetry.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
