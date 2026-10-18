# Person 1 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Person 1's backend subsystems for notebook scanning & extraction, draft management, customer matching directory, approved debt handoff, and reminder orchestration scheduler with full test coverage.

**Architecture:** Domain logic isolated in `lib/` modules with pluggable dual-tier persistence (in-memory test store + Postgres Neon DB). Restful authenticated endpoints under `app/api/`. Deterministic fixture-based vision extraction with Vercel AI SDK integration. Safe reminder execution delegating to Person 2's PayPal reminder functions.

**Tech Stack:** Next.js App Router (TypeScript), Node.js, Vitest, Vercel AI SDK (`ai`), Zod, Neon Postgres (`@neondatabase/serverless`).

**Spec:** `docs/superpowers/specs/2026-10-18-person-1-backend-design.md`

## Global Constraints
- Target branch is `feature/person-1-scanning-import-reminders`, based on `dev`.
- All monetary values stored and calculated in whole sen (integer minor units).
- Extracted entries are strictly drafts — no financial action without explicit owner approval.
- Zero-dependency testing: tests must pass without external database or AI API key configured.
- Replay and retry safety: handoffs and scheduled reminders use deterministic idempotency keys.

## Review Focus
1. **Oversized and malformed image uploads:** Files larger than 10MB or unsupported MIME types are rejected with HTTP 413/415 before buffering into memory.
2. **Ambiguous and crossed-out entry classifications:** Hand-written notes with strikeouts or uncertain amounts are flagged and barred from handoff until reviewed.
3. **Duplicate scan submissions:** Resubmitting identical photo bytes flags existing scan instead of producing duplicate draft entries.
4. **Customer contact change invalidation:** Editing customer details or email after draft association invalidates earlier matching and requires re-verification.
5. **Reminder race condition & Friday prayer suppression:** Concurrent reminder executions cannot send duplicate notifications, and reminders scheduled for Friday 12:00-14:59 are postponed to 15:00.

---

### Task 1: Domain Entities & Pluggable Storage (`Person1Store`)

**Files:**
- Create: `lib/person1-types.ts`
- Create: `lib/person1-store.ts`
- Create: `lib/person1-store.test.ts`
- Create: `db/migrations/004_person1_tables.sql`

**Interfaces:**
- Produces: `Person1Store` interface, `createMemoryPerson1Store()`, `createPostgresPerson1Store()`, and types `ScanRecord`, `ExtractedEntry`, `CustomerRecord`, `ApprovedDebtRecord`, `ReminderRuleRecord`, `ReminderDecision`.

- [ ] **Step 1: Write unit tests for memory store CRUD operations**
- [ ] **Step 2: Run vitest to verify failure**
- [ ] **Step 3: Implement domain types, memory store, and Postgres SQL migration**
- [ ] **Step 4: Run vitest to verify passes**
- [ ] **Step 5: Commit changes**

---

### Task 2: Private Image Storage Engine

**Files:**
- Create: `lib/image-storage.ts`
- Create: `lib/image-storage.test.ts`

**Interfaces:**
- Produces: `saveScanImage(ownerEmail, fileBytes, mimeType)`, `getScanImage(ownerEmail, imageKey)`, `deleteScanImage(ownerEmail, imageKey)`, `computeImageHash(bytes)`.

- [ ] **Step 1: Write unit tests for MIME validation, file size limit (10MB), hashing, and owner access isolation**
- [ ] **Step 2: Run vitest to verify failure**
- [ ] **Step 3: Implement image storage engine using local private directory storage with SHA-256 hash detection**
- [ ] **Step 4: Run vitest to verify passes**
- [ ] **Step 5: Commit changes**

---

### Task 3: Vision Extraction & Edge Case Classification

**Files:**
- Create: `lib/vision-extractor.ts`
- Create: `lib/vision-extractor.test.ts`

**Interfaces:**
- Produces: `extractNotebookEntries(imageBytes, mimeType, opts)` returning structured `ExtractedEntry[]` with classifications (`debt`, `repayment`, `crossed_out`, `ambiguous`).

- [ ] **Step 1: Write tests covering legible lines, ambiguous handwriting, crossed-out entries, and partial repayments**
- [ ] **Step 2: Run vitest to verify failure**
- [ ] **Step 3: Implement multimodal vision extractor with AI SDK structured outputs and heuristic test fallback**
- [ ] **Step 4: Run vitest to verify passes**
- [ ] **Step 5: Commit changes**

---

### Task 4: Scans API Endpoints

