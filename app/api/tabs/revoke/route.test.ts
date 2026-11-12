import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }));
const db = vi.hoisted(() => ({ tabDb: vi.fn() }));

vi.mock("@/lib/auth-server", () => auth);
vi.mock("@/lib/tab-db", () => db);

import { POST } from "./route";

let owner = 0;
function signedIn() {
  auth.requireOwner.mockResolvedValue({ email: `owner${++owner}@shop.my` });
}

function post(body: string) {
  return POST(new Request("http://x/api/tabs/revoke", { method: "POST", body }));
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/tabs/revoke", () => {
  it("needs a signed-in owner", async () => {
    auth.requireOwner.mockResolvedValue(NextResponse.json({ error: "Sign in to do that." }, { status: 401 }));
    expect((await post(JSON.stringify({ slug: "kak-lina" }))).status).toBe(401);
    expect(db.tabDb).not.toHaveBeenCalled();
  });

  it("turns the link off", async () => {
    signedIn();
    const revoke = vi.fn().mockResolvedValue(true);
    db.tabDb.mockReturnValue({ revoke });
    const res = await post(JSON.stringify({ slug: "kak-lina" }));
    expect(await res.json()).toEqual({ revoked: true });
    expect(revoke).toHaveBeenCalledWith(`owner${owner}@shop.my`, "kak-lina");
  });

  it("says sharing isn't set up without the database", async () => {
    signedIn();
    db.tabDb.mockReturnValue(null);
    expect((await post(JSON.stringify({ slug: "kak-lina" }))).status).toBe(503);
  });

  it("refuses a big body and a bad slug", async () => {
    signedIn();
    db.tabDb.mockReturnValue({ revoke: vi.fn() });
    expect((await post("x".repeat(5000))).status).toBe(413);
    expect((await post(JSON.stringify({ slug: "../x" }))).status).toBe(400);
  });

  it("throttles one owner after 60 a minute", async () => {
    signedIn();
    db.tabDb.mockReturnValue({ revoke: vi.fn().mockResolvedValue(false) });
    for (let i = 0; i < 60; i++) await post(JSON.stringify({ slug: "kak-lina" }));
    expect((await post(JSON.stringify({ slug: "kak-lina" }))).status).toBe(429);
  });
});
