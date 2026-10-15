"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MessageKey } from "@/lib/i18n";
import { BellIcon, BookIcon, ChartIcon, HomeIcon, ScanIcon, SendIcon } from "./components/icons";
import { useT } from "./useT";

const ICONS = { home: HomeIcon, scan: ScanIcon, ledger: BookIcon, insights: ChartIcon, reminders: BellIcon, collect: SendIcon };

/** `label` is a translation key, e.g. "nav.home". `wideOnly` links show in the laptop sidebar but not in the phone's five-tab menu. */
export type NavLink = { href: string; label: MessageKey; icon: keyof typeof ICONS; wideOnly?: boolean };

// Marks the link for the current page with aria-current="page" (styled in globals.css).
export default function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const { t } = useT();
  return (
    <ul className="site-nav">
      {links.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`);
        const Icon = ICONS[link.icon];
        return (
          <li key={link.href} className={link.wideOnly ? "nav-wide-only" : undefined}>
            <Link href={link.href} aria-current={active ? "page" : undefined}>
              <Icon />
              <span>{t(link.label)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
