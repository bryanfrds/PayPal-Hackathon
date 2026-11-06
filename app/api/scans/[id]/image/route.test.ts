import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ value: true, email: "image-owner@example.com" }));
const image = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () => signedIn.value
    ? { email: signedIn.email, method: "email", exp: 9999999999 }
    : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));
vi.mock("@/lib/image-storage", () => ({ getScanImage: image.get }));

import { getPerson1Store } from "@/lib/person1-store";
import { GET } from "./route";

describe("GET /api/scans/[id]/image", () => {
  beforeEach(async () => {
    signedIn.value = true;
    signedIn.email = `image-owner-${Date.now()}-${Math.random()}@example.com`;
    image.get.mockReset().mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff]));
    await getPerson1Store().saveScan({
      id: "scan-image",
      ownerEmail: signedIn.email,
      imageKey: "scans/owner/scan.jpg",
      imageHash: "hash",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      status: "completed",
      mode: "notebook",
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it("streams the private image to its owner without caching", async () => {
    const response = await GET(new Request("http://x/api/scans/scan-image/image"), { params: Promise.resolve({ id: "scan-image" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
  });

  it("returns no bytes for unknown, wrong-owner, or signed-out requests", async () => {
    expect((await GET(new Request("http://x"), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
    signedIn.email = "intruder@example.com";
    expect((await GET(new Request("http://x"), { params: Promise.resolve({ id: "scan-image" }) })).status).toBe(404);
    signedIn.value = false;
    expect((await GET(new Request("http://x"), { params: Promise.resolve({ id: "scan-image" }) })).status).toBe(401);
    expect(image.get).not.toHaveBeenCalled();
  });
});
