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
- Every must-have works end to end before any nice-to-have starts: Scan → Collect → Chase → Ledger.
- One look across all screens. Real-looking example data, loading and error states, no dead buttons.
- Check UI changes in a browser before calling them done.

## Folders (one owner each, shared code in `lib/`)
- `app/scan` (Bryan): photo to clean rows, with a fix-up screen
- `app/collect` + `lib/paypal.ts` (Teammate 2): invoices and payment status
- `lib/chase` (Bryan): reminder agent
- `app/ledger` (Teammate 3): AG Grid dashboard
