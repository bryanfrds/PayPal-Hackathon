-- Person 1 backend persistence tables
-- Compatible with PostgreSQL / Neon

CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  image_key TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_owner_hash ON scans (owner_email, image_hash);

CREATE TABLE IF NOT EXISTS extracted_entries (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  item TEXT NOT NULL,
  amount_sen INTEGER NOT NULL,
  raw_amount_text TEXT NOT NULL,
  date TEXT NOT NULL,
  classification TEXT NOT NULL,
  confidence REAL NOT NULL,
  is_ambiguous BOOLEAN NOT NULL DEFAULT FALSE,
  ambiguity_reason TEXT,
  included BOOLEAN NOT NULL DEFAULT TRUE,
  source_ref JSONB NOT NULL,
  owner_edited BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extracted_entries_scan ON extracted_entries (scan_id, revision);

CREATE TABLE IF NOT EXISTS customer_directory (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_customer_owner_slug UNIQUE (owner_email, slug)
);

CREATE TABLE IF NOT EXISTS approved_debts (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  source_entry_id TEXT NOT NULL,
  scan_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  amount_sen INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MYR',
  item TEXT NOT NULL,
  date TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handoff_key TEXT NOT NULL UNIQUE,
  CONSTRAINT uq_approved_debts_owner_source UNIQUE (owner_email, source_entry_id)
);

CREATE TABLE IF NOT EXISTS reminder_rules (
  owner_email TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  first_after_days INTEGER NOT NULL DEFAULT 3,
  min_interval_days INTEGER NOT NULL DEFAULT 4,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  send_hour INTEGER NOT NULL DEFAULT 10,
  skip_friday_prayers BOOLEAN NOT NULL DEFAULT TRUE,
  require_approval BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminder_decisions (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_number INTEGER NOT NULL,
  delivery_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminder_decisions_owner ON reminder_decisions (owner_email, created_at DESC);
