"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./components/Logo";
import { SparkIcon } from "./components/icons";
import NavLinks, { type NavLink } from "./NavLinks";

// The shop owner's header and menu. Hidden on a customer's own tab page (/tab/...),
// which is what the customer opens from the link the shop sends them, and on the
// full-screen scanner (/scan), which has its own close and back buttons.
export default function SiteHeader({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  if (pathname.startsWith("/tab/") || pathname === "/scan") return null;
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <Logo />
      </Link>
      <nav aria-label="Main">
        <NavLinks links={links} />
      </nav>
      {/* Laptop sidebar only: Nudge, one click from every screen. */}
      <Link href="/nudge" className="side-nudge">
        <strong>
          <SparkIcon />
          Ask Nudge
        </strong>
        <span>&ldquo;Who should I remind today?&rdquo;</span>
      </Link>
    </header>
  );
}
