# Person 1 Technical Design: Scanning, Import Backend, Customer Preparation, and Reminder Orchestration

**Author:** Antigravity / Person 1 Backend  
**Date:** 2026-10-18  
**Status:** Approved  
**Target Branch:** `feature/person-1-scanning-import-reminders`  
**Base Branch:** `dev`

---

## 1. Overview & Architectural Goals

Person 1 owns the backend services that turn physical notebook photos into reviewable draft entries, prepare customer matching and explicit confirmation, gate approved debt handoffs to Person 2, and orchestrate safe reminder scheduling.

### Critical Invariants
1. **Draft-Only Gate:** Extracted entries are strictly drafts. No financial action, debt creation, or invoice creation occurs without explicit owner approval.
2. **Replay Safety & Idempotency:** Duplicate uploads, rescans, debt handoffs, and reminder attempts are strictly idempotent.
3. **No Competing Authority:** Person 2 owns PayPal invoices, payments, and balances. Person 1 checks status from Person 2 and calls Person 2's safe reminder function.
4. **Dual-Tier Storage Architecture:** Supports in-memory/file storage for zero-dependency test execution and local development, while supporting Neon PostgreSQL (`DATABASE_URL`) in production.

---

## 2. Data Models & Entities

### 2.1 Scan & Extraction Entities
- **`ScanRecord`**:
  - `id`: string (UUID)
  - `ownerEmail`: string
  - `imageKey`: string (internal path in private storage)
  - `imageHash`: string (SHA-256 hash of image bytes)
  - `mimeType`: string (`image/jpeg`, `image/png`, `image/webp`)
  - `sizeBytes`: number (max 10MB)
  - `status`: `"pending"` | `"processing"` | `"completed"` | `"failed"`
  - `mode`: `"notebook"` | `"receipt"`
  - `revision`: number (starts at 1, increments on rescan)
  - `isDuplicate`: boolean (true if imageHash matches a prior scan for owner)
  - `error`?: string
  - `createdAt`, `updatedAt`: ISO strings

- **`ExtractedEntry`**:
  - `id`: string
  - `scanId`: string
  - `revision`: number
  - `rawText`: string
  - `customerName`: string
  - `item`: string
  - `amountSen`: number (integer minor units)
  - `rawAmountText`: string
  - `date`: string (YYYY-MM-DD)
  - `classification`: `"debt"` | `"repayment"` | `"crossed_out"` | `"ambiguous"`
  - `confidence`: number (0.0 - 1.0)
  - `isAmbiguous`: boolean
  - `ambiguityReason`?: string
  - `included`: boolean
  - `sourceRef`: `{ lineIndex: number; boundingBox?: [number, number, number, number] }`
  - `ownerEdited`: boolean
  - `confirmedCustomerId`?: string

### 2.2 Customer Preparation
- **`CustomerRecord`**:
  - `id`: string
  - `ownerEmail`: string
  - `name`: string
  - `slug`: string (normalized key via `customerSlug`)
  - `email`?: string
  - `phone`?: string
  - `confirmedAt`?: string
  - `createdAt`, `updatedAt`: ISO strings

### 2.3 Approved Debt Handoff
- **`ApprovedDebtRecord`**:
  - `id`: string
  - `ownerEmail`: string
  - `sourceEntryId`: string
  - `scanId`: string
  - `customerId`: string
  - `customerName`: string
  - `customerEmail`: string
  - `amountSen`: number
  - `currency`: string (default `"MYR"`)
  - `item`: string
  - `date`: string
  - `approvedAt`: string
  - `handoffKey`: string (unique per `sourceEntryId + revision`)

### 2.4 Reminder Rules & Scheduling Decisions
- **`ReminderRuleRecord`**:
  - `ownerEmail`: string
  - `enabled`: boolean (default `true`)
  - `firstAfterDays`: number (default `3`)
  - `minIntervalDays`: number (default `4`)
  - `maxAttempts`: number (default `3`)
  - `sendHour`: number (default `10`)
  - `skipFridayPrayers`: boolean (default `true`)
  - `requireApproval`: boolean (default `false`)
  - `updatedAt`: string

- **`ReminderDecision`**:
  - `id`: string
  - `ownerEmail`: string
  - `invoiceId`: string
  - `action`: `"skipped"` | `"pending_approval"` | `"requested"` | `"failed"`
  - `reason`: string
  - `idempotencyKey`: string
  - `attemptNumber`: number
  - `deliveryResult`?: string
  - `createdAt`: string

