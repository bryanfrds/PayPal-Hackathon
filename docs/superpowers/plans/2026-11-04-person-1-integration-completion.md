# Person 1 Integration Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Person 1's PDF responsibilities end to end by connecting the existing scanning, customer, approved-debt, and reminder backends to the real application journey.

**Architecture:** Keep the existing Person 1 domain services and authenticated API routes. Make the browser retain server scan/entry identities, persist every review decision through those APIs, and pass only server-approved debt records into Person 2's invoice flow. Replace the separate browser-only reminder configuration with the existing persistent Person 1 rules and activity APIs.

**Tech Stack:** Next.js App Router, TypeScript, React 19, Vitest, Vercel Blob, Neon PostgreSQL, Vercel AI SDK, PayPal Invoicing API.

**Spec:** `docs/superpowers/specs/2026-10-18-person-1-backend-design.md`

## Why This Plan Exists

The Person 1 backend is largely implemented and its focused tests pass, but the deployed user journey bypasses several of its contracts:

- The scan screen reads extracted entries from `/api/scans`, then turns corrected lines directly into browser-local debts.
- Corrections, exclusions, customer confirmations, and approved-debt handoffs are not called by the scan UI.
- Person 2's invoice route does not consume `ApprovedDebtRecord` or `handoffKey`.
- The reminder screens use a browser-side rule store while the scheduled job reads server-side Person 1 rules.
- Duplicate warnings are returned by the upload API but discarded by the scan client.
- Scheduler skips are not persisted in the activity audit log.

## Chosen Approach

Use the existing server APIs as the single authority and add only the missing adapters and lookups.

Alternatives considered:

1. **Recommended: connect the existing contracts.** Smallest safe change, preserves the tested backend, and prevents browser data from becoming financial authority.
2. **Rewrite the Person 1 backend around the browser stores.** Rejected because local storage cannot support cron jobs, cross-device recovery, or safe financial handoff.
3. **Replace everything with one large scan-to-invoice endpoint.** Rejected because it would combine review, customer confirmation, invoice approval, and PayPal delivery into one risky transaction.

## Global Constraints

- Extracted entries remain drafts until explicit owner approval.
- Monetary values remain positive integer sen values; never trust browser-provided invoice amounts.
- Every owner-scoped route must call `requireOwner()` and scope all reads and writes by `owner.email`.
- Duplicate uploads, debt handoffs, scheduled jobs, and delivery requests remain idempotent.
- `DATABASE_URL` and private Blob storage are required for production Person 1 persistence.
- Do not add dependencies; use the existing API, validation, database, and test utilities.
- Complete the notebook journey before adding more receipt-scanning behavior or AI recommendations.
- Person 2 must review changes to `app/api/invoices/route.ts`; Person 3 must review scan, collect, customer, and reminder screen changes.
- Work from `dev` on a feature branch and open the PR into `dev`; do not commit this implementation directly to `main`.

## Review Focus

1. **Reload or network failure during review:** saved server corrections must survive, and retrying must not duplicate debts or invoices.
2. **Duplicate photo submission:** return the existing scan without creating a second Blob, extraction, or draft set, and show the warning in the UI.
3. **Customer contact change after confirmation:** invalidate confirmation and prevent invoice approval until the owner confirms the changed record.
4. **Concurrent reminder jobs:** only one delivery claim may win, while skips remain auditable without counting as delivery attempts.
5. **Production without persistence:** fail configuration checks clearly instead of silently relying on serverless memory.

---

### Task 1: Preserve Server Scan and Entry Identity in the Review UI

**Files:**
- Modify: `lib/scan.ts`
- Modify: `lib/scan-client.ts`
- Modify: `lib/scan.test.ts`
- Modify: `lib/scan-client.test.ts`
- Modify: `app/scan/ScanFlow.tsx`

**Interfaces:**
- Produces: `ScanLine.entryId: string`, `ReadResult.scanId`, `ReadResult.isDuplicate`, and `ReadResult.warning`.
- Produces: `patchScanEntry(scanId, entryId, patch, fetchImpl?)` for saving review changes.
- Consumes: existing `PATCH /api/scans/[id]/entries/[entryId]`.

- [ ] **Step 1: Write failing conversion and client tests**

