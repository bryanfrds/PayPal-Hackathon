"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellKeyDownEvent,
  type ColDef,
  type FullWidthCellKeyDownEvent,
  type GridApi,
  type ModelUpdatedEvent,
  type RowSelectionOptions,
  type SelectionColumnDef,
} from "ag-grid-community";
import { formatSen, outstanding, type Debt } from "@/lib/debts";
import type { T } from "@/lib/i18n";
import { daysLate, invoiceState, isOverdue } from "@/lib/tab-status";
import { TabStatus, tabStatusText } from "../components/StatusBadge";
import { DARK_GRID_COLOURS } from "../components/grid-theme";
import { CloseIcon } from "../components/icons";
import { useResolvedTheme } from "../usePrefs";
import { useT } from "../useT";

ModuleRegistry.registerModules([AllCommunityModule]);

// Style H, Soft Premium: matches the colours in globals.css.
const ledgerTheme = themeQuartz.withParams({
  fontFamily: "inherit",
  foregroundColor: "#141414",
  accentColor: "#141414",
  backgroundColor: "#ffffff",
  headerBackgroundColor: "#ffffff",
  headerFontWeight: 700,
  borderColor: "#ebe7df",
  wrapperBorder: false,
  wrapperBorderRadius: 24,
  rowHoverColor: "#f7f5f1",
});

const ledgerDarkTheme = ledgerTheme.withParams({ ...DARK_GRID_COLOURS, headerBackgroundColor: "#1d1d1c" });

// Phones: half the side padding in each cell, so name, amount and the status badge all fit.
const PHONE_PADDING = { cellHorizontalPaddingScale: 0.5 } as const;
const ledgerPhoneTheme = ledgerTheme.withParams(PHONE_PADDING);
const ledgerPhoneDarkTheme = ledgerDarkTheme.withParams(PHONE_PADDING);

// Narrow grids hide Item and Date; medium ones hide Date; wide ones show every column.
// Measured on the grid itself: on a phone it's about 340px wide ("phone"); on a laptop the
// ledger page is wider and the grid is about 730px at a 1280px window ("desktop").
const PHONE_MAX_WIDTH = 460;
const TABLET_MAX_WIDTH = 700;

type LayoutMode = "phone" | "tablet" | "desktop";

// Fixed sizes so the grid can be given an exact height that follows the visible rows.
const ROW_HEIGHT = 42;
const HEADER_HEIGHT = 44;

type LedgerRow = Debt;

type DeleteContext = { onDelete: (debt: Debt) => void; t: T };

// Passed through the column (cellRendererParams), which the grid re-reads when the layout or
// day changes; the grid context is only read once.
type StatusParams = { today: string; compact: boolean };

function StatusCell(props: CustomCellRendererProps<LedgerRow> & StatusParams) {
  const debt = props.data;
  // The pinned "Still owed" row has no status.
  if (!debt || props.node.rowPinned) return null;
  return (
    <span className="status-cell">
      <TabStatus debt={debt} today={props.today} compact={props.compact} />
    </span>
  );
}

/** Sort order: overdue first (most days late first), then invoice sent, not sent, paid. */
function statusRank(debt: Debt, today: string): number {
  if (isOverdue(debt, today)) return -daysLate(debt, today) - 1;
  return { sent: 1, unpaid: 2, paid: 3 }[invoiceState(debt)];
}

function DeleteButton(props: CustomCellRendererProps<LedgerRow, unknown, DeleteContext>) {
  const debt = props.data;
  // The pinned "Still owed" row has no id to delete.
  if (!debt || props.node.rowPinned) return null;
  return (
    <button
      type="button"
      className="row-delete"
      aria-label={props.context.t("ledger.deleteRow", { name: debt.customerName, amount: formatSen(debt.amountSen) })}
      title={props.context.t("ledger.delete")}
      onClick={() => props.context.onDelete(debt)}
    >
      <CloseIcon className="icon row-delete-icon" />
    </button>
  );
}

