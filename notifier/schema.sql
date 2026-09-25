-- Subscriber storage. Deliberately minimal: an email address and the filters
-- the person chose, nothing else (no names, no IPs, no open/click tracking).
-- Unsubscribing deletes the row outright.

CREATE TABLE IF NOT EXISTS subscriptions (
  -- random 128-bit token; doubles as the confirm / unsubscribe secret
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  -- canonical JSON: {"journal":[...],"method":[...],"data_type":[...],"q":"..."}
  filters TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  -- used only to expire unconfirmed sign-ups and throttle re-sent confirmations
  created_at TEXT NOT NULL,
  UNIQUE (email, filters)
);

CREATE INDEX IF NOT EXISTS subscriptions_email ON subscriptions (email);
CREATE INDEX IF NOT EXISTS subscriptions_confirmed ON subscriptions (confirmed);

-- Which addresses have already been sent the current batch, so a retried
-- /notify call doesn't send duplicates. Cleared of older batches on each run.
CREATE TABLE IF NOT EXISTS deliveries (
  batch_id TEXT NOT NULL,
  email TEXT NOT NULL,
  PRIMARY KEY (batch_id, email)
);
