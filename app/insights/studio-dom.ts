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

/**
 * Makes everything on the page except `keep` (and its ancestors, up to `top`) inert, leaving
 * live regions alone. Returns the undo, which only touches what this call changed.
 */
export function inertOutside(keep: Element, top: Element = document.body): () => void {
  const changed: Element[] = [];
  let node: Element | null = keep;
  while (node && node !== top) {
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

type Observers = {
  ResizeObserver: typeof ResizeObserver;
  MutationObserver: typeof MutationObserver;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/**
 * Reports the width of the first element matching `selector` under `box`: the first width at
 * once, later ones after `settleMs` without a further change. Studio builds its DOM itself and
 * rebuilds it on a remount (asynchronously), so only a connected element with a real width is
 * read: the old element, removed or collapsed mid-rebuild, never reports 0. While the element is
 * connected, DOM changes are ignored; once it's gone, the next DOM change looks for the new one.
 * Returns the cleanup.
 */
export function watchElementWidth(
  box: ParentNode & Node,
  selector: string,
  onWidth: (width: number) => void,
  settleMs = 150,
  given?: Observers,
): () => void {
  // Tests pass fakes; the browser's own are only looked up here, never during server rendering.
  const env: Observers = given ?? {
    ResizeObserver,
    MutationObserver,
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let watched: Element | null = null;
  let reported = false;
  let timer: unknown;
  const read = () => {
    if (!watched?.isConnected) return;
    const width = watched.getBoundingClientRect().width;
    if (!(width > 0)) return;
    env.clearTimeout(timer);
    if (!reported) {
      reported = true;
      onWidth(width);
      return;
    }
    timer = env.setTimeout(() => onWidth(width), settleMs);
  };
  const resize = new env.ResizeObserver(read);
  const find = () => {
    if (watched?.isConnected) return;
    if (watched) resize.unobserve(watched);
    watched = box.querySelector(selector);
    if (!watched) return;
    resize.observe(watched);
    read();
  };
  find();
  const mutations = new env.MutationObserver(find);
  mutations.observe(box, { childList: true, subtree: true });
  return () => {
    mutations.disconnect();
    resize.disconnect();
    env.clearTimeout(timer);
  };
}

/** watchElementWidth as React state: null until the element has been seen with a width. */
export function useStudioElementWidth(root: RefObject<HTMLElement | null>, selector: string, enabled = true): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const box = root.current;
    if (!box || !enabled) return;
    return watchElementWidth(box, selector, setWidth);
  }, [root, selector, enabled]);

  return width;
}
