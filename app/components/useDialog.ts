"use client";

// Shared behaviour for the app's dialogs and sheets (the same pattern as AccountSheet and
// ShareSheet): focus moves in, Tab stays inside, Escape closes, focus goes back to
// whatever opened it, and the page behind doesn't scroll while it's open. Put role="dialog" aria-modal="true" and a label on the element itself.

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Wires a dialog's focus and keys. `returnTo` is the element to focus on close; when left
 * out, it's whatever had focus when the dialog opened.
 */
export function useDialog<T extends HTMLElement>(
  onClose: () => void,
  options: { returnTo?: HTMLElement | null; initialFocus?: string } = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const { returnTo, initialFocus } = options;

  useEffect(() => {
    const root = ref.current;
    const opener = returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // Lock the page behind (restored on close; nested dialogs restore in order).
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    if (root) {
      const first = (initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null) ?? focusables(root)[0] ?? root;
      if (first === root && !root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
      first.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = focusables(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      html.style.overflow = previousOverflow;
      // After React finishes removing the dialog, so the opener is focusable again.
      window.setTimeout(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      }, 0);
    };
    // Runs once per open: the dialog mounts when opened and unmounts when closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
