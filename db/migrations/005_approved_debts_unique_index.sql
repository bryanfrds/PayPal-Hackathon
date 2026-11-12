CREATE UNIQUE INDEX IF NOT EXISTS uq_approved_debts_owner_source ON approved_debts (owner_email, source_entry_id);
