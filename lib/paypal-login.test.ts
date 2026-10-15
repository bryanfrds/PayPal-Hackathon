import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailFromCode, verifiedEmail } from "./paypal-login";

describe("verifiedEmail", () => {
  it("takes the email PayPal says is verified", () => {
    expect(verifiedEmail({ email: "owner@shop.my", email_verified: true })).toBe("owner@shop.my");
    expect(verifiedEmail({ email: "owner@shop.my", email_verified: "true" })).toBe("owner@shop.my");
  });

  it("refuses an email with no proof it's verified", () => {
    expect(verifiedEmail({ email: "owner@shop.my" })).toBeUndefined();
    expect(verifiedEmail({ email: "owner@shop.my", email_verified: false })).toBeUndefined();
    expect(verifiedEmail({ email: "owner@shop.my", email_verified: "false" })).toBeUndefined();
  });

  it("only takes a confirmed address from the list, the primary one first", () => {
    expect(verifiedEmail({ emails: [{ value: "a@shop.my", primary: true }] })).toBeUndefined();
    expect(verifiedEmail({ emails: [{ value: "a@shop.my", primary: true }, { value: "b@shop.my", confirmed: true }] })).toBe("b@shop.my");
    expect(
      verifiedEmail({
        emails: [
          { value: "b@shop.my", confirmed: true },
          { value: "a@shop.my", primary: true, confirmed: true },
        ],
      }),
    ).toBe("a@shop.my");
  });

  it("doesn't fall back to the list when the main email is unverified", () => {
    expect(verifiedEmail({ email: "owner@shop.my", email_verified: false, emails: [{ value: "owner@shop.my" }] })).toBeUndefined();
  });
});

describe("emailFromCode", () => {
  beforeEach(() => {
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_API_BASE", "https://api-m.sandbox.paypal.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  function paypal(userinfo: unknown) {
    return vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/oauth2/token")
        ? Response.json({ access_token: "token" })
        : Response.json(userinfo),
    ) as unknown as typeof fetch;
  }

  it("returns a verified email", async () => {
    await expect(emailFromCode("code", "https://x/cb", paypal({ email: "owner@shop.my", email_verified: true }))).resolves.toBe("owner@shop.my");
  });

  it("refuses an unverified email", async () => {
    await expect(emailFromCode("code", "https://x/cb", paypal({ email: "owner@shop.my" }))).rejects.toThrow("isn't verified");
  });

  it("says when PayPal shares no email at all", async () => {
    await expect(emailFromCode("code", "https://x/cb", paypal({ sub: "123" }))).rejects.toThrow("didn't share an email");
  });
});
