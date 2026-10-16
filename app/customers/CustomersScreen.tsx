"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EMAIL_DOMAINS, isValidEmail, withDomain } from "@/lib/collect";
import { CollectStoreError } from "@/lib/collect-store";
import { customerSlug } from "@/lib/customer-tab";
import { newDebtId } from "@/lib/debt-store";
import { createManualDebt, formatSen, parseRmToSen, todayLocal, type Debt } from "@/lib/debts";
import Avatar from "../components/Avatar";
import { BackIcon, CheckIcon, CloseIcon, MailIcon, PlusIcon, SearchIcon, SendIcon } from "../components/icons";
import { useCollect } from "../useCollect";
import { useDebts } from "../useDebts";
import { useT } from "../useT";

type FilterTab = "all" | "owed" | "missing_email" | "ready";

type CustomerRow = {
  name: string;
  slug: string;
  email?: string;
  totalDebts: number;
  unpaidCount: number;
  overdueCount: number;
  owedSen: number;
  lastDate?: string;
};

export default function CustomersScreen() {
  const { t } = useT();
  const router = useRouter();
  const { debts, add } = useDebts();
  const { emails, setEmail } = useCollect();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRow | null>(null);

  // Derive unique customers from debts and emails map
  const customers = useMemo(() => {
    const map = new Map<string, CustomerRow>();

    for (const d of debts) {
      const slug = customerSlug(d.customerName);
      let row = map.get(slug);
      if (!row) {
        row = {
          name: d.customerName,
          slug,
          email: emails[slug],
          totalDebts: 0,
          unpaidCount: 0,
          overdueCount: 0,
          owedSen: 0,
          lastDate: d.date,
        };
        map.set(slug, row);
      }
      row.totalDebts += 1;
      if (d.status === "unpaid") {
        row.unpaidCount += 1;
        row.owedSen += d.amountSen;
      } else if (d.status === "overdue") {
        row.overdueCount += 1;
        row.owedSen += d.amountSen;
      }
      if (!row.lastDate || d.date > row.lastDate) {
        row.lastDate = d.date;
      }
    }

    // Include any saved emails for customers who might not have active debts
    for (const [slug, email] of Object.entries(emails)) {
      if (!map.has(slug)) {
        map.set(slug, {
          name: slug.replace(/-/g, " "),
          slug,
          email,
          totalDebts: 0,
          unpaidCount: 0,
          overdueCount: 0,
          owedSen: 0,
        });
      } else {
        const row = map.get(slug)!;
        row.email = email;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.owedSen - a.owedSen || a.name.localeCompare(b.name));
  }, [debts, emails]);

  // Filtered customer list
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      const matchesQuery = !q || c.name.toLowerCase().includes(q) || (c.email && c.email.toLowerCase().includes(q));
      if (!matchesQuery) return false;

      if (filter === "owed") return c.owedSen > 0;
      if (filter === "missing_email") return !c.email;
      if (filter === "ready") return !!c.email && c.owedSen > 0;
      return true;
    });
  }, [customers, query, filter]);

  // Summary counts
  const totalOwedSen = useMemo(() => customers.reduce((sum, c) => sum + c.owedSen, 0), [customers]);
  const missingEmailCount = useMemo(() => customers.filter((c) => !c.email).length, [customers]);
  const readyCount = useMemo(() => customers.filter((c) => !!c.email && c.owedSen > 0).length, [customers]);

  return (
    <div className="customers-page" style={{ maxWidth: "800px", margin: "0 auto", padding: "1.25rem 1rem" }}>
      <div className="page-head" style={{ marginBottom: "1.25rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Link href="/ledger" className="link-button" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              <BackIcon /> Back to Ledger
            </Link>
          </div>
          <h1 className="page-title" style={{ marginTop: "0.5rem" }}>Customer Directory</h1>
          <p className="page-intro">
            Manage customer contact emails, track balances, and ensure customers are ready for PayPal invoicing.
          </p>
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={() => setAddModalOpen(true)}
          style={{ whiteSpace: "nowrap" }}
        >
          <PlusIcon /> Add Customer
        </button>
      </div>

      {/* Metrics overview */}
      <div
        className="card"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "1rem",
          padding: "1rem",
          marginBottom: "1.25rem",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)", fontWeight: 600 }}>Total Customers</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{customers.length}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)", fontWeight: 600 }}>Total Balance Owed</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--ink)" }}>RM {formatSen(totalOwedSen)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)", fontWeight: 600 }}>Ready to Invoice</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--success)" }}>{readyCount}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)", fontWeight: 600 }}>Missing Email</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: missingEmailCount > 0 ? "var(--warning)" : "var(--ink-muted)" }}>
            {missingEmailCount}
          </div>
        </div>
      </div>

      {/* Missing email actionable banner */}
      {missingEmailCount > 0 && (
        <div
          className="notice notice-warning"
          role="status"
          style={{ marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <span>
            ⚠️ <strong>{missingEmailCount} customer{missingEmailCount > 1 ? "s" : ""}</strong> missing invoicing emails. Add emails to send official PayPal invoices.
          </span>
          <button
            type="button"
            className="button button-sm"
            onClick={() => {
              setFilter("missing_email");
              const firstMissing = customers.find((c) => !c.email);
              if (firstMissing) setEditingCustomer(firstMissing);
            }}
          >
            Resolve now ✉
          </button>
        </div>
      )}

      {/* Search and Filters */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <div style={{ position: "relative" }}>
          <input
            type="search"
            placeholder="Search by customer name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "0.6rem 0.8rem 0.6rem 2.2rem",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              fontSize: "0.95rem",
              background: "var(--card)",
              color: "var(--ink)",
            }}
          />
          <div style={{ position: "absolute", left: "0.7rem", top: "50%", transform: "translateY(-50%)", color: "var(--ink-muted)", pointerEvents: "none" }}>
            <SearchIcon />
          </div>
        </div>

        <div className="ledger-chips" role="group" aria-label="Customer filters">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All <b>{customers.length}</b>
          </button>
          <button type="button" aria-pressed={filter === "owed"} onClick={() => setFilter("owed")}>
            Owes Money <b>{customers.filter((c) => c.owedSen > 0).length}</b>
          </button>
          <button type="button" aria-pressed={filter === "missing_email"} onClick={() => setFilter("missing_email")}>
            Needs Email <b>{missingEmailCount}</b>
          </button>
          <button type="button" aria-pressed={filter === "ready"} onClick={() => setFilter("ready")}>
            Ready to Invoice <b>{readyCount}</b>
          </button>
        </div>
      </div>

      {/* Customer Directory List */}
      {filtered.length === 0 ? (
        <div className="card empty-state" style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
          <h2>No customers found</h2>
          <p style={{ color: "var(--ink-muted)", margin: "0.5rem 0 1.25rem" }}>
            {query ? `No customers matched "${query}".` : "No customers found in this filter."}
          </p>
          {query && (
            <button type="button" className="button" onClick={() => setQuery("")}>
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {filtered.map((c) => (
            <div
              key={c.slug}
              className="card"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                padding: "1rem",
                transition: "border-color 0.15s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <Avatar name={c.name} className="avatar avatar-md" />
                  <div>
                    <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0 }}>
                      <Link href={`/tab/${c.slug}`} style={{ color: "inherit", textDecoration: "none" }}>
                        {c.name}
                      </Link>
                    </h2>
                    <div style={{ fontSize: "0.82rem", color: "var(--ink-muted)", marginTop: "0.2rem" }}>
                      {c.totalDebts} tab{c.totalDebts !== 1 ? "s" : ""}
                      {c.lastDate && ` · Last activity: ${c.lastDate}`}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 800, color: c.owedSen > 0 ? "var(--ink)" : "var(--success)" }}>
                    {c.owedSen > 0 ? `RM ${formatSen(c.owedSen)}` : "All paid ✓"}
                  </div>
                  {c.overdueCount > 0 && (
                    <span className="badge badge-overdue" style={{ fontSize: "0.75rem", marginTop: "0.2rem", display: "inline-block" }}>
                      {c.overdueCount} overdue
                    </span>
                  )}
                </div>
              </div>

              {/* Email Status & Configuration Row */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  padding: "0.5rem 0.75rem",
                  background: c.email ? "var(--bg-subtle, rgba(0,0,0,0.02))" : "#fff8e6",
                  border: `1px solid ${c.email ? "var(--border)" : "#fed7aa"}`,
                  borderRadius: "8px",
                  fontSize: "0.85rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <MailIcon className="icon" />
                  {c.email ? (
                    <span>
                      <strong>PayPal Invoice Email:</strong> <code style={{ fontSize: "0.85rem" }}>{c.email}</code>
                    </span>
                  ) : (
                    <span style={{ color: "#9a3412", fontWeight: 600 }}>
                      ⚠️ Missing invoice email (required for PayPal)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className={`button button-sm ${c.email ? "" : "button-primary"}`}
                  onClick={() => setEditingCustomer(c)}
                >
                  {c.email ? "Edit Email" : "Add Email ✉"}
                </button>
              </div>

              {/* Action links */}
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <Link href={`/tab/${c.slug}`} className="button button-sm">
                  View Tab ↗
                </Link>
                {c.owedSen > 0 && (
                  <Link href="/collect" className="button button-sm button-primary" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                    <SendIcon /> Invoice
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Edit Customer Email */}
      {editingCustomer && (
        <EditEmailModal
          customer={editingCustomer}
          onClose={() => setEditingCustomer(null)}
          onSaved={(email) => {
            setEmail(editingCustomer.slug, email);
            setEditingCustomer(null);
          }}
        />
      )}

      {/* Modal: Add New Customer */}
      {addModalOpen && (
        <AddCustomerModal
          onClose={() => setAddModalOpen(false)}
          onCreated={(name, email, initialDebt) => {
            const slug = customerSlug(name);
            setEmail(slug, email);
            if (initialDebt) {
              const now = todayLocal();
              const debt = createManualDebt(
                {
                  customerName: name,
                  item: initialDebt.item || "Barang kedai",
                  amountSen: initialDebt.amountSen,
                  date: now,
                },
                { id: newDebtId(), now: new Date() }
              );
              add(debt);
            }
            setAddModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function EditEmailModal({
  customer,
  onClose,
  onSaved,
}: {
  customer: CustomerRow;
  onClose: () => void;
  onSaved: (email: string) => void;
}) {
  const [value, setValue] = useState(customer.email || "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!isValidEmail(value)) {
      setError("Please enter a valid email address (e.g., name@gmail.com).");
      return;
    }
    onSaved(value.trim());
  }

  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-labelledby="edit-email-title">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" style={{ maxWidth: "460px" }}>
        <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
        <div className="sheet-who" style={{ textAlign: "center", marginBottom: "1rem" }}>
          <Avatar name={customer.name} className="avatar avatar-lg" />
          <h2 id="edit-email-title" style={{ margin: "0.5rem 0 0.25rem", fontSize: "1.2rem", fontWeight: 800 }}>
            {customer.name}
          </h2>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-muted)" }}>
            PayPal requires an email address to send official itemized invoices.
          </p>
        </div>

        {error && (
          <p className="notice notice-error" role="alert" style={{ marginBottom: "0.75rem" }}>
            {error}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="field" style={{ marginBottom: "0.75rem" }}>
            <label htmlFor="customer-email-input">PayPal Invoicing Email</label>
            <input
              id="customer-email-input"
              type="email"
              placeholder="customer@gmail.com"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              style={{
                width: "100%",
                padding: "0.6rem 0.8rem",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
            {EMAIL_DOMAINS.map((domain) => (
              <button
                key={domain}
                type="button"
                className="button button-sm"
                onClick={() => setValue(withDomain(value, domain))}
                style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
              >
                @{domain}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button button-primary">
              Save Email
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddCustomerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string, email: string, initialDebt?: { item: string; amountSen: number }) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [includeInitialDebt, setIncludeInitialDebt] = useState(false);
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please enter the customer's name.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address for PayPal invoicing.");
      return;
    }

    let initialDebt: { item: string; amountSen: number } | undefined;
    if (includeInitialDebt) {
      const sen = parseRmToSen(amount);
      if (sen === null || sen <= 0) {
        setError("Please enter a valid initial debt amount (e.g. 15.00).");
        return;
      }
      initialDebt = { item: item.trim() || "Barang kedai", amountSen: sen };
    }

    onCreated(trimmedName, email.trim(), initialDebt);
  }

  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-labelledby="add-customer-title">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" style={{ maxWidth: "480px" }}>
        <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
        <h2 id="add-customer-title" style={{ margin: "0 0 0.5rem", fontSize: "1.2rem", fontWeight: 800 }}>
          Add New Customer
        </h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.85rem", color: "var(--ink-muted)" }}>
          Register a customer with their PayPal invoicing contact so you can send itemized invoices directly.
        </p>

        {error && (
          <p className="notice notice-error" role="alert" style={{ marginBottom: "0.75rem" }}>
            {error}
          </p>
        )}

        <form onSubmit={onSubmit}>
          <div className="field" style={{ marginBottom: "0.75rem" }}>
            <label htmlFor="new-customer-name">Customer Name *</label>
            <input
              id="new-customer-name"
              type="text"
              placeholder="e.g. Ah Hock, Kak Minah"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              required
              autoFocus
              style={{
                width: "100%",
                padding: "0.6rem 0.8rem",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div className="field" style={{ marginBottom: "0.5rem" }}>
            <label htmlFor="new-customer-email">PayPal Invoicing Email *</label>
            <input
              id="new-customer-email"
              type="email"
              placeholder="customer@gmail.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
              required
              style={{
                width: "100%",
                padding: "0.6rem 0.8rem",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {EMAIL_DOMAINS.map((domain) => (
              <button
                key={domain}
                type="button"
                className="button button-sm"
                onClick={() => setEmail(withDomain(email, domain))}
                style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
              >
                @{domain}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: "1.25rem", padding: "0.75rem", border: "1px dashed var(--border)", borderRadius: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={includeInitialDebt}
                onChange={(e) => setIncludeInitialDebt(e.target.checked)}
              />
              Record initial credit tab now
            </label>

            {includeInitialDebt && (
              <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label htmlFor="new-customer-item" style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
                    Item / description
                  </label>
                  <input
                    id="new-customer-item"
                    type="text"
                    placeholder="Barang kedai"
                    value={item}
                    onChange={(e) => setItem(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="new-customer-amount" style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
                    Amount (RM)
                  </label>
                  <input
                    id="new-customer-amount"
                    type="text"
                    placeholder="15.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button button-primary">
              Create Customer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
