"use client";

// "Who owes you" on a laptop: an AG Grid table, sortable, with the next step on each row
// (Remind, Invoice or View) and a WhatsApp share button. Same theme as the ledger's grid.

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import { tabPath } from "@/lib/customer-tab";
import { formatSen } from "@/lib/debts";
import type { BoardRow } from "@/lib/home";
import Avatar from "../components/Avatar";
import { ShareButton } from "../components/ShareButton";

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

type ShareContext = { onShare: (slug: string, button: HTMLButtonElement) => void };

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

/** Its own narrow column, so the chat buttons line up whatever the next-step button says. */
function ShareCell({ data, context }: CustomCellRendererProps<Row, unknown, ShareContext>) {
  if (!data || isTotal(data)) return null;
  return (
    <span className="hg-wa">
      <ShareButton customerName={data.customerName} className="wa-btn-sm" onOpen={(button) => context.onShare(data.slug, button)} />
    </span>
  );
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

// Minimum widths add up to 504px, so the grid fits inside its card (557px wide at a 1280px
// window, about 512px inside the padding) with no sideways scroll. Anything wider goes to
// the flexible columns, mostly Customer. The days-late header says just "Late" (tooltip has
// the rest): "Days late" needs about 95px and there's no room for it at 1280.
const COLUMNS: ColDef<Row>[] = [
  { headerName: "Customer", field: "customerName", flex: 1.6, minWidth: 104, cellRenderer: CustomerCell },
  {
    headerName: "Owed",
    field: "owedSen",
    flex: 0.8,
    minWidth: 88,
    type: "rightAligned",
    sort: "desc",
    valueFormatter: (p) => (p.value == null ? "" : formatSen(Number(p.value))),
    cellClass: "hg-num",
  },
  {
    headerName: "Status",
    field: "status",
    flex: 1,
    minWidth: 120,
    cellRenderer: StatusCell,
    comparator: (a, b) => (a ? STATUS_ORDER[a as BoardRow["status"]] : 9) - (b ? STATUS_ORDER[b as BoardRow["status"]] : 9),
  },
  { headerName: "Late", field: "daysLate", flex: 0.5, minWidth: 56, headerTooltip: "Days past the bill's due date", type: "rightAligned" },
  // Named for screen readers; the labels are hidden on screen.
  { headerName: "Next step", headerClass: "hg-hidden-header", colId: "next", width: 92, minWidth: 92, maxWidth: 92, sortable: false, cellClass: "hg-next-cell", cellRenderer: ActionCell },
  {
    headerName: "WhatsApp",
    headerClass: "hg-hidden-header",
    colId: "share",
    width: 44,
    minWidth: 44,
    maxWidth: 44,
    sortable: false,
    cellClass: "hg-wa-cell",
    cellRenderer: ShareCell,
  },
];

export default function HomeBoardGrid({ rows, onShare }: { rows: BoardRow[]; onShare: ShareContext["onShare"] }) {
  // AG Grid reads `context` once, so it gets a stable function that calls the latest onShare.
  const onShareRef = useRef(onShare);
  useEffect(() => {
    onShareRef.current = onShare;
  });
  const context = useMemo<ShareContext>(() => ({ onShare: (slug, button) => onShareRef.current(slug, button) }), []);
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
        context={context}
        getRowId={(p) => (isTotal(p.data) ? "total" : p.data.slug)}
        suppressCellFocus
      />
    </div>
  );
}
