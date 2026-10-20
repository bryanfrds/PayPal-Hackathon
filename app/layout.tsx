import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import type { ReactNode } from "react";
import type { NavLink } from "./NavLinks";
import PaymentSync from "./PaymentSync";
import SiteHeader from "./SiteHeader";
import TabPublisher from "./TabPublisher";
import ThemeScript from "./ThemeScript";
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
  { href: "/", label: "nav.home", icon: "home" },
  { href: "/scan", label: "nav.scan", icon: "scan" },
  { href: "/ledger", label: "nav.ledger", icon: "ledger" },
  { href: "/insights", label: "nav.insights", icon: "insights" },
  { href: "/reminders", label: "nav.reminders", icon: "reminders", wideOnly: true },
  { href: "/collect", label: "nav.collect", icon: "collect" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets data-theme before React loads, so the attribute can differ from
    // the server's; suppressHydrationWarning covers only this element's own attributes.
    <html lang="en" className={manrope.variable} data-theme="light" suppressHydrationWarning>
      <head>
        {/* Before first paint: no flash of light for an owner who picked Dark. */}
        <ThemeScript />
      </head>
      <body>
        <SiteHeader links={NAV_LINKS} />
        <main className="site-main">{children}</main>
        <PaymentSync />
        <TabPublisher />
      </body>
    </html>
  );
}
