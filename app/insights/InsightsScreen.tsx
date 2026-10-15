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
import { canvasHeight, layoutKind, studioCanvasWidth, tabsGridFor } from "./tiles";
import { AgStudio, FILL, VIEW_PANELS, manropeFamily } from "./studio-loader";
import {
  dataFor,
  initialStateFor,
  STUDIO_CANVAS,
  themeFor,
  widgetRegistry,
} from "./studio-config";
import { NUDGE_PANELS, NudgeRoster, nudgeLocaleText } from "./NudgePanel";
import { nudgeHarness, nudgeToolDisplay, type NudgeShop } from "./nudge-ai";
import { inertOutside, useStudioElementWidth, useStudioSlot } from "./studio-dom";
import { useResolvedTheme } from "../usePrefs";
import { useT } from "../useT";

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
  const { t, lang } = useT();
  const localWidgets = useMemo(() => widgetRegistry(t), [t]);
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
    // A hidden tab gets no resize events, so read again when it's shown.
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
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
  // Only crossing between the phone and wide layouts, or a change in the grid sizing below,
  // remounts it (via key), since the starting layout is read once; the chat then comes back
  // from nudge-history.ts.
  const data = useMemo(
    () => dataFor(toInsightRows(debts, today), t, lang),
    [debts, today, t, lang],
  );
  // How many columns the "Every tab" grid shows, and how wide, comes from the width of Studio's
  // canvas: our box less Nudge's docked panel on a laptop (on a phone Nudge opens over the page),
  // lowered by Studio's own measurement if that's narrower. See studioCanvasWidth.
  const measuredCanvas = useStudioElementWidth(boxRef, ".ag-studio-layout-measurement-container", ready);
  const canvasWidth = width === null ? null : studioCanvasWidth(width, isWide, measuredCanvas);
  const tabs = kind === null || canvasWidth === null ? null : tabsGridFor(canvasWidth, kind);
  const tabsColumns = tabs?.columns;
  const tabsColumnWidth = tabs?.columnWidth;
  const tabsCellPadding = tabs?.cellPadding;
  // Tile titles and the grid's columns are read once per mount, so a language change or a new
  // column count or width remounts Studio (see the key).
  const initialState = useMemo(
    () =>
      kind === null || tabsColumns === undefined || tabsColumnWidth === undefined || tabsCellPadding === undefined
        ? null
        : initialStateFor(kind, { columns: tabsColumns, columnWidth: tabsColumnWidth, cellPadding: tabsCellPadding }, t),
    [kind, tabsColumns, tabsColumnWidth, tabsCellPadding, t],
  );
  const localeText = useMemo(() => nudgeLocaleText(t), [t]);
  // A light/dark switch remounts Studio (see the key below) so it restyles reliably; Nudge's
  // chat comes back from nudge-history.ts, as it does after a layout change.
  const mode = useResolvedTheme();
  // The grid's cell padding is a theme setting; it changes only with the column width, which
  // remounts Studio anyway (see the key).
  const theme = useMemo(
    () => themeFor(manropeFamily(), STUDIO_CANVAS[mode], mode === "dark", tabsCellPadding),
    [mode, tabsCellPadding],
  );

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
  // Rebuilt only when the language changes, which remounts Studio anyway; chats survive in nudge-history.ts.
  const ai = useMemo(() => {
    const getShop = () => shopRef.current;
    return { harness: nudgeHarness(getShop, setAnnouncement, t), toolDisplay: nudgeToolDisplay(getShop, t) };
  }, [t]);

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
          <h1 className="page-title">{t("insights.title")}</h1>
          <p className="page-intro">
            {t("insights.intro")}
          </p>
        </div>
        <div className="page-actions">
          <Link href="/reminders" className="button">
            {t("insights.reminders")}
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
              {t("insights.askNudge")}
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
            <button ref={closeRef} type="button" className="nudge-sheet-close" onClick={closeSheet} aria-label={t("insights.closeNudge")}>
              <CloseIcon />
            </button>,
            closeSlot,
          )}
        {ready && initialState && (
          <AgStudio
            key={`${kind}-${tabsColumns}x${tabsColumnWidth}p${tabsCellPadding}-${mode}-${lang}`}
            data={data}
            mode="view"
            theme={theme}
            widgets={localWidgets}
            panels={showPanel ? NUDGE_PANELS : VIEW_PANELS}
            style={FILL}
            initialState={initialState}
            modules={AI_MODULES}
            ai={ai.harness}
            aiToolDisplay={ai.toolDisplay}
            localeText={localeText}
          />
        )}
      </div>
    </div>
  );
}
