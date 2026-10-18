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

export interface Person1Store {
  // Scans
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
  saveApprovedDebts(debts: ApprovedDebtRecord[]): Promise<void>;
  getApprovedDebts(ownerEmail: string): Promise<ApprovedDebtRecord[]>;
  getApprovedDebtByHandoffKey(ownerEmail: string, handoffKey: string): Promise<ApprovedDebtRecord | null>;

  // Reminder Rules & Decisions
  getReminderRules(ownerEmail: string): Promise<ReminderRuleRecord>;
  setReminderRules(rules: ReminderRuleRecord): Promise<void>;
  saveReminderDecision(decision: ReminderDecision): Promise<void>;
  listReminderDecisions(ownerEmail: string, limit?: number): Promise<ReminderDecision[]>;
  getReminderDecision(ownerEmail: string, decisionId: string): Promise<ReminderDecision | null>;
  updateReminderDecisionAction(ownerEmail: string, decisionId: string, action: ReminderDecision["action"], deliveryResult?: string): Promise<void>;
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
      const updated: CustomerRecord = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      customers.set(custKey(ownerEmail, customerId), updated);
      return { ...updated };
    },
    async confirmCustomer(ownerEmail, customerId) {
      return this.updateCustomer(ownerEmail, customerId, {
        confirmedAt: new Date().toISOString(),
      });
    },

    async saveApprovedDebts(newDebts) {
      for (const d of newDebts) {
        approvedDebts.set(d.id, { ...d });
      }
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
    async getApprovedDebtByHandoffKey(ownerEmail, handoffKey) {
      for (const d of approvedDebts.values()) {
        if (d.ownerEmail.toLowerCase() === ownerEmail.toLowerCase() && d.handoffKey === handoffKey) {
          return { ...d };
        }
      }
      return null;
    },

    async getReminderRules(ownerEmail) {
      const existing = rules.get(ownerEmail.toLowerCase());
      if (existing) return { ...existing };
      return {
        ownerEmail,
        ...DEFAULT_PERSON1_RULES,
        updatedAt: new Date().toISOString(),
      };
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
    async listReminderDecisions(ownerEmail, limit = 100) {
      const result: ReminderDecision[] = [];
      for (const d of decisions.values()) {
        if (d.ownerEmail.toLowerCase() === ownerEmail.toLowerCase()) {
          result.push({ ...d });
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
  };
}

// Global in-memory singleton for shared dev / serverless lifespan
let globalMemoryStore: Person1Store | null = null;

export function getPerson1Store(): Person1Store {
  if (!globalMemoryStore) {
    globalMemoryStore = createMemoryPerson1Store();
  }
  return globalMemoryStore;
}
