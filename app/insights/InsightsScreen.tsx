"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgStudioAiModule } from "ag-studio";
import { isPayPalUrl } from "@/lib/customer-pay";
import { todayLocal } from "@/lib/debts";
import { toInsightRows } from "@/lib/insights";
import { buildNudgeContext } from "@/lib/nudge";
import { buildSchedule } from "@/lib/reminders";
import { CloseIcon, SparkIcon } from "../components/icons";
import { useCollect } from "../useCollect";
import { useDebts } from "../useDebts";
import { useIsWide } from "../useIsWide";
import { useReminders } from "../useReminders";
import { useShop } from "../useShop";
import { canvasHeight, layoutKind } from "./tiles";
import { AgStudio, FILL, VIEW_PANELS, manropeFamily } from "./studio-loader";
import {
  dataFor,
  initialStateFor,
  STUDIO_CANVAS,
  themeFor,
  widgets,
} from "./studio-config";
import { NUDGE_LOCALE_TEXT, NUDGE_PANELS, NudgeRoster } from "./NudgePanel";
import { nudgeHarness, nudgeToolDisplay, type NudgeShop } from "./nudge-ai";
import { inertOutside, useStudioSlot } from "./studio-dom";
import { useResolvedTheme } from "../usePrefs";

const AI_MODULES = [AgStudioAiModule];
const SHEET_ID = "nudge-sheet";
/** Shortest the laptop dashboard gets when it fills the screen, in px. */
const MIN_FILL_HEIGHT = 520;

