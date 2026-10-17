// Person 1 domain types and shared interfaces

export type ScanStatus = "pending" | "processing" | "completed" | "failed";

export type ScanRecord = {
  id: string;
  ownerEmail: string;
  imageKey: string;
  imageHash: string;
  mimeType: string;
  sizeBytes: number;
  status: ScanStatus;
  mode: "notebook" | "receipt";
  revision: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type EntryClassification = "debt" | "repayment" | "crossed_out" | "ambiguous";

export type ExtractedEntry = {
  id: string;
  scanId: string;
  revision: number;
  rawText: string;
  customerName: string;
  item: string;
  amountSen: number;
  rawAmountText: string;
  date: string;
  classification: EntryClassification;
  confidence: number;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  included: boolean;
  sourceRef: { lineIndex: number; boundingBox?: [number, number, number, number] };
  ownerEdited: boolean;
  confirmedCustomerId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomerRecord = {
  id: string;
  ownerEmail: string;
  name: string;
  slug: string;
  email?: string;
  phone?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovedDebtRecord = {
  id: string;
  ownerEmail: string;
  sourceEntryId: string;
  scanId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amountSen: number;
  currency: string;
  item: string;
  date: string;
  approvedAt: string;
  handoffKey: string;
};

export type ReminderRuleRecord = {
  ownerEmail: string;
  enabled: boolean;
  firstAfterDays: number;
  minIntervalDays: number;
  maxAttempts: number;
  sendHour: number;
  skipFridayPrayers: boolean;
  requireApproval: boolean;
  updatedAt: string;
};

export type ReminderDecision = {
  id: string;
  ownerEmail: string;
  invoiceId: string;
  action: "skipped" | "pending_approval" | "requested" | "failed";
  reason: string;
  idempotencyKey: string;
  attemptNumber: number;
  deliveryResult?: string;
  createdAt: string;
};
