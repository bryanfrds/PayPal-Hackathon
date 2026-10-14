import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_SECONDS,
  MAX_CODE_TRIES,
  SESSION_SECONDS,
  checkCode,
  isAllowedOwner,
  makePayPalState,
  makePending,
  makeSession,
  newCode,
  normaliseEmail,
  readPayPalState,
  readSession,
  safeNext,
  sign,
  verify,
} from "./auth";

const SECRET = "test-secret-that-is-long-enough-for-hmac";
const NOW = Date.UTC(2026, 9, 14, 3, 0, 0);

describe("sign and verify", () => {
  it("reads back what it signed", async () => {
    const token = await sign({ typ: "session" }, "session", SECRET);
    expect(await verify(token, "session", SECRET)).toEqual({ typ: "session" });
  });

  it("refuses a tampered payload, a wrong secret and junk", async () => {
    const token = await makeSession("a@b.co", "email", SECRET, NOW);
    const [, sig] = token.split(".");
    const forged = `${btoa(JSON.stringify({ typ: "session", email: "evil@b.co", method: "email", exp: 9999999999 })).replace(/=+$/, "")}.${sig}`;
    expect(await readSession(forged, SECRET, NOW)).toBeNull();
    expect(await readSession(token, "another-secret-that-is-also-long-enough", NOW)).toBeNull();
    expect(await readSession("nonsense", SECRET, NOW)).toBeNull();
    expect(await readSession(`${token}.extra`, SECRET, NOW)).toBeNull();
    expect(await readSession(token, "", NOW)).toBeNull();
  });
});

describe("one kind of cookie can't stand in for another", () => {
  it("refuses a pending-code cookie as a session (no signing in without the code)", async () => {
    const pending = await makePending("victim@example.com", "ABC234", SECRET, NOW);
    expect(await readSession(pending, SECRET, NOW)).toBeNull();
  });

  it("refuses a PayPal state cookie as a session, and a session as a pending cookie", async () => {
    const state = await makePayPalState("nonce", "/", SECRET, NOW);
    expect(await readSession(state, SECRET, NOW)).toBeNull();
    const session = await makeSession("a@b.co", "email", SECRET, NOW);
    expect(await checkCode(session, "ABC234", SECRET, NOW)).toMatchObject({ ok: false, reason: "noCode" });
    expect(await readPayPalState(session, SECRET, NOW)).toBeNull();
  });

  it("won't sign a value as a kind it doesn't say it is", async () => {
    await expect(sign({ typ: "pending" }, "session", SECRET)).rejects.toThrow();
  });
});

describe("sessions", () => {
  it("last 7 days", async () => {
    const token = await makeSession("a@b.co", "email", SECRET, NOW);
    expect(await readSession(token, SECRET, NOW)).toMatchObject({ email: "a@b.co", method: "email" });
    expect(await readSession(token, SECRET, NOW + SESSION_SECONDS * 1000 - 1000)).not.toBeNull();
    expect(await readSession(token, SECRET, NOW + SESSION_SECONDS * 1000 + 1000)).toBeNull();
  });

  it("are null with no cookie", async () => {
    expect(await readSession(undefined, SECRET)).toBeNull();
  });
});

