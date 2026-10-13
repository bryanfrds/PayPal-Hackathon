import { afterEach, describe, expect, it, vi } from "vitest";

// The model is never called in these tests: they cover the checks before it.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn(() => { throw new Error("model should not be called"); }) };
});

const { POST } = await import("./route");

const CONTEXT = { shopName: "K", today: "2026-10-13", owedSen: 0, collectedSen: 0, customers: [] };

function request(body: unknown) {
  return new Request("http://localhost/api/nudge", { method: "POST", body: JSON.stringify(body) });
}

function userMessage(text: string) {
  return { id: "m1", role: "user", parts: [{ type: "text", text }] };
}

describe("POST /api/nudge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("says it isn't connected when there's no AI Gateway key", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    const res = await POST(request({ messages: [userMessage("hi")], context: CONTEXT }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/isn't connected/);
  });

  it("refuses a message without valid shop data", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    const res = await POST(request({ messages: [userMessage("hi")], context: { customers: "lots" } }));
    expect(res.status).toBe(400);
  });

  it("refuses a message that's too long", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    const res = await POST(request({ messages: [userMessage("x".repeat(601))], context: CONTEXT }));
    expect(res.status).toBe(413);
  });

  it("refuses a very long chat", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    const messages = Array.from({ length: 25 }, () => userMessage("hi"));
    const res = await POST(request({ messages, context: CONTEXT }));
    expect(res.status).toBe(413);
  });

  it("refuses a body that isn't JSON", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    const res = await POST(new Request("http://localhost/api/nudge", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
  });
});
