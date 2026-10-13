import { ImageResponse } from "next/og";
import { AppIconArt, iconFonts } from "./components/appIcon";

// iPhone "Add to Home Screen" icon. iOS rounds the corners itself, so this is full-bleed.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  return new ImageResponse(<AppIconArt size={180} rounded={false} />, { ...size, fonts: await iconFonts() });
}
