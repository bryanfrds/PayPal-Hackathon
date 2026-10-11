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
import { formatSen, outstanding, sortDebts, type Debt, type DebtStatus } from "@/lib/debts";

ModuleRegistry.registerModules([AllCommunityModule]);

// Phones hide Item and Date; tablets hide Date. Desktop shows every column.
const PHONE_QUERY = "(max-width: 600px)";
const TABLET_QUERY = "(max-width: 820px)";

type LayoutMode = "phone" | "tablet" | "desktop";

// Fixed sizes so the grid can be given an exact height that follows the visible rows.
const ROW_HEIGHT = 42;
const HEADER_HEIGHT = 44;

type LedgerRow = Debt;

function StatusBadge(props: CustomCellRendererProps<LedgerRow>) {
  const status = props.value as DebtStatus | undefined;
  if (!status) return null;
  return (
    <span className="status-cell">
      <span className={`badge badge-${status}`}>{status}</span>
    </span>
  );
}

type DeleteContext = { onDelete: (debt: Debt) => void };

function DeleteButton(props: CustomCellRendererProps<LedgerRow, unknown, DeleteContext>) {
  const debt = props.data;
  // The pinned "Still owed" row has no id to delete.
  if (!debt || props.node.rowPinned) return null;
  return (
    <button
      type="button"
      className="row-delete"
      aria-label={`Delete ${debt.customerName}'s tab of RM ${formatSen(debt.amountSen)}`}
      title="Delete"
      onClick={() => props.context.onDelete(debt)}
    >
      ×
    </button>
  );
}

// Minimum widths are set so the visible columns fit: phone columns total about
// 320px with the delete button (fits a 360px phone), tablet about 550px (fits a 700px screen).
function buildColumnDefs(mode: LayoutMode): ColDef<LedgerRow>[] {
  const phone = mode === "phone";
  return [
    { field: "customerName", headerName: "Name", flex: 1.2, minWidth: phone ? 100 : 120 },
    { field: "item", headerName: "Item", flex: 2, minWidth: 150, hide: phone },
    {
      field: "amountSen",
      headerName: mode === "desktop" ? "Amount (RM)" : "RM",
      flex: 1,
      minWidth: phone ? 80 : 130,
      type: "rightAligned",
      valueFormatter: (p) => (p.value == null ? "" : formatSen(Number(p.value))),
    },
    { field: "date", headerName: "Date", flex: 1, minWidth: 110, hide: mode !== "desktop" },
    { field: "status", headerName: "Status", flex: 1, minWidth: phone ? 96 : 110, cellRenderer: StatusBadge },
    {
      colId: "delete",
      headerName: "",
      width: 44,
      minWidth: 44,
      maxWidth: 44,
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

function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>("desktop");
  useEffect(() => {
    const phone = window.matchMedia(PHONE_QUERY);
    const tablet = window.matchMedia(TABLET_QUERY);
    const update = () => setMode(phone.matches ? "phone" : tablet.matches ? "tablet" : "desktop");
    update();
    phone.addEventListener("change", update);
    tablet.addEventListener("change", update);
    return () => {
      phone.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
  }, []);
  return mode;
}

export default function LedgerGrid({ rows, onDelete }: { rows: Debt[]; onDelete: (debt: Debt) => void }) {
  const [quickFilter, setQuickFilter] = useState("");
  const layout = useLayoutMode();
  const sortedRows = useMemo(() => sortDebts(rows), [rows]);
  // AG Grid only reads `context` once, so it gets a stable function that always calls
  // the latest onDelete instead of the one from the first render.
  const onDeleteRef = useRef(onDelete);
  useEffect(() => {
    onDeleteRef.current = onDelete;
  });
  const gridContext = useMemo<DeleteContext>(() => ({ onDelete: (debt) => onDeleteRef.current(debt) }), []);
  const columnDefs = useMemo(() => buildColumnDefs(layout), [layout]);

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
        customerName: "Still owed",
        item: `${view.outstandingCount} ${view.outstandingCount === 1 ? "tab" : "tabs"}, paid excluded`,
        amountSen: view.outstandingTotal,
      },
    ],
    [view],
  );

  // Header + visible rows + the pinned total row, plus the 1px borders.
  const gridHeight = HEADER_HEIGHT + (view.visibleCount + 1) * ROW_HEIGHT + 2;

  return (
    <div className="ledger">
      <div className="ledger-toolbar">
        <label className="visually-hidden" htmlFor="ledger-search">
          Search the ledger
        </label>
        <input
          id="ledger-search"
          type="search"
          placeholder="Search name, item, status…"
          value={quickFilter}
          onChange={(event) => setQuickFilter(event.target.value)}
        />
      </div>
      <div className="ledger-grid" data-testid="ledger-grid" style={{ height: gridHeight }}>
        <AgGridReact<LedgerRow>
          rowData={sortedRows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          pinnedBottomRowData={pinnedTotals}
          quickFilterText={quickFilter}
          onModelUpdated={onModelUpdated}
          theme={themeQuartz}
          rowHeight={ROW_HEIGHT}
          headerHeight={HEADER_HEIGHT}
          getRowId={(params) => params.data.id}
          context={gridContext}
        />
      </div>
    </div>
  );
}
