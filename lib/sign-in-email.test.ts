import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInEmailError, emailIsSetUp, sendSignInCode, type GmailSend } from "./sign-in-email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function clearEmailEnv() {
  vi.stubEnv("GMAIL_USER", "");
  vi.stubEnv("GMAIL_APP_PASSWORD", "");
  vi.stubEnv("RESEND_API_KEY", "");
}

describe("sendSignInCode", () => {
  it("sends through Gmail when the Gmail login is set, and never calls Resend", async () => {
    clearEmailEnv();
    vi.stubEnv("GMAIL_USER", "shop@example.test");
    vi.stubEnv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const gmail = vi.fn<GmailSend>().mockResolvedValue(undefined);
    const fetchImpl = vi.fn<typeof fetch>();

    await sendSignInCode("owner@example.test", "AB12CD", fetchImpl, gmail);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(gmail).toHaveBeenCalledOnce();
    const [user, password, mail] = gmail.mock.calls[0];
    expect(user).toBe("shop@example.test");
    expect(password).toBe("abcdefghijklmnop");
    expect(mail.to).toBe("owner@example.test");
    expect(mail.subject).toContain("AB12CD");
    expect(mail.text).toContain("AB12CD");
  });

  it("turns a Gmail failure into a plain message", async () => {
    clearEmailEnv();
    vi.stubEnv("GMAIL_USER", "shop@example.test");
    vi.stubEnv("GMAIL_APP_PASSWORD", "abcdefghijklmnop");
    const gmail = vi.fn<GmailSend>().mockRejectedValue(new Error("535 bad login"));

    await expect(sendSignInCode("owner@example.test", "AB12CD", vi.fn(), gmail)).rejects.toThrow(SignInEmailError);
  });

  it("falls back to Resend when only the Resend key is set", async () => {
    clearEmailEnv();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const gmail = vi.fn<GmailSend>();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));

    await sendSignInCode("owner@example.test", "AB12CD", fetchImpl, gmail);

    expect(gmail).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith("https://api.resend.com/emails", expect.anything());
  });

  it("fails plainly in production with nothing set up", async () => {
    clearEmailEnv();
    vi.stubEnv("NODE_ENV", "production");

    await expect(sendSignInCode("owner@example.test", "AB12CD", vi.fn(), vi.fn())).rejects.toThrow(
      "Email sign-in isn't set up on this server yet.",
    );
  });

  it("prints the code locally with nothing set up", async () => {
    clearEmailEnv();
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendSignInCode("owner@example.test", "AB12CD", vi.fn(), vi.fn());

    expect(log).toHaveBeenCalledWith(expect.stringContaining("AB12CD"));
  });
});

describe("emailIsSetUp", () => {
  it("needs both the Gmail address and app password", () => {
    clearEmailEnv();
    vi.stubEnv("GMAIL_USER", "shop@example.test");
    expect(emailIsSetUp()).toBe(false);
    vi.stubEnv("GMAIL_APP_PASSWORD", "abcdefghijklmnop");
    expect(emailIsSetUp()).toBe(true);
  });
});
