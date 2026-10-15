// Soft avatar colours with a dark-mode partner for each, so a customer keeps "their" colour in
// both themes. Inline styles can't follow the theme on their own, so each element carries both
// pairs as CSS variables and globals.css ([data-pal]) picks the one for the theme showing.

import type { CSSProperties } from "react";

const DARK: Record<string, [string, string]> = {
  "#fde8df": ["#4a2418", "#ffb59c"],
  "#e3ecfb": ["#1c2a4d", "#a9c1ff"],
  "#e6f3ea": ["#183022", "#7fd19b"],
  "#f6efdc": ["#3d3112", "#f4d27a"],
  "#efe6f8": ["#2f2450", "#cdb8ff"],
  "#e0f2f1": ["#12302e", "#7fd6cc"],
  "#ffe9e4": ["#3a1d17", "#ff8a73"],
};

/** Props for an element coloured with a light pair: `{...palette(bg, fg)}`. Light looks exactly as before. */
export function palette(bg: string, fg: string): { style: CSSProperties; "data-pal": "" } {
  const [darkBg, darkFg] = DARK[bg] ?? [bg, fg];
  return {
    "data-pal": "",
    style: {
      "--pal-bg": bg,
      "--pal-fg": fg,
      "--pal-bg-dark": darkBg,
      "--pal-fg-dark": darkFg,
      background: "var(--pal-bg-now)",
      color: "var(--pal-fg-now)",
    } as CSSProperties,
  };
}
