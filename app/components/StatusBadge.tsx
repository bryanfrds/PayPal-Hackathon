import type { DebtStatus } from "@/lib/debts";

/** What each status reads as on screen. "unpaid" means no invoice has gone out yet. */
export const STATUS_LABEL: Record<DebtStatus, string> = {
  overdue: "Overdue",
  sent: "Invoice sent",
  unpaid: "Not sent",
  paid: "Paid",
};

export default function StatusBadge({ status }: { status: DebtStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}
