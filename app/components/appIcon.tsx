import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Draws the 555 Buku app icon for ImageResponse (home-screen icons, favicon, Apple touch icon).
// Matches the logo mark in app/components/Logo.tsx: black notebook, spiral holes, "555".

export function AppIconArt({ size, rounded, inset = 0 }: { size: number; rounded: boolean; inset?: number }) {
  // `inset` shrinks the artwork for maskable icons, whose edges the phone may crop.
  const art = size * (1 - inset * 2);
  const holes = 5;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: rounded ? "transparent" : "#141414",
      }}
    >
      <div
        style={{
          width: art,
          height: art,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: "#141414",
          borderRadius: rounded ? art * 0.22 : 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: art * 0.13,
            top: art * 0.2,
            bottom: art * 0.2,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          {Array.from({ length: holes }, (_, i) => (
            <div
              key={i}
              style={{ width: art * 0.06, height: art * 0.06, borderRadius: art, background: "rgba(255,255,255,0.75)" }}
            />
          ))}
        </div>
        <div
          style={{
            marginLeft: art * 0.12,
            color: "#ffffff",
            fontSize: art * 0.34,
            fontWeight: 800,
            fontFamily: "Manrope",
            letterSpacing: -art * 0.01,
          }}
        >
          555
        </div>
      </div>
    </div>
  );
}

/**
 * ImageResponse options for the icon's bold "555": Manrope ExtraBold, kept in the repo
 * (app/components/fonts, only the glyph "5", SIL Open Font License alongside) so building
 * never depends on the network. If the file can't be read, the options are left out and
 * the icon uses next/og's built-in font; passing an empty `fonts` list would throw.
 */
export async function iconFontOptions(): Promise<
  { fonts: { name: string; data: ArrayBuffer; weight: 800; style: "normal" }[] } | Record<string, never>
> {
  try {
    const file = await readFile(join(process.cwd(), "app/components/fonts/Manrope-ExtraBold-555.ttf"));
    const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    return { fonts: [{ name: "Manrope", data, weight: 800, style: "normal" }] };
  } catch {
    return {};
  }
}
