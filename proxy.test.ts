import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, makePending, makeSession } from "@/lib/auth";
import { proxy } from "./proxy";

const SECRET = "test-secret-that-is-long-enough-for-hmac-signing";

function req(path: string, init: { method?: string; cookie?: string } = {}) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers: init.cookie ? { cookie: init.cookie } : {},
  });
}

describe("proxy", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("sends signed-out visitors of owner pages to sign-in, remembering where they were going", async () => {
    const res = await proxy(req("/collect?tab=sent"));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/sign-in");
    expect(to.searchParams.get("next")).toBe("/collect?tab=sent");
  });

  it("answers signed-out API calls with 401", async () => {
    expect((await proxy(req("/api/invoices", { method: "POST" }))).status).toBe(401);
    expect((await proxy(req("/api/nudge", { method: "POST" }))).status).toBe(401);
    expect((await proxy(req("/api/invoices/status", { method: "POST" }))).status).toBe(401);
  });

  it("leaves customers, sign-in and one invoice's status open", async () => {
    for (const path of ["/sign-in", "/tab/mak-cik-siti", "/tab/mak-cik-siti/pay", "/t/AbCdEfGhIjKlMnOpQrStUv", "/t/AbCdEfGhIjKlMnOpQrStUv/pay", "/api/auth/email/start", "/api/invoices/INV2-ABCD"]) {
      const res = await proxy(req(path));
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("lets PayPal post to its webhook, and nothing else there", async () => {
    expect((await proxy(req("/api/paypal/webhook", { method: "POST" }))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/api/paypal/webhook"))).status).toBe(401);
    expect((await proxy(req("/api/paypal/webhook/x", { method: "POST" }))).status).toBe(401);
  });

  it("lets Vercel Cron call the reminder process endpoint with GET, and blocks other methods", async () => {
    expect((await proxy(req("/api/reminders/process"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/api/reminders/process", { method: "POST" }))).status).toBe(401);
  });

  it("doesn't open invoice changes, only reading one", async () => {
    expect((await proxy(req("/api/invoices/INV2-ABCD", { method: "POST" }))).status).toBe(401);
    expect((await proxy(req("/api/invoices/status"))).status).toBe(401);
  });

  it("lets a signed-in owner through", async () => {
    const cookie = `${SESSION_COOKIE}=${await makeSession("owner@example.com", "email", SECRET)}`;
    expect((await proxy(req("/collect", { cookie }))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/api/invoices", { method: "POST", cookie }))).headers.get("x-middleware-next")).toBe("1");
  });

  it("refuses a valid session for an email that isn't on the owner list", async () => {
    vi.stubEnv("OWNER_EMAILS", "owner@example.com");
    const stranger = `${SESSION_COOKIE}=${await makeSession("stranger@example.com", "email", SECRET)}`;
    expect((await proxy(req("/collect", { cookie: stranger }))).status).toBe(307);
    expect((await proxy(req("/api/invoices", { method: "POST", cookie: stranger }))).status).toBe(401);
    const owner = `${SESSION_COOKIE}=${await makeSession("owner@example.com", "email", SECRET)}`;
    expect((await proxy(req("/collect", { cookie: owner }))).headers.get("x-middleware-next")).toBe("1");
  });

  it("refuses a pending-code cookie passed off as a session", async () => {
    const pending = await makePending("owner@example.com", "ABC234", SECRET);
    expect((await proxy(req("/api/invoices", { method: "POST", cookie: `${SESSION_COOKIE}=${pending}` }))).status).toBe(401);
  });

  it("refuses a forged session", async () => {
    const forged = await makeSession("owner@example.com", "email", "some-other-secret-that-is-also-long-enough");
    expect((await proxy(req("/collect", { cookie: `${SESSION_COOKIE}=${forged}` }))).status).toBe(307);
  });

  it("locks owner pages when there's no AUTH_SECRET, rather than opening them", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect((await proxy(req("/collect"))).status).toBe(307);
  });
});