export default function InsightsScreen() {
  const { debts, ready } = useDebts();
  const { invoices } = useCollect();
  const { rules, moves, sent } = useReminders();
  const { name: shopName } = useShop();
  const isWide = useIsWide();
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  // On phones Nudge opens over the page; on a laptop it's always beside the dashboard.
  const [askOpen, setAskOpen] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Read out by screen readers: Nudge replying, done, or failed.
  const [announcement, setAnnouncement] = useState("");
  // On a laptop the dashboard and Nudge fill the screen below the heading, so the page itself
  // never scrolls (Studio focusing its message box would otherwise scroll it).
  const [fillHeight, setFillHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!isWide || !el) {
      setFillHeight(null);
      return;
    }
    const fit = () => {
      // Whatever the page is taller than the window, take off the dashboard.
      const overflow = document.documentElement.scrollHeight - window.innerHeight;
      const next = Math.max(MIN_FILL_HEIGHT, Math.floor(el.getBoundingClientRect().height - overflow));
      setFillHeight((current) => (current !== null && Math.abs(current - next) <= 1 ? current : next));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [isWide, ready]);

  const kind = width === null ? null : layoutKind(width);
  // Days late depend on today, so a page left open past midnight catches up on its next render.
  const today = todayLocal();
  // New rows reach Studio through the `data` prop without a remount (Studio takes changes to
  // inline data), so Nudge's chat and any tiles it added survive a ledger edit or PaymentSync.
  // Only crossing between the phone and wide layouts remounts it (via key), since the starting
  // layout is read once; the chat then comes back from nudge-history.ts.
  const data = useMemo(
    () => dataFor(toInsightRows(debts, today)),
    [debts, today],
  );
  const initialState = useMemo(
    () => (kind === null ? null : initialStateFor(kind)),
    [kind],
  );
  // A light/dark switch remounts Studio (see the key below) so it restyles reliably; Nudge's
  // chat comes back from nudge-history.ts, as it does after a layout change.
  const mode = useResolvedTheme();
  const theme = useMemo(() => themeFor(manropeFamily(), STUDIO_CANVAS[mode], mode === "dark"), [mode]);

  // What Nudge's tools read: built the same way as the Nudge chat's summary (app/nudge).
  const shop = useMemo<NudgeShop>(() => {
    const schedule = buildSchedule(debts, invoices, rules, moves, today, sent);
    const payLinks = new Map<string, string>();
    for (const inv of invoices) if (inv.payerLink && isPayPalUrl(inv.payerLink) && !payLinks.has(inv.slug)) payLinks.set(inv.slug, inv.payerLink);
    return { context: buildNudgeContext(shopName, debts, invoices, schedule, today), payLinks };
  }, [shopName, debts, invoices, rules, moves, sent, today]);
  // Studio builds the harness once, so its tools read the latest summary through this ref.
  const shopRef = useRef(shop);
  useEffect(() => {
    shopRef.current = shop;
  }, [shop]);
  const [ai] = useState(() => {
    const getShop = () => shopRef.current;
    return { harness: nudgeHarness(getShop, setAnnouncement), toolDisplay: nudgeToolDisplay(getShop) };
  });

  const showPanel = isWide || askOpen;
  const sheetOpen = askOpen && !isWide;

  // The roster sits inside Studio's panel, under its "Nudge" title; on a phone the sheet's close
  // button sits in that title row.
  const rosterSlot = useStudioSlot(boxRef, ".ag-studio-ai-panel .ag-studio-panel-content", "start", "nudge-roster-slot", ready && showPanel);
  const closeSlot = useStudioSlot(boxRef, ".ag-studio-ai-panel .ag-studio-panel-header", "end", "nudge-close-slot", ready && sheetOpen);

  const closeSheet = useCallback(() => {
    setAskOpen(false);
    // After the page behind stops being inert.
    requestAnimationFrame(() => askRef.current?.focus());
  }, []);

  // The phone sheet is a modal dialog: the page behind is inert, focus moves in, Escape closes it.
  useEffect(() => {
    if (!sheetOpen || !closeSlot) return;
    let undo: (() => void) | null = null;
    let sheet: Element | null = null;
    let frame = 0;
    const setUp = () => {
      sheet = closeSlot.closest(".ag-studio-root-panel-container-right");
      if (!sheet) {
        frame = requestAnimationFrame(setUp);
        return;
      }
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      sheet.setAttribute("aria-label", "Nudge");
      sheet.id = SHEET_ID;
      undo = inertOutside(sheet);
      closeRef.current?.focus();
    };
    setUp();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSheet();
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("nudge-sheet-open");
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("nudge-sheet-open");
      undo?.();
      if (sheet) for (const name of ["role", "aria-modal", "aria-label"]) sheet.removeAttribute(name);
    };
  }, [sheetOpen, closeSlot, closeSheet]);

  const height = kind === null ? undefined : isWide && fillHeight !== null ? fillHeight : canvasHeight(kind);

  return (
    <div className={`insights${isWide ? " insights-wide" : ""}${sheetOpen ? " insights-asking" : ""}`}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Insights</h1>
          <p className="page-intro">
            Who owes you and how fast people pay, from your ledger.
          </p>
        </div>
        <div className="page-actions">
          <Link href="/reminders" className="button">
            Reminders
          </Link>
          {!isWide && (
            <button
              ref={askRef}
              type="button"
              className="button button-primary insights-ask"
              onClick={() => setAskOpen(true)}
              aria-expanded={askOpen}
              aria-controls={SHEET_ID}
            >
              <SparkIcon />
              Ask Nudge
            </button>
          )}
        </div>
      </div>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <div
        className="insights-studio"
        ref={boxRef}
        style={height === undefined ? undefined : { height }}
      >
        {rosterSlot && createPortal(<NudgeRoster />, rosterSlot)}
        {closeSlot &&
          createPortal(
            <button ref={closeRef} type="button" className="nudge-sheet-close" onClick={closeSheet} aria-label="Close Nudge">
              <CloseIcon />
            </button>,
            closeSlot,
          )}
        {ready && initialState && (
          <AgStudio
            key={`${kind}-${mode}`}
            data={data}
            mode="view"
            theme={theme}
            widgets={widgets}
            panels={showPanel ? NUDGE_PANELS : VIEW_PANELS}
            style={FILL}
            initialState={initialState}
            modules={AI_MODULES}
            ai={ai.harness}
            aiToolDisplay={ai.toolDisplay}
            localeText={NUDGE_LOCALE_TEXT}
          />
        )}
      </div>
    </div>
  );
}
