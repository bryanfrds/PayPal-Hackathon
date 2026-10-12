import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import NavLinks from "./NavLinks";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "555 Buku",
  description: "Turn your shop's 555 IOU notebook into PayPal invoices.",
};

const NAV_LINKS = [
  { href: "/scan", label: "Scan" },
  { href: "/collect", label: "Collect" },
  { href: "/ledger", label: "Ledger" },
  { href: "/add", label: "Add debt" },
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
