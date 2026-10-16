-- WhisperToCursor schema v1.
-- No transcripts and no audio are ever stored on the server. usage_events holds only
-- durations, counts and error codes so limits can be enforced.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  disabled INTEGER NOT NULL DEFAULT 0,
  -- NULL means "use the server default" from DEFAULT_DAILY/MONTHLY_LIMIT_MINUTES.
  daily_limit_seconds INTEGER,
  monthly_limit_seconds INTEGER,
  enhance_allowed INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Single-use codes: 'signup' invites and admin-issued 'reset' codes. Only hashes are stored.
CREATE TABLE invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'signup' CHECK (kind IN ('signup', 'reset')),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  target_user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
  daily_limit_seconds INTEGER,
  monthly_limit_seconds INTEGER,
  note TEXT,
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by INTEGER REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE vocabulary (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  term TEXT NOT NULL,
  PRIMARY KEY (user_id, position)
);

CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Kept (as NULL) when a user is deleted so global totals stay correct.
  user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('transcribe', 'enhance')),
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  audio_seconds REAL NOT NULL DEFAULT 0,
  keyterms INTEGER NOT NULL DEFAULT 0,
  -- 'pending' while the provider call runs, so concurrent requests count against the quota.
  status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'error')),
  error_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX usage_user_month ON usage_events (user_id, month, kind);
CREATE INDEX usage_month ON usage_events (month, kind);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
