import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import type { ReactNode } from "react";
import type { NavLink } from "./NavLinks";
import PaymentSync from "./PaymentSync";
import SiteHeader from "./SiteHeader";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "555 Buku",
  description: "Turn your shop's 555 IOU notebook into PayPal invoices.",
  applicationName: "555 Buku",
  // iPhone: opens full-screen from the home screen, named "555 Buku".
  appleWebApp: { capable: true, title: "555 Buku", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f3f1ec",
  viewportFit: "cover",
};

const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/scan", label: "Scan", icon: "scan" },
  { href: "/ledger", label: "Ledger", icon: "ledger" },
  { href: "/insights", label: "Insights", icon: "insights" },
  { href: "/reminders", label: "Reminders", icon: "reminders", wideOnly: true },
  { href: "/collect", label: "Collect", icon: "collect" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <SiteHeader links={NAV_LINKS} />
        <main className="site-main">{children}</main>
        <PaymentSync />
      </body>
    </html>
  );
}
