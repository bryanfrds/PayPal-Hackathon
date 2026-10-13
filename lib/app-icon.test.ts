import { describe, expect, it } from "vitest";
import { iconFontOptions } from "../app/components/appIcon";

describe("iconFontOptions", () => {
  it("loads the bundled Manrope font, a real TrueType file", async () => {
    const options = await iconFontOptions();
    expect("fonts" in options).toBe(true);
    if (!("fonts" in options)) return;
    const [font] = options.fonts;
    expect(font).toMatchObject({ name: "Manrope", weight: 800 });
    expect(new DataView(font.data).getUint32(0)).toBe(0x00010000);
  });
});
