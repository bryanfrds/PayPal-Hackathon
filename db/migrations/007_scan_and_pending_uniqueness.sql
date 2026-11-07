CREATE UNIQUE INDEX IF NOT EXISTS uq_scans_owner_hash ON scans (owner_email, image_hash);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY owner_email, invoice_id ORDER BY created_at DESC, id DESC) AS position
  FROM reminder_decisions
  WHERE action = 'pending_approval'
)
UPDATE reminder_decisions
SET action = 'skipped', delivery_result = COALESCE(delivery_result, 'Superseded by a newer pending approval')
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_pending_owner_invoice
  ON reminder_decisions (owner_email, invoice_id)
  WHERE action = 'pending_approval';
