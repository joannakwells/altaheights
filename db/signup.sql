CREATE TABLE IF NOT EXISTS mailing_list_signups (
  email text PRIMARY KEY CHECK (length(email) <= 254),
  name text NOT NULL CHECK (length(name) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS mailing_list_pending ON mailing_list_signups(next_attempt_at)
  WHERE synced_at IS NULL;
CREATE TABLE IF NOT EXISTS mailing_list_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS mailing_list_health (
  id text PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now()
);
