"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { initials } from "@/lib/home";
import AccountSheet from "./components/AccountSheet";
import Logo from "./components/Logo";
import { GearIcon, SparkIcon } from "./components/icons";
import NavLinks, { type NavLink } from "./NavLinks";
import { useShop } from "./useShop";
import { useT } from "./useT";

// The shop owner's header and menu. Hidden on a customer's own tab page (/tab/...),
// which is what the customer opens from the link the shop sends them, on the
// full-screen scanner (/scan), which has its own close and back buttons, and on sign-in.
export default function SiteHeader({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const { name } = useShop();
  const { t } = useT();
  const [accountOpen, setAccountOpen] = useState(false);
  if (pathname.startsWith("/tab/") || pathname === "/scan" || pathname.startsWith("/sign-in")) return null;
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <Logo />
      </Link>
      <nav aria-label={t("nav.main")}>
        <NavLinks links={links} />
      </nav>
      {/* Laptop sidebar only: Nudge, one click from every screen. */}
      <Link href="/nudge" className="side-nudge">
        <strong>
          <SparkIcon />
          {t("nav.askNudge")}
        </strong>
        <span>{t("nav.nudgeQuestion")}</span>
      </Link>
      {/* Laptop sidebar only. On phones Settings is reached from the account sheet. */}
      <Link
        href="/settings"
        className="side-settings"
        aria-current={pathname === "/settings" ? "page" : undefined}
        data-tour="settings-wide"
      >
        <GearIcon />
        {t("nav.settings")}
      </Link>
      {/* Laptop sidebar only: who's signed in, and Sign out. On phones it's the avatar on Home. */}
      <button type="button" className="side-account" onClick={() => setAccountOpen(true)} aria-label={t("nav.account", { name })}>
        <span className="side-account-av" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="side-account-name">{name}</span>
      </button>
      {accountOpen && <AccountSheet onClose={() => setAccountOpen(false)} />}
    </header>
  );
}