// Minimum widths are set so the visible columns fit without cutting the status badges or the
// date: phone columns (with the 34px tick box) total about 332px, under the ~340px grid on a
// 390px phone; laptop columns total about 722px, under the ~730px grid at 1280px.
function buildColumnDefs(mode: LayoutMode, t: T, today: string): ColDef<LedgerRow>[] {
  const phone = mode === "phone";
  const label = (debt: Debt | undefined) => (debt ? tabStatusText(debt, today, t) : "");
  return [
    { field: "customerName", headerName: t("ledger.colName"), flex: 1.3, minWidth: phone ? 88 : 130, tooltipField: "customerName" },
    // Item gives up width first, so a late tab's two status badges fit beside it.
    { field: "item", headerName: t("ledger.colItem"), flex: 2, minWidth: 80, hide: phone, tooltipField: "item" },
    {
      field: "amountSen",
      headerName: mode === "desktop" ? t("ledger.colAmount") : "RM",
      flex: 1,
      minWidth: phone ? 62 : 110,
      type: "rightAligned",
      // Right-aligned headers put the filter button before the label, where it looks like an empty column.
      suppressHeaderFilterButton: true,
      valueFormatter: (p) => (p.value == null ? "" : formatSen(Number(p.value))),
    },
    {
      field: "date",
      headerName: t("ledger.colDate"),
      // Fixed: a YYYY-MM-DD date and the filter button need about 120px, and never more.
      width: 124,
      minWidth: 124,
      hide: mode !== "desktop",
      getQuickFilterText: (p) => p.data?.date ?? "",
    },
    {
      field: "status",
      headerName: t("ledger.colStatus"),
      flex: 1,
      // Phones show one badge; wider grids show the invoice state and a late badge side by side.
      minWidth: phone ? 112 : 186,
      cellRenderer: StatusCell,
      cellRendererParams: { today, compact: phone } satisfies StatusParams,
      // Search and filter by the words on the badges ("Invoice sent · Overdue"), not the stored value.
      getQuickFilterText: (p) => label(p.data),
      filterValueGetter: (p) => label(p.data),
      // Header sort goes by urgency (overdue → invoice sent → not sent → paid), not A–Z.
      comparator: (_a, _b, nodeA, nodeB) =>
        (nodeA.data ? statusRank(nodeA.data, today) : 9) - (nodeB.data ? statusRank(nodeB.data, today) : 9),
      valueFormatter: (p) => label(p.data),
    },
    {
      colId: "delete",
      headerName: "",
      width: phone ? 36 : 44,
      minWidth: phone ? 36 : 44,
      maxWidth: phone ? 36 : 44,
      cellClass: "ledger-delete-cell",
      sortable: false,
      filter: false,
      resizable: false,
      cellRenderer: DeleteButton,
    },
  ];
}

// Tick boxes in their own column; the header box ticks only the rows the search leaves showing.
// A plain row click opens the detail sheet instead of ticking, and the pinned "Still owed" row
// can't be ticked (no box shows on it).
const ROW_SELECTION: RowSelectionOptions<LedgerRow> = {
  mode: "multiRow",
  checkboxes: true,
  headerCheckbox: true,
  selectAll: "filtered",
  enableClickSelection: false,
  hideDisabledCheckboxes: true,
  isRowSelectable: (node) => !node.rowPinned && node.data?.id !== "OUTSTANDING",
};

const SELECTION_COLUMN: SelectionColumnDef = {
  // The tick box (16px) plus the cell's side padding.
  width: 48,
  minWidth: 48,
  maxWidth: 48,
  resizable: false,
  sortable: false,
  suppressHeaderMenuButton: true,
};

// Phones use half the side padding, so the tick box column can be narrower.
const SELECTION_COLUMN_PHONE: SelectionColumnDef = { ...SELECTION_COLUMN, width: 34, minWidth: 34, maxWidth: 34 };

