import { ImageResponse } from "next/og";
import { AppIconArt, iconFontOptions } from "../../components/appIcon";

// Home-screen icons listed in app/manifest.ts. Built once at build time.
const VARIANTS = {
  "192": { size: 192, rounded: true, inset: 0 },
  "512": { size: 512, rounded: true, inset: 0 },
  // Android crops maskable icons to its own shape, so the art stays inside the middle 80%.
  "maskable-512": { size: 512, rounded: false, inset: 0.1 },
} as const;

type Variant = keyof typeof VARIANTS;

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  const spec = VARIANTS[variant as Variant];
  if (!spec) return new Response("Not found", { status: 404 });
  return new ImageResponse(<AppIconArt size={spec.size} rounded={spec.rounded} inset={spec.inset} />, {
    width: spec.size,
    height: spec.size,
    ...(await iconFontOptions()),
  });
}
