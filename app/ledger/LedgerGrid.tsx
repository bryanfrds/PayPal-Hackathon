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

// Narrow grids fold Item and Date under the name and the status under the amount; medium ones
// hide Date; wide ones show every column. Measured on the grid itself: on a phone it's about
// 340px wide ("phone"); on a laptop it's about 1020px at a 1280px window ("desktop"). The
// breakpoints sit where the next layout's minimum widths (below) stop fitting.
export const PHONE_MAX_WIDTH = 760;
export const TABLET_MAX_WIDTH = 950;
// The status column on wider grids, in px (see buildColumnDefs).
const STATUS_WIDTH = 272;

export type LayoutMode = "phone" | "tablet" | "desktop";

// Fixed sizes so the grid can be given an exact height that follows the visible rows.
const ROW_HEIGHT = 42;
// Phone rows hold two lines: name over item and date, amount over the status badge.
const PHONE_ROW_HEIGHT = 58;
const HEADER_HEIGHT = 44;

type LedgerRow = Debt;

type DeleteContext = {
  onDelete: (debt: Debt) => void;
  t: T;
  formatDay: (day: string, opts?: { year?: boolean }) => string;
};

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

/** Phone name cell: the name, with the date and item on a second line (date first, so it never gets cut) so same-name rows differ. */
function NameCell(props: CustomCellRendererProps<LedgerRow, unknown, DeleteContext>) {
  const debt = props.data;
  if (!debt) return null;
  const pinned = !!props.node.rowPinned;
  const sub = pinned
    ? debt.item
    : [debt.date ? props.context.formatDay(debt.date, { year: false }) : "", debt.item].filter(Boolean).join(" · ");
  return (
    <span className={`ledger-name-cell${pinned ? " ledger-name-cell-total" : ""}`}>
      <span className="ledger-name-main">{debt.customerName}</span>
      {sub && <span className="ledger-name-sub">{sub}</span>}
    </span>
  );
}

/** Pinned "Still owed" row on wider grids: its label and count share the name and item columns. */
function TotalLabelCell(props: CustomCellRendererProps<LedgerRow, unknown, DeleteContext>) {
  const debt = props.data;
  if (!debt) return null;
  if (!props.node.rowPinned) return <>{debt.customerName}</>;
  return (
    <span className="ledger-total-label">
      <b>{debt.customerName}</b> <span>{debt.item}</span>
    </span>
  );
}

/** Phone amount cell: the amount with its (single, compact) status badge underneath. */
function AmountStatusCell(props: CustomCellRendererProps<LedgerRow> & StatusParams) {
  const debt = props.data;
  if (!debt) return null;
  return (
    <span className="ledger-amount-cell">
      <span className="ledger-amount-main">{props.valueFormatted ?? ""}</span>
      {debt.status && !props.node.rowPinned && <TabStatus debt={debt} today={props.today} compact />}
    </span>
  );
}

/**
 * The row's tick box, named after the customer and amount for screen readers (AG Grid's own box
 * says "Press Space to toggle row" on every row), with a hit area of at least 24px.
 */
export function SelectCell(props: CustomCellRendererProps<LedgerRow, unknown, DeleteContext>) {
  const { node, context } = props;
  const [checked, setChecked] = useState(() => node.isSelected() ?? false);
  useEffect(() => {
    const sync = () => setChecked(node.isSelected() ?? false);
    node.addEventListener("rowSelected", sync);
    return () => node.removeEventListener("rowSelected", sync);
  }, [node]);
  const debt = props.data;
  if (!debt || node.rowPinned || !node.selectable) return null;
  return (
    <label className="ledger-select">
      <input
        type="checkbox"
        checked={checked}
        aria-label={context.t("ledger.selectRow", { name: debt.customerName, amount: formatSen(debt.amountSen) })}
        onChange={(event) => node.setSelected(event.target.checked, false, "checkboxSelected")}
        onClick={(event) => event.stopPropagation()}
      />
    </label>
  );
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

// Minimum widths are set so every header and status badge reads in full, in English and in
// Bahasa Melayu (a late invoiced tab shows "Invois dihantar" and "40 hari lewat" side by side):
// laptop columns total about 950px, which is TABLET_MAX_WIDTH; tablet ones about 745px (under
// PHONE_MAX_WIDTH, so a portrait tablet gets the two-line phone rows); phone
// ones (two-line rows) about 300px, under the ~340px grid on a 390px phone.
/** "20 Oct": how a date reads in the owner's language (useT's formatDay). */
type FormatDay = (day: string, opts?: { year?: boolean }) => string;

/** The grid's columns for a layout; exported for tests. */
export function buildColumnDefs(mode: LayoutMode, t: T, today: string, formatDay?: FormatDay): ColDef<LedgerRow>[] {
  const phone = mode === "phone";
  const desktop = mode === "desktop";
  // The pinned "Still owed" row has no date or status: it gets no label.
  const label = (debt: Debt | undefined) => (debt?.status && debt.date ? tabStatusText(debt, today, t) : "");
  return [
    {
      field: "customerName",
      headerName: t("ledger.colName"),
      flex: 1.3,
      minWidth: phone ? 100 : 150,
      tooltipField: phone ? undefined : "customerName",
      cellRenderer: phone ? NameCell : TotalLabelCell,
      cellClass: phone ? "ledger-two-line" : undefined,
      // Wider grids: the "Still owed" label and its count run across the name and item columns.
      colSpan: (p) => (!phone && p.node?.rowPinned ? 2 : 1),
    },
    { field: "item", headerName: t("ledger.colItem"), flex: 2, minWidth: desktop ? 180 : 120, hide: phone, tooltipField: "item" },
    {
      field: "amountSen",
      headerName: desktop ? t("ledger.colAmount") : "RM",
      // Only the phone column stretches; elsewhere spare room goes to the name and item.
      flex: phone ? 1 : undefined,
      width: phone ? undefined : desktop ? 130 : 110,
      minWidth: phone ? 124 : desktop ? 130 : 110,
      type: "rightAligned",
      // Right-aligned headers put the filter button before the label, where it looks like an empty column.
      suppressHeaderFilterButton: true,
      valueFormatter: (p) => (p.value == null ? "" : formatSen(Number(p.value))),
      cellRenderer: phone ? AmountStatusCell : undefined,
      cellRendererParams: phone ? ({ today, compact: true } satisfies StatusParams) : undefined,
      cellClass: phone ? "ledger-two-line" : undefined,
    },
    {
      field: "date",
      headerName: t("ledger.colDate"),
      // Fixed: a YYYY-MM-DD date and the filter button need about 120px, and never more.
      width: 124,
      minWidth: 124,
      hide: !desktop,
      // Search finds the stored date and the words phones show under the name ("20 Oct"),
      // so typing "Oct" works on every layout.
      getQuickFilterText: (p) => {
        const date = p.data?.date;
        if (!date) return "";
        return formatDay ? `${date} ${formatDay(date, { year: false })}` : date;
      },
    },
    {
      field: "status",
      headerName: t("ledger.colStatus"),
      // Fixed: fits a late invoiced tab's two badges ("Invois dihantar" + "40 hari lewat") and
      // the filter button. Phones fold the status under the amount instead.
      width: STATUS_WIDTH,
      minWidth: STATUS_WIDTH,
      hide: phone,
      cellRenderer: StatusCell,
      cellRendererParams: { today, compact: phone } satisfies StatusParams,
      // Search and filter by the words on the badges ("Invoice sent · Overdue"), not the stored value.
      getQuickFilterText: (p) => label(p.data),
      filterValueGetter: (p) => label(p.data),
      // Header sort goes by urgency (overdue → invoice sent → not sent → paid), not A–Z.
      comparator: (_a, _b, nodeA, nodeB) =>
        (nodeA.data?.status ? statusRank(nodeA.data, today) : 9) - (nodeB.data?.status ? statusRank(nodeB.data, today) : 9),
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
// The row boxes are our own SelectCell (named per row); AG Grid draws only the header box.
export const ROW_SELECTION: RowSelectionOptions<LedgerRow> = {
  mode: "multiRow",
  checkboxes: false,
  headerCheckbox: true,
  selectAll: "filtered",
  enableClickSelection: false,
  hideDisabledCheckboxes: true,
  isRowSelectable: (node) => !node.rowPinned && node.data?.id !== "OUTSTANDING",
};

export const SELECTION_COLUMN: SelectionColumnDef = {
  // The tick box's 24px hit area plus the cell's side padding.
  cellRenderer: SelectCell,
  cellClass: "ledger-select-cell",
  width: 48,
  minWidth: 48,
  maxWidth: 48,
  resizable: false,
  sortable: false,
  suppressHeaderMenuButton: true,
};

// Phones use half the side padding, so the tick box column can be narrower.
export const SELECTION_COLUMN_PHONE: SelectionColumnDef = { ...SELECTION_COLUMN, width: 40, minWidth: 40, maxWidth: 40 };

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
  const { t, lang, formatDay } = useT();
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
  const gridContext = useMemo<DeleteContext>(
    () => ({ onDelete: (debt) => onDeleteRef.current(debt), t, formatDay }),
    [t, formatDay],
  );
  const columnDefs = useMemo(() => buildColumnDefs(layout, t, today, formatDay), [layout, t, today, formatDay]);
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
      // The header tick box, read out by screen readers.
      ariaHeaderSelection: t("ledger.selectAll"),
      ariaRowSelectAll: t("ledger.selectAll"),
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
  const rowHeight = layout === "phone" ? PHONE_ROW_HEIGHT : ROW_HEIGHT;
  const gridHeight = HEADER_HEIGHT + (view.visibleCount + 1) * rowHeight + 2;

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
          // Phones fold Item, Date and Status into other cells: search still finds them.
          includeHiddenColumnsInQuickFilter
          onModelUpdated={onModelUpdated}
          theme={layout === "phone" ? (dark ? ledgerPhoneDarkTheme : ledgerPhoneTheme) : dark ? ledgerDarkTheme : ledgerTheme}
          rowHeight={rowHeight}
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
            if (target?.closest(".row-delete, .ledger-select, .ag-selection-checkbox, .ag-checkbox-input")) return;
            if (event.data && !event.node.isRowPinned()) {
              onRowClick?.(event.data);
            }
          }}
        />
      </div>
    </div>
  );
}