/** What the ledger screen can ask of the grid. */
export type LedgerGridHandle = {
  /** Unticks every row (the bulk bar's Clear). */
  clearSelection: () => void;
};

type LedgerView = {
  /** Rows the grid is showing after the quick filter, paid included. */
  visibleCount: number;
  /** Sum still owed across the visible rows (paid excluded), in sen. */
  outstandingTotal: number;
  /** Visible rows that are not paid. */
  outstandingCount: number;
};

function summariseRows(rows: LedgerRow[]): LedgerView {
  const owed = outstanding(rows);
  return { visibleCount: rows.length, outstandingTotal: owed.totalSen, outstandingCount: owed.count };
}

/** Same summary, over the rows the grid is showing after the quick filter. */
function summariseVisible(api: GridApi<LedgerRow>): LedgerView {
  const visible: LedgerRow[] = [];
  api.forEachNodeAfterFilterAndSort((node) => {
    if (node.data) visible.push(node.data);
  });
  return summariseRows(visible);
}

function modeForWidth(width: number): LayoutMode {
  if (width <= PHONE_MAX_WIDTH) return "phone";
  if (width <= TABLET_MAX_WIDTH) return "tablet";
  return "desktop";
}

function useLayoutMode(ref: React.RefObject<HTMLElement | null>): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>("phone");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMode(modeForWidth(el.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return mode;
}

export default function LedgerGrid({
  ref,
  rows,
  today,
  onDelete,
  onRowClick,
  onSelectionChange,
}: {
  ref?: Ref<LedgerGridHandle>;
  rows: Debt[];
  /** YYYY-MM-DD: decides which tabs are late (lib/tab-status). */
  today: string;
  onDelete: (debt: Debt) => void;
  onRowClick?: (debt: Debt) => void;
  onSelectionChange?: (selected: Debt[]) => void;
}) {
  const { t, lang } = useT();
  const [quickFilter, setQuickFilter] = useState("");
  const dark = useResolvedTheme() === "dark";
  const wrapperRef = useRef<HTMLDivElement>(null);
  const layout = useLayoutMode(wrapperRef);
  // Most urgent first (the status column's order), then oldest first.
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => statusRank(a, today) - statusRank(b, today) || a.date.localeCompare(b.date)),
    [rows, today],
  );
  const apiRef = useRef<GridApi<LedgerRow> | null>(null);
  useImperativeHandle(ref, () => ({ clearSelection: () => apiRef.current?.deselectAll() }), []);
  // AG Grid only reads `context` once, so it gets a stable function that always calls
  // the latest onDelete instead of the one from the first render.
  const onDeleteRef = useRef(onDelete);
  useEffect(() => {
    onDeleteRef.current = onDelete;
  });
  // The grid is remounted when the language changes (key={lang}), so t is current here.
  const gridContext = useMemo<DeleteContext>(() => ({ onDelete: (debt) => onDeleteRef.current(debt), t }), [t]);
  const columnDefs = useMemo(() => buildColumnDefs(layout, t, today), [layout, t, today]);
  // AG Grid's own words that actually show: the text filter popup and the empty overlay.
  const localeText = useMemo<Record<string, string>>(
    () => ({
      noRowsToShow: t("ledger.grid.noRows"),
      filterOoo: t("ledger.grid.filter"),
      contains: t("ledger.grid.contains"),
      notContains: t("ledger.grid.notContains"),
      equals: t("ledger.grid.equals"),
      notEqual: t("ledger.grid.notEqual"),
      startsWith: t("ledger.grid.startsWith"),
      endsWith: t("ledger.grid.endsWith"),
      blank: t("ledger.grid.blank"),
      notBlank: t("ledger.grid.notBlank"),
      andCondition: t("ledger.grid.and"),
      orCondition: t("ledger.grid.or"),
    }),
    [t],
  );

  // Starts from all rows, then follows the quick filter once the grid reports its model.
  const [view, setView] = useState<LedgerView>(() => summariseRows(rows));

  const onModelUpdated = (event: ModelUpdatedEvent<LedgerRow>) => {
    const next = summariseVisible(event.api);
    setView((prev) =>
      prev.visibleCount === next.visibleCount &&
      prev.outstandingTotal === next.outstandingTotal &&
      prev.outstandingCount === next.outstandingCount
        ? prev
        : next,
    );
  };

  // Pinned rows are not filtered by the grid. This row is built from the visible
  // rows, so it always reflects the current filter.
  const pinnedTotals = useMemo<Partial<LedgerRow>[]>(
    () => [
      {
        id: "OUTSTANDING",
        customerName: t("ledger.stillOwed"),
        item: t("ledger.outstandingTabs", { count: view.outstandingCount }),
        amountSen: view.outstandingTotal,
      },
    ],
    [view, t],
  );

  // Enter on a focused row opens its detail sheet, like a click (not on the tick box or delete cells).
  const onCellKeyDown = (event: CellKeyDownEvent<LedgerRow> | FullWidthCellKeyDownEvent<LedgerRow>) => {
    const key = (event.event as KeyboardEvent | null | undefined)?.key;
    if (key !== "Enter" || !("column" in event) || !event.data || event.node.rowPinned) return;
    const colId = event.column.getColId();
    if (colId === "delete" || colId.startsWith("ag-Grid-")) return;
    onRowClick?.(event.data);
  };

  // Header + visible rows + the pinned total row, plus the 1px borders.
  const gridHeight = HEADER_HEIGHT + (view.visibleCount + 1) * ROW_HEIGHT + 2;

  return (
    <div className="ledger" ref={wrapperRef}>
      <div className="ledger-toolbar">
        <label className="visually-hidden" htmlFor="ledger-search">
          {t("ledger.search")}
        </label>
        <input
          id="ledger-search"
          type="search"
          placeholder={t("ledger.searchPlaceholder")}
          value={quickFilter}
          onChange={(event) => setQuickFilter(event.target.value)}
        />
      </div>
      <div className="ledger-grid" data-testid="ledger-grid" style={{ height: gridHeight }}>
        <AgGridReact<LedgerRow>
          key={lang}
          localeText={localeText}
          rowData={sortedRows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          pinnedBottomRowData={pinnedTotals}
          quickFilterText={quickFilter}
          onModelUpdated={onModelUpdated}
          theme={layout === "phone" ? (dark ? ledgerPhoneDarkTheme : ledgerPhoneTheme) : dark ? ledgerDarkTheme : ledgerTheme}
          rowHeight={ROW_HEIGHT}
          headerHeight={HEADER_HEIGHT}
          getRowId={(params) => params.data.id}
          context={gridContext}
          // A cut-off name or item shows in full on hover; full ones don't get a tooltip.
          tooltipShowMode="whenTruncated"
          rowSelection={ROW_SELECTION}
          selectionColumnDef={layout === "phone" ? SELECTION_COLUMN_PHONE : SELECTION_COLUMN}
          onGridReady={(event) => {
            apiRef.current = event.api;
            // A remount (language change) starts with nothing ticked, so the bulk bar follows.
            onSelectionChange?.([]);
          }}
          onCellKeyDown={onCellKeyDown}
          onSelectionChanged={(event) => {
            const selected = event.api.getSelectedRows();
            onSelectionChange?.(selected);
          }}
          onRowClicked={(event) => {
            const target = event.event?.target as HTMLElement | null;
            if (target?.closest(".row-delete, .ag-selection-checkbox, .ag-checkbox-input")) return;
            if (event.data && !event.node.isRowPinned()) {
              onRowClick?.(event.data);
            }
          }}
        />
      </div>
    </div>
  );
}