**Files:**
- Create: `app/api/scans/route.ts`
- Create: `app/api/scans/[id]/route.ts`
- Create: `app/api/scans/[id]/retry/route.ts`
- Create: `app/api/scans/[id]/rescan/route.ts`
- Create: `app/api/scans/[id]/entries/[entryId]/route.ts`
- Create: `app/api/scans/scans.test.ts`

**Interfaces:**
- Consumes: `Person1Store`, `saveScanImage`, `extractNotebookEntries`
- Produces: REST endpoints for scan upload, draft retrieval, retry, rescan revisions, and entry corrections.

- [ ] **Step 1: Write integration tests for `POST /api/scans`, `GET /api/scans/[id]`, retry, rescan, and entry patch**
- [ ] **Step 2: Run vitest to verify failure**
- [ ] **Step 3: Implement the scan route handlers with owner auth check and error handling**
- [ ] **Step 4: Run vitest to verify passes**
- [ ] **Step 5: Commit changes**

---

### Task 5: Customer Directory & Match Suggestions

**Files:**
- Create: `lib/customer-matching.ts`
- Create: `lib/customer-matching.test.ts`
- Create: `app/api/customers/route.ts`
- Create: `app/api/customers/[id]/route.ts`
- Create: `app/api/entries/[id]/customer-suggestions/route.ts`
- Create: `app/api/entries/[id]/confirm-customer/route.ts`
- Create: `app/api/customers/customers.test.ts`

**Interfaces:**
- Produces: `findCustomerSuggestions(draftName, directory)`
- Produces: Endpoints for customer CRUD, suggestions ranking, and explicit confirmation.

- [ ] **Step 1: Write tests for fuzzy name matching, suggestion confidence scoring, and customer confirmation**
- [ ] **Step 2: Run vitest to verify failure**
- [ ] **Step 3: Implement customer matching logic and API routes**
- [ ] **Step 4: Run vitest to verify passes**
- [ ] **Step 5: Commit changes**

---

### Task 6: Approved Debt Handoff Contract Gate

**Files:**
- Create: `lib/debt-handoff.ts`
- Create: `lib/debt-handoff.test.ts`
- Create: `app/api/debts/approve/route.ts`
- Create: `app/api/debts/approve/route.test.ts`

**Interfaces:**
- Produces: `approveDebtsForInvoicing(ownerEmail, entryIds, store)` returning `ApprovedDebtRecord[]` or validation errors.

- [ ] **Step 1: Write tests verifying that unreviewed, ambiguous, unconfirmed, or crossed-out entries are rejected**
- [ ] **Step 2: Run vitest to verify failure**
- [ ] **Step 3: Implement handoff gate with idempotency checks**
- [ ] **Step 4: Run vitest to verify passes**
- [ ] **Step 5: Commit changes**

---

### Task 7: Reminder Rules, Scheduler & Activity Audit Log

**Files:**
- Create: `lib/reminder-scheduler.ts`
- Create: `lib/reminder-scheduler.test.ts`
- Create: `app/api/reminder-rules/route.ts`
- Create: `app/api/reminders/process/route.ts`
- Create: `app/api/reminders/activity/route.ts`
- Create: `app/api/reminders/[id]/approve/route.ts`
- Create: `app/api/reminders/[id]/reject/route.ts`
- Create: `app/api/reminders/reminders.test.ts`

**Interfaces:**
- Produces: `processEligibleReminders(ownerEmail, deps)`
- Produces: Rules endpoints, scheduler process endpoint, activity log, and approval/rejection endpoints.

- [ ] **Step 1: Write tests for overdue checks, interval pacing, max attempts, Friday prayer shifting, and post-payment suppression**
- [ ] **Step 2: Run vitest to verify failure**
- [ ] **Step 3: Implement scheduler and reminder API endpoints**
- [ ] **Step 4: Run vitest to verify passes**
- [ ] **Step 5: Commit changes**

---

### Task 8: End-to-End Person 1 Verification Suite & CI Check

**Files:**
- Create: `lib/person1-fixtures.test.ts`

**Interfaces:**
- Validates the entire flow end-to-end: upload photo -> extract drafts -> correct line -> confirm customer -> approve debt -> scheduler checks -> decision logged.

- [ ] **Step 1: Write comprehensive journey test running the full lifecycle**
- [ ] **Step 2: Execute full test suite (`NODE_ENV=test npm test`)**
- [ ] **Step 3: Verify zero regressions across all 60+ test suites**
- [ ] **Step 4: Commit changes**
