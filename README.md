# 555 Buku

Snap your shop's 555 IOU notebook. AI turns every handwritten debt into a PayPal invoice, plans polite reminders, and shows who still owes you at a glance.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) by a team of three.

**Live app:** https://paypal-hackathon.vercel.app (PayPal sandbox, so no real money moves). Judges: the demo login is in our Devpost submission.

## The problem

Corner shops in Malaysia still run credit on a "buku 555", a small notebook of who owes what. Chasing those debts is awkward, the notebook gets lost or smudged, and there's no easy way for a customer to just pay.

## How it works

1. **Scan**: photograph a page of the notebook. AI reads names, amounts and dates, and the owner checks every line before anything is saved.
2. **Collect**: one tap sends each customer a PayPal invoice. When PayPal says it's paid in full, the debt ticks itself off (checked every minute while the app is open).
3. **Remind**: a reminder schedule from the owner's rules (when to start, how often, how many, and no reminders during Friday prayers), shown on a calendar. On a laptop the owner can drag a reminder to move it. Nudge, an AI assistant, answers questions like "who should I chase this week?" and drafts polite messages.
4. **Ledger and Insights**: an AG Grid ledger of who owes what, overdue first, and an AG Studio dashboard of totals and trends.
5. **Customer page**: a page for each customer's tab: what they owe, monthly bills with due dates, and a way to pay their PayPal invoices.

## Screens

| Screen | What it's for |
|---|---|
| Home | Today's money at a glance: owed, overdue, collected |
| Scan | Photo of the notebook → lines to check → debts |
| Add | Type one debt in by hand |
| Ledger | Every debt in an AG Grid table, with filters and totals |
| Collect | Pick customers and send PayPal invoices, with a result for each one and safe retry |
| Reminders | Upcoming reminders on a Bryntum Scheduler (laptop) or Calendar (phone), and the rules behind them |
| Insights | AG Studio dashboard, including a custom "who owes you" scoreboard |
| Customer tab (`/tab/...`) | The customer's own view, with a way to pay. No sign-in needed |

It works on a phone and on a laptop; laptops get a sidebar and wider layouts.

## Built with

| What | Used for |
|---|---|
| **PayPal** Invoicing API (v2) | Creating and sending invoices, and checking which are paid |
| **Log in with PayPal** | Shop owners can sign in with their PayPal account |
| **AG Grid** | The Ledger and Home tables |
| **AG Studio** | The Insights dashboard and its custom scoreboard widget |
| **Bryntum** Scheduler and Calendar | The reminders view: Scheduler on a laptop (drag a reminder to move it), Calendar on a phone |
| **Vercel AI Gateway** + AI SDK | Nudge, the reminder assistant (Claude Haiku) |
| **Next.js 16** on **Vercel** | The app and its API routes |

## Sign-in

Shop owners sign in with **Log in with PayPal**, or with their email and a code: a 6-character code by email, or a fixed 12-character code set privately for each owner while email sending isn't set up. Only emails on the owner list (`OWNER_EMAILS`), plus the judges' demo login, get in. Sessions are signed cookies that last 7 days. Customers never sign in: their tab page is open to anyone with the link.

## Where things stand

We'd rather be clear about what's real and what's still being connected:

- **Real:** sending PayPal sandbox invoices, checking payment status, reconciling paid debts, sign-in (email and Log in with PayPal), the ledger, insights, the reminders view and Nudge.
- **Being connected:** the scan screen currently uses a fixed sample reading while the vision-model extraction is finished. Reminders are worked out and shown, but not sent yet. The customer page works on the owner's device; showing it on a customer's own phone needs the shared database below.
- **Data:** the ledger is stored on the owner's device (in the browser). There's no shared database yet. On a first visit the app fills in example customers so there's something to try; their invoices go to our own test inboxes.

## Running it yourself

You need Node.js 22 or newer (`node -v` to check).

1. Install packages: `npm install`
2. Copy the env template: `cp .env.example .env.local`
3. Fill in the PayPal sandbox keys in `.env.local`. Get them from [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → Sandbox. Also set `PAYPAL_SANDBOX_BUYER_EMAIL` to a sandbox buyer account.
   - **Currency:** invoices use MYR by default, but PayPal only accepts MYR between two Malaysia-country accounts. Create both the sandbox business (seller) and the sandbox personal (buyer) accounts with country **Malaysia**. If you can't, set `PAYPAL_CURRENCY=USD` in `.env.local` as a fallback.
   - Set `AUTH_SECRET` to any random string of 32+ characters. Every other variable is explained in `.env.example`.
   - Optional, for **Log in with PayPal**: in the same PayPal app, tick *Log in with PayPal*, add `http://localhost:3000/api/auth/paypal/callback` as a return URL (PayPal may only accept https ones; then test it on a deployed copy), and tick the email scope. Without it, use email sign-in.
4. Start the app: `npm run dev`, then open http://localhost:3000. Locally, with the owner list and the Resend key left empty, any email can sign in and the code is printed in the terminal.
5. Send one test invoice: `npm run paypal:test-invoice`. It prints the invoice id and payer link.

Other useful commands: `npm test` (unit tests), `npm run typecheck`, `npm run build`.

## Working on it

See [CLAUDE.md](CLAUDE.md) for the team rules. In short: branch from `dev`, open a PR into `dev`, get it reviewed. `main` only gets `dev` at the end.
