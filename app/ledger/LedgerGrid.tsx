"use client";

import { useMemo, useState } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import { sortLedgerRows, type LedgerRow, type LedgerStatus } from "./sample-data";

ModuleRegistry.registerModules([AllCommunityModule]);

function StatusBadge(props: CustomCellRendererProps<LedgerRow>) {
  const status = props.value as LedgerStatus | undefined;
  if (!status) return null;
  return <span className={`badge badge-${status}`}>{status}</span>;
}

const COLUMN_DEFS: ColDef<LedgerRow>[] = [
  { field: "customerName", headerName: "Name", flex: 1.2, minWidth: 160 },
  { field: "item", headerName: "Item", flex: 2, minWidth: 220 },
  {
    field: "amountRm",
    headerName: "Amount (RM)",
    flex: 1,
    minWidth: 130,
    type: "rightAligned",
    valueFormatter: (p) => (p.value == null ? "" : Number(p.value).toFixed(2)),
  },
  { field: "date", headerName: "Date", flex: 1, minWidth: 120 },
  { field: "status", headerName: "Status", flex: 1, minWidth: 120, cellRenderer: StatusBadge },
];

// TODO(Teammate 3): replace SAMPLE_LEDGER_ROWS with live rows from the server,
// and add loading and error states around the grid.
export default function LedgerGrid({ rows }: { rows: LedgerRow[] }) {
  const [quickFilter, setQuickFilter] = useState("");

  const sortedRows = useMemo(() => sortLedgerRows(rows), [rows]);

  // Pinned, so the totals stay visible while the quick filter narrows the rows.
  const totals = useMemo<Partial<LedgerRow>[]>(() => {
    const totalRm = rows.reduce((sum, row) => sum + row.amountRm, 0);
    return [
      {
        id: "TOTAL",
        customerName: "Total",
        item: `${rows.length} tabs`,
        amountRm: Math.round(totalRm * 100) / 100,
      },
    ];
  }, [rows]);

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
      <div className="ledger-grid" data-testid="ledger-grid">
        <AgGridReact<LedgerRow>
          rowData={sortedRows}
          columnDefs={COLUMN_DEFS}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          pinnedBottomRowData={totals}
          quickFilterText={quickFilter}
          theme={themeQuartz}
          domLayout="autoHeight"
          getRowId={(params) => params.data.id}
        />
      </div>
    </div>
  );
}
