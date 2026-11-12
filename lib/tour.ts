// The first-visit quick tour's steps, pure so they can be tested in Node. Each step points at
// a real element marked with data-tour="..."; the screen tells us which of those are showing
// (`has`), and steps whose target isn't there are skipped. Mock: "555 Buku - Quick Tour Mock.html".

export type TourLayout = "phone" | "wide";

export const TOUR_STEP_IDS = ["home", "scan", "collect", "reminders", "settings"] as const;
export type TourStepId = (typeof TOUR_STEP_IDS)[number];

/** data-tour values for each step, per layout, best first. */
const TARGETS: Record<TourStepId, Record<TourLayout, string[]>> = {
  home: { phone: ["home-hero"], wide: ["home-hero"] },
  scan: { phone: ["nav-scan"], wide: ["nav-scan"] },
  collect: { phone: ["nav-collect"], wide: ["nav-collect"] },
  // The phone's five-tab menu has no Reminders tab, so point at Home's "Remind" button instead.
  reminders: { phone: ["home-reminders"], wide: ["nav-reminders"] },
  // Phones reach Settings from the account avatar; laptops have a Settings link in the sidebar.
  settings: { phone: ["settings-phone"], wide: ["settings-wide"] },
};

export function tourTargets(id: TourStepId, layout: TourLayout): string[] {
  return TARGETS[id][layout];
}

/** The data-tour value to point at for this step, or null when none of its targets is showing. */
export function resolveTarget(id: TourStepId, layout: TourLayout, has: (target: string) => boolean): string | null {
  return tourTargets(id, layout).find(has) ?? null;
}

export type TourState = {
  layout: TourLayout;
  /** The steps that have a target on screen, in order. */
  steps: TourStepId[];
  index: number;
};

/** The steps that can be shown in this layout right now. */
export function availableSteps(layout: TourLayout, has: (target: string) => boolean): TourStepId[] {
  return TOUR_STEP_IDS.filter((id) => resolveTarget(id, layout, has) !== null);
}

/** Step 1 of the tour, or null when nothing it points at is on screen. */
export function startTour(layout: TourLayout, has: (target: string) => boolean): TourState | null {
  const steps = availableSteps(layout, has);
  return steps.length === 0 ? null : { layout, steps, index: 0 };
}

/** The next step, or null when the tour is finished. */
export function nextStep(s: TourState): TourState | null {
  return s.index + 1 >= s.steps.length ? null : { ...s, index: s.index + 1 };
}

/** The step before; stays on step 1 when already there. */
export function backStep(s: TourState): TourState {
  return s.index === 0 ? s : { ...s, index: s.index - 1 };
}

export function currentStep(s: TourState): TourStepId {
  return s.steps[s.index];
}

/**
 * When the current step's target has gone (it was there when the tour started), drops it and
 * moves on in the direction the owner was going. Null when no step has a target any more.
 */
export function skipMissing(s: TourState, has: (target: string) => boolean, direction: 1 | -1 = 1): TourState | null {
  const steps = s.steps.filter((id) => id === currentStep(s) || resolveTarget(id, s.layout, has) !== null);
  let index = steps.indexOf(currentStep(s));
  if (resolveTarget(steps[index], s.layout, has) !== null) return { ...s, steps, index };
  steps.splice(index, 1);
  if (steps.length === 0) return null;
  // Going forward, the next step slides into this index; going back, take the one before.
  if (direction === -1) index = Math.max(0, index - 1);
  if (index >= steps.length) return null; // the missing step was the last: the tour is done
  return { ...s, steps, index };
}

/**
 * The same tour after the screen changes between phone and laptop: the step list is rebuilt for
 * the new layout, staying on the same step when it's still there.
 */
export function relayout(s: TourState, layout: TourLayout, has: (target: string) => boolean): TourState | null {
  if (layout === s.layout) return s;
  const steps = availableSteps(layout, has);
  if (steps.length === 0) return null;
  const same = steps.indexOf(currentStep(s));
  if (same >= 0) return { layout, steps, index: same };
  // Its step isn't in this layout: go to the first later step that is.
  const later = TOUR_STEP_IDS.indexOf(currentStep(s));
  const index = steps.findIndex((id) => TOUR_STEP_IDS.indexOf(id) > later);
  return index < 0 ? { layout, steps, index: steps.length - 1 } : { layout, steps, index };
}

export type Rect = { top: number; left: number; width: number; height: number };

export type TipPlacement = {
  top: number;
  left: number;
  /** The tooltip sits below the target (arrow on top) or above it (arrow underneath). */
  side: "below" | "above";
  /** The arrow's distance from the tooltip's left edge, so it points at the target's middle. */
  arrowX: number;
};

/**
 * Where to put the tooltip so it stays on screen: below the target when it fits, else above,
 * else whichever side has more room (clamped inside the window). Horizontally centred on the
 * target, kept `margin` px from each edge.
 */
export function placeTip(
  target: Rect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  { gap = 14, margin = 16, arrowInset = 24 }: { gap?: number; margin?: number; arrowInset?: number } = {},
): TipPlacement {
  const roomBelow = viewport.height - (target.top + target.height) - gap - margin;
  const roomAbove = target.top - gap - margin;
  const side: TipPlacement["side"] =
    tip.height <= roomBelow ? "below" : tip.height <= roomAbove ? "above" : roomBelow >= roomAbove ? "below" : "above";
  const rawTop = side === "below" ? target.top + target.height + gap : target.top - gap - tip.height;
  const top = clamp(rawTop, margin, Math.max(margin, viewport.height - margin - tip.height));
  const centre = target.left + target.width / 2;
  const left = clamp(centre - tip.width / 2, margin, Math.max(margin, viewport.width - margin - tip.width));
  const arrowX = clamp(centre - left, arrowInset, Math.max(arrowInset, tip.width - arrowInset));
  return { top, left, side, arrowX };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
