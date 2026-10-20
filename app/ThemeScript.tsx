"use client";

import { THEME_SCRIPT } from "@/lib/preferences";

// Sets data-theme (and lang) before first paint, so an owner who picked Dark never sees a flash
// of light. The server renders a normal inline <script>, which the browser runs while parsing
// <head>. In the browser React only ever re-creates this element, and React 19 warns about any
// runnable <script> it creates ("Scripts inside React components are never executed"), so on the
// client it's marked as a data block (type="text/plain"): never run twice, never warned about.
// The type differing at hydration is expected, hence suppressHydrationWarning.
// Not next/script's beforeInteractive: in the app router that waits for Next's own JavaScript,
// which loads after first paint, so Dark would flash light.
export default function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? undefined : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  );
}
