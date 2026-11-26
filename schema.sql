CREATE TABLE IF NOT EXISTS channels (
  twitch_login TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  role_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
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
  ('vivionyx'),
  ('shiroe_com'),
  ('panszczesniak');

CREATE TABLE IF NOT EXISTS youtube_channels(account_key TEXT PRIMARY KEY,channel_url TEXT NOT NULL DEFAULT '',channel_id TEXT NOT NULL DEFAULT '',channel_title TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 0,role_id TEXT NOT NULL DEFAULT '',message_text TEXT NOT NULL DEFAULT '',webhook_url TEXT NOT NULL DEFAULT '',color INTEGER NOT NULL DEFAULT 10181046,lease_expires TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO youtube_channels(account_key) VALUES('panszczesniak'),('shiroe'),('vivi');
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,credential_tag TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_queue(event_key TEXT PRIMARY KEY,kind TEXT NOT NULL,recipient TEXT NOT NULL,payload TEXT NOT NULL,origin TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS delivery_due ON delivery_queue(status,next_at);
