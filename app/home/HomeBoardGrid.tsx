"use client";

// "Who owes you" on a laptop: an AG Grid table, sortable, with the next step on each row
// (Remind, Invoice or View). Same theme as the ledger's grid.

import Link from "next/link";
import { useMemo } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import { tabPath } from "@/lib/customer-tab";
import { formatSen } from "@/lib/debts";
import type { BoardRow } from "@/lib/home";
import Avatar from "../components/Avatar";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  foregroundColor: "#141414",
  accentColor: "#141414",
  backgroundColor: "#ffffff",
  headerBackgroundColor: "#fcfbf9",
  headerFontWeight: 800,
  borderColor: "#ebe7df",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  rowHoverColor: "#f7f5f1",
  rowHeight: 52,
  cellHorizontalPaddingScale: 0.8,
});

const STATUS_TEXT: Record<BoardRow["status"], string> = { overdue: "Overdue", sent: "Invoice sent", unpaid: "Not sent" };
const STATUS_ORDER: Record<BoardRow["status"], number> = { overdue: 0, sent: 1, unpaid: 2 };
const BAR: Record<BoardRow["status"], string> = { overdue: "#c23b22", sent: "#2f55c4", unpaid: "#8c6512" };

type Row = BoardRow | (Partial<BoardRow> & { total: true; count: number });

function isTotal(row: Row | undefined): row is Partial<BoardRow> & { total: true; count: number } {
  return !!row && "total" in row;
}

function CustomerCell({ data }: CustomCellRendererProps<Row>) {
  if (!data) return null;
  if (isTotal(data)) return <strong>{data.count} {data.count === 1 ? "customer" : "customers"}</strong>;
  return (
    <Link href={tabPath(data.slug)} className="hg-who">
      <Avatar name={data.customerName} />
      <span className="hg-who-main">
        <span className="hg-who-name">{data.customerName}</span>
        {/* Bar: their balance against the biggest one, like the Insights scoreboard. */}
        <span className="hg-bar" aria-hidden="true">
          <b style={{ width: `${data.sharePct}%`, background: BAR[data.status] }} />
        </span>
      </span>
    </Link>
  );
}

function StatusCell({ data }: CustomCellRendererProps<Row>) {
  if (!data || isTotal(data)) return null;
  return <span className={`badge badge-${data.status}`}>{STATUS_TEXT[data.status]}</span>;
}

/** The next step for this customer: invoice first if nothing's been sent, then remind once late. */
function ActionCell({ data }: CustomCellRendererProps<Row>) {
  if (!data || isTotal(data)) return null;
  if (!data.invoiced) {
    return (
      <Link href="/collect" className="hg-act" aria-label={`Send ${data.customerName} a PayPal invoice`}>
        Invoice
      </Link>
    );
  }
  if (data.status === "overdue") {
    return (
      <Link href="/reminders" className="hg-act hg-act-dark" aria-label={`Remind ${data.customerName}`}>
        Remind
      </Link>
    );
  }
  return (
    <Link href={tabPath(data.slug)} className="hg-act" aria-label={`View ${data.customerName}'s tab`}>
      View
    </Link>
  );
}

const COLUMNS: ColDef<Row>[] = [
  { headerName: "Customer", field: "customerName", flex: 1.8, minWidth: 170, cellRenderer: CustomerCell },
  {
    headerName: "Owed",
    field: "owedSen",
    flex: 0.9,
    minWidth: 92,
    type: "rightAligned",
    sort: "desc",
    valueFormatter: (p) => (p.value == null ? "" : formatSen(Number(p.value))),
    cellClass: "hg-num",
  },
  {
    headerName: "Status",
    field: "status",
    flex: 1,
    minWidth: 130,
    cellRenderer: StatusCell,
    comparator: (a, b) => (a ? STATUS_ORDER[a as BoardRow["status"]] : 9) - (b ? STATUS_ORDER[b as BoardRow["status"]] : 9),
  },
  { headerName: "Days late", field: "daysLate", flex: 0.6, minWidth: 96, headerTooltip: "Days past the bill's due date", type: "rightAligned" },
  // Named for screen readers; the label is hidden on screen.
  { headerName: "Next step", headerClass: "hg-hidden-header", colId: "next", width: 116, minWidth: 116, maxWidth: 116, sortable: false, cellRenderer: ActionCell },
];

export default function HomeBoardGrid({ rows }: { rows: BoardRow[] }) {
  const total = useMemo<Row[]>(
    () => [{ total: true, count: rows.length, owedSen: rows.reduce((sum, r) => sum + r.owedSen, 0) }],
    [rows],
  );
  return (
    <div className="card home-grid" data-testid="home-grid">
      <AgGridReact<Row>
        theme={theme}
        rowData={rows}
        columnDefs={COLUMNS}
        pinnedBottomRowData={total}
        defaultColDef={{ sortable: true, resizable: false, suppressMovable: true }}
        domLayout="autoHeight"
        getRowId={(p) => (isTotal(p.data) ? "total" : p.data.slug)}
        suppressCellFocus
      />
    </div>
  );
}
