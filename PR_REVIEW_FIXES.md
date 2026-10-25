# PR review fixes

This PR is not ready to merge until every **Must fix**, **Required test**, and **Before merge** item below is complete. Merge the latest `dev` into the current branch first, preserve unrelated work from both branches, and push the fixes back to this same branch for another review.

Coverage checked against both review comments on 2026-10-24. This document records requested work; it does not certify that the implementation, tests, production migrations, or environment variables have been completed.

## Must fix

### 1. Resolve the auth merge conflict safely

Files: `lib/auth.ts`, `lib/auth.test.ts`, and the shared Vitest setup.

- Merge the latest `dev`, including the email sign-in and invoice-ownership work from #50 through #54.
- Preserve both the branch's auth changes and #51's `OWNER_EMAILS=*` wildcard. A configured `*` must allow any valid email to sign in.
- Remove the `|| Boolean(env.VITEST)` test-only bypass from `isAllowedOwner`. Production auth code must not contain a Vitest escape hatch.
- Set `OWNER_EMAILS` explicitly in the test setup (or pass it in each auth test) so tests exercise the same allow-list rules as production.
- Keep the existing local-development behavior for an empty owner list, but an empty production owner list must allow nobody.

Done when wildcard, explicit allow-list, empty-development, and empty-production behavior are covered without checking `VITEST` in application code.

### 2. Prevent a notebook line from being approved twice after a rescan

Files: `lib/debt-handoff.ts`, `lib/vision-extractor.ts`, the Person 1 stores/migrations if needed, and `lib/debt-handoff.test.ts`.

Rescans generate new entry IDs, so the unique key on `(owner_email, source_entry_id)` does not identify the same physical notebook line across revisions. Make approval idempotent by the line's stable identity, such as `(owner, scan, sourceRef.lineIndex)`, or use another design that has the same guarantee. Also reject an entry when `entry.revision !== scan.revision` so stale review screens cannot approve superseded extraction results.

Add a regression test for this exact sequence:

1. Approve line 1 from revision 1.
2. Rescan the same scan, producing revision 2 and new entry IDs.
3. Attempt to approve line 1 again.
4. Assert that only one approved debt represents that notebook line and that the second action is rejected or returns the existing record rather than creating a second debt.

The protection must work in both the memory store and Postgres store.

### 3. Stop request-controlled scan fixtures from reaching real data

Files: `app/api/scans/route.ts`, `app/api/scans/[id]/rescan/route.ts`, `app/api/scans/[id]/retry/route.ts`, and `lib/vision-extractor.ts`.

- Accept `fixtureScenario` only outside production or behind an explicit flag such as `ALLOW_SCAN_FIXTURES=true`.
- Validate the value at runtime against the complete known set:
  - `clear_handwriting`
  - `ambiguous_handwriting`
  - `crossed_out_debt`
  - `partial_repayment`
  - `missing_date`
- Reject an unknown value instead of letting it fall through to the default three fake debtors.
- When fixtures are disabled, a supplied fixture value must never cause synthetic entries to be saved.

Cover create, rescan, and retry routes, including an unknown scenario and a production/disabled-fixture request.

### 4. Remove or correctly wire the dead "already invoiced" guard

File: `lib/debt-handoff.ts` and its tests.

The current guard searches `invoices.debt_ids` for `appr-*` IDs, but that column contains the device ledger debt IDs used by CollectFlow and `/api/invoices`. Therefore the guard never fires in real use.

Choose one honest contract:

- Carry approved-debt IDs through the invoice creation flow and persist them in a dedicated, consistently read field; or
- Remove this guard and delete/replace the test whose mock puts `appr-*` IDs into `debt_ids`.

Do not keep a test-only representation that production never writes. The simpler option is to remove the guard unless blocking edits to invoiced approved debts is a current product requirement.

### 5. Allow manual reminders for invoices missing from the database

Files: `lib/payment-db.ts`, `app/api/invoices/[id]/remind/route.ts`, and `app/api/invoices/[id]/remind/route.test.ts`.

`saveInvoice` is best effort, and older invoices may not have a database row. The manual Remind action must therefore refuse only an invoice that is known to belong to another owner.

- Add `PaymentDb.invoiceExists(invoiceId)`, implemented with `SELECT 1 FROM invoices WHERE id = $1`.
- If `getOwnerInvoice(owner.email, id)` returns the owner's row, send the reminder.
- If it returns `null` and `invoiceExists(id)` is true, return `404 Unknown invoice.` because another owner owns the recorded invoice.
- If both checks return no row, send the reminder as before.
- If there is no payment database, send as before.

