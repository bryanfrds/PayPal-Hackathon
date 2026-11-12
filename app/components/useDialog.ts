"use client";

// Shared behaviour for the app's dialogs and sheets (the same pattern as AccountSheet and
// ShareSheet): focus moves in, Tab stays inside, Escape closes, focus goes back to
// whatever opened it (or to the page heading if it opened by itself), and the page behind is
// inert and doesn't scroll while it's open. Put role="dialog" aria-modal="true" and a label on the element itself.

import { useEffect, useRef, useState, type RefObject } from "react";

// The page behind stays still while any dialog is open. A count, not a saved-and-restored
// value per dialog, so it's right whatever order stacked dialogs close in: the first to open
// saves the page's own setting and locks it, the last to close puts it back.
let openDialogs = 0;
let savedOverflow = "";

function lockPage() {
  if (openDialogs === 0) {
    savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }
  openDialogs += 1;
}

function unlockPage() {
  openDialogs = Math.max(0, openDialogs - 1);
  if (openDialogs === 0) document.documentElement.style.overflow = savedOverflow;
}

const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

/** The bits of an element inertOutside touches, so it can be tested without a browser. */
type Node_ = {
  parentElement: Node_ | null;
  children: ArrayLike<Node_>;
  inert?: boolean;
  tagName: string;
  closest?: (selector: string) => Node_ | null;
};

/**
 * Makes everything outside the dialog inert (no clicks, no focus, hidden from screen readers) by
 * marking the siblings of the dialog and of each of its ancestors, up to <body>. A sheet's dimmed
 * backdrop (.sheet-dim) sits beside it inside .sheet-layer and closes it on tap, so the walk starts
 * from that layer and the backdrop stays live. Returns a function that undoes exactly what it did;
 * elements that were already inert are left alone.
 */
export function inertOutside(root: Node_): () => void {
  const changed: Node_[] = [];
  let node: Node_ | null = root.closest?.(".sheet-layer") ?? root;
  while (node?.parentElement && node.tagName !== "BODY") {
    const parent: Node_ = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || sibling.inert || sibling.tagName === "SCRIPT" || sibling.tagName === "HEAD") continue;
      sibling.inert = true;
      changed.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const el of changed) el.inert = false;
  };
}

/** The bits of the document returnFocusTarget reads. */
type Doc_ = { body: unknown; querySelector: (selector: string) => HTMLElement | null };

/**
 * Where focus goes when a dialog closes: back to what opened it, or, for a dialog that opened by
 * itself (focus was on the page, or the opener has gone), to the page's heading or main area,
 * rather than dropping to <body> where screen readers lose their place.
 */
export function returnFocusTarget(opener: HTMLElement | null, doc: Doc_): HTMLElement | null {
  if (opener && opener !== doc.body && opener.isConnected) return opener;
  return doc.querySelector("main h1") ?? doc.querySelector("h1") ?? doc.querySelector("main");
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
  // What had focus when the dialog first rendered, read during render rather than in the effect:
  // in development React runs the effect twice, and by the second run focus is already inside the
  // dialog, so the opener would be lost.
  const [focusedAtOpen] = useState(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const root = ref.current;
    const opener = returnTo ?? focusedAtOpen;
    lockPage();
    // The page behind can't be clicked, tabbed into or read out while the dialog is open.
    const restoreInert = root ? inertOutside(root) : () => {};
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
      restoreInert();
      unlockPage();
      // After React finishes removing the dialog, so the opener is focusable again.
      window.setTimeout(() => {
        const target = returnFocusTarget(opener, document);
        if (!target) return;
        // A heading or <main> isn't focusable on its own; -1 lets a script focus it without adding a Tab stop.
        if (target !== opener && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }, 0);
    };
    // Runs once per open: the dialog mounts when opened and unmounts when closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
