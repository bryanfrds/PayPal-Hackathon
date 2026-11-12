-- A customer's tab, published by the owner so the customer can open it on their own phone
-- at /t/<token>. Holds only what that customer's page shows (their own debts, bills and open
-- PayPal pay links); the owner's email is kept to find and update the row, never shown.

CREATE TABLE IF NOT EXISTS customer_tabs (
  token text PRIMARY KEY CHECK (char_length(token) >= 22),  -- 128+ random bits, base64url
  owner_email text NOT NULL,          -- the signed-in owner who published it, lower-case
  slug text NOT NULL,                 -- customer key, as on the device (lib/customer-tab.ts)
  customer_name text NOT NULL,
  shop_name text NOT NULL,
  snapshot jsonb NOT NULL,            -- lib/tab-snapshot.ts TabSnapshot, validated before saving
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,             -- set when the owner turns the link off
  UNIQUE (owner_email, slug)
);
