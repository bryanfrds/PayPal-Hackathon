// Person 1 pluggable persistence layer
import type {
  ApprovedDebtRecord,
  CustomerRecord,
  ExtractedEntry,
  ReminderDecision,
  ReminderRuleRecord,
  ScanRecord,
} from "./person1-types";

export const DEFAULT_PERSON1_RULES: Omit<ReminderRuleRecord, "ownerEmail" | "updatedAt"> = {
  enabled: true,
  firstAfterDays: 3,
  minIntervalDays: 4,
  maxAttempts: 3,
  sendHour: 10,
  skipFridayPrayers: true,
  requireApproval: false,
};

export type ReminderInvoiceState = {
  attemptCount: number;
  lastAttemptAt?: string;
  hasPendingApproval: boolean;
};

export interface Person1Store {
  // Scans
  claimScan(scan: ScanRecord): Promise<boolean>;
  saveScan(scan: ScanRecord): Promise<void>;
  getScan(ownerEmail: string, scanId: string): Promise<ScanRecord | null>;
  findScanByHash(ownerEmail: string, imageHash: string): Promise<ScanRecord | null>;
  updateScanStatus(ownerEmail: string, scanId: string, status: ScanRecord["status"], error?: string): Promise<void>;

  // Entries
  saveEntries(entries: ExtractedEntry[]): Promise<void>;
  getEntriesByScan(ownerEmail: string, scanId: string, revision?: number): Promise<ExtractedEntry[]>;
  getEntry(ownerEmail: string, entryId: string): Promise<ExtractedEntry | null>;
  updateEntry(ownerEmail: string, entryId: string, patch: Partial<ExtractedEntry>): Promise<ExtractedEntry | null>;

  // Customers Directory
  saveCustomer(customer: CustomerRecord): Promise<void>;
  getCustomer(ownerEmail: string, customerId: string): Promise<CustomerRecord | null>;
  getCustomerBySlug(ownerEmail: string, slug: string): Promise<CustomerRecord | null>;
  listCustomers(ownerEmail: string): Promise<CustomerRecord[]>;
  updateCustomer(ownerEmail: string, customerId: string, patch: Partial<CustomerRecord>): Promise<CustomerRecord | null>;
  confirmCustomer(ownerEmail: string, customerId: string): Promise<CustomerRecord | null>;

  // Approved Debts Handoff
  saveApprovedDebts(debts: ApprovedDebtRecord[]): Promise<ApprovedDebtRecord[]>;
  replaceApprovedDebt(debt: ApprovedDebtRecord): Promise<ApprovedDebtRecord | null>;
  getApprovedDebt(ownerEmail: string, approvedDebtId: string): Promise<ApprovedDebtRecord | null>;
  getApprovedDebts(ownerEmail: string): Promise<ApprovedDebtRecord[]>;
  getApprovedDebtByHandoffKey(ownerEmail: string, handoffKey: string): Promise<ApprovedDebtRecord | null>;
  getApprovedDebtBySourceEntryId(ownerEmail: string, sourceEntryId: string): Promise<ApprovedDebtRecord | null>;
  getApprovedDebtByScanAndLine(ownerEmail: string, scanId: string, lineIndex: number): Promise<ApprovedDebtRecord | null>;

  // Reminder Rules & Decisions
  ensureReminderRules(ownerEmail: string): Promise<ReminderRuleRecord>;
  getReminderRules(ownerEmail: string): Promise<ReminderRuleRecord>;
  setReminderRules(rules: ReminderRuleRecord): Promise<void>;
  saveReminderDecision(decision: ReminderDecision): Promise<void>;
  claimReminderRequest(decision: ReminderDecision): Promise<boolean>;
  getReminderInvoiceStates(ownerEmail: string, invoiceIds: string[]): Promise<Record<string, ReminderInvoiceState>>;
  listReminderDecisions(ownerEmail: string, limit?: number, action?: ReminderDecision["action"]): Promise<ReminderDecision[]>;
  getReminderDecision(ownerEmail: string, decisionId: string): Promise<ReminderDecision | null>;
  updateReminderDecisionAction(ownerEmail: string, decisionId: string, action: ReminderDecision["action"], deliveryResult?: string): Promise<void>;
  claimPendingReminder(ownerEmail: string, decisionId: string, deliveredAt?: string): Promise<boolean>;
  rejectPendingReminder(ownerEmail: string, decisionId: string, reason?: string): Promise<boolean>;
  listEnabledReminderOwners(): Promise<string[]>;
}

