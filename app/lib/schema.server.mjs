// Gift Cards data, in the `gift_cards` schema of the shared bookerva_apps database.
// The first block is the original app's DDL, unchanged, so existing cards and designs keep working.
// Everything after "INK-1092" is additive (ADD COLUMN IF NOT EXISTS), safe to run on every boot.

export const APP_DDL = `
  CREATE TABLE IF NOT EXISTS designs (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL,
    name TEXT NOT NULL, denominations JSONB NOT NULL DEFAULT '[]', allow_custom BOOLEAN NOT NULL DEFAULT true,
    min_amount NUMERIC NOT NULL DEFAULT 500, max_amount NUMERIC NOT NULL DEFAULT 50000,
    currency TEXT NOT NULL DEFAULT 'JMD', active BOOLEAN NOT NULL DEFAULT true,
    merchant_name TEXT, merchant_logo TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE designs ADD COLUMN IF NOT EXISTS accent TEXT NOT NULL DEFAULT '#3b5bdb';
  ALTER TABLE designs ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'classic';
  ALTER TABLE designs ADD COLUMN IF NOT EXISTS image TEXT;
  ALTER TABLE designs ADD COLUMN IF NOT EXISTS terms TEXT;
  ALTER TABLE designs ADD COLUMN IF NOT EXISTS expiry_months INTEGER;
  CREATE TABLE IF NOT EXISTS cards (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, design_id BIGINT,
    code TEXT NOT NULL, amount NUMERIC NOT NULL, balance NUMERIC NOT NULL, currency TEXT NOT NULL,
    recipient_name TEXT, recipient_email TEXT, buyer_email TEXT, message TEXT,
    ref TEXT, inkress_order_id TEXT, payment_url TEXT, state TEXT NOT NULL DEFAULT 'awaiting',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (merchant_id, code)
  );
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS deliver_on DATE;
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS expires_on DATE;
  CREATE TABLE IF NOT EXISTS redemptions (
    id BIGSERIAL PRIMARY KEY, merchant_id BIGINT NOT NULL, card_id BIGINT, code TEXT, amount NUMERIC,
    note TEXT, created_by_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'redeem';
  CREATE INDEX IF NOT EXISTS idx_gc_cards ON cards (merchant_id, state, created_at DESC);
  CREATE TABLE IF NOT EXISTS webhook_subs (merchant_id BIGINT PRIMARY KEY, url TEXT NOT NULL, registered_at TIMESTAMPTZ NOT NULL DEFAULT now());

  -- INK-1092 rebuild: where a card came from, why it was issued, when it was turned off or reminded.
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online';
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS reason TEXT;
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
  CREATE INDEX IF NOT EXISTS idx_gc_cards_code ON cards (merchant_id, code);
  CREATE INDEX IF NOT EXISTS idx_gc_history ON redemptions (card_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_gc_history_merchant ON redemptions (merchant_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS merchant_settings (
    merchant_id BIGINT PRIMARY KEY,
    setup_hidden BOOLEAN NOT NULL DEFAULT false,
    test_sent_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;
