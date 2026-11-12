import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("site font", () => {
  it("uses a bundled Manrope font so production builds do not need Google Fonts", async () => {
    const layout = await readFile(join(process.cwd(), "app/layout.tsx"), "utf8");
    const font = await stat(join(process.cwd(), "app/components/fonts/Manrope-Variable-Latin.woff2"));

    expect(layout).toContain('from "next/font/local"');
    expect(layout).toContain('src: "./components/fonts/Manrope-Variable-Latin.woff2"');
    expect(layout).not.toContain('from "next/font/google"');
    expect(font.size).toBeGreaterThan(20_000);
  });
});