Assert that `entriesToLines()` preserves each backend entry ID, upload parsing preserves duplicate metadata, and `patchScanEntry()` sends `amountSen`, `included`, `isAmbiguous`, `customerName`, `item`, and `date` to the correct authenticated route.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npx vitest run lib/scan.test.ts lib/scan-client.test.ts`

Expected: FAIL because scan lines and client results do not preserve the new server fields.

- [ ] **Step 3: Implement the minimal client contract**

Use the extracted entry's real `id` instead of generated keys such as `l1`. Keep UI-only state separate from the server identity. Do not add a new state-management library.

- [ ] **Step 4: Persist notebook review changes before local navigation**

Make the notebook save action PATCH every changed or excluded entry. If any PATCH fails, keep the review screen and local draft intact and show a retryable error. Do not create local debts until all server changes succeed.

- [ ] **Step 5: Verify the focused tests**

Run: `npx vitest run lib/scan.test.ts lib/scan-client.test.ts app/api/scans/scans.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/scan.ts lib/scan-client.ts lib/scan.test.ts lib/scan-client.test.ts app/scan/ScanFlow.tsx
git commit -m "feat: persist scanned entry reviews"
```

---

### Task 2: Make Duplicate Upload Handling Persistent and Visible

**Files:**
- Modify: `app/api/scans/route.ts`
- Modify: `app/api/scans/scans.test.ts`
- Modify: `lib/scan-client.ts`
- Modify: `app/scan/ScanFlow.tsx`

**Interfaces:**
- Produces on duplicate: `{ scan, entries, isDuplicate: true, warning }` using the original scan.
- Consumes: `Person1Store.findScanByHash(ownerEmail, imageHash)` and `getEntriesByScan(...)`.

- [ ] **Step 1: Write a failing duplicate-upload API test**

Upload identical bytes twice and assert that the second request returns the first scan ID, does not call `saveScanImage()` again, does not run extraction again, and does not create another draft set.

- [ ] **Step 2: Run the scan API test and verify failure**

Run: `npx vitest run app/api/scans/scans.test.ts`

Expected: FAIL because the current route creates a second scan and extraction.

- [ ] **Step 3: Return the existing scan on a duplicate**

Perform hash detection before Blob storage. If the existing scan failed, return it with a retry action; otherwise return its current-revision entries and HTTP 200.

- [ ] **Step 4: Show the duplicate warning in the scan UI**

Display a non-blocking warning that the existing scan was reopened. Do not silently drop `isDuplicate` or `warning` in `scan-client.ts`.

- [ ] **Step 5: Verify duplicate behavior**

Run: `npx vitest run app/api/scans/scans.test.ts lib/scan-client.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/scans/route.ts app/api/scans/scans.test.ts lib/scan-client.ts app/scan/ScanFlow.tsx
git commit -m "fix: reopen duplicate scans safely"
```

---

### Task 3: Complete Customer Matching and Confirmation

**Files:**
- Modify: `lib/scan-client.ts`
- Modify: `app/scan/ScanFlow.tsx`
- Modify: `app/api/customers/[id]/route.ts`
- Modify: `app/api/customers/customers.test.ts`
- Modify: `lib/person1-store.ts`
- Modify: `lib/person1-postgres-store.ts`

**Interfaces:**
- Produces client calls for customer listing, creation, suggestions, updates, and confirmation using the existing routes.
- Produces customer update behavior that recomputes `slug` after a name change and clears `confirmedAt` after a name, email, or phone change.
- Consumes: `GET /api/entries/[id]/customer-suggestions` and `POST /api/entries/[id]/confirm-customer`.

- [ ] **Step 1: Write failing customer invalidation tests**

Assert that changing a confirmed customer's identity or contact data clears `confirmedAt`, changing the name recomputes the slug, and unchanged fields preserve confirmation.

- [ ] **Step 2: Run the customer tests and verify failure**

Run: `npx vitest run app/api/customers/customers.test.ts lib/person1-store.test.ts lib/person1-postgres-store.test.ts`

Expected: FAIL on confirmation invalidation and slug recomputation.

- [ ] **Step 3: Implement customer update invalidation**

Keep the logic in the customer update path shared by memory and PostgreSQL stores. A cleared confirmation is sufficient to block handoff; linked entry IDs may remain for re-confirmation.

- [ ] **Step 4: Connect matching to the scan review UI**

For each included notebook entry, show ranked server suggestions, allow selecting or creating a customer, collect the email needed by PayPal, and call the explicit confirmation endpoint. Preserve unresolved entries as drafts rather than silently converting them to debts.

- [ ] **Step 5: Verify matching and confirmation**

Run: `npx vitest run app/api/customers/customers.test.ts lib/customer-matching.test.ts lib/debt-handoff.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/scan-client.ts app/scan/ScanFlow.tsx app/api/customers/[id]/route.ts app/api/customers/customers.test.ts lib/person1-store.ts lib/person1-postgres-store.ts
git commit -m "feat: connect scan customer confirmation"
```

---

### Task 4: Connect Approved Debts to Person 2's Invoice Workflow

**Files:**
- Modify: `lib/person1-store.ts`
- Modify: `lib/person1-postgres-store.ts`
- Modify: `lib/person1-store.test.ts`
- Modify: `lib/person1-postgres-store.test.ts`
- Create: `app/api/debts/approved/route.ts`
- Create: `app/api/debts/approved/route.test.ts`
- Modify: `app/api/invoices/route.ts`
- Modify: `app/api/invoices/route.test.ts`
- Modify: `app/collect/CollectFlow.tsx`

**Interfaces:**
- Produces: `Person1Store.getApprovedDebt(ownerEmail, approvedDebtId)`.
- Produces: authenticated `GET /api/debts/approved` for the owner's handoff queue.
- Produces: invoice request `{ approvedDebtId: string }`; the server obtains customer, amount, currency, item, and source data from `ApprovedDebtRecord`.
- Consumes: existing `approveDebtsForInvoicing(ownerEmail, entryIds, store)`.

- [ ] **Step 1: Write failing store and approved-queue tests**

Assert owner isolation, stable IDs, and that only the signed-in owner's approved debts are returned.

- [ ] **Step 2: Run the new tests and verify failure**

Run: `npx vitest run lib/person1-store.test.ts lib/person1-postgres-store.test.ts app/api/debts/approved/route.test.ts`

Expected: FAIL because the lookup and route do not exist.

- [ ] **Step 3: Implement the minimal approved-debt lookup and route**

Reuse the existing repository; do not introduce a second handoff table or queue abstraction.

- [ ] **Step 4: Write failing invoice authority tests**

Assert that invoice creation rejects unknown, wrong-owner, ambiguous, or unapproved debt IDs and ignores any conflicting amount/email supplied by the browser. Assert retrying the same approved debt does not create another invoice.

- [ ] **Step 5: Update Person 2's invoice route**

Resolve the approved debt server-side and use its stable ID as the idempotency source. Preserve manual-debt invoicing only through an explicit, separately validated request shape.

- [ ] **Step 6: Connect the Collect screen**

Load approved debts from the server, show them for explicit invoice approval, and send only `approvedDebtId` to the invoice route.

- [ ] **Step 7: Verify the handoff**

Run: `npx vitest run app/api/debts/approve/route.test.ts app/api/debts/approved/route.test.ts app/api/invoices/route.test.ts lib/debt-handoff.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/person1-store.ts lib/person1-postgres-store.ts lib/person1-store.test.ts lib/person1-postgres-store.test.ts app/api/debts/approved app/api/invoices/route.ts app/api/invoices/route.test.ts app/collect/CollectFlow.tsx
git commit -m "feat: invoice only approved scanned debts"
```

---

### Task 5: Unify Reminder Rules and Activity on the Server

**Files:**
- Modify: `lib/reminder-store.ts`
- Modify: `lib/reminder-store.test.ts`
- Modify: `app/reminders/rules/RulesScreen.tsx`
- Modify: `app/reminders/RemindersScreen.tsx`
- Modify: `app/api/reminder-rules/route.ts`
- Modify: `app/api/reminders/reminders.test.ts`
- Modify: `lib/person1-store.ts`
- Modify: `lib/person1-postgres-store.ts`

**Interfaces:**
- Produces: API-backed `getRules()`, `saveRules(rules)`, and `getActivity(limit)` adapters.
- Produces: `Person1Store.ensureReminderRules(ownerEmail)` that persistently inserts defaults once.
- Consumes: `/api/reminder-rules` and `/api/reminders/activity`.

- [ ] **Step 1: Write failing API-backed reminder-store tests**

Assert correct mapping between UI names and server names: `everyDays` to `minIntervalDays`, `maxCount` to `maxAttempts`, enabled state, approval state, and send hour.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run lib/reminder-store.test.ts app/api/reminders/reminders.test.ts`

