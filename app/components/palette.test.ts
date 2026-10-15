import { describe, expect, it } from "vitest";
import { palette } from "./palette";

describe("palette", () => {
  it("keeps the light pair as given, so light mode looks the same", () => {
    const p = palette("#fde8df", "#b4441f");
    expect(p["data-pal"]).toBe("");
    expect(p.style).toMatchObject({ "--pal-bg": "#fde8df", "--pal-fg": "#b4441f" });
    expect(p.style).toMatchObject({ background: "var(--pal-bg-now)", color: "var(--pal-fg-now)" });
  });

  it("adds the dark partner for a known colour", () => {
    expect(palette("#e3ecfb", "#2f55c4").style).toMatchObject({ "--pal-bg-dark": "#1c2a4d", "--pal-fg-dark": "#a9c1ff" });
  });

  it("uses the light pair in dark too for an unknown colour", () => {
    expect(palette("#123456", "#abcdef").style).toMatchObject({ "--pal-bg-dark": "#123456", "--pal-fg-dark": "#abcdef" });
  });
});
