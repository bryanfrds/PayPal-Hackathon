import { describe, expect, it } from "vitest";
import { themeFor } from "./studio-config";

// The theme object is compared through its JSON so the test doesn't depend on Studio internals.
const json = (dark?: boolean) => JSON.stringify(dark === undefined ? themeFor("Manrope", "#f3f1ec") : themeFor("Manrope", "#f3f1ec", dark));

describe("themeFor", () => {
  it("light is the default and keeps the light colours", () => {
    const light = json(false);
    expect(light).toBe(json());
    for (const v of ['"foregroundColor":"#141414"', '"backgroundColor":"#ffffff"', '"borderColor":"#ebe7df"', '"studioWidgetBackgroundColor":"#ffffff"']) {
      expect(light).toContain(v);
    }
    expect(light).not.toContain("#1d1d1c");
  });

  it("dark adds the dark palette on top", () => {
    const dark = json(true);
    expect(dark).toContain('"backgroundColor":"#1d1d1c"');
    expect(dark).not.toBe(json(false));
  });
});
