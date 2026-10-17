"use client";

// The first-visit quick tour on Home: a welcome card, then five steps that each light up a real
// part of the screen (marked data-tour="...") with a tooltip beside it. Finishing or skipping
// saves tourSeen, so it never shows on its own again on this device; Settings can replay it.
// The steps themselves are in lib/tour.ts. Mock: "555 Buku - Quick Tour Mock.html".

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { MessageKey } from "@/lib/i18n";
import {
  backStep,
  currentStep,
  nextStep,
  placeTip,
  relayout,
  resolveTarget,
  skipMissing,
  startTour,
  type Rect,
  type TipPlacement,
  type TourLayout,
  type TourState,
} from "@/lib/tour";
import { WIDE_QUERY } from "../useIsWide";
import { usePrefs } from "../usePrefs";
import { useT } from "../useT";
import { BellIcon, ScanIcon, SendIcon } from "./icons";
import { LogoMark } from "./Logo";
import { markTourClosed, takeTourReplay, tourClosedThisVisit } from "./tourReplay";
import { useDialog } from "./useDialog";
import "./quick-tour.css";

type Phase = { kind: "welcome" } | { kind: "tour"; state: TourState; dir: 1 | -1 };

/** The first element marked data-tour={name} that's actually showing (hidden ones measure 0×0). */
function findTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const has = (name: string) => findTarget(name) !== null;

function currentLayout(): TourLayout {
  return window.matchMedia(WIDE_QUERY).matches ? "wide" : "phone";
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function QuickTour() {
  const { prefs, ready, setPrefs } = usePrefs();
  const [phase, setPhase] = useState<Phase | null>(null);
  const decided = useRef(false);

  // Finished or skipped. If this browser can't save (private mode), it still stays closed for this visit.
  const close = useCallback(() => {
    markTourClosed();
    setPrefs({ tourSeen: true });
    setPhase(null);
  }, [setPrefs]);

  // Nothing the tour points at is on screen: close it (and count it as seen) rather than show an empty tour.
  const begin = useCallback(() => {
    const state = startTour(currentLayout(), has);
    if (state) setPhase({ kind: "tour", state, dir: 1 });
    else close();
  }, [close]);

  // Once prefs are read: a replay from Settings starts at step 1; a first visit gets the welcome.
  useEffect(() => {
    if (!ready || decided.current) return;
    decided.current = true;
    if (takeTourReplay()) begin();
    else if (!prefs.tourSeen && !tourClosedThisVisit()) setPhase({ kind: "welcome" });
  }, [ready, prefs.tourSeen, begin]);

  if (!phase) return null;
  return <TourLayer phase={phase} setPhase={setPhase} begin={begin} close={close} />;
}

function TourLayer({
  phase,
  setPhase,
  begin,
  close,
}: {
  phase: Phase;
  setPhase: (p: Phase | null) => void;
  begin: () => void;
  close: () => void;
}) {
  const { t, formatNumber } = useT();
  const ids = useId();
  // One dialog for the welcome and every step, so focus stays trapped throughout and goes back
  // to where it was only when the tour closes. Escape skips.
  const ref = useDialog<HTMLDivElement>(close, { initialFocus: "[data-qt-primary]" });

  const step = phase.kind === "tour" ? currentStep(phase.state) : null;
  const index = phase.kind === "tour" ? phase.state.index : -1;

  const next = useCallback(() => {
    if (phase.kind !== "tour") return;
    const s = nextStep(phase.state);
    if (s) setPhase({ kind: "tour", state: s, dir: 1 });
    else close();
  }, [phase, setPhase, close]);

  const back = useCallback(() => {
    if (phase.kind !== "tour" || phase.state.index === 0) return;
    setPhase({ kind: "tour", state: backStep(phase.state), dir: -1 });
  }, [phase, setPhase]);

  // Left and right arrows move between steps.
  useEffect(() => {
    if (phase.kind !== "tour") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase.kind, next, back]);

  // ----- Spotlight and tooltip position -----
  const [rect, setRect] = useState<(Rect & { radius: string }) | null>(null);
  const [place, setPlace] = useState<TipPlacement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const placed = place !== null;

  // Each new step puts focus on its Next (or Done) button; the live region reads the step out.
  // Runs again once the tooltip is placed, so step 1 gets focus on Start and on a replay too.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-qt-primary]")?.focus({ preventScroll: true });
  }, [ref, phase.kind, index, placed]);

  useLayoutEffect(() => {
    if (phase.kind !== "tour") return;
    const { state, dir } = phase;
    const target = resolveTarget(currentStep(state), state.layout, has);
    const el = target ? findTarget(target) : null;
    if (!el) {
      // Its target has gone since the tour started: move on, or finish if nothing's left.
      const s = skipMissing(state, has, dir);
      if (s) setPhase({ kind: "tour", state: s, dir });
      else close();
      return;
    }

    const r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > window.innerHeight) {
      el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    }

    const PAD = 6;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const css = getComputedStyle(el).borderTopLeftRadius;
      const px = parseFloat(css);
      const radius = css.endsWith("%") ? css : `${(Number.isNaN(px) ? 12 : px) + PAD}px`;
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2, radius });
    };
    measure();

    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    // Crossing between phone and laptop size swaps which element each step points at.
    const onResize = () => {
      const layout = currentLayout();
      if (layout !== state.layout) {
        const s = relayout(state, layout, has);
        if (s) setPhase({ kind: "tour", state: s, dir: 1 });
        else close();
        return;
      }
      later();
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
    ro?.observe(el);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", later, true);
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", later, true);
    };
  }, [phase, setPhase, close]);

  // Place the tooltip above or below the lit-up part once both are measured.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!rect || !tip) return;
    setPlace(
      placeTip(rect, { width: tip.offsetWidth, height: tip.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [rect, index, t]);

  // The step read out by screen readers: set after the region is on screen, so it's announced.
  const [announce, setAnnounce] = useState("");
  const total = phase.kind === "tour" ? phase.state.steps.length : 0;
  const stepOf = t("tour.stepOf", { step: formatNumber(index + 1), total: formatNumber(total) });
  const title = step ? t(`tour.${step}.title` as MessageKey) : t("tour.welcome.title");
  const text = step ? t(`tour.${step}.text` as MessageKey) : t("tour.welcome.sub");
  useEffect(() => {
    setAnnounce(step ? `${stepOf}. ${title}. ${text}` : "");
  }, [step, stepOf, title, text]);

  return (
    <div ref={ref} className="qt" role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} aria-describedby={`${ids}-text`}>
      {phase.kind === "welcome" ? (
        <Welcome titleId={`${ids}-title`} textId={`${ids}-text`} begin={begin} close={close} />
      ) : (
        <>
          {/* Blocks taps on the page underneath while the tour is open; dims it all until the spotlight is measured. */}
          <div className={rect ? "qt-catch" : "qt-catch qt-dim"} aria-hidden="true" />
          {rect && (
            <div
              className="qt-spot"
              style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: rect.radius }}
              aria-hidden="true"
            />
          )}
          <div
            ref={tipRef}
            className="qt-tip"
            data-side={place?.side ?? "below"}
            data-placed={placed || undefined}
            style={place ? ({ top: place.top, left: place.left, "--qt-arrow": `${place.arrowX}px` } as CSSProperties) : undefined}
          >
            <p className="qt-step">{stepOf}</p>
            <h2 id={`${ids}-title`}>{title}</h2>
            <p id={`${ids}-text`}>{text}</p>
            <div className="qt-bar">
              <span className="qt-dots" aria-hidden="true">
                {phase.state.steps.map((id, i) => (
                  <i key={id} className={i === index ? "on" : undefined} />
                ))}
              </span>
              <span className="qt-bar-btns">
                <button type="button" className="qt-btn qt-btn-ghost" onClick={close}>
                  {t("tour.skip")}
                </button>
                {index > 0 && (
                  <button type="button" className="qt-btn" onClick={back}>
                    {t("tour.back")}
                  </button>
                )}
                <button type="button" className="qt-btn qt-btn-primary" data-qt-primary onClick={next}>
                  {index === total - 1 ? t("tour.done") : t("tour.next")}
                </button>
              </span>
            </div>
          </div>
        </>
      )}
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
    </div>
  );
}

