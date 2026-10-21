# 555 Buku

Snap your shop's 555 IOU notebook. AI turns every handwritten debt into a PayPal invoice, plans polite reminders, and shows who still owes you at a glance.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) by a team of three.

**Live app:** https://paypal-hackathon.vercel.app (PayPal sandbox, so no real money moves). Judges: the demo login is in our Devpost submission.

## The problem

Corner shops in Malaysia still run credit on a "buku 555", a small notebook of who owes what. Chasing those debts is awkward, the notebook gets lost or smudged, and there's no easy way for a customer to just pay.

## How it works

1. **Scan**: photograph a page of the notebook. AI reads names, amounts and dates, and the owner checks every line before anything is saved.
2. **Collect**: one tap sends each customer a PayPal invoice. When PayPal says it's paid in full, the debt ticks itself off. With the payments database set up, PayPal's webhook tells the server within about half a minute, even while the app is closed. Without it, the app asks PayPal every minute while it's open.
3. **Remind**: a reminder schedule from the owner's rules (when to start, how often, how many, and no reminders during Friday prayers), shown on a calendar. On a laptop the owner can drag a reminder to move it. Each reminder goes out with one tap, by WhatsApp or as an email from PayPal. Nudge, an AI assistant, answers questions like "who should I chase this week?" and drafts polite messages.
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
| **PayPal** Invoicing API (v2) | Creating and sending invoices, checking which are paid, and emailing reminders |
| **PayPal** webhooks | Hearing about payments, cancellations and refunds within about half a minute |
| **Log in with PayPal** | Shop owners can sign in with their PayPal account |
| **AG Grid** | The Ledger and Home tables |
| **AG Studio** | The Insights dashboard and its custom scoreboard widget |
| **Bryntum** Scheduler and Calendar | The reminders view: Scheduler on a laptop (drag a reminder to move it), Calendar on a phone |
| **Vercel AI Gateway** + AI SDK | Nudge, the reminder assistant (Claude Haiku) |
| **Neon** Postgres | The payments database: invoices sent, PayPal's latest answer, webhook events and reminder holds |
| **Next.js 16** on **Vercel** | The app and its API routes |

## Sign-in

Shop owners sign in with **Log in with PayPal**, or with their email and a code: a 6-character code by email, or a fixed 12-character code set privately for each owner while email sending isn't set up. Only emails on the owner list (`OWNER_EMAILS`), plus the judges' demo login, get in. Sessions are signed cookies that last 7 days. Customers never sign in: their tab page is open to anyone with the link.

## Where things stand

We'd rather be clear about what's real and what's still being connected:

- **Real:** sending PayPal sandbox invoices, checking payment status, reconciling paid debts, sign-in (email and Log in with PayPal), reminders emailed by PayPal, the payments database and PayPal webhook, the ledger, insights, the reminders view and Nudge.
- **Being connected:** the scan screen currently uses a fixed sample reading while the vision-model extraction is finished. Reminders are worked out and shown, and the owner sends each one with a tap; they don't go out automatically yet. The customer page works on the owner's device; showing it on a customer's own phone is the next step, built on the payments database.
- **Data:** the ledger is stored on the owner's device (in the browser). Payment records also live in the payments database when it's set up (see below). With the webhook too, PayPal's answers are saved even while the app is closed. On a first visit the app fills in example customers so there's something to try; their invoices go to our own test inboxes.

## Running it yourself

You need Node.js 22 or newer (`node -v` to check).

