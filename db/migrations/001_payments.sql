-- Payment records on the server (Person 2). The ledger itself still lives on the owner's
-- device; these tables hold what PayPal said about each invoice we sent, so it survives
-- across devices and PayPal's webhook has somewhere to write.

-- One row per PayPal invoice the app sent.
CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,                -- PayPal's invoice id (INV2-…)
  owner_email text NOT NULL,          -- the signed-in owner who sent it, lower-case
  number text,                        -- PayPal's invoice number, e.g. 0012
  customer_name text NOT NULL,
  slug text NOT NULL,                 -- customer key, as on the device (lib/customer-tab.ts)
  debt_ids text[] NOT NULL,           -- the device's debt ids this invoice covers
  amount_sen integer NOT NULL CHECK (amount_sen > 0),
  currency text NOT NULL,
  payer_link text,
  sent_at timestamptz NOT NULL,
  -- PayPal's latest answer, and the settlement lib/payments.ts makes of it.
  status text,
  settlement text CHECK (settlement IN ('paid', 'open', 'closed', 'check')),
  total_sen integer,
  paid_sen integer,
  due_sen integer,
  checked_at timestamptz,             -- when that answer was read; only ever moves forward
  checked_by text CHECK (checked_by IN ('app', 'webhook')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_owner_slug ON invoices (owner_email, slug);

-- Every PayPal webhook event once: a repeat delivery finds its id here and is skipped.
CREATE TABLE IF NOT EXISTS paypal_events (
  id text PRIMARY KEY,                -- PayPal's event id (WH-…)
  event_type text NOT NULL,
  invoice_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  outcome text
);

-- Holds back a second reminder for the same invoice (app/api/invoices/[id]/remind).
CREATE TABLE IF NOT EXISTS reminder_holds (
  invoice_id text PRIMARY KEY,
  held_at timestamptz NOT NULL
);