Keep the scheduled path conservative: `candidateInvoices` filtered through `listOwnerInvoices` should continue dropping unrecorded invoices.

Add tests for all three database cases: another owner's invoice returns 404, the owner's invoice sends, and an unrecorded invoice sends.

## Required tests

Add or extend tests for all of the following:

- Cron `GET /api/reminders/process`:
  - an unset or empty server-side `CRON_SECRET` returns 401, even if an authorization header is supplied;
  - missing `Authorization` returns 401;
  - a wrong bearer secret returns 401;
  - the correct secret loops over every enabled owner and records an outcome for each owner, including isolated per-owner failures.
- Reminder approval `POST /api/reminders/[id]/approve`:
  - returns 409 when the decision is no longer `pending_approval`;
  - returns 409 when `claimPendingReminder` loses a concurrent claim;
  - does not call the delivery function after either conflict.
- `createPostgresPerson1Store().saveApprovedDebts`:
  - exercise the `ON CONFLICT` path;
  - verify that a conflicting save preserves the existing row's stable ID and applies the intended updates;
  - if implementing the optional stored-row return improvement, verify both concurrent callers receive the same stored ID rather than the losing caller's generated ID.
- Reminder processing with posted `candidateInvoices`:
  - when the request contains an invoice ID belonging to another owner, `listOwnerInvoices(owner)` filtering drops it and it is never scheduled or delivered.
- Rescan approval regression: approve, rescan, approve the same physical line again without producing two approved debts.
- Scan fixtures: known values work only when enabled; unknown or production-disabled values cannot save fake debtors.
- Manual invoice reminder ownership: other owner = 404, current owner = send, no database record = send.

Run the targeted tests while implementing, then run the full verification set:

```text
npm test
npm run typecheck
npm run build
```

## Describe the new behavior in the PR

Update the PR description to call out these additions explicitly:

- The Person 1 Postgres store is selected automatically when `DATABASE_URL` is present.
- Notebook images use private Vercel Blob storage.
- Notebook extraction uses a real vision model through Vercel AI Gateway.
- Authentication and scan endpoints include throttling.
- Vercel invokes the protected cron `GET /api/reminders/process`, which processes all enabled owners.
- `claimPendingReminder` atomically claims a pending reminder before delivery to prevent double sends.

Also describe the ownership and safety behavior added by this fix: current-revision debt approval, fixture gating, owner-scoped scheduled candidates, and manual reminders for unrecorded PayPal invoices.

## Existing behavior to preserve

- `getOwnerInvoice` and `listOwnerInvoices` normalize owner emails consistently with `saveInvoice`. Preserve that normalization when adding `invoiceExists` or extracting a shared mapper.
- Reminder approval claims the decision through `claimPendingReminder` before delivery. Keep this atomic claim alongside the existing 20-hour hold in `lib/remind.ts`; they protect different stages of delivery.
- Automatic reminders remain limited to recorded invoices belonging to the signed-in owner. The allowance for unrecorded invoices applies to manual reminders.

## Nice to fix

- Change `saveApprovedDebts` to return the row actually stored. With `INSERT ... ON CONFLICT ... RETURNING`, two simultaneous first approvals should both receive the same stable approved-debt ID. Update the `Person1Store` interface, memory implementation, Postgres implementation, and callers together.
- Stop routine daily `skipped` reminder decisions from crowding real activity out of the latest 100 rows. Either do not persist routine skips or exclude them from the default activity feed while retaining useful failure and user-action history.
- Share a `toStoredInvoice(row)` mapper and the common invoice column list between `getOwnerInvoice` and `listOwnerInvoices` in `lib/payment-db.ts`.
- Restore `db/migrations/004_person1_tables.sql` exactly to its already-applied form. Keep the approved-debt uniqueness change only in `db/migrations/005_approved_debts_unique_index.sql`; never rewrite an applied migration.
- Change `.env.example` from "hourly reminder cron" to "daily reminder cron" to match `vercel.json` (`0 1 * * *`).

## Before merge

- Confirm against the production database that `schema_migrations` contains both:
  - `004_person1_tables.sql`
  - `005_approved_debts_unique_index.sql`
- Set these variables in the Vercel **Production** environment and redeploy:
  - `CRON_SECRET`
  - `BLOB_READ_WRITE_TOKEN`
  - `AI_GATEWAY_API_KEY`
- Confirm the production cron sends `Authorization: Bearer <CRON_SECRET>` and that the daily schedule is intentional.
- Run the full test, typecheck, and build commands successfully.
- Push the changes to this same branch and request another review before merging into `dev`.

Do not merge if either production migration is missing: routes that select the Postgres store can fail immediately once this version is deployed.
