-- Every PayPal invoice made for an approved debt, written before it's sent, so a correction can
-- never send a second invoice even if saving to the invoices table failed.
ALTER TABLE approved_debts ADD COLUMN IF NOT EXISTS paypal_invoice_ids TEXT[] NOT NULL DEFAULT '{}';
