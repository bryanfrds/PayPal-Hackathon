"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { AgStudioReactProperties } from "ag-studio-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { todayLocal } from "@/lib/debts";
import { toInsightRows } from "@/lib/insights";
import { useDebts } from "../useDebts";
import {
  PHONE_MAX,
  type BukuRegistry,
  canvasHeight,
  dataFor,
  initialStateFor,
  themeFor,
  widgets,
} from "./studio-config";

// Studio measures the DOM, so it only runs in the browser.
const AgStudio = dynamic(
  () =>
    Promise.all([import("ag-studio-react"), import("ag-studio")])
      .then(([react, core]) => {
        // AG Studio trial or full key from AG Grid (info@ag-grid.com). Without one it runs as a trial with a watermark.
        const key = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY;
        if (key) core.AgStudioLicenseManager.setLicenseKey(key);
        return react;
      })
      .then(
        (m) =>
          m.AgStudio as unknown as ComponentType<
            AgStudioReactProperties<BukuRegistry>
          >,
      ),
  {
    ssr: false,
    loading: () => <p className="card loading">Loading your dashboard…</p>,
  },
);

// The real family name next/font gave Manrope (e.g. "'Manrope', 'Manrope Fallback'").
function manropeFamily(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-manrope")
      .trim() || "system-ui, sans-serif"
  );
}

const PANELS = { view: { left: [] } };
const FILL = { height: "100%", width: "100%" };

export default function InsightsScreen() {
  const { debts, ready } = useDebts();
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const narrow = width !== null && width <= PHONE_MAX;
  const layoutKey = width === null ? null : narrow ? "phone" : "wide";
  // Studio reads data and the starting layout once, so it's remounted (via key) when the
  // ledger changes or the screen crosses between the phone and wide layouts.
  const data = useMemo(
    () => dataFor(toInsightRows(debts, todayLocal())),
    [debts],
  );
  const initialState = useMemo(
    () =>
      layoutKey === null
        ? null
        : initialStateFor(layoutKey === "phone" ? 0 : Infinity),
    [layoutKey],
  );
  const theme = useMemo(() => themeFor(manropeFamily()), []);
  const version = useMemo(
    () => debts.map((d) => `${d.id}:${d.status}:${d.amountSen}`).join("|"),
    [debts],
  );

  return (
    <div className="insights">
      <div className="page-head">
        <div>
          <h1 className="page-title">Insights</h1>
          <p className="page-intro">
            Who owes you and how fast people pay, from your ledger.
          </p>
        </div>
      </div>
      <div
        className="insights-studio"
        ref={boxRef}
        style={width === null ? undefined : { height: canvasHeight(width) }}
      >
        {ready && initialState && (
          <AgStudio
            key={`${layoutKey}-${version}`}
            data={data}
            mode="view"
            theme={theme}
            widgets={widgets}
            panels={PANELS}
            style={FILL}
            initialState={initialState}
          />
        )}
      </div>
    </div>
  );
}
