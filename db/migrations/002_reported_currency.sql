-- The currency PayPal reported for the invoice, kept apart from the one we billed in, so the
-- currency check still works on answers read back from the database.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reported_currency text;