Expected: FAIL because the current reminder UI store is browser-only.

- [ ] **Step 3: Replace browser-only rule authority with API adapters**

The UI may cache the last successful response for resilience, but the server remains authoritative. Failed saves must remain visibly retryable.

- [ ] **Step 4: Persist default rules for active owners**

Call `ensureReminderRules()` when an owner approves their first debt and when reminder settings are first loaded. This ensures the cron owner list includes users who accept default rules.

- [ ] **Step 5: Use server activity in the reminder history**

Render scheduler decisions from `/api/reminders/activity`; keep local UI-only actions clearly separate from server delivery history.

- [ ] **Step 6: Verify reminder rule integration**

Run: `npx vitest run lib/reminder-store.test.ts app/api/reminders/reminders.test.ts app/reminders/reminder-board.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/reminder-store.ts lib/reminder-store.test.ts app/reminders app/api/reminder-rules/route.ts app/api/reminders/reminders.test.ts lib/person1-store.ts lib/person1-postgres-store.ts
git commit -m "feat: persist reminder rules and activity"
```

---

### Task 6: Correct Reminder Attempt Accounting and Audit Skips

**Files:**
- Modify: `lib/reminder-scheduler.ts`
- Modify: `lib/reminder-scheduler.test.ts`
- Modify: `lib/person1-types.ts`
- Modify: `lib/person1-store.ts`
- Modify: `lib/person1-postgres-store.ts`
- Modify: `app/api/reminders/reminders.test.ts`
- Modify: `vercel.json`