1. Install packages: `npm install`
2. Copy the env template: `cp .env.example .env.local`
3. Fill in the PayPal sandbox keys in `.env.local`. Get them from [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → Sandbox. Also set `PAYPAL_SANDBOX_BUYER_EMAIL` to a sandbox buyer account.
   - **Currency:** invoices use MYR by default, but PayPal only accepts MYR between two Malaysia-country accounts. Create both the sandbox business (seller) and the sandbox personal (buyer) accounts with country **Malaysia**. If you can't, set `PAYPAL_CURRENCY=USD` in `.env.local` as a fallback.
   - Set `AUTH_SECRET` to any random string of 32+ characters. Every other variable is explained in `.env.example`.
   - Optional, for **Log in with PayPal**: in the same PayPal app, tick *Log in with PayPal*, add `http://localhost:3000/api/auth/paypal/callback` as a return URL (PayPal may only accept https ones; then test it on a deployed copy), and tick the email scope. Without it, use email sign-in.
4. Start the app: `npm run dev`, then open http://localhost:3000. Locally, with the owner list and the email settings (Gmail or Resend) left empty, any email can sign in and the code is printed in the terminal.
5. Send one test invoice: `npm run paypal:test-invoice`. It prints the invoice id and payer link.

Other useful commands: `npm test` (unit tests), `npm run typecheck`, `npm run build`.

## Payments database and webhook

Both are optional. Without them, the app keeps payment records on the owner's device and asks PayPal about open invoices every minute while it's open. With them, PayPal tells the server when an invoice is paid, cancelled or refunded, about half a minute later in our sandbox test. The app picks that up within about 10 seconds, so a payment or cancellation shows within about 40 seconds. A refund of an invoice the app already shows as paid shows within about an hour.

### 1. The database

1. Create a free Postgres database on [Neon](https://neon.tech). On Vercel, add **Neon** from the Marketplace (Storage tab) and connect it to the project; that sets `DATABASE_URL` for you.
2. Put its connection string in `.env.local` as `DATABASE_URL`.
3. Create the tables: `npm run db:migrate`. It only applies migrations that haven't run yet, so it's safe to run again after every pull.

To migrate the live database from your laptop, pass its URL just for that one command: `DATABASE_URL='postgresql://...' npm run db:migrate`. A value set in the shell wins over `.env.local`.

New migrations go in `db/migrations/` as the next numbered `.sql` file. Keep them to plain statements: the runner splits on `;` at the end of a line and can't handle `--` inside strings or `$$` function bodies.

### 2. The webhook

PayPal has to reach the webhook over the internet, so set it up on the deployed site.

1. On [developer.paypal.com](https://developer.paypal.com), open the sandbox app whose Client ID is in `PAYPAL_CLIENT_ID` (Apps & Credentials → Sandbox), then **Add Webhook**. Deliveries are checked with that app's keys, so a webhook on any other app fails the check.
2. Webhook URL: `https://<your-site>/api/paypal/webhook`.
3. Events: `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.CANCELLED`, `INVOICING.INVOICE.REFUNDED`, `INVOICING.INVOICE.UPDATED` and `INVOICING.INVOICE.UNPAID`.
4. Copy the new webhook's **Webhook ID** into `PAYPAL_WEBHOOK_ID` (on Vercel: Settings → Environment Variables), then redeploy.

To try it locally, expose your dev server with a tunnel such as `npx cloudflared tunnel --url http://localhost:3000`, register the tunnel's address as a second webhook, and set its id in `.env.local`. Delete that webhook when you're done, because the tunnel's address changes every time.

**Check it works:** send an invoice, pay it as the sandbox buyer, and keep the app open. The debt should show Paid within about 40 seconds. On the live sandbox, PayPal took about 28 seconds to send the webhook and the app showed Paid 4 seconds after that. The Vercel logs show any delivery that failed. The app slows its own checks to every 5 minutes only while the webhook has handled a real event in the last day, so a webhook that has never worked, or has gone quiet for a day, leaves it checking every minute.

**How it stays safe:** every delivery is checked with PayPal before anything is saved, and a repeated delivery is skipped. The server reads each invoice fresh from PayPal and keeps only answers newer than the one it has. A payment counts only when the amount and currency match what was billed.

### 3. Database tests

`lib/payment-db.test.ts` runs the payment queries against a real database set in `TEST_DATABASE_URL`, and is skipped without it (as in CI). It writes test rows and removes them afterwards, so give it a database of its own, such as a separate Neon branch. Create its tables first with `DATABASE_URL='<test database url>' npm run db:migrate`.

## Working on it

See [CLAUDE.md](CLAUDE.md) for the team rules. In short: branch from `dev`, open a PR into `dev`, get it reviewed. `main` only gets `dev` at the end.
