import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Debt } from "@/lib/debts";

const URL1 = "https://buku.example.com/t/AbCdEfGhIjKlMnOpQrStUv";
const KEY = "buku.tabLinks.v1";

function debt(id: string, name: string, amountSen = 1000): Debt {
  return { id, customerName: name, item: "Milo", amountSen, date: "2026-10-01", status: "unpaid", source: "manual", createdAt: "2026-10-01T00:00:00Z" };
}

let store: Record<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

function memoryStorage() {
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  };
}

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

/** A fresh copy of the module (its state is module-level), with this device's saved links. */
type TestData = { debts: Debt[]; invoices: never[]; shopName: string; ready: boolean };

async function load(saved: Record<string, string> = {}, data: TestData = { debts: [debt("T-1", "Kak Lina")], invoices: [], shopName: "Kedai", ready: true }) {
  store = Object.keys(saved).length ? { [KEY]: JSON.stringify(saved) } : {};
  vi.stubGlobal("window", { localStorage: memoryStorage(), location: { origin: "https://buku.example.com" } });
  vi.resetModules();
  const mod = await import("./tabLinks");
  let current = data;
  mod.registerTabData(() => current);
  return { mod, setData: (next: typeof data) => (current = next) };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("readLinks", () => {
  it("keeps only links that look like ours", async () => {
    const { mod } = await load({
      "kak-lina": URL1,
      dev: "http://localhost:3000/t/AbCdEfGhIjKlMnOpQrStUv",
      "mr-raj": "javascript:alert(1)",
      tan: "https://buku.example.com/tab/tan",
      plain: "http://buku.example.com/t/AbCdEfGhIjKlMnOpQrStUv",
      bad: 42 as unknown as string,
    });
    expect(mod.readLinks()).toEqual({ "kak-lina": URL1, dev: "http://localhost:3000/t/AbCdEfGhIjKlMnOpQrStUv" });
  });

  it("copes with garbage in storage", async () => {
    const { mod } = await load();
    store[KEY] = "{not json";
    expect(mod.readLinks()).toEqual({});
    store[KEY] = "[1,2]";
    expect(mod.readLinks()).toEqual({});
  });
});

describe("publishTab (the deliberate step)", () => {
  it("publishes, saves the link and returns it", async () => {
    const { mod } = await load();
    fetchMock.mockImplementation(() => json(200, { url: URL1 }));
    await expect(mod.publishTab("kak-lina")).resolves.toBe(URL1);
    expect(JSON.parse(store[KEY])).toEqual({ "kak-lina": URL1 });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/tabs/publish");
    expect(JSON.parse(init.body).snapshot.customerName).toBe("Kak Lina");
  });

  it("503 means sharing isn't set up: no link, and no more tries this visit", async () => {
    const { mod } = await load();
    fetchMock.mockImplementation(() => json(503, { error: "not set up" }));
    await expect(mod.publishTab("kak-lina")).resolves.toBeUndefined();
    await mod.publishTab("kak-lina");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a failure is noted quietly and keeps the old link", async () => {
    const { mod } = await load({ "kak-lina": URL1 });
    fetchMock.mockImplementation(() => json(502, { error: "down" }));
    await expect(mod.publishTab("kak-lina")).resolves.toBe(URL1);
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("offline")));
    await expect(mod.publishTab("kak-lina")).resolves.toBe(URL1);
    expect(JSON.parse(store[KEY])).toEqual({ "kak-lina": URL1 });
  });

  it("refuses a link from the server that isn't ours", async () => {
    const { mod } = await load();
    fetchMock.mockImplementation(() => json(200, { url: "https://evil.example/phish" }));
    await expect(mod.publishTab("kak-lina")).resolves.toBeUndefined();
    expect(store[KEY]).toBeUndefined();
  });
});

describe("refreshPublishedTabs", () => {
  it("waits for a pause, then sends only tabs that already have a link and changed", async () => {
    const { mod, setData } = await load({ "kak-lina": URL1 }, { debts: [debt("T-1", "Kak Lina"), debt("T-2", "Mr Raj")], invoices: [], shopName: "Kedai", ready: true });
    fetchMock.mockImplementation(() => json(200, { url: URL1 }));
    mod.refreshPublishedTabs(["kak-lina", "mr-raj"]);
    mod.refreshPublishedTabs(["kak-lina"]);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(mod.DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Kak Lina only: Mr Raj was never shared
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).slug).toBe("kak-lina");

    // Nothing changed: nothing sent.
    mod.refreshPublishedTabs();
    await vi.advanceTimersByTimeAsync(mod.DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Her tab changed: sent again.
    setData({ debts: [debt("T-1", "Kak Lina", 2500), debt("T-2", "Mr Raj")], invoices: [], shopName: "Kedai", ready: true });
    mod.refreshPublishedTabs();
    await vi.advanceTimersByTimeAsync(mod.DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("turns off the link of a customer with no debts left (deleted or renamed)", async () => {
    const { mod } = await load({ "kak-lina": URL1 }, { debts: [debt("T-1", "Kak Lina Binti Ali")], invoices: [], shopName: "Kedai", ready: true });
    fetchMock.mockImplementation(() => json(200, { revoked: true }));
    mod.refreshPublishedTabs();
    await vi.advanceTimersByTimeAsync(mod.DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tabs/revoke");
    expect(JSON.parse(store[KEY])).toEqual({});
  });
});

describe("a ledger that hasn't loaded or couldn't be read", () => {
  it("never revokes or sends anything", async () => {
    const empty: TestData = { debts: [], invoices: [], shopName: "Kedai", ready: false };
    const { mod, setData } = await load({ "kak-lina": URL1 }, empty);
    fetchMock.mockImplementation(() => json(200, { revoked: true }));
    mod.refreshPublishedTabs();
    await vi.advanceTimersByTimeAsync(mod.DEBOUNCE_MS);
    await expect(mod.publishTab("kak-lina")).resolves.toBe(URL1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(store[KEY])).toEqual({ "kak-lina": URL1 });

    // Once it loads (and her debts are there), refreshing works as usual.
    setData({ debts: [debt("T-1", "Kak Lina")], invoices: [], shopName: "Kedai", ready: true });
    fetchMock.mockImplementation(() => json(200, { url: URL1 }));
    mod.refreshPublishedTabs();
    await vi.advanceTimersByTimeAsync(mod.DEBOUNCE_MS);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/tabs/publish"]);
  });
});

describe("revokeTabLink and clearTabLinks", () => {
  it("turns a link off and forgets it", async () => {
    const { mod } = await load({ "kak-lina": URL1 });
    fetchMock.mockImplementation(() => json(200, { revoked: true }));
    await expect(mod.revokeTabLink("kak-lina")).resolves.toBe(true);
    expect(JSON.parse(store[KEY])).toEqual({});
  });

  it("keeps the link when the server couldn't be told", async () => {
    const { mod } = await load({ "kak-lina": URL1 });
    fetchMock.mockImplementation(() => json(502, {}));
    await expect(mod.revokeTabLink("kak-lina")).resolves.toBe(false);
    expect(JSON.parse(store[KEY])).toEqual({ "kak-lina": URL1 });
  });

  it("clears every link on sign-out", async () => {
    const { mod } = await load({ "kak-lina": URL1 });
    mod.clearTabLinks();
    expect(store[KEY]).toBeUndefined();
  });
});
