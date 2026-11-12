import type { Metadata } from "next";
import type { ReactNode } from "react";

// A customer's own tab, opened from the link the shop sends. Never indexed, and the link
// (its token) isn't passed on to other sites in the Referer header.
export const metadata: Metadata = {
  title: "Your tab · 555 Buku",
  description: "What you owe the shop, your bills and your history.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default function SharedTabLayout({ children }: { children: ReactNode }) {
  return children;
}
