"use client";

// Small bridges into AG Studio's own DOM for the Nudge panel: a slot inside Studio's AI panel that
// React can portal into (the roster, the phone close button), and making the rest of the page
// inert while the phone sheet is open. Studio builds its panel itself, so these find it once it
// appears and put the slot back if Studio rebuilds that part.

import { useEffect, useState, type RefObject } from "react";

/**
 * A <div> kept inside the first element matching `selector` under `root` (at the start, or the
 * end), or null while there's no such element. Removed again on unmount or when `enabled` is false.
 */
export function useStudioSlot(root: RefObject<HTMLElement | null>, selector: string, where: "start" | "end", className: string, enabled = true): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const box = root.current;
    if (!box || !enabled) return;
    const el = document.createElement("div");
    el.className = className;
    const place = () => {
      const target = box.querySelector(selector);
      if (!target) return;
      const placed = where === "start" ? target.firstElementChild === el : target.lastElementChild === el;
      if (placed) return;
      if (where === "start") target.prepend(el);
      else target.append(el);
    };
    place();
    setSlot(el);
    const observer = new MutationObserver(place);
    observer.observe(box, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      el.remove();
      setSlot(null);
    };
  }, [root, selector, where, className, enabled]);

  return slot;
}

/** Makes everything on the page except `keep` (and its ancestors) inert. Returns the undo. */
export function inertOutside(keep: Element): () => void {
  const changed: Element[] = [];
  let node: Element | null = keep;
  while (node && node !== document.body) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      // Live regions stay reachable, so replies are still announced.
      if (sibling === node || sibling.hasAttribute("inert") || sibling.tagName === "SCRIPT" || sibling.matches('[role="status"], [aria-live]')) continue;
      sibling.setAttribute("inert", "");
      changed.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const el of changed) el.removeAttribute("inert");
  };
}