export function createMemoryPerson1Store(): Person1Store {
  const scans = new Map<string, ScanRecord>();
  const entries = new Map<string, ExtractedEntry>();
  const customers = new Map<string, CustomerRecord>();
  const approvedDebts = new Map<string, ApprovedDebtRecord>();
  const rules = new Map<string, ReminderRuleRecord>();
  const decisions = new Map<string, ReminderDecision>();

  const scanKey = (owner: string, id: string) => `${owner.toLowerCase()}::scan::${id}`;
  const custKey = (owner: string, id: string) => `${owner.toLowerCase()}::cust::${id}`;

  return {
    async claimScan(scan) {
      // Do not await a lookup here: two async callers could both observe a missing
      // hash before either continuation inserts it. Map reads and writes are
      // synchronous, so this makes the memory-store claim atomic just as the
      // database unique constraint is in production.
      for (const existing of scans.values()) {
        if (existing.ownerEmail.toLowerCase() === scan.ownerEmail.toLowerCase() && existing.imageHash === scan.imageHash) {
          return false;
        }
      }
      scans.set(scanKey(scan.ownerEmail, scan.id), { ...scan });
      return true;
    },
    async saveScan(scan) {
      scans.set(scanKey(scan.ownerEmail, scan.id), { ...scan });
    },
    async getScan(ownerEmail, scanId) {
      return scans.get(scanKey(ownerEmail, scanId)) ?? null;
    },
    async findScanByHash(ownerEmail, imageHash) {
      for (const s of scans.values()) {
        if (s.ownerEmail.toLowerCase() === ownerEmail.toLowerCase() && s.imageHash === imageHash) {
          return { ...s };
        }
      }
      return null;
    },
    async updateScanStatus(ownerEmail, scanId, status, error) {
      const existing = scans.get(scanKey(ownerEmail, scanId));
      if (existing) {
        existing.status = status;
        if (error !== undefined) existing.error = error;
        else if (status !== "failed") delete existing.error;
        existing.updatedAt = new Date().toISOString();
      }
    },

    async saveEntries(newEntries) {
      for (const e of newEntries) {
        entries.set(e.id, { ...e });
      }
    },
    async getEntriesByScan(ownerEmail, scanId, revision) {
      const scan = scans.get(scanKey(ownerEmail, scanId));
      if (!scan) return [];
      const result: ExtractedEntry[] = [];
      for (const e of entries.values()) {
        if (e.scanId === scanId && (revision === undefined || e.revision === revision)) {
          result.push({ ...e });
        }
      }
      return result.sort((a, b) => a.sourceRef.lineIndex - b.sourceRef.lineIndex);
    },
    async getEntry(ownerEmail, entryId) {
      const entry = entries.get(entryId);
      if (!entry) return null;
      const scan = scans.get(scanKey(ownerEmail, entry.scanId));
      if (!scan) return null;
      return { ...entry };
    },
    async updateEntry(ownerEmail, entryId, patch) {
      const existing = await this.getEntry(ownerEmail, entryId);
      if (!existing) return null;
      const updated: ExtractedEntry = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      entries.set(entryId, updated);
      return { ...updated };
    },

    async saveCustomer(customer) {
      customers.set(custKey(customer.ownerEmail, customer.id), { ...customer });
    },
    async getCustomer(ownerEmail, customerId) {
      return customers.get(custKey(ownerEmail, customerId)) ?? null;
    },
    async getCustomerBySlug(ownerEmail, slug) {
      const target = slug.toLowerCase();
      for (const c of customers.values()) {
        if (c.ownerEmail.toLowerCase() === ownerEmail.toLowerCase() && c.slug.toLowerCase() === target) {
          return { ...c };
        }
      }
      return null;
    },
    async listCustomers(ownerEmail) {
      const result: CustomerRecord[] = [];
      for (const c of customers.values()) {
        if (c.ownerEmail.toLowerCase() === ownerEmail.toLowerCase()) {
          result.push({ ...c });
        }
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    },
    async updateCustomer(ownerEmail, customerId, patch) {
      const existing = customers.get(custKey(ownerEmail, customerId));
      if (!existing) return null;

      // Detect if identity or contact info changed
      const nameChanged = patch.name !== undefined && patch.name !== existing.name;
      const emailChanged = patch.email !== undefined && patch.email !== existing.email;
      const phoneChanged = patch.phone !== undefined && patch.phone !== existing.phone;
      const shouldClearConfirmation = nameChanged || emailChanged || phoneChanged;

      const updated: CustomerRecord = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };

      // Recompute slug if name changed
      if (nameChanged) {
        const customerTab = await import("./customer-tab");
        updated.slug = customerTab.customerSlug(updated.name);
      }

      // Clear confirmation if identity or contact changed
      if (shouldClearConfirmation) {
        updated.confirmedAt = undefined;
      }

      customers.set(custKey(ownerEmail, customerId), updated);
      return { ...updated };
    },
    async confirmCustomer(ownerEmail, customerId) {
      return this.updateCustomer(ownerEmail, customerId, {
        confirmedAt: new Date().toISOString(),
      });
    },

    async saveApprovedDebts(newDebts) {
      const stored: ApprovedDebtRecord[] = [];
      for (const d of newDebts) {
        let replaced = false;
        for (const [key, existing] of approvedDebts.entries()) {
          if (
            existing.ownerEmail.toLowerCase() === d.ownerEmail.toLowerCase() &&
            existing.sourceEntryId === d.sourceEntryId
          ) {
            const updated = { ...existing, ...d, id: existing.id };
            approvedDebts.set(key, updated);
            stored.push({ ...updated });
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          const created = { ...d };
          approvedDebts.set(created.id, created);
          stored.push({ ...created });
        }
      }
      return stored;
    },
    async getApprovedDebts(ownerEmail) {
      const result: ApprovedDebtRecord[] = [];
      for (const d of approvedDebts.values()) {
        if (d.ownerEmail.toLowerCase() === ownerEmail.toLowerCase()) {
          result.push({ ...d });
        }
      }
      return result.sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
    },
    async replaceApprovedDebt(debt) {
      const current = approvedDebts.get(debt.id);
      if (!current || current.ownerEmail.toLowerCase() !== debt.ownerEmail.toLowerCase()) return null;
      approvedDebts.set(debt.id, { ...debt });
      return { ...debt };
    },
    async getApprovedDebt(ownerEmail, approvedDebtId) {
      for (const d of approvedDebts.values()) {
        if (d.ownerEmail.toLowerCase() === ownerEmail.toLowerCase() && d.id === approvedDebtId) {
          return { ...d };
        }
      }
      return null;
    },
    async getApprovedDebtByHandoffKey(ownerEmail, handoffKey) {
      for (const d of approvedDebts.values()) {
        if (d.ownerEmail.toLowerCase() === ownerEmail.toLowerCase() && d.handoffKey === handoffKey) {
          return { ...d };
        }
      }
      return null;
    },
    async getApprovedDebtBySourceEntryId(ownerEmail, sourceEntryId) {
      for (const d of approvedDebts.values()) {
        if (d.ownerEmail.toLowerCase() === ownerEmail.toLowerCase() && d.sourceEntryId === sourceEntryId) {
          return { ...d };
        }
      }
      return null;
    },
    async getApprovedDebtByScanAndLine(ownerEmail, scanId, lineIndex) {
      for (const d of approvedDebts.values()) {
        if (d.ownerEmail.toLowerCase() === ownerEmail.toLowerCase() && d.scanId === scanId) {
          const entry = entries.get(d.sourceEntryId);
          if (entry && entry.sourceRef.lineIndex === lineIndex) {
            return { ...d };
          }
        }
      }
      return null;
    },

    async ensureReminderRules(ownerEmail) {
      const existing = rules.get(ownerEmail.toLowerCase());
      if (existing) return { ...existing };
      const created = {
        ownerEmail,
        ...DEFAULT_PERSON1_RULES,
        updatedAt: new Date().toISOString(),
      };
      rules.set(ownerEmail.toLowerCase(), created);
      return { ...created };
    },
    async getReminderRules(ownerEmail) {
      const existing = rules.get(ownerEmail.toLowerCase());
      if (existing) return { ...existing };
      return { ownerEmail, ...DEFAULT_PERSON1_RULES, updatedAt: new Date().toISOString() };
    },
    async setReminderRules(newRules) {
      rules.set(newRules.ownerEmail.toLowerCase(), {
        ...newRules,
        updatedAt: new Date().toISOString(),
      });
    },
    async saveReminderDecision(decision) {
      decisions.set(decision.id, { ...decision });
    },
    async claimReminderRequest(decision) {
      if ([...decisions.values()].some((item) => item.idempotencyKey === decision.idempotencyKey)) return false;
      if (decision.action === "pending_approval" && [...decisions.values()].some((item) =>
        item.ownerEmail.toLowerCase() === decision.ownerEmail.toLowerCase() &&
        item.invoiceId === decision.invoiceId &&
        item.action === "pending_approval"
      )) return false;
      decisions.set(decision.id, { ...decision });
      return true;
    },
    async getReminderInvoiceStates(ownerEmail, invoiceIds) {
      const wanted = new Set(invoiceIds);
      const states: Record<string, ReminderInvoiceState> = {};
      for (const decision of decisions.values()) {
        if (decision.ownerEmail.toLowerCase() !== ownerEmail.toLowerCase() || !wanted.has(decision.invoiceId)) continue;
        const state = states[decision.invoiceId] ?? { attemptCount: 0, hasPendingApproval: false };
        if (decision.action === "requested" || decision.action === "failed") {
          state.attemptCount += 1;
          const attemptedAt = decision.deliveredAt ?? decision.createdAt;
          if (!state.lastAttemptAt || attemptedAt > state.lastAttemptAt) state.lastAttemptAt = attemptedAt;
        }
        if (decision.action === "pending_approval") state.hasPendingApproval = true;
        states[decision.invoiceId] = state;
      }
      return states;
    },
    async listReminderDecisions(ownerEmail, limit = 100, action) {
      const result: ReminderDecision[] = [];
      for (const d of decisions.values()) {
        if (d.ownerEmail.toLowerCase() === ownerEmail.toLowerCase()) {
          if (!action || d.action === action) {
            result.push({ ...d });
          }
        }
      }
      return result
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
    async getReminderDecision(ownerEmail, decisionId) {
      const d = decisions.get(decisionId);
      if (!d || d.ownerEmail.toLowerCase() !== ownerEmail.toLowerCase()) return null;
      return { ...d };
    },
    async updateReminderDecisionAction(ownerEmail, decisionId, action, deliveryResult) {
      const d = decisions.get(decisionId);
      if (d && d.ownerEmail.toLowerCase() === ownerEmail.toLowerCase()) {
        d.action = action;
        if (deliveryResult !== undefined) d.deliveryResult = deliveryResult;
      }
    },
    async claimPendingReminder(ownerEmail, decisionId, deliveredAt = new Date().toISOString()) {
      const d = decisions.get(decisionId);
      if (!d || d.ownerEmail.toLowerCase() !== ownerEmail.toLowerCase() || d.action !== "pending_approval") return false;
      d.action = "requested";
      d.deliveryResult = "Claimed for delivery";
      d.deliveredAt = deliveredAt;
      return true;
    },
    async rejectPendingReminder(ownerEmail, decisionId, reason = "Rejected by owner") {
      const d = decisions.get(decisionId);
      if (!d || d.ownerEmail.toLowerCase() !== ownerEmail.toLowerCase() || d.action !== "pending_approval") return false;
      d.action = "skipped";
      d.deliveryResult = reason;
      return true;
    },
    async listEnabledReminderOwners() {
      return [...rules.values()].filter((rule) => rule.enabled).map((rule) => rule.ownerEmail);
    },
  };
}

// Global in-memory singleton for shared dev / serverless lifespan
let globalMemoryStore: Person1Store | null = null;

export function getPerson1Store(): Person1Store {
  if (process.env.DATABASE_URL) {
    // Loaded lazily to keep unit tests and browser-adjacent imports free of database setup.
    const { getPostgresPerson1Store } = require("./person1-postgres-store") as typeof import("./person1-postgres-store");
    return getPostgresPerson1Store();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required for persistent Person 1 storage.");
  }
  if (!globalMemoryStore) {
    globalMemoryStore = createMemoryPerson1Store();
  }
  return globalMemoryStore;
}