**Interfaces:**
- Produces: persisted, idempotent per-invoice skip decisions.
- Defines delivery attempts as `requested` or `failed`; `skipped`, rejected, and `pending_approval` do not consume `maxAttempts` until delivery is claimed.
- Keeps `claimReminderRequest(decision)` as the atomic delivery guard.

- [ ] **Step 1: Replace incorrect scheduler expectations with failing behavior tests**

Assert that a persisted policy skip appears in activity but does not increment the next delivery attempt, a failed PayPal call does increment it, and repeated hourly jobs create at most one identical skip record per invoice/day/reason.

- [ ] **Step 2: Run the scheduler tests and verify failure**

Run: `npx vitest run lib/reminder-scheduler.test.ts app/api/reminders/reminders.test.ts`

Expected: FAIL because the scheduler currently counts every decision and does not save ordinary skips.

- [ ] **Step 3: Implement attempt filtering and skip persistence**

Use stable keys such as `skip:<owner>:<invoice>:<reason-code>:<YYYY-MM-DD>`. Do not persist global hourly skips such as "outside configured hour" for every owner, because those are job-control events rather than invoice decisions.

- [ ] **Step 4: Simplify cron configuration**

Replace the 24 equivalent entries with one hourly entry using `0 * * * *`. The scheduler already converts to `Asia/Kuala_Lumpur` and enforces each owner's `sendHour`.

- [ ] **Step 5: Verify scheduler behavior**

Run: `npx vitest run lib/reminder-scheduler.test.ts app/api/reminders/reminders.test.ts app/api/reminders/delivery.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/reminder-scheduler.ts lib/reminder-scheduler.test.ts lib/person1-types.ts lib/person1-store.ts lib/person1-postgres-store.ts app/api/reminders/reminders.test.ts vercel.json
git commit -m "fix: audit reminder decisions correctly"
```

---

### Task 7: Preserve Corrections Across Rescans and Allow Source Review

**Files:**
- Modify: `app/api/scans/[id]/rescan/route.ts`
- Modify: `app/api/scans/scans.test.ts`
- Create: `app/api/scans/[id]/image/route.ts`
- Create: `app/api/scans/[id]/image/route.test.ts`
- Modify: `app/scan/ScanFlow.tsx`

**Interfaces:**
- Produces: authenticated `GET /api/scans/[id]/image` that streams the private image only to its owner.
- Produces: rescan results that preserve owner-edited fields when a new entry has the same `sourceRef.lineIndex`; unmatched new lines remain new drafts.

- [ ] **Step 1: Write failing rescan preservation tests**

Correct an amount, customer name, inclusion flag, and confirmed customer; rescan; then assert matching lines retain those owner decisions while keeping the new revision and raw extraction metadata.

- [ ] **Step 2: Write failing image authorization tests**

