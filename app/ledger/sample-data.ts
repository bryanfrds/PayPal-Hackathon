// Example 555 tabs for a kedai runcit (neighbourhood sundry shop).
// Replace with live data once the Scan and Collect screens write real rows.

export type LedgerStatus = "overdue" | "sent" | "unpaid" | "paid";

export type LedgerRow = {
  id: string;
  customerName: string;
  item: string;
  amountRm: number;
  date: string; // ISO date, YYYY-MM-DD
  status: LedgerStatus;
};

export const SAMPLE_LEDGER_ROWS: LedgerRow[] = [
  { id: "T-1001", customerName: "Mak Cik Siti", item: "Beras 10kg, minyak masak 2kg", amountRm: 48.5, date: "2026-08-02", status: "overdue" },
  { id: "T-1002", customerName: "Pak Ali (Bengkel)", item: "Rokok Dunhill x2 kotak", amountRm: 36.0, date: "2026-08-19", status: "overdue" },
  { id: "T-1003", customerName: "Ah Seng", item: "Susu tepung 2kg, Milo 1kg", amountRm: 39.9, date: "2026-09-04", status: "overdue" },
  { id: "T-1004", customerName: "Kak Lina", item: "Telur 30 biji, gula 1kg", amountRm: 22.4, date: "2026-09-28", status: "sent" },
  { id: "T-1005", customerName: "Encik Hafiz", item: "Roti canai x3, teh tarik x3", amountRm: 13.5, date: "2026-10-03", status: "unpaid" },
  { id: "T-1006", customerName: "Uncle Tan", item: "Sabun basuh 1L x2", amountRm: 17.8, date: "2026-10-05", status: "unpaid" },
  { id: "T-1007", customerName: "Puan Rosnah", item: "Garam 1kg, kicap 500ml", amountRm: 9.2, date: "2026-10-06", status: "sent" },
  { id: "T-1008", customerName: "Mr. Raj", item: "Kopi O x2", amountRm: 5.0, date: "2026-10-08", status: "unpaid" },
  { id: "T-1009", customerName: "Ah Hock", item: "Air mineral 12 botol", amountRm: 12.0, date: "2026-09-15", status: "paid" },
  { id: "T-1010", customerName: "Nurul", item: "Biskut Marie x4, sos cili", amountRm: 16.6, date: "2026-09-22", status: "paid" },
];

const STATUS_ORDER: Record<LedgerStatus, number> = {
  overdue: 0,
  sent: 1,
  unpaid: 2,
  paid: 3,
};

// Overdue first, then the rest by status, then oldest date first within a status.
export function sortLedgerRows(rows: LedgerRow[]): LedgerRow[] {
  return [...rows].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return a.date.localeCompare(b.date);
  });
}
