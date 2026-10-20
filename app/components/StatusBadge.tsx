"use client";

import { STATUS_LABEL, type Debt, type DebtStatus } from "@/lib/debts";
import type { T } from "@/lib/i18n";
import { daysLate, invoiceState, isOverdue } from "@/lib/tab-status";
import { useT } from "../useT";

export { STATUS_LABEL };

export default function StatusBadge({ status }: { status: DebtStatus }) {
  const { t } = useT();
  return <span className={`badge badge-${status}`}>{t(`status.${status}`)}</span>;
}

/**
 * One tab's status, by the shared rules in lib/tab-status: where its invoice stands (Paid,
 * Invoice sent, Not sent) plus a red "10 days late" when it's overdue, so a late invoiced tab
 * reads "Invoice sent" and late, never one or the other. `compact` (phone grids) shows a
 * single badge: the late one when late, with the invoice state in its tooltip.
 */
export function TabStatus({ debt, today, compact = false }: { debt: Debt; today: string; compact?: boolean }) {
  const { t } = useT();
  const state = invoiceState(debt);
  if (!isOverdue(debt, today)) return <StatusBadge status={state} />;
  const days = daysLate(debt, today);
  const late = days > 0 ? t("late.days", { count: days }) : t("status.overdue");
  if (compact) {
    return (
      <span className="badge badge-overdue" title={`${t(`status.${state}`)} · ${late}`}>
        {t("status.overdue")}
      </span>
    );
  }
  return (
    <span className="tab-status">
      <StatusBadge status={state} />
      <span className="badge badge-overdue">{late}</span>
    </span>
  );
}

/** TabStatus as plain text ("Invoice sent · Overdue · 10 days late"), for search and filters. */
export function tabStatusText(debt: Debt, today: string, t: T): string {
  const state = t(`status.${invoiceState(debt)}`);
  if (!isOverdue(debt, today)) return state;
  const days = daysLate(debt, today);
  return `${state} · ${t("status.overdue")}${days > 0 ? ` · ${t("late.days", { count: days })}` : ""}`;
}
