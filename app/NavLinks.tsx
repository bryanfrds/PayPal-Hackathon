"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookIcon, ChartIcon, HomeIcon, ScanIcon, SendIcon } from "./components/icons";

const ICONS = { home: HomeIcon, scan: ScanIcon, ledger: BookIcon, insights: ChartIcon, collect: SendIcon };

export type NavLink = { href: string; label: string; icon: keyof typeof ICONS };

// Marks the link for the current page with aria-current="page" (styled in globals.css).
export default function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return (
    <ul className="site-nav">
      {links.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`);
        const Icon = ICONS[link.icon];
        return (
          <li key={link.href}>
            <Link href={link.href} aria-current={active ? "page" : undefined}>
              <Icon />
              <span>{link.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