---

## 3. Storage & Services Architecture

### 3.1 Repository Pattern (`Person1Store`)
`lib/person1-store.ts` defines the interface and implements:
1. `MemoryPerson1Store`: Thread-safe, in-memory repository for unit tests and local dev.
2. `PostgresPerson1Store`: Backed by `db/migrations/004_person1_tables.sql` when `DATABASE_URL` is configured.

### 3.2 Private Image Storage
`lib/image-storage.ts` manages private storage:
- Stores files under `.storage/scans/<owner_hash>/<scan_id>.<ext>`
- Strictly verifies file types (`image/jpeg`, `image/png`, `image/webp`) and size (<= 10MB).
- Enforces owner access control; unauthorized access returns 403/404.

### 3.3 Vision Extraction Engine
`lib/vision-extractor.ts`:
- Multimodal extraction via Vercel AI SDK when `AI_GATEWAY_API_KEY` is present.
- Deterministic heuristic/fixture fallback engine for offline development and reproducible unit tests.
- Classifies:
  - Strike-through / cancelled debts (`crossed_out`).
  - Repayments / partial payments (`repayment`).
  - Ambiguous figures / names (`ambiguous`), flagging `unsure` notes (e.g. "13.50 or 18.50").

### 3.4 Customer Matching Service
`lib/customer-matching.ts`:
- Fuzzy matching between notebook names and confirmed directory records.
- Matches based on exact slug, token prefix, and Levenshtein similarity.
- Ranks suggestions with confidence scores.

### 3.5 Reminder Scheduler Engine
`lib/reminder-scheduler.ts`:
- Evaluates invoice eligibility against owner rules and Person 2 invoice status.
- Skips settled, closed, or pending-payment invoices.
- Applies Friday prayer rule (shifts 12:00-14:59 to 15:00 on Fridays).
- Checks interval gap and maximum attempt limit.
- Manages manual approval queue when `requireApproval: true`.
- Calls Person 2's safe delivery endpoint/function with stable idempotency keys.

---

## 4. API Endpoints

1. **Scans**:
   - `POST /api/scans`: Upload image & extract draft entries.
   - `GET /api/scans/[id]`: Get scan details & draft entries.
   - `POST /api/scans/[id]/retry`: Retry failed extraction.
   - `POST /api/scans/[id]/rescan`: Rescan with new revision while preserving edits.
   - `PATCH /api/scans/[id]/entries/[entryId]`: Update entry values / inclusion / flags.
2. **Customers**:
   - `GET /api/customers`: Get directory.
   - `POST /api/customers`: Create directory customer.
   - `PATCH /api/customers/[id]`: Update customer contact.
   - `GET /api/entries/[id]/customer-suggestions`: Get candidate matches.
   - `POST /api/entries/[id]/confirm-customer`: Link entry to customer.
3. **Approved Debts Handoff**:
   - `POST /api/debts/approve`: Gatekeeper creating `ApprovedDebtRecord` items.
4. **Reminders**:
   - `GET /api/reminder-rules`: Read rules.
   - `PUT /api/reminder-rules`: Update rules.
   - `POST /api/reminders/process`: Run scheduled reminder evaluation batch.
   - `GET /api/reminders/activity`: Fetch decision history & audit log.
   - `POST /api/reminders/[requestId]/approve`: Approve pending reminder.
   - `POST /api/reminders/[requestId]/reject`: Reject pending reminder.

---

## 5. Verification & Testing Matrix

Tests located in:
- `lib/image-storage.test.ts`
- `lib/vision-extractor.test.ts`
- `lib/customer-matching.test.ts`
- `lib/person1-store.test.ts`
- `lib/debt-handoff.test.ts`
- `lib/reminder-scheduler.test.ts`
- `app/api/scans/scans.test.ts`
- `app/api/customers/customers.test.ts`
- `app/api/debts/approve/route.test.ts`
- `app/api/reminders/reminders.test.ts`

Covering all edge cases from Section 2.4:
- Clear handwriting
- Unclear/ambiguous handwriting & amounts
- Missing dates & fallback handling
- Similar names & match suggestions
- Crossed-out debts & repayments
- Duplicate image uploads/imports
- Reminder rules, Friday prayers, idempotency, and post-payment suppression.
