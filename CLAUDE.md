# 555 Buku: team rules (for people and for Claude Code)

## Branches and PRs
- `main` stays untouched until the project is finished. Never push or merge into `main`.
- All work: branch from `dev`, open a PR into `dev`, and get another teammate (or a reviewer agent) to review it before merging.
- One topic per PR, small commits, clear messages.

## Secrets
- PayPal Client ID/Secret and any AI API keys go in `.env.local` only. Never commit them, never paste them in chat, issues or PRs.
- `.env.example` lists the variable names with empty values.

## PayPal
- Sandbox only while building: API base `https://api-m.sandbox.paypal.com`.
- PayPal must be central to the product (judging pass/fail), not an add-on.
- Use PayPal's official buttons and logos if we show them; don't redraw them.

## Product rules (judging: a complete, coherent product, not a proof of concept)
- Every must-have works end to end before any nice-to-have starts: the whole journey below, from upload to reminders.
- One look across all screens. Real-looking example data, loading and error states, no dead buttons.
- Check UI changes in a browser before calling them done.

## Who owns what (see "Buku: Detailed Team Split")
The journey: upload notebook → review extracted entries → confirm customers → approve invoices → collect payments → track balances → remind unpaid customers.
Agree the shared data model and API contracts before building separately. Each owner writes the code **and the tests** for their area.

- **Person 1: scanning, import backend, reminder orchestration.** Photo upload and private image storage, vision-model extraction into draft entries, corrections and rescans, duplicate imports, the customer-directory backend and name matching, the reminder rules and scheduled job (it calls Person 2's reminder function). Extraction only makes drafts; money actions need owner approval.
- **Person 2: PayPal and financial correctness.** Sandbox accounts, app and webhook setup, `lib/paypal.ts`, creating and sending invoices from approved debts (no duplicates on retry), invoice/payment/balance records, webhook verification and reconciliation, and the safe reminder-delivery function.
- **Person 3 (Bryan): the whole app experience, the ledger and deployment.** Upload and review screens, customer matching screens, invoice approval with per-invoice outcomes and safe retry, the AG Grid ledger and reminder settings/activity views, sign-in, phone layout, deployment, the resettable demo data, README, screenshots, video and submission checklist.

## Milestones
1. **First payment loop:** records and interfaces agreed (P1), one sandbox invoice sent and reconciled (P2), manual debt entry and a minimal ledger (P3).
2. **Scanning connected:** extraction and correction APIs (P1), approved debts accepted for invoicing (P2), upload, review and customer matching joined up (P3).
3. **Collection reliable:** import failures and duplicates (P1), payment states and retries (P2), batch outcomes and recovery controls (P3).
4. **Reminders connected:** eligibility and scheduling (P1), safe delivery (P2), settings and activity views (P3).
5. **Submission ready:** extraction fixtures and scheduler checked (P1), payment edge cases and setup docs (P2), deployment polished and demo coordinated (P3).

Keep optional features deferred (see Product rules); rebalance work after the first payment loop.

Workload: Person 1 has substantial backend and testing work, Person 2 carries the highest financial integration risk, and Person 3 has the widest UI workload.

## Code layout
- Screens under `app/` (Person 3). Server code under `lib/` and `app/api/`: `lib/paypal.ts`, payment records and the PayPal webhook endpoint (Person 2), scanning, import, customers and the scheduler (Person 1).
- Touching another person's area? Ask them first, or tag them on the PR.
