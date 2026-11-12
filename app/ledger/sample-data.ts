// Example 555 tabs for a kedai runcit (neighbourhood sundry shop). The ledger starts
// with these on a first visit, and "Load sample tabs" puts them back for demos.

import type { Debt } from "@/lib/debts";

function sample(
  id: string,
  customerName: string,
  item: string,
  amountSen: number,
  date: string,
  status: Debt["status"],
): Debt {
  return { id, customerName, item, amountSen, date, status, source: "manual", createdAt: `${date}T09:00:00.000Z` };
}

export const SAMPLE_DEBTS: Debt[] = [
  sample("T-1001", "Mak Cik Siti", "Beras 10kg, minyak masak 2kg", 4850, "2026-08-02", "overdue"),
  sample("T-1002", "Pak Ali (Bengkel)", "Rokok Dunhill x2 kotak", 3600, "2026-08-19", "overdue"),
  sample("T-1003", "Ah Seng", "Susu tepung 2kg, Milo 1kg", 3990, "2026-09-04", "overdue"),
  sample("T-1004", "Kak Lina", "Telur 30 biji, gula 1kg", 2240, "2026-09-28", "sent"),
  sample("T-1005", "Encik Hafiz", "Roti canai x3, teh tarik x3", 1350, "2026-10-03", "unpaid"),
  sample("T-1006", "Uncle Tan", "Sabun basuh 1L x2", 1780, "2026-10-05", "unpaid"),
  sample("T-1007", "Puan Rosnah", "Garam 1kg, kicap 500ml", 920, "2026-10-06", "sent"),
  sample("T-1008", "Mr. Raj", "Kopi O x2", 500, "2026-10-08", "unpaid"),
  sample("T-1009", "Ah Hock", "Air mineral 12 botol", 1200, "2026-09-15", "paid"),
  sample("T-1010", "Nurul", "Biskut Marie x4, sos cili", 1660, "2026-09-22", "paid"),
  // Kak Lina's older, paid tabs, so her customer page (/tab/kak-lina) has bills to show.
  sample("T-1011", "Kak Lina", "Roti Gardenia x2", 480, "2026-10-06", "unpaid"),
  sample("T-1012", "Kak Lina", "Milo 1kg, susu pekat", 1990, "2026-08-03", "paid"),
  sample("T-1013", "Kak Lina", "Beras 5kg", 1160, "2026-08-01", "paid"),
  sample("T-1014", "Kak Lina", "Sardin x3, bawang 1kg", 1350, "2026-07-14", "paid"),
];

// Demo customers' emails, so the Collect screen opens ready to send. They all reach
// Bryan's inbox through Gmail "+" addresses (bryanljy07+siti@gmail.com lands in
// bryanljy07@gmail.com); change DEMO_INBOX to use your own. Mr. Raj is left without one
// to show the "Add email" step. Keyed by customer slug (lib/customer-tab.ts).
const DEMO_INBOX = { user: "bryanljy07", domain: "gmail.com" };

function demoEmail(tag: string): string {
  return `${DEMO_INBOX.user}+${tag}@${DEMO_INBOX.domain}`;
}

export const SAMPLE_EMAILS: Record<string, string> = {
  "mak-cik-siti": demoEmail("siti"),
  "pak-ali-bengkel": demoEmail("ali"),
  "ah-seng": demoEmail("ahseng"),
  "kak-lina": demoEmail("lina"),
  "encik-hafiz": demoEmail("hafiz"),
  "uncle-tan": demoEmail("tan"),
  "puan-rosnah": demoEmail("rosnah"),
  "ah-hock": demoEmail("ahhock"),
  nurul: demoEmail("nurul"),
};
