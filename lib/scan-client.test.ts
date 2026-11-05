import { describe, expect, it, vi } from "vitest";
import { patchScanEntry, readPhoto, retryRead } from "./scan-client";

const ENTRY = { id: "e1", customerName: "Ah Seng", item: "Susu", amountSen: 3990, rawAmountText: "39.90", date: "2026-10-12", classification: "debt", isAmbiguous: false, included: true };

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("readPhoto", () => {
  it("uploads the photo and mode, and returns the lines read", async () => {
    const fetchImpl = respond(201, { scan: { id: "scan-1" }, entries: [ENTRY] });
    const result = await readPhoto(new Blob(["x"], { type: "image/jpeg" }), "receipt", fetchImpl);
    expect(result).toEqual({ ok: true, scanId: "scan-1", entries: [ENTRY] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/scans");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("mode")).toBe("receipt");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("preserves duplicate metadata so the UI can explain a reopened scan", async () => {
    const result = await readPhoto(
      new Blob(["x"]),
      "notebook",
      respond(200, { scan: { id: "scan-1" }, entries: [], isDuplicate: true, warning: "This photo was already scanned." }),
    );
    expect(result).toEqual({
      ok: true,
      scanId: "scan-1",
      entries: [],
      isDuplicate: true,
      warning: "This photo was already scanned.",
    });
  });

  it.each([
    [413, "tooBig"],
    [429, "tooMany"],
    [401, "signedOut"],
    [502, "failed"],
    [500, "failed"],
  ])("names a %i as %s", async (status, reason) => {
    const result = await readPhoto(new Blob(["x"]), "notebook", respond(status, { error: "x" }));
    expect(result).toEqual({ ok: false, reason, scanId: undefined });
  });

  it("says not connected only when the 503 is the AI reader's", async () => {
    const ai = await readPhoto(new Blob(["x"]), "notebook", respond(503, { error: "AI document scanning is not configured." }));
    expect(ai).toMatchObject({ ok: false, reason: "notConnected" });
    const signIn = await readPhoto(new Blob(["x"]), "notebook", respond(503, { error: "Sign-in isn't set up on this server." }));
    expect(signIn).toMatchObject({ ok: false, reason: "failed" });
  });

  it("keeps the scan id from a failed read, so the retry can reuse the upload", async () => {
    const result = await readPhoto(new Blob(["x"]), "notebook", respond(502, { scan: { id: "scan-9", status: "failed" }, error: "x" }));
    expect(result).toEqual({ ok: false, reason: "failed", scanId: "scan-9" });
  });

  it("calls a network error or an odd answer a failure", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await readPhoto(new Blob(["x"]), "notebook", offline)).toEqual({ ok: false, reason: "failed" });
    expect(await readPhoto(new Blob(["x"]), "notebook", respond(201, { scan: { id: "s" } }))).toEqual({ ok: false, reason: "failed", scanId: "s" });
  });
});

describe("patchScanEntry", () => {
  it("saves every reviewable field to the owner-scoped scan entry route", async () => {
    const updated = { ...ENTRY, customerName: "Ah Seng Trading", amountSen: 4250, included: false };
    const fetchImpl = respond(200, updated);
    const patch = {
      amountSen: 4250,
      included: false,
      isAmbiguous: false,
      customerName: "Ah Seng Trading",
      item: "Susu dan Milo",
      date: "2026-10-13",
    };

    await expect(patchScanEntry("scan/1", "entry 1", patch, fetchImpl)).resolves.toEqual(updated);
    expect(fetchImpl.mock.calls[0]).toEqual([
      "/api/scans/scan%2F1/entries/entry%201",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ]);
  });

  it("rejects a failed save so the review screen can keep its draft", async () => {
    await expect(
      patchScanEntry("scan-1", "entry-1", { included: false }, respond(503, { error: "Database unavailable" })),
    ).rejects.toThrow("Database unavailable");
  });
});

describe("retryRead", () => {
  it("reads the uploaded photo again", async () => {
    const fetchImpl = respond(200, { scan: { id: "scan-1" }, entries: [ENTRY] });
    expect(await retryRead("scan-1", fetchImpl)).toEqual({ ok: true, scanId: "scan-1", entries: [ENTRY] });
    expect(fetchImpl.mock.calls[0]).toEqual(["/api/scans/scan-1/retry", { method: "POST" }]);
  });

  it.each([404, 410])("drops the scan id when the upload is gone (%i), so the next try uploads again", async (status) => {
    expect(await retryRead("scan-1", respond(status, { error: "x" }))).toEqual({ ok: false, reason: "gone", scanId: undefined });
  });

  it("keeps the scan id when the retry fails without one", async () => {
    expect(await retryRead("scan-1", respond(502, { error: "x" }))).toEqual({ ok: false, reason: "failed", scanId: "scan-1" });
  });
});