function Welcome({ titleId, textId, begin, close }: { titleId: string; textId: string; begin: () => void; close: () => void }) {
  const { t } = useT();
  return (
    <>
      <div className="qt-dim" aria-hidden="true" />
      <div className="qt-welcome">
        <span className="qt-art" aria-hidden="true">
          <LogoMark size={72} />
        </span>
        <h2 id={titleId}>{t("tour.welcome.title")}</h2>
        <p id={textId}>{t("tour.welcome.sub")}</p>
        <ul className="qt-list">
          <li>
            <b className="qt-ic qt-ic-scan" aria-hidden="true">
              <ScanIcon />
            </b>
            {t("tour.welcome.scan")}
          </li>
          <li>
            <b className="qt-ic qt-ic-collect" aria-hidden="true">
              <SendIcon />
            </b>
            {t("tour.welcome.collect")}
          </li>
          <li>
            <b className="qt-ic qt-ic-remind" aria-hidden="true">
              <BellIcon />
            </b>
            {t("tour.welcome.remind")}
          </li>
        </ul>
        <div className="qt-welcome-btns">
          <button type="button" className="qt-btn qt-btn-primary" data-qt-primary onClick={begin}>
            {t("tour.welcome.start")}
          </button>
          <button type="button" className="qt-btn" onClick={close}>
            {t("tour.welcome.skip")}
          </button>
        </div>
        <small>{t("tour.welcome.note")}</small>
      </div>
    </>
  );
}
