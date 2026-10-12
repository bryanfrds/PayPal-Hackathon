# Idea: scan receipts as well as the buku 555

**Status:** nice-to-have. Build it only after every must-have works end to end (scan notebook → approve → PayPal invoice → ledger → reminders).

## The idea

When a customer buys on credit ("pay later"), the owner can scan the **receipt** instead of writing it in the buku 555. The debt goes straight onto that customer's tab.

So the app accepts two kinds of photo:

| Photo | What's on it | What the owner does after scanning |
|---|---|---|
| **Buku 555 page** | Many customers' debts, handwritten | Check what the AI read, match each name to a customer |
| **Receipt** | One purchase: items and a total, but **no customer name** | Pick which customer it's for |

## How it works

1. Owner taps **Scan** and chooses **Notebook** or **Receipt**.
2. The AI reads the receipt: items, total and date.
3. Owner picks the customer (or adds a new one with their email) and checks the amount.
4. It becomes a normal debt: owner approval, then PayPal invoice, ledger and reminders, same as notebook entries.

## How customers are told to pay (same for both)

1. **Invoice:** after the owner approves, PayPal emails the customer an invoice with a Pay button. The app can also give a link to share on WhatsApp.
2. **Reminders:** if it's still unpaid, the scheduler asks PayPal to send reminder emails, firmer when overdue.
3. **Paid:** paying on PayPal updates the ledger automatically, and the reminders stop.

Each customer needs an email address on file.

## Who builds what

- **Person 1 (scanning):** reading receipts (a different layout from the notebook) into the same draft-entry format.
- **Person 3 (Bryan, app):** the Notebook / Receipt choice on the upload screen, and the "pick customer" step for receipts.
- **Person 2 (PayPal):** nothing new. A receipt debt is invoiced like any other approved debt.

## Why it's not first

The buku 555 is what makes the demo memorable, and judges reward a few features that work well over many half-done ones. Receipts are cheap to add later (same AI, different layout) and show the app works for more shops.
