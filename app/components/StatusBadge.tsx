"use client";

import { STATUS_LABEL, type DebtStatus } from "@/lib/debts";
import { useT } from "../useT";

export { STATUS_LABEL };

export default function StatusBadge({ status }: { status: DebtStatus }) {
  const { t } = useT();
  return <span className={`badge badge-${status}`}>{t(`status.${status}`)}</span>;
}
