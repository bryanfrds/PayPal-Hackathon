import { describe, expect, it } from "vitest";
import { clientIp, createThrottle } from "./throttle";

describe("createThrottle", () => {
  it("allows up to the limit in a window, then asks to wait", () => {
    const t = createThrottle(2, 60_000);
    expect(t.hit("a", 0)).toBe(0);
    expect(t.hit("a", 1000)).toBe(0);
    expect(t.hit("a", 2000)).toBe(58);
    expect(t.hit("b", 2000)).toBe(0);
  });

  it("starts again after the window", () => {
    const t = createThrottle(1, 1000);
    t.hit("a", 0);
    expect(t.hit("a", 500)).toBe(1);
    expect(t.hit("a", 1000)).toBe(0);
  });

  it("doesn't grow without limit", () => {
    const t = createThrottle(1, 1000, 10);
    for (let i = 0; i < 100; i += 1) t.hit(`k${i}`, 0);
    // Still answers sensibly after pruning.
    expect(t.hit("fresh", 0)).toBe(0);
  });
});

describe("clientIp", () => {
  it("takes the first forwarded address", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
