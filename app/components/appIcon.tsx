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

/** First bytes of a real font file: TrueType (0x00010000 or "true") or OpenType ("OTTO"). */
function looksLikeFont(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false;
  const sig = new DataView(data).getUint32(0);
  return sig === 0x00010000 || sig === 0x4f54544f || sig === 0x74727565;
}

/**
 * Manrope ExtraBold for the icon's "555", fetched when the icon is built. Any failure
 * (no network, an error page, a slow server) falls back to the default font rather than
 * failing the build.
 */
export async function iconFonts(): Promise<{ name: string; data: ArrayBuffer; weight: 800; style: "normal" }[]> {
  try {
    const cssRes = await fetch("https://fonts.googleapis.com/css2?family=Manrope:wght@800&text=555", {
      signal: AbortSignal.timeout(5000),
    });
    if (!cssRes.ok) return [];
    const url = (await cssRes.text()).match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return [];
    const fontRes = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!fontRes.ok) return [];
    const data = await fontRes.arrayBuffer();
    return looksLikeFont(data) ? [{ name: "Manrope", data, weight: 800, style: "normal" }] : [];
  } catch {
    return [];
  }
}
