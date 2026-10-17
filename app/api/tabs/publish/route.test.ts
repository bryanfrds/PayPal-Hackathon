import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const auth = vi.hoisted(() => ({ requireOwner: vi.fn(), siteOrigin: vi.fn(() => "https://buku.example.com") }));
const db = vi.hoisted(() => ({ tabDb: vi.fn() }));

vi.mock("@/lib/auth-server", () => auth);
vi.mock("@/lib/tab-db", () => db);

import { buildTabSnapshot, MAX_SNAPSHOT_BYTES } from "@/lib/tab-snapshot";
import { POST } from "./route";

const snapshot = buildTabSnapshot(
  "kak-lina",
  [{ id: "T-1", customerName: "Kak Lina", item: "Milo", amountSen: 1200, date: "2026-10-01", status: "unpaid", source: "manual", createdAt: "2026-10-01T00:00:00Z" }],
  [],
  "Kedai Ah Seng",
)!;

let owner = 0;
function signedIn() {
  // A fresh owner per test, so the per-owner throttle doesn't carry over.
  auth.requireOwner.mockResolvedValue({ email: `owner${++owner}@shop.my` });
}

function post(body: string) {
  return POST(new Request("http://x/api/tabs/publish", { method: "POST", body }));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.siteOrigin.mockReturnValue("https://buku.example.com");
});

describe("POST /api/tabs/publish", () => {
  it("needs a signed-in owner", async () => {
    auth.requireOwner.mockResolvedValue(NextResponse.json({ error: "Sign in to do that." }, { status: 401 }));
    const res = await post(JSON.stringify({ slug: "kak-lina", snapshot }));
    expect(res.status).toBe(401);
    expect(db.tabDb).not.toHaveBeenCalled();
  });

  it("publishes and returns the full link on this site's own origin", async () => {
    signedIn();
    const publish = vi.fn().mockResolvedValue("AbCdEfGhIjKlMnOpQrStUv");
    db.tabDb.mockReturnValue({ publish });
    const res = await post(JSON.stringify({ slug: "kak-lina", snapshot }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://buku.example.com/t/AbCdEfGhIjKlMnOpQrStUv" });
    expect(publish).toHaveBeenCalledWith(`owner${owner}@shop.my`, "kak-lina", snapshot);
  });

  it("says sharing isn't set up without the database", async () => {
    signedIn();
    db.tabDb.mockReturnValue(null);
    expect((await post(JSON.stringify({ slug: "kak-lina", snapshot }))).status).toBe(503);
  });

  it("refuses an oversized body before reading it", async () => {
    signedIn();
    const res = await post("x".repeat(MAX_SNAPSHOT_BYTES + 2048));
    expect(res.status).toBe(413);
    expect(db.tabDb).not.toHaveBeenCalled();
  });

  it("refuses a bad snapshot", async () => {
    signedIn();
    db.tabDb.mockReturnValue({ publish: vi.fn() });
    expect((await post(JSON.stringify({ slug: "kak-lina", snapshot: { ...snapshot, extra: true } }))).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
  });

  it("throttles one owner after 60 updates a minute", async () => {
    signedIn();
    db.tabDb.mockReturnValue({ publish: vi.fn().mockResolvedValue("AbCdEfGhIjKlMnOpQrStUv") });
    for (let i = 0; i < 60; i++) expect((await post(JSON.stringify({ slug: "kak-lina", snapshot }))).status).toBe(200);
    const res = await post(JSON.stringify({ slug: "kak-lina", snapshot }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("reports a database failure as 502", async () => {
    signedIn();
    db.tabDb.mockReturnValue({ publish: vi.fn().mockRejectedValue(new Error("down")) });
    expect((await post(JSON.stringify({ slug: "kak-lina", snapshot }))).status).toBe(502);
  });
});