Assert 200 for the owner, 404 for an unknown scan, and no image bytes for another owner or signed-out request.

- [ ] **Step 3: Run the tests and verify failure**

Run: `npx vitest run app/api/scans/scans.test.ts app/api/scans/[id]/image/route.test.ts`

Expected: FAIL because rescan currently replaces corrections and no image route exists.

- [ ] **Step 4: Implement line-based correction reconciliation**

Reuse `sourceRef.lineIndex`; do not introduce fuzzy matching until real examples demonstrate that line ordering changes frequently. Mark preserved values as `ownerEdited: true`.

- [ ] **Step 5: Implement owner-only image retrieval**

Look up the owner-scoped scan first, then call `getScanImage(owner.email, scan.imageKey)`. Return the stored MIME type and private/no-store cache headers.

- [ ] **Step 6: Use the server image when reopening a saved scan**

Keep the immediate local preview for speed, but use the authenticated route after reload or recovery.

- [ ] **Step 7: Verify scan recovery**

Run: `npx vitest run app/api/scans/scans.test.ts app/api/scans/[id]/image/route.test.ts lib/image-storage.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/scans app/scan/ScanFlow.tsx
git commit -m "feat: preserve scan review across rescans"
```

---

### Task 8: Add Realistic Acceptance Fixtures and Production Configuration Checks

**Files:**
- Create: `test/fixtures/scans/clear-notebook.jpg`
- Create: `test/fixtures/scans/ambiguous-notebook.jpg`
- Modify: `lib/person1-fixtures.test.ts`
- Modify: `lib/vision-extractor.test.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: deterministic tests that read real image bytes while mocking only the external model response.
- Produces: an optional live smoke test enabled only when explicit test credentials are provided.

- [ ] **Step 1: Add sanitized notebook image fixtures**

Use synthetic names and amounts only. Include one clear page and one page with a missing date, similar names, a crossed-out line, a repayment, and an ambiguous amount.

- [ ] **Step 2: Test that actual fixture bytes reach the vision provider**

Assert MIME type, non-empty image bytes, schema validation, classifications, missing-date ambiguity, and draft-only output.

- [ ] **Step 3: Add a gated live extraction smoke test**

Skip unless a dedicated flag and AI credential are present. It must never run in normal CI or send real customer data.

- [ ] **Step 4: Document production requirements**

Clarify that `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, AI Gateway credentials/OIDC, and `CRON_SECRET` are required for the complete Person 1 production journey, even if other parts of the app have local fallbacks.

- [ ] **Step 5: Run Person 1 verification**

Run:

```bash
npx vitest run lib/person1-fixtures.test.ts lib/vision-extractor.test.ts lib/image-storage.test.ts app/api/scans/scans.test.ts app/api/customers/customers.test.ts app/api/debts/approve/route.test.ts app/api/reminders/reminders.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0; live smoke test is explicitly skipped without its flag.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/scans lib/person1-fixtures.test.ts lib/vision-extractor.test.ts .env.example README.md
git commit -m "test: verify Person 1 journey with image fixtures"
```

---

### Task 9: Close Remaining Integration Review Findings

**Files:**
- Modify: `lib/scan.ts`
- Modify: `lib/scan.test.ts`
- Modify: `app/scan/ScanFlow.tsx`
- Modify: `app/api/scans/route.ts`
- Modify: `app/api/scans/scans.test.ts`
- Modify: `lib/person1-store.ts`
- Modify: `lib/person1-store.test.ts`
- Modify: `lib/person1-postgres-store.ts`
- Modify: `lib/person1-postgres-store.test.ts`
- Modify: `lib/reminder-scheduler.ts`
- Modify: `lib/reminder-scheduler.test.ts`
- Create: `db/migrations/007_scan_and_pending_uniqueness.sql`

**Interfaces:**
- Produces a versioned active-scan session record containing `scanId`, `mode`, and review lines so a refresh reopens the authenticated source image and current draft.
- Produces `Person1Store.claimScan(scan): Promise<boolean>` backed by unique `(owner_email, image_hash)` storage.
- Produces per-invoice reminder state containing delivery-attempt count, latest delivery time, and whether an approval is already pending.
- Requires `DATABASE_URL` whenever `NODE_ENV=production`; the memory store remains development/test-only.

- [x] **Step 1: Write failing scan recovery and simultaneous-upload tests**

