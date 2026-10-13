import { ImageResponse } from "next/og";
import { AppIconArt, iconFonts } from "./components/appIcon";

// Browser tab icon.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
  return new ImageResponse(<AppIconArt size={64} rounded />, { ...size, fonts: await iconFonts() });
}
