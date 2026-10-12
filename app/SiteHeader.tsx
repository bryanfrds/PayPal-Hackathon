"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavLinks, { type NavLink } from "./NavLinks";

// The shop owner's header and menu. Hidden on a customer's own tab page (/tab/...),
// which is what the customer opens from the link the shop sends them.
export default function SiteHeader({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  if (pathname.startsWith("/tab/")) return null;
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        555 Buku
      </Link>
      <nav aria-label="Main">
        <NavLinks links={links} />
      </nav>
    </header>
  );
}
