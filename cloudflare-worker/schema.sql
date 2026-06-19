CREATE TABLE IF NOT EXISTS tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT,
  event_type TEXT NOT NULL DEFAULT 'pageview',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  src TEXT,
  gclid TEXT,
  fbclid TEXT,
  referrer TEXT,
  user_agent TEXT,
  landing_url TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracking_client_id ON tracking_events(client_id);
CREATE INDEX IF NOT EXISTS idx_tracking_created_at ON tracking_events(created_at);
CREATE INDEX IF NOT EXISTS idx_tracking_event_type ON tracking_events(event_type);
