import { afterEach, describe, expect, it, vi } from "vitest";

// Signed in as the shop owner unless a test says otherwise.
// Each request gets its own email too, unless a test pins one, so the per-email brakes only
// count where a test means them to.
const signedIn = vi.hoisted(() => ({ value: true, email: "owner@example.com" }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () =>
    signedIn.value
      ? { email: signedIn.email, method: "email", exp: 9999999999 }
      : Response.json({ error: "Sign in to do that." }, { status: 401 }),
}));

// The model is never called in these tests: they cover the checks before it.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn(() => { throw new Error("model should not be called"); }) };
});

const { POST } = await import("./route");

const TOOL = { name: "shop_summary", description: "The shop's tabs", parameters: { type: "object", properties: {} }, kind: "client" };
const user = (text: string) => ({ id: "u", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text }] });

let ip = 0;
function request(body: unknown, headers: Record<string, string> = {}) {
  // A fresh IP and email each time, so the throttles only count where a test means them to.
  ip += 1;
  signedIn.email = `owner${ip}@example.com`;
  return new Request("http://localhost/api/studio-ai", {
    method: "POST",
    headers: { "x-forwarded-for": `10.0.0.${ip}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const BODY = { input: [user("Who's late?")], instructions: "Be kind", tools: [TOOL], responseFormat: { type: "text" } };

describe("POST /api/studio-ai", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses anyone who isn't signed in", async () => {
    signedIn.value = false;
    const res = await POST(request(BODY));
    signedIn.value = true;
    expect(res.status).toBe(401);
  });

  it("says it isn't connected when there's no AI Gateway key", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    const res = await POST(request(BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/isn't connected/);
  });

  it("refuses a body that isn't JSON", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    expect((await POST(request("{"))).status).toBe(400);
  });

  it("refuses a body that's too big before parsing it", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    const res = await POST(request(JSON.stringify({ ...BODY, pad: "x".repeat(700_000) })));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too long/);
  });

  it("refuses a body that claims to be huge", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    expect((await POST(request(BODY, { "content-length": "99999999" }))).status).toBe(413);
  });

  it("refuses too long a conversation, with a plain message", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    const input = Array.from({ length: 200 }, () => user("hi"));
    const res = await POST(request({ ...BODY, input }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/Start a new chat/);
  });

  it("refuses too many tools", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    const tools = Array.from({ length: 31 }, (_, i) => ({ ...TOOL, name: `t${i}` }));
    expect((await POST(request({ ...BODY, tools }))).status).toBe(413);
  });

  it("refuses an image or a malformed item", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    const image = { ...user("x"), content: [{ type: "image", detail: "auto", imageUrl: "https://example.com/a.png" }] };
    expect((await POST(request({ ...BODY, input: [image] }))).status).toBe(400);
    expect((await POST(request({ ...BODY, input: "hi" }))).status).toBe(400);
  });

  it("refuses a conversation with nothing from the owner in it", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test");
    const system = { ...user("note"), role: "system" };
    expect((await POST(request({ ...BODY, input: [system] }))).status).toBe(400);
  });

  it("slows down one IP that sends too many turns", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    signedIn.email = "busy-ip@example.com";
    const same = () => new Request("http://localhost/api/studio-ai", { method: "POST", headers: { "x-forwarded-for": "10.9.9.9" }, body: "{}" });
    const statuses: number[] = [];
    for (let i = 0; i < 60; i++) statuses.push((await POST(same())).status);
    // The first 60 get as far as the connection check; the 61st is throttled.
    expect(statuses.every((s) => s === 503)).toBe(true);
    const last = await POST(same());
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("slows down one login sending turns from many IPs", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      signedIn.email = "Shared.Demo@example.com";
      const req = new Request("http://localhost/api/studio-ai", { method: "POST", headers: { "x-forwarded-for": `10.8.${Math.floor(i / 200)}.${i % 200}` }, body: "{}" });
      statuses.push((await POST(req)).status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 503)).toBe(true);
    expect(statuses[60]).toBe(429);
    // The same login in another case still counts as the same login.
    signedIn.email = "shared.demo@EXAMPLE.com";
    expect((await POST(new Request("http://localhost/api/studio-ai", { method: "POST", headers: { "x-forwarded-for": "10.7.7.7" }, body: "{}" }))).status).toBe(429);
  });
});