Assert active-scan parsing rejects malformed records and preserves a valid scan identity/draft. Run two byte-identical uploads concurrently and assert both return the same scan ID while image storage and extraction happen once.

- [x] **Step 2: Run the scan tests and verify failure**

Run: `npx vitest run lib/scan.test.ts app/api/scans/scans.test.ts`

Expected: FAIL because only line data is persisted and duplicate detection is a non-atomic read-before-write.

- [x] **Step 3: Implement active-scan recovery and atomic scan claiming**

Persist one versioned active record per scan mode, restore it in `ScanFlow`, and use the authenticated scan image after refresh. Claim the scan row before Blob storage/extraction; a losing request returns the winning scan and its entries without performing either operation.

- [x] **Step 4: Write failing reminder-history and pending-approval tests**

Assert an invoice with more than 1,000 newer unrelated decisions still observes its attempt count and interval. Assert scheduler runs on later days keep exactly one pending approval per invoice.

- [x] **Step 5: Run the reminder tests and verify failure**

Run: `npx vitest run lib/reminder-scheduler.test.ts lib/person1-store.test.ts lib/person1-postgres-store.test.ts`

Expected: FAIL because the scheduler reads only 1,000 rows and pending idempotency keys change by day.

- [x] **Step 6: Implement per-invoice reminder state and pending uniqueness**

Query only the candidate invoice IDs, aggregate requested/failed attempt counts and latest times in PostgreSQL, and flag existing pending approvals. Enforce one pending row per owner/invoice in both stores and with a partial unique index.

- [x] **Step 7: Write and pass the production persistence test**

Assert `getPerson1Store()` throws a clear configuration error when `NODE_ENV=production` and `DATABASE_URL` is absent, while test/development still use memory.

- [x] **Step 8: Run focused and full verification**

Run the focused tests after each fix, then `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`.

- [x] **Step 9: Commit**

```bash
git add app/scan/ScanFlow.tsx app/api/scans/route.ts app/api/scans/scans.test.ts lib/scan.ts lib/scan.test.ts lib/person1-store.ts lib/person1-store.test.ts lib/person1-postgres-store.ts lib/person1-postgres-store.test.ts lib/reminder-scheduler.ts lib/reminder-scheduler.test.ts db/migrations/007_scan_and_pending_uniqueness.sql docs/superpowers/plans/2026-11-04-person-1-integration-completion.md
git commit -m "fix: close remaining Person 1 integration findings"
```

---

## Final End-to-End Acceptance

- [ ] Upload a real notebook image and receive only draft entries.
- [ ] Reload the review and still see the private source image and saved corrections.
- [ ] Correct an uncertain amount and exclude a crossed-out or repayment line.
- [ ] Resolve a similar customer name and explicitly confirm valid contact details.
- [ ] Approve selected entries and see stable `ApprovedDebtRecord` IDs.
- [ ] Create PayPal invoices using only those approved IDs.
- [ ] Retry the approval and invoice actions without duplicate records or invoices.
- [ ] Upload the same image again and reopen the existing scan with a visible warning.
- [ ] Change reminder rules in the UI and verify the cron reads the same persisted values.
- [ ] Pay an invoice and verify the scheduler records a skip without requesting delivery.
- [ ] Run concurrent reminder jobs and verify only one delivery request is claimed.
- [ ] Confirm reminder activity shows requested, failed, pending, rejected, and meaningful skipped decisions.

Final commands:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

## Nice-to-Haves After All Acceptance Checks Pass

1. Store model-provided bounding boxes and highlight the matching image crop when an entry is selected.
2. Show a before/after diff for changed extraction results after a rescan.
3. Add operational metrics for extraction latency, ambiguity rate, owner correction rate, and scheduler outcomes.
4. Add a scheduler health panel showing the last successful cron run and processed-owner count.
5. Add AI explanations or recommendations for reminder eligibility, as deferred by the PDF.
6. Resume receipt-specific extraction improvements only after the notebook-to-invoice-to-reminder journey passes end to end.

## Explicit Non-Goals

- No automatic invoice creation directly from extraction.
- No automatic customer confirmation based only on a fuzzy match.
- No new queue, event-bus, state-management, or database dependency.
- No custom OCR or matching framework unless production evidence shows the existing vision and token matching are insufficient.
- No expansion of receipt scanning while the notebook must-haves remain incomplete.
