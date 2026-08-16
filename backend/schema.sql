PRAGMA foreign_keys = ON;

-- Users are anonymous-ish: handle + device hash, authenticated via signed token.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  device_hash TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);

-- Rooms are ephemeral (default 4h TTL).
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  topic TEXT,
  creator_user_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  deleted_at INTEGER,
  live_count INTEGER NOT NULL DEFAULT 0,
  live_updated_at INTEGER,
  FOREIGN KEY (creator_user_id) REFERENCES users(id)
);

-- Indexes for nearby query (bounding box) + expiry filter.
CREATE INDEX IF NOT EXISTS idx_rooms_expiry ON rooms(expires_at);
CREATE INDEX IF NOT EXISTS idx_rooms_lat_lng ON rooms(lat, lng);
CREATE INDEX IF NOT EXISTS idx_rooms_deleted ON rooms(deleted_at);

-- Message history for scrollback.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('user', 'system')),
  user_id TEXT,
  handle TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_room_time ON messages(room_id, created_at DESC);

