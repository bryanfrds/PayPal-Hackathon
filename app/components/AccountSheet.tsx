"use client";

// Who's signed in, the shop's name, PayPal status and Sign out. Opened from the shop avatar
// on Home (phone) or the account button in the laptop sidebar.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { initials } from "@/lib/home";
import { useShop } from "../useShop";
import { CheckIcon, CloseIcon } from "./icons";

type Me = { email: string; method: "email" | "paypal" };

export default function AccountSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { name } = useShop();
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .then((body) => {
        if (live) setMe(body);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Escape closes; focus starts in the sheet and stays there.
  useEffect(() => {
    const sheet = sheetRef.current;
    sheet?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !sheet) return;
      const items = [...sheet.querySelectorAll<HTMLElement>("button, a[href]")].filter((el) => !el.hasAttribute("disabled"));
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!res.ok) throw new Error();
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setError("Couldn't sign out just now. Try again.");
      setBusy(false);
    }
  }

  // Rendered at the end of <body>, so no sticky or layered part of a page can sit on top.
  return createPortal(
    <div className="acct-backdrop" onClick={onClose}>
      <div
        ref={sheetRef}
        className="acct-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acct-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="acct-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="acct-who">
          <span className="acct-av" aria-hidden="true">
            {initials(name)}
          </span>
          <span>
            <b id="acct-title">{name}</b>
            <span>{me?.email ?? " "}</span>
          </span>
        </div>
        <dl className="acct-rows">
          <div>
            <dt>Shop name</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>Signed in with</dt>
            <dd>{me ? (me.method === "paypal" ? "PayPal" : "Email code") : "…"}</dd>
          </div>
          <div>
            <dt>PayPal invoices</dt>
            <dd className="acct-ok">
              <CheckIcon />
              Sandbox
            </dd>
          </div>
        </dl>
        {error && (
          <p className="si-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="acct-signout" onClick={signOut} disabled={busy}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
