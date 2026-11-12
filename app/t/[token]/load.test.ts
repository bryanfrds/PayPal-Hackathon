import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
const hdrs = vi.hoisted(() => ({ headers: vi.fn() }));
const db = vi.hoisted(() => ({ tabDb: vi.fn() }));

vi.mock("next/navigation", () => nav);
vi.mock("next/headers", () => hdrs);
vi.mock("@/lib/tab-db", () => db);

import { buildTabSnapshot } from "@/lib/tab-snapshot";
import { loadForPage } from "./load";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const snapshot = buildTabSnapshot(
  "kak-lina",
  [{ id: "T-1", customerName: "Kak Lina", item: "Milo", amountSen: 1200, date: "2026-10-01", status: "unpaid", source: "manual", createdAt: "2026-10-01T00:00:00Z" }],
  [],
  "Kedai Ah Seng",
)!;

let ip = 0;
beforeEach(() => {
  vi.clearAllMocks();
  hdrs.headers.mockResolvedValue(new Headers({ "x-forwarded-for": `10.0.0.${++ip}` }));
});

describe("the /t/<token> loader", () => {
  it("shows a live tab with links under /t/<token>", async () => {
    db.tabDb.mockReturnValue({ read: vi.fn().mockResolvedValue({ customerName: "Kak Lina", shopName: "Kedai Ah Seng", snapshot, updatedAt: "2026-10-17T00:00:00Z" }) });
    const data = await loadForPage(TOKEN);
    expect(data).toMatchObject({ slug: "kak-lina", shopName: "Kedai Ah Seng", base: `/t/${TOKEN}` });
    expect(data).not.toHaveProperty("snapshot");
  });

  it("gives not found for an unknown or turned-off token", async () => {
    db.tabDb.mockReturnValue({ read: vi.fn().mockResolvedValue(null) });
    await expect(loadForPage(TOKEN)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(nav.notFound).toHaveBeenCalled();
  });

  it("gives not found for a malformed token without asking the database", async () => {
    const read = vi.fn();
    db.tabDb.mockReturnValue({ read });
    await expect(loadForPage("short")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(read).not.toHaveBeenCalled();
  });

  it("gives not found when the database is missing or fails", async () => {
    db.tabDb.mockReturnValue(null);
    await expect(loadForPage(TOKEN)).rejects.toThrow("NEXT_NOT_FOUND");
    db.tabDb.mockReturnValue({ read: vi.fn().mockRejectedValue(new Error("down")) });
    await expect(loadForPage(TOKEN)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("gives not found to an address that loads too many pages", async () => {
    hdrs.headers.mockResolvedValue(new Headers({ "x-forwarded-for": "10.9.9.9" }));
    db.tabDb.mockReturnValue({ read: vi.fn().mockResolvedValue(null) });
    for (let i = 0; i < 60; i++) await loadForPage(TOKEN).catch(() => {});
    const read = vi.fn();
    db.tabDb.mockReturnValue({ read });
    await expect(loadForPage(TOKEN)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(read).not.toHaveBeenCalled();
  });
});
