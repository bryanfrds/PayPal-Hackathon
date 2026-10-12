import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Your tab · 555 Buku",
  description: "What you owe the shop, your bills and your history.",
};

export default function TabLayout({ children }: { children: ReactNode }) {
  return children;
}
