import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "555 Buku",
  description: "Turn your shop's 555 IOU notebook into PayPal invoices.",
};

const NAV_LINKS = [
  { href: "/scan", label: "Scan" },
  { href: "/collect", label: "Collect" },
  { href: "/ledger", label: "Ledger" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            555 Buku
          </Link>
          <nav aria-label="Main">
            <ul className="site-nav">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
