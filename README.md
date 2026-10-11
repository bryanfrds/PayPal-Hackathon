# 555 Buku

Snap your shop's 555 IOU notebook. AI turns every handwritten debt into a PayPal invoice, sends friendly reminders, and shows who still owes you at a glance.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) by a team of three.

## How it works

1. **Scan**: photograph a page of the buku 555; AI reads names, amounts and dates, and you fix anything it misread.
2. **Collect**: one tap sends each customer a PayPal invoice (sandbox while we build); paid invoices tick themselves off.
3. **Chase**: a polite reminder agent follows up, gentler for regulars, firmer when overdue; the owner approves anything unusual.
4. **Ledger**: an AG Grid dashboard of who owes what, overdue first, with totals and filters.

## Getting started

You need Node.js 20.12 or newer (`node -v` to check).

1. Install packages: `npm install`
2. Copy the env template: `cp .env.example .env.local`
3. Fill in the PayPal sandbox keys in `.env.local`. Get them from [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → Sandbox. Also set `PAYPAL_SANDBOX_BUYER_EMAIL` to a sandbox buyer account.
   - **Currency:** invoices use MYR by default, but PayPal only accepts MYR between two Malaysia-country accounts. Create both the sandbox business (seller) and the sandbox personal (buyer) accounts with country **Malaysia**. If you can't, set `PAYPAL_CURRENCY=USD` in `.env.local` as a fallback.
4. Start the app: `npm run dev`, then open http://localhost:3000
5. Send one test invoice: `npm run paypal:test-invoice`. It prints the invoice id and payer link.

Other useful commands: `npm test` (unit tests), `npm run typecheck`, `npm run build`.

## Working on it

See [CLAUDE.md](CLAUDE.md) for the team rules. In short: branch from `dev`, open a PR into `dev`, get it reviewed. `main` only gets `dev` at the end.
