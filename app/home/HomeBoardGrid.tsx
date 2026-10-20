"use client";

// "Who owes you" on a laptop: an AG Grid table, sortable, with the next step on each row
// (Remind, Invoice or View) and a WhatsApp share button. Same theme as the ledger's grid.

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import type { T } from "@/lib/i18n";
import { tabPath } from "@/lib/customer-tab";
import { formatSen } from "@/lib/debts";
import { lateLabel, type BoardRow } from "@/lib/home";
import Avatar from "../components/Avatar";
import { DARK_GRID_COLOURS } from "../components/grid-theme";
import { ShareButton } from "../components/ShareButton";
import { useResolvedTheme } from "../usePrefs";
import { useT } from "../useT";

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

const darkTheme = theme.withParams({ ...DARK_GRID_COLOURS, headerBackgroundColor: "#232321" });

const STATUS_ORDER: Record<BoardRow["status"], number> = { overdue: 0, sent: 1, unpaid: 2 };
const BAR: Record<BoardRow["status"], string> = { overdue: "var(--overdue)", sent: "var(--sent)", unpaid: "var(--unpaid)" };

type ShareContext = { onShare: (slug: string, button: HTMLButtonElement) => void };

type Row = BoardRow | (Partial<BoardRow> & { total: true; count: number });

function isTotal(row: Row | undefined): row is Partial<BoardRow> & { total: true; count: number } {
  return !!row && "total" in row;
}

function CustomerCell({ data }: CustomCellRendererProps<Row>) {
  const { t } = useT();
  if (!data) return null;
  if (isTotal(data)) return <strong>{t("home.grid.customers", { count: data.count })}</strong>;
  return (
    <Link href={tabPath(data.slug)} className="hg-who">
      <Avatar name={data.customerName} />
      <span className="hg-who-main">
        <span className="hg-who-name" title={data.customerName}>
          {data.customerName}
        </span>
        {/* Bar: their balance against the biggest one, like the Insights scoreboard. */}
        <span className="hg-bar" aria-hidden="true">
          <b style={{ width: `${data.sharePct}%`, background: BAR[data.status] }} />
        </span>
      </span>
    </Link>
  );
}

function StatusCell({ data }: CustomCellRendererProps<Row>) {
  const { t } = useT();
  if (!data || isTotal(data)) return null;
  // Days late folded into the badge, like the phone list: "5 days late", "Invoice sent", "Not sent".
  return <span className={`badge badge-${data.status}`}>{lateLabel(data, t)}</span>;
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

/**
 * The next step for this customer (owedBoard decides): remind once an invoiced tab is late,
 * otherwise invoice any tab that has no invoice yet, otherwise view.
 */
function ActionCell({ data }: CustomCellRendererProps<Row>) {
  const { t } = useT();
  if (!data || isTotal(data)) return null;
  if (data.next === "invoice") {
    return (
      <Link href="/collect" className="hg-act" aria-label={t("home.grid.invoiceAria", { name: data.customerName })}>
        {t("home.grid.invoice")}
      </Link>
    );
  }
  if (data.next === "remind") {
    return (
      <Link href="/reminders" className="hg-act hg-act-dark" aria-label={t("home.grid.remindAria", { name: data.customerName })}>
        {t("home.remind")}
      </Link>
    );
  }
  return (
    <Link href={tabPath(data.slug)} className="hg-act" aria-label={t("home.grid.viewAria", { name: data.customerName })}>
      {t("home.grid.view")}
    </Link>
  );
}

// At a 1280px window the card is 557px, about 512px inside its padding. Minimum widths add up
// to 510px (Customer 168 + Owed 88 + Status 118 + Next step 92 + chat 44), so there's no
// sideways scroll, and Customer keeps about 110px for the name after its padding and avatar.
// Anything wider goes to the flexible columns, mostly Customer.
/** The columns, with headers in the owner's language. */
function columnsFor(t: T): ColDef<Row>[] {
  return [
  { headerName: t("home.grid.customer"), field: "customerName", flex: 1.8, minWidth: 168, cellClass: "hg-who-cell", cellRenderer: CustomerCell },
  {
    headerName: t("home.grid.owed"),
    field: "owedSen",
    flex: 0.8,
    minWidth: 88,
    type: "rightAligned",
    sort: "desc",
    valueFormatter: (p) => (p.value == null ? "" : formatSen(Number(p.value))),
    cellClass: "hg-num",
  },
  {
    headerName: t("home.grid.status"),
    field: "status",
    flex: 1,
    minWidth: 118,
    cellClass: "hg-status-cell",
    headerTooltip: t("home.grid.statusTip"),
    cellRenderer: StatusCell,
    getQuickFilterText: (p) => (p.data && !isTotal(p.data) ? lateLabel(p.data, t) : ""),
    // Most days late first, then overdue, invoice sent, not sent.
    comparator: (_a, _b, nodeA, nodeB) => {
      const a = nodeA.data;
      const b = nodeB.data;
      if (!a || isTotal(a) || !b || isTotal(b)) return 0;
      return b.daysLate - a.daysLate || STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    },
  },
  // Named for screen readers; the labels are hidden on screen.
  { headerName: t("home.grid.nextStep"), headerClass: "hg-hidden-header", colId: "next", width: 92, minWidth: 92, maxWidth: 92, sortable: false, cellClass: "hg-next-cell", cellRenderer: ActionCell },
  {
    headerName: t("home.grid.whatsapp"),
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
}

export default function HomeBoardGrid({ rows, onShare }: { rows: BoardRow[]; onShare: ShareContext["onShare"] }) {
  const dark = useResolvedTheme() === "dark";
  const { t } = useT();
  const columns = useMemo(() => columnsFor(t), [t]);
  // AG Grid's own words: only the empty-table and loading overlays can show here.
  const localeText = useMemo(() => ({ noRowsToShow: t("home.grid.noRows"), loadingOoo: t("common.loading") }), [t]);
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
        theme={dark ? darkTheme : theme}
        rowData={rows}
        columnDefs={columns}
        localeText={localeText}
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
