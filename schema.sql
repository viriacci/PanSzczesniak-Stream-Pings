CREATE TABLE IF NOT EXISTS channels (
  twitch_login TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  role_id TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT 'Wbijaj na stream! ✨',
  banner_key TEXT,
  webhook_url TEXT NOT NULL DEFAULT '',
  color INTEGER NOT NULL DEFAULT 10181046,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS received_events (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS banners (
  banner_key TEXT PRIMARY KEY,
  content BLOB NOT NULL,
  content_type TEXT NOT NULL
);

INSERT OR IGNORE INTO channels (twitch_login) VALUES
  ('vivionyxx'),
  ('shiroe_com'),
  ('panszczesniak');
