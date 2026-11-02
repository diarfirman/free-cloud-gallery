CREATE TABLE IF NOT EXISTS albums (
  name TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO albums (name) VALUES ('General');

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  title TEXT,
  album TEXT DEFAULT 'General',
  size_bytes INTEGER DEFAULT 0,
  media_type TEXT DEFAULT 'image',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);