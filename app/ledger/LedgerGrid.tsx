"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type ModelUpdatedEvent,
} from "ag-grid-community";
import { formatSen, outstanding, sortDebts, STATUS_ORDER, type Debt, type DebtStatus } from "@/lib/debts";
import type { T } from "@/lib/i18n";
import StatusBadge from "../components/StatusBadge";
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

// Narrow grids hide Item and Date; medium ones hide Date; wide ones show every column.
// Measured on the grid itself, since the app is a phone-width column even on a laptop.
// The column caps the grid at about 448px, so today it is always "phone"; the wider
// modes stay for if the ledger ever gets a wider layout.
const PHONE_MAX_WIDTH = 460;
const TABLET_MAX_WIDTH = 700;

type LayoutMode = "phone" | "tablet" | "desktop";

// Fixed sizes so the grid can be given an exact height that follows the visible rows.
const ROW_HEIGHT = 42;
const HEADER_HEIGHT = 44;

type LedgerRow = Debt;

function StatusCell(props: CustomCellRendererProps<LedgerRow>) {
  const status = props.value as DebtStatus | undefined;
  if (!status) return null;
  return (
    <span className="status-cell">
      <StatusBadge status={status} />
    </span>
  );
}

type DeleteContext = { onDelete: (debt: Debt) => void; t: T };

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

// Minimum widths are set so the visible columns fit: phone columns total about
// 320px with the delete button (fits a 360px phone), tablet about 550px (fits a 700px screen).
function buildColumnDefs(mode: LayoutMode, t: T): ColDef<LedgerRow>[] {
  const phone = mode === "phone";
  const label = (status: DebtStatus) => t(`status.${status}`);
  return [
    {
      colId: "selection",
      headerName: "",
      width: 38,
      minWidth: 38,
      maxWidth: 38,
      checkboxSelection: (p) => !p.node.isRowPinned(),
      headerCheckboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
      sortable: false,
      filter: false,
      resizable: false,
    },
    { field: "customerName", headerName: t("ledger.colName"), flex: 1.2, minWidth: phone ? 90 : 120 },
    { field: "item", headerName: t("ledger.colItem"), flex: 2, minWidth: 150, hide: phone },
    {
      field: "amountSen",
      headerName: mode === "desktop" ? t("ledger.colAmount") : "RM",
      flex: 1,
      minWidth: phone ? 75 : 130,
      type: "rightAligned",
      // Right-aligned headers put the filter button before the label, where it looks like an empty column.
      suppressHeaderFilterButton: true,
      valueFormatter: (p) => (p.value == null ? "" : formatSen(Number(p.value))),
    },
    {
      field: "date",
      headerName: t("ledger.colDate"),
      flex: 1,
      minWidth: 110,
      hide: mode !== "desktop",
      getQuickFilterText: (p) => p.data?.date ?? "",
    },
    {
      field: "status",
      headerName: t("ledger.colStatus"),
      flex: 1,
      minWidth: phone ? 100 : 120,
      cellRenderer: StatusCell,
      // Search and filter by the words on the badge ("Invoice sent"), not the stored value ("sent").
      getQuickFilterText: (p) => (p.value ? label(p.value as DebtStatus) : ""),
      filterValueGetter: (p) => (p.data?.status ? label(p.data.status) : ""),
      // Header sort goes by urgency (overdue → invoice sent → not sent → paid), not A–Z.
      comparator: (a, b) => (a ? STATUS_ORDER[a as DebtStatus] : 9) - (b ? STATUS_ORDER[b as DebtStatus] : 9),
      valueFormatter: (p) => (p.value ? label(p.value as DebtStatus) : ""),
    },
    {
      colId: "delete",
      headerName: "",
      width: 38,
      minWidth: 38,
      maxWidth: 38,
      sortable: false,
      filter: false,
      resizable: false,
      cellRenderer: DeleteButton,
    },
  ];
}

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
  rows,
  onDelete,
  onRowClick,
  onSelectionChange,
}: {
  rows: Debt[];
  onDelete: (debt: Debt) => void;
  onRowClick?: (debt: Debt) => void;
  onSelectionChange?: (selected: Debt[]) => void;
}) {
  const { t, lang } = useT();
  const [quickFilter, setQuickFilter] = useState("");
  const dark = useResolvedTheme() === "dark";
  const wrapperRef = useRef<HTMLDivElement>(null);
  const layout = useLayoutMode(wrapperRef);
  const sortedRows = useMemo(() => sortDebts(rows), [rows]);
  // AG Grid only reads `context` once, so it gets a stable function that always calls
  // the latest onDelete instead of the one from the first render.
  const onDeleteRef = useRef(onDelete);
  useEffect(() => {
    onDeleteRef.current = onDelete;
  });
  // The grid is remounted when the language changes (key={lang}), so t is current here.
  const gridContext = useMemo<DeleteContext>(() => ({ onDelete: (debt) => onDeleteRef.current(debt), t }), [t]);
  const columnDefs = useMemo(() => buildColumnDefs(layout, t), [layout, t]);
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
          theme={dark ? ledgerDarkTheme : ledgerTheme}
          rowHeight={ROW_HEIGHT}
          headerHeight={HEADER_HEIGHT}
          getRowId={(params) => params.data.id}
          context={gridContext}
          rowSelection="multiple"
          onSelectionChanged={(event) => {
            const selected = event.api.getSelectedRows();
            onSelectionChange?.(selected);
          }}
          onRowClicked={(event) => {
            const target = event.event?.target as HTMLElement | null;
            if (target?.closest(".row-delete") || target?.closest(".ag-selection-checkbox") || target?.closest(".ag-checkbox-input")) {
              return;
            }
            if (event.data && !event.node.isRowPinned() && event.data.id !== "OUTSTANDING") {
              onRowClick?.(event.data);
            }
          }}
        />
      </div>
    </div>
  );
}