describe("codes", () => {
  it("are six characters from the easy-to-read alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = newCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it("accept the right code in any case, with spaces or a dash", async () => {
    const pending = await makePending("a@b.co", "ABC234", SECRET, NOW);
    expect(await checkCode(pending, "ABC234", SECRET, NOW)).toEqual({ ok: true, email: "a@b.co" });
    expect(await checkCode(pending, "abc 234", SECRET, NOW)).toEqual({ ok: true, email: "a@b.co" });
    expect(await checkCode(pending, "ABC-234", SECRET, NOW)).toEqual({ ok: true, email: "a@b.co" });
  });

  it("count wrong tries and stop after the limit", async () => {
    let pending: string | undefined = await makePending("a@b.co", "ABC234", SECRET, NOW);
    for (let i = 1; i < MAX_CODE_TRIES; i += 1) {
      const r = await checkCode(pending, "ZZZZZZ", SECRET, NOW);
      expect(r).toMatchObject({ ok: false, reason: "wrong" });
      pending = r.ok ? undefined : r.pending;
    }
    const last = await checkCode(pending, "ZZZZZZ", SECRET, NOW);
    expect(last).toMatchObject({ ok: false, reason: "tooManyTries" });
    expect(await checkCode(last.ok ? undefined : last.pending, "ABC234", SECRET, NOW)).toMatchObject({ reason: "tooManyTries" });
  });

  it("expire after 10 minutes", async () => {
    const pending = await makePending("a@b.co", "ABC234", SECRET, NOW);
    expect(await checkCode(pending, "ABC234", SECRET, NOW + CODE_SECONDS * 1000 + 1000)).toMatchObject({ ok: false, reason: "expired" });
  });

  it("only work for the email they were sent to", async () => {
    const pending = await makePending("a@b.co", "ABC234", SECRET, NOW);
    const [payload, sig] = pending.split(".");
    const swapped = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    swapped.email = "b@b.co";
    const forged = `${btoa(JSON.stringify(swapped)).replace(/=+$/, "")}.${sig}`;
    expect(await checkCode(forged, "ABC234", SECRET, NOW)).toMatchObject({ ok: false, reason: "noCode" });
  });

  it("say so when there's no code in progress", async () => {
    expect(await checkCode(undefined, "ABC234", SECRET, NOW)).toMatchObject({ ok: false, reason: "noCode" });
  });
});

describe("PayPal state", () => {
  it("expires after 10 minutes", async () => {
    const state = await makePayPalState("n1", "/collect", SECRET, NOW);
    expect(await readPayPalState(state, SECRET, NOW)).toMatchObject({ nonce: "n1", next: "/collect" });
    expect(await readPayPalState(state, SECRET, NOW + 11 * 60 * 1000)).toBeNull();
  });
});

describe("isAllowedOwner", () => {
  it("allows only listed owners and the demo email", () => {
    const env = { OWNER_EMAILS: "Owner@Shop.com, partner@shop.com", DEMO_EMAIL: "demo@shop.com", NODE_ENV: "production" };
    expect(isAllowedOwner("owner@shop.com", env)).toBe(true);
    expect(isAllowedOwner("partner@shop.com", env)).toBe(true);
    expect(isAllowedOwner("demo@shop.com", env)).toBe(true);
    expect(isAllowedOwner("stranger@shop.com", env)).toBe(false);
  });

  it("lets nobody in on production with no list, but anyone in local development", () => {
    expect(isAllowedOwner("a@b.co", { NODE_ENV: "production" })).toBe(false);
    expect(isAllowedOwner("a@b.co", { NODE_ENV: "development" })).toBe(true);
  });
});

describe("normaliseEmail", () => {
  it("trims and lower-cases, and refuses non-emails", () => {
    expect(normaliseEmail("  AhSeng.Kedai@Gmail.com ")).toBe("ahseng.kedai@gmail.com");
    expect(normaliseEmail("not an email")).toBeNull();
    expect(normaliseEmail("a@b")).toBeNull();
    expect(normaliseEmail(42)).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps paths inside the app, with their query", () => {
    expect(safeNext("/collect")).toBe("/collect");
    expect(safeNext("/collect?tab=sent")).toBe("/collect?tab=sent");
  });

  it("never leaves the app", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/%5Cevil.example",
      "/sign-in",
      "/api/invoices",
      null,
      "",
    ]) {
      const next = safeNext(bad);
      expect(new URL(next, "https://paypal-hackathon.vercel.app").host, String(bad)).toBe("paypal-hackathon.vercel.app");
      expect(next.startsWith("//"), String(bad)).toBe(false);
    }
    expect(safeNext("/sign-in")).toBe("/");
    expect(safeNext("/api/invoices")).toBe("/");
  });
});
