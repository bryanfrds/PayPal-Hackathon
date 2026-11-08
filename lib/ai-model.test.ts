import { describe, expect, it } from "vitest";
import { DEFAULT_GATEWAY_MODEL, DEFAULT_GEMINI_MODEL, aiConnected, aiModel, aiModelName } from "./ai-model";

describe("aiModel", () => {
  it("uses Gemini when a Gemini key is set", () => {
    const env = { GEMINI_API_KEY: "k" };
    const model = aiModel("chat", env);
    expect(typeof model).not.toBe("string");
    expect(aiModelName("chat", env)).toBe(`google/${DEFAULT_GEMINI_MODEL}`);
  });

  it("lets scans use their own Gemini model", () => {
    const env = { GEMINI_API_KEY: "k", GEMINI_MODEL: "chat-model", GEMINI_VISION_MODEL: "vision-model" };
    expect(aiModelName("chat", env)).toBe("google/chat-model");
    expect(aiModelName("vision", env)).toBe("google/vision-model");
  });

  it("falls back to AI Gateway model ids without a Gemini key", () => {
    expect(aiModel("chat", {})).toBe(DEFAULT_GATEWAY_MODEL);
    expect(aiModel("vision", { AI_GATEWAY_MODEL: "a/b", AI_GATEWAY_VISION_MODEL: "c/d" })).toBe("c/d");
    expect(aiModel("vision", { AI_GATEWAY_MODEL: "a/b" })).toBe("a/b");
  });

  it("ignores a blank Gemini key", () => {
    expect(aiModel("chat", { GEMINI_API_KEY: "  " })).toBe(DEFAULT_GATEWAY_MODEL);
  });
});

describe("aiConnected", () => {
  it("is true with a Gemini key, a gateway key or an OIDC token", () => {
    expect(aiConnected(undefined, { GEMINI_API_KEY: "k" })).toBe(true);
    expect(aiConnected(undefined, { AI_GATEWAY_API_KEY: "k" })).toBe(true);
    expect(aiConnected(undefined, { VERCEL_OIDC_TOKEN: "t" })).toBe(true);
    expect(aiConnected(new Request("http://x", { headers: { "x-vercel-oidc-token": "t" } }), {})).toBe(true);
  });

  it("is false with none", () => {
    expect(aiConnected(undefined, {})).toBe(false);
  });
});
