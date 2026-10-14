import { describe, expect, it } from "vitest";
import {
  CODE_SECONDS,
  MAX_CODE_TRIES,
  SESSION_SECONDS,
  checkCode,
  makePending,
  makeSession,
  newCode,
  normaliseEmail,
  readSession,
  safeNext,
  sign,
  verify,
} from "./auth";

const SECRET = "test-secret-that-is-long-enough-for-hmac";
const NOW = Date.UTC(2026, 9, 14, 3, 0, 0);

describe("sign and verify", () => {
  it("reads back what it signed", async () => {
    expect(await verify(await sign({ a: 1 }, SECRET), SECRET)).toEqual({ a: 1 });
  });

  it("refuses a tampered payload, a wrong secret and junk", async () => {
    const token = await sign({ email: "a@b.co" }, SECRET);
    const [, sig] = token.split(".");
    const forged = `${btoa(JSON.stringify({ email: "evil@b.co" })).replace(/=+$/, "")}.${sig}`;
    expect(await verify(forged, SECRET)).toBeNull();
    expect(await verify(token, "another-secret")).toBeNull();
    expect(await verify("nonsense", SECRET)).toBeNull();
    expect(await verify(`${token}.extra`, SECRET)).toBeNull();
    expect(await verify(token, "")).toBeNull();
  });
});

describe("sessions", () => {
  it("lasts 30 days", async () => {
    const token = await makeSession("a@b.co", "email", SECRET, NOW);
    expect(await readSession(token, SECRET, NOW)).toMatchObject({ email: "a@b.co", method: "email" });
    expect(await readSession(token, SECRET, NOW + SESSION_SECONDS * 1000 - 1000)).not.toBeNull();
    expect(await readSession(token, SECRET, NOW + SESSION_SECONDS * 1000 + 1000)).toBeNull();
  });

  it("is null with no cookie", async () => {
    expect(await readSession(undefined, SECRET)).toBeNull();
  });
});

describe("email codes", () => {
  it("are six digits", () => {
    for (let i = 0; i < 50; i += 1) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it("accept the right code, with or without spaces", async () => {
    const pending = await makePending("a@b.co", "482917", SECRET, NOW);
    expect(await checkCode(pending, "482917", SECRET, NOW)).toEqual({ ok: true, email: "a@b.co" });
    expect(await checkCode(pending, "482 917", SECRET, NOW)).toEqual({ ok: true, email: "a@b.co" });
  });

  it("count wrong tries and stop after the limit", async () => {
    let pending: string | undefined = await makePending("a@b.co", "482917", SECRET, NOW);
    for (let i = 1; i < MAX_CODE_TRIES; i += 1) {
      const r = await checkCode(pending, "000000", SECRET, NOW);
      expect(r).toMatchObject({ ok: false, reason: "wrong" });
      pending = r.ok ? undefined : r.pending;
    }
    const last = await checkCode(pending, "000000", SECRET, NOW);
    expect(last).toMatchObject({ ok: false, reason: "tooManyTries" });
    // Even the right code is refused now.
    expect(await checkCode(last.ok ? undefined : last.pending, "482917", SECRET, NOW)).toMatchObject({ reason: "tooManyTries" });
  });

  it("expire after 10 minutes", async () => {
    const pending = await makePending("a@b.co", "482917", SECRET, NOW);
    expect(await checkCode(pending, "482917", SECRET, NOW + CODE_SECONDS * 1000 + 1000)).toMatchObject({ ok: false, reason: "expired" });
  });

  it("say so when there's no code in progress", async () => {
    expect(await checkCode(undefined, "482917", SECRET, NOW)).toMatchObject({ ok: false, reason: "noCode" });
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
  it("only allows paths inside the app", () => {
    expect(safeNext("/collect")).toBe("/collect");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/sign-in")).toBe("/");
    expect(safeNext("/api/invoices")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
