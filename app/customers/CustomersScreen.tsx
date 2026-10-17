"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { EMAIL_DOMAINS, isValidEmail, withDomain } from "@/lib/collect";
import {
  customerRows,
  customerTotals,
  isReadyToInvoice,
  planAddCustomer,
  saveAddCustomer,
  type AddCustomerErrors,
  type AddCustomerPlan,
  type CustomerRow,
} from "@/lib/customers";
import { newDebtId } from "@/lib/debt-store";
import { formatSen, todayLocal } from "@/lib/debts";
import Avatar from "../components/Avatar";
import { BackIcon, CloseIcon, MailIcon, PlusIcon, SearchIcon, SendIcon } from "../components/icons";
import { useDialog } from "../components/useDialog";
import { useCollect } from "../useCollect";
import { useDebts } from "../useDebts";
import { useT } from "../useT";

type FilterTab = "all" | "owed" | "missing_email" | "ready";


export default function CustomersScreen() {
  const { t, formatDay, formatNumber } = useT();
  const { debts } = useDebts();
  const { emails, invoices, pending } = useCollect();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRow | null>(null);

  // One row per customer (lib/customers.ts). "Owed" counts everything not paid, invoice sent
  // included, so the total matches Home.
  const customers = useMemo(() => {
    const knownNames = new Map<string, string>();
    for (const inv of invoices) if (!knownNames.has(inv.slug)) knownNames.set(inv.slug, inv.customerName);
    for (const p of Object.values(pending)) if (!knownNames.has(p.slug)) knownNames.set(p.slug, p.customerName);
    return customerRows(debts, emails, knownNames, pending);
  }, [debts, emails, invoices, pending]);

  // Filtered customer list
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      const matchesQuery = !q || c.name.toLowerCase().includes(q) || (c.email && c.email.toLowerCase().includes(q));
      if (!matchesQuery) return false;

      if (filter === "owed") return c.owedSen > 0;
      if (filter === "missing_email") return !c.email;
      if (filter === "ready") return isReadyToInvoice(c);
      return true;
    });
  }, [customers, query, filter]);

  // Summary counts
  const totals = useMemo(() => customerTotals(customers), [customers]);
  const totalOwedSen = totals.owedSen;
  const owedCount = totals.owing;
  const missingEmailCount = totals.missingEmail;
  const readyCount = totals.readyToInvoice;

  const chips: { id: FilterTab; label: string; count: number }[] = [
    { id: "all", label: t("customers.filter.all"), count: customers.length },
    { id: "owed", label: t("customers.filter.owed"), count: owedCount },
    { id: "missing_email", label: t("customers.filter.missing"), count: missingEmailCount },
    { id: "ready", label: t("customers.filter.ready"), count: readyCount },
  ];

  return (
    <div className="customers-page">
      <div className="page-head">
        <div>
          <Link href="/ledger" className="link-button cust-back">
            <BackIcon /> {t("customers.back")}
          </Link>
          <h1 className="page-title">{t("customers.title")}</h1>
          <p className="page-intro">{t("customers.intro")}</p>
        </div>
        <button type="button" className="button button-primary cust-add" onClick={() => setAddModalOpen(true)}>
          <PlusIcon /> {t("customers.add")}
        </button>
      </div>

      {/* Metrics overview */}
      <div className="card cust-metrics">
        <div>
          <div className="cust-metric-label">{t("customers.metric.total")}</div>
          <div className="cust-metric-value">{formatNumber(customers.length)}</div>
        </div>
        <div>
          <div className="cust-metric-label">{t("customers.metric.owed")}</div>
          <div className="cust-metric-value">RM {formatSen(totalOwedSen)}</div>
        </div>
        <div>
          <div className="cust-metric-label">{t("customers.metric.ready")}</div>
          <div className="cust-metric-value cust-metric-good">{formatNumber(readyCount)}</div>
        </div>
        <div>
          <div className="cust-metric-label">{t("customers.metric.missing")}</div>
          <div className={`cust-metric-value${missingEmailCount > 0 ? " cust-metric-warn" : " cust-metric-quiet"}`}>
            {formatNumber(missingEmailCount)}
          </div>
        </div>
      </div>

      {/* Missing email actionable banner */}
      {missingEmailCount > 0 && (
        <div className="notice notice-warning cust-banner" role="status">
          <span>{t("customers.missing", { count: missingEmailCount })}</span>
          <button
            type="button"
            className="button button-sm"
            onClick={() => {
              setFilter("missing_email");
              const firstMissing = customers.find((c) => !c.email);
              if (firstMissing) setEditingCustomer(firstMissing);
            }}
          >
            {t("customers.missing.resolve")}
          </button>
        </div>
      )}

      {/* Search and Filters */}
      <div className="cust-tools">
        <div className="cust-search">
          <input
            type="search"
            aria-label={t("customers.search.label")}
            placeholder={t("customers.search.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="cust-search-icon" aria-hidden="true">
            <SearchIcon />
          </span>
        </div>

        <div className="ledger-chips" role="group" aria-label={t("customers.filter.label")}>
          {chips.map((chip) => (
            <button key={chip.id} type="button" aria-pressed={filter === chip.id} onClick={() => setFilter(chip.id)}>
              {chip.label} <b>{formatNumber(chip.count)}</b>
            </button>
          ))}
        </div>
      </div>

      {/* Customer Directory List */}
      {filtered.length === 0 ? (
        <div className="card empty-state">
          <h2>{t("customers.empty.title")}</h2>
          <p className="cust-muted">{query ? t("customers.empty.query", { query }) : t("customers.empty.filter")}</p>
          {query && (
            <button type="button" className="button" onClick={() => setQuery("")}>
              {t("customers.empty.clear")}
            </button>
          )}
        </div>
      ) : (
        <div className="cust-list">
          {filtered.map((c) => (
            <div key={c.slug} className="card cust-card">
              <div className="cust-card-top">
                <div className="cust-who">
                  <Avatar name={c.name} className="avatar avatar-md" />
                  <div>
                    <h2 className="cust-name">
                      <Link href={`/tab/${c.slug}`}>{c.name}</Link>
                    </h2>
                    <div className="cust-meta">
                      {t("customers.row.tabs", { count: c.totalDebts })}
                      {c.lastDate && ` · ${t("customers.row.lastActivity", { date: formatDay(c.lastDate) })}`}
                    </div>
                  </div>
                </div>

                <div className="cust-owed">
                  <div className={`cust-owed-amount${c.owedSen > 0 ? "" : " cust-owed-paid"}`}>
                    {c.owedSen > 0 ? `RM ${formatSen(c.owedSen)}` : t("customers.row.allPaid")}
                  </div>
                  {c.overdueCount > 0 && (
                    <span className="badge badge-overdue cust-overdue">
                      {t("customers.row.overdue", { count: c.overdueCount })}
                    </span>
                  )}
                </div>
              </div>

              {/* Email Status & Configuration Row */}
              <div className={`cust-email${c.email ? "" : " cust-email-missing"}`}>
                <div className="cust-email-text">
                  <MailIcon className="icon" />
                  {c.email ? (
                    <span>
                      <strong>{t("customers.row.email")}:</strong> <code>{c.email}</code>
                    </span>
                  ) : (
                    <span className="cust-email-warn">{t("customers.row.noEmail")}</span>
                  )}
                </div>
                <button
                  type="button"
                  className={`button button-sm${c.email ? "" : " button-primary"}`}
                  aria-label={t(c.email ? "customers.row.editEmailFor" : "customers.row.addEmailFor", { name: c.name })}
                  onClick={() => setEditingCustomer(c)}
                >
                  {c.email ? t("customers.row.editEmail") : t("customers.row.addEmail")}
                </button>
              </div>

              {/* Action links */}
              <div className="cust-actions">
                <Link href={`/tab/${c.slug}`} className="button button-sm">
                  {t("customers.row.viewTab")}
                </Link>
                {/* Only when Collect has something to send them, so "Invoice sent" tabs get no dead button. */}
                {isReadyToInvoice(c) && (
                  <Link href="/collect" className="button button-sm button-primary cust-invoice">
                    <SendIcon /> {t("customers.row.invoice")}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingCustomer && <EditEmailModal customer={editingCustomer} onClose={() => setEditingCustomer(null)} />}

      {addModalOpen && <AddCustomerModal onClose={() => setAddModalOpen(false)} />}
    </div>
  );
}

function EmailEndings({ value, onPick }: { value: string; onPick: (next: string) => void }) {
  const { t } = useT();
  return (
    <div className="sheet-chips" role="group" aria-label={t("collect.email.endings")}>
      {EMAIL_DOMAINS.map((domain) => (
        <button key={domain} type="button" onClick={() => onPick(withDomain(value, domain))}>
          @{domain}
        </button>
      ))}
    </div>
  );
}

function EditEmailModal({ customer, onClose }: { customer: CustomerRow; onClose: () => void }) {
  const { t } = useT();
  const { setEmail } = useCollect();
  const [value, setValue] = useState(customer.email || "");
  const [error, setError] = useState<string | null>(null);
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: "#customer-email-input" });

  function save() {
    if (!isValidEmail(value)) {
      setError(t("collect.email.invalid"));
      return;
    }
    try {
      setEmail(customer.slug, value.trim());
    } catch {
      // CollectStoreError (storage full or blocked): nothing was changed.
      setError(t("customers.email.saveFailed"));
      return;
    }
    onClose();
  }

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="sheet cust-sheet" role="dialog" aria-modal="true" aria-labelledby="edit-email-title">
        <button type="button" className="sheet-close" aria-label={t("common.close")} onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="sheet-who">
          <Avatar name={customer.name} className="avatar avatar-lg" />
          <h2 id="edit-email-title">{customer.name}</h2>
          <p>{t("customers.email.intro")}</p>
        </div>

        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="field">
            <label htmlFor="customer-email-input">{t("customers.email.label")}</label>
            <input
              id="customer-email-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("collect.email.placeholder")}
              value={value}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
            />
          </div>

          <EmailEndings value={value} onPick={setValue} />

          <div className="cust-sheet-actions">
            <button type="button" className="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="button button-primary">
              {t("customers.email.save")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function AddCustomerModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const { debts, add } = useDebts();
  const { emails, setEmail: saveEmail } = useCollect();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [includeInitialDebt, setIncludeInitialDebt] = useState(false);
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<AddCustomerErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set when the name matches a customer who already has a different email.
  const [conflict, setConflict] = useState<Extract<AddCustomerPlan, { kind: "exists" }> | null>(null);
  const ref = useDialog<HTMLDivElement>(onClose, { initialFocus: "#new-customer-name" });

  function edited() {
    if (Object.keys(errors).length > 0) setErrors({});
    if (saveError) setSaveError(null);
    if (conflict) setConflict(null);
  }

  function commit(plan: Exclude<AddCustomerPlan, { kind: "invalid" }>) {
    const result = saveAddCustomer(plan, { addDebt: add, setEmail: saveEmail, newId: newDebtId, now: new Date() });
    if (result.ok) {
      onClose();
      return;
    }
    if (result.saved === "debtOnly") {
      // The debt is on the ledger; don't let a second tap add it twice.
      setIncludeInitialDebt(false);
      setSaveError(t("customers.err.debtOnly"));
    } else {
      setSaveError(t("customers.err.nothingSaved"));
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    const plan = planAddCustomer(
      { name, email, withDebt: includeInitialDebt, item, amount },
      debts,
      emails,
      todayLocal(),
      t,
    );
    if (plan.kind === "invalid") {
      setErrors(plan.errors);
      setConflict(null);
      const first = (["name", "email", "item", "amount"] as const).find((f) => plan.errors[f]);
      if (first) document.getElementById(`new-customer-${first}`)?.focus();
      return;
    }
    setErrors({});
    if (plan.kind === "exists") {
      setConflict(plan);
      return;
    }
    commit(plan);
  }

  const errorCount = Object.keys(errors).length;

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="sheet cust-sheet" role="dialog" aria-modal="true" aria-labelledby="add-customer-title">
        <button type="button" className="sheet-close" aria-label={t("common.close")} onClick={onClose}>
          <CloseIcon />
        </button>
        <h2 id="add-customer-title" className="cust-sheet-title">
          {t("customers.add.title")}
        </h2>
        <p className="cust-sheet-intro">{t("customers.add.intro")}</p>

        {errorCount > 0 && (
          <p className="notice notice-error" role="alert">
            {t("add.fieldsNeedFixing", { count: errorCount })}
          </p>
        )}
        {saveError && (
          <p className="notice notice-error" role="alert">
            {saveError}
          </p>
        )}

        <form onSubmit={onSubmit} noValidate>
          <div className="field cust-field">
            <label htmlFor="new-customer-name">{t("customers.add.name")}</label>
            <input
              id="new-customer-name"
              type="text"
              autoComplete="off"
              placeholder={t("add.namePlaceholder")}
              value={name}
              required
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "new-customer-name-error" : undefined}
              onChange={(e) => {
                setName(e.target.value);
                edited();
              }}
            />
            {errors.name && (
              <p id="new-customer-name-error" className="field-error">
                {errors.name}
              </p>
            )}
          </div>

          <div className="field cust-field">
            <label htmlFor="new-customer-email">{t("customers.email.label")}</label>
            <input
              id="new-customer-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("collect.email.placeholder")}
              value={email}
              required
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "new-customer-email-error" : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                edited();
              }}
            />
            {errors.email && (
              <p id="new-customer-email-error" className="field-error">
                {errors.email}
              </p>
            )}
            <EmailEndings
              value={email}
              onPick={(next) => {
                setEmail(next);
                edited();
              }}
            />
          </div>

          <div className="cust-debt-box">
            <label className="cust-check">
              <input
                type="checkbox"
                checked={includeInitialDebt}
                onChange={(e) => {
                  setIncludeInitialDebt(e.target.checked);
                  edited();
                }}
              />
              {t("customers.add.withDebt")}
            </label>

            {includeInitialDebt && (
              <div className="cust-debt-fields">
                <div className="field">
                  <label htmlFor="new-customer-item">
                    {t("add.item")} <span className="optional">{t("add.optional")}</span>
                  </label>
                  <input
                    id="new-customer-item"
                    type="text"
                    placeholder={t("add.itemPlaceholder")}
                    value={item}
                    aria-invalid={errors.item ? true : undefined}
                    aria-describedby={errors.item ? "new-customer-item-error" : undefined}
                    onChange={(e) => {
                      setItem(e.target.value);
                      edited();
                    }}
                  />
                  {errors.item && (
                    <p id="new-customer-item-error" className="field-error">
                      {errors.item}
                    </p>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="new-customer-amount">{t("add.amount")}</label>
                  <input
                    id="new-customer-amount"
                    type="text"
                    inputMode="decimal"
                    placeholder="15.00"
                    value={amount}
                    aria-invalid={errors.amount ? true : undefined}
                    aria-describedby={errors.amount ? "new-customer-amount-error" : undefined}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      edited();
                    }}
                  />
                  {errors.amount && (
                    <p id="new-customer-amount-error" className="field-error">
                      {errors.amount}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {conflict ? (
            <div className="notice notice-warning cust-conflict" role="alert">
              <p className="notice-text">
                <strong>{t("customers.exists.title", { name: conflict.existingName })}</strong>
                <br />
                {t("customers.exists.keepEmail", { email: conflict.existingEmail })}
              </p>
              <div className="cust-sheet-actions">
                <button type="button" className="button" onClick={onClose}>
                  {t("common.cancel")}
                </button>
                {conflict.debt && (
                  <button type="button" className="button button-primary" onClick={() => commit(conflict)}>
                    {t("customers.exists.addDebt", { name: conflict.existingName })}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="cust-sheet-actions">
              <button type="button" className="button" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="button button-primary">
                {t("customers.add.save")}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>,
    document.body,
  );
}
