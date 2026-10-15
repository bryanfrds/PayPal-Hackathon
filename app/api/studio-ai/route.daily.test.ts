import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { TURNS_PER_DAY, TURNS_PER_MINUTE } from "@/lib/studio-ai";

// The daily cap per login, and what reaches the model, with a fake model that answers at once.
const owner = vi.hoisted(() => ({ email: "daily@example.com" }));
vi.mock("@/lib/auth-server", () => ({
  requireOwner: async () => ({ email: owner.email, method: "email", exp: 9999999999 }),
}));

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const seen: LanguageModelV4CallOptions[] = [];
const fake = new MockLanguageModelV4({
  doStream: async (options) => {
    seen.push(options);
    return { stream: simulateReadableStream({ chunks: [{ type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage }] }) };
  },
});
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: (opts: Parameters<typeof actual.streamText>[0]) => actual.streamText({ ...opts, model: fake }) };
});

const { POST } = await import("./route");

const USER = { id: "u1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "hi" }] };
const CLIENT_TOOL = { name: "draft_reminder", description: "Draft", parameters: { type: "object", properties: {} }, kind: "client" };

let n = 0;
async function turn(body: Record<string, unknown> = {}) {
  n += 1;
  vi.stubEnv("AI_GATEWAY_API_KEY", "test");
  const res = await POST(
    new Request("http://localhost/api/studio-ai", {
      method: "POST",
      headers: { "x-forwarded-for": `10.2.${Math.floor(n / 250)}.${n % 250}` },
      body: JSON.stringify({ input: [USER], tools: [CLIENT_TOOL], responseFormat: { type: "text" }, ...body }),
    }),
  );
  await res.text();
  return res;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/studio-ai limits per login", () => {
  it(`stops one login after ${TURNS_PER_DAY} model turns in a day`, async () => {
    owner.email = "daily@example.com";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T08:00:00Z"));
    for (let i = 0; i < TURNS_PER_DAY; i++) {
      // Spread out so the per-minute brake never trips; only the daily cap is being tested.
      if (i > 0 && i % (TURNS_PER_MINUTE - 1) === 0) vi.setSystemTime(Date.now() + 61_000);
      expect((await turn()).status).toBe(200);
    }
    vi.setSystemTime(Date.now() + 61_000);
    const capped = await turn();
    expect(capped.status).toBe(429);
    expect(capped.headers.get("Retry-After")).toBeTruthy();

    // Another login isn't affected, and the next day this one can ask again.
    owner.email = "someone-else@example.com";
    expect((await turn()).status).toBe(200);
    owner.email = "daily@example.com";
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
    expect((await turn()).status).toBe(200);
  });

  it("doesn't count turns refused before the model", async () => {
    owner.email = "refused@example.com";
    for (let i = 0; i < 5; i++) expect((await turn({ input: "nope" })).status).toBe(400);
    const before = seen.length;
    expect((await turn()).status).toBe(200);
    expect(seen.length).toBe(before + 1);
  });
});

describe("POST /api/studio-ai tools offered to the model", () => {
  it("offers only browser tools, never server or provider tools", async () => {
    owner.email = "tools@example.com";
    await turn({
      tools: [CLIENT_TOOL, { ...CLIENT_TOOL, name: "server_side", kind: "server" }, { ...CLIENT_TOOL, name: "web", kind: "provided" }],
    });
    expect(seen.at(-1)?.tools?.map((t) => t.name)).toEqual(["draft_reminder"]);
  });

  it("falls back to auto when a forced tool is asked for but no tools are on offer", async () => {
    owner.email = "tools@example.com";
    await turn({ tools: [], toolChoice: { name: "complete_task" } });
    const choice = seen.at(-1)?.toolChoice;
    expect(choice === undefined || choice.type === "auto").toBe(true);
  });

  it("caps output tokens below what it used to allow", async () => {
    owner.email = "tools@example.com";
    await turn();
    expect(seen.at(-1)?.maxOutputTokens).toBeLessThanOrEqual(2_500);
  });
});
