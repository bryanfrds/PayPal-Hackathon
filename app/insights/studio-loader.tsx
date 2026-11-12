"use client";

// AG Studio, loaded only in the browser (it measures the DOM), with the licence key applied
// first. Shared by Insights and Home's chart tile.

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { AgStudioReactProperties } from "ag-studio-react";
import type { BukuRegistry } from "./studio-config";
import { useT } from "../useT";

function StudioLoading() {
  const { t } = useT();
  return <p className="card loading">{t("common.loading")}</p>;
}

export const AgStudio = dynamic(
  () =>
    Promise.all([import("ag-studio-react"), import("ag-studio")])
      .then(([react, core]) => {
        // AG Studio trial or full key from AG Grid (info@ag-grid.com). Without one it runs as a trial with a watermark.
        const key = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY;
        if (key) core.AgStudioLicenseManager.setLicenseKey(key);
        return react;
      })
      .then((m) => m.AgStudio as unknown as ComponentType<AgStudioReactProperties<BukuRegistry>>),
  {
    ssr: false,
    loading: () => <StudioLoading />,
  },
);

/** The real family name next/font gave Manrope (e.g. "'Manrope', 'Manrope Fallback'"). */
export function manropeFamily(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  return getComputedStyle(document.documentElement).getPropertyValue("--font-manrope").trim() || "system-ui, sans-serif";
}

/** View mode with no side panels. */
export const VIEW_PANELS = { view: { left: [] } };
export const FILL = { height: "100%", width: "100%" };
