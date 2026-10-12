import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import NavLinks, { type NavLink } from "./NavLinks";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "555 Buku",
  description: "Turn your shop's 555 IOU notebook into PayPal invoices.",
};

const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/scan", label: "Scan", icon: "scan" },
  { href: "/ledger", label: "Ledger", icon: "ledger" },
  { href: "/collect", label: "Collect", icon: "collect" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            555 Buku
          </Link>
          <nav aria-label="Main">
            <NavLinks links={NAV_LINKS} />
          </nav>
        </header>
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
