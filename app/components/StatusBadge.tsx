import { STATUS_LABEL, type DebtStatus } from "@/lib/debts";

export { STATUS_LABEL };

export default function StatusBadge({ status }: { status: DebtStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}
