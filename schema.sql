-- D1 schema for the attempt log. Apply once the EXHUME_DB binding exists:
--   wrangler d1 create exhume
--   wrangler d1 execute exhume --file=schema.sql
-- Until then the Worker logs one JSON line per attempt to the console instead.

CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,            -- ISO 8601
  player       TEXT NOT NULL,            -- hashed, 16 hex chars
  ladder       TEXT NOT NULL DEFAULT '35', -- which campaign: "35" | "15" (level ids differ per ladder)
  level        INTEGER NOT NULL,
  channel      TEXT NOT NULL,            -- chat | document | tool | cot
  verdict      TEXT NOT NULL,            -- leak | blocked | claimed | miss | closed | error
  filters      TEXT NOT NULL,            -- JSON array, e.g. ["I2:persona opener"]
  tags         TEXT NOT NULL,            -- JSON array of technique tags
  candles_left INTEGER,
  message      TEXT NOT NULL,            -- the player's verbatim message
  response     TEXT NOT NULL             -- the guard's verbatim reply
);

-- A table created before the ladder column existed needs one line, once:
--   ALTER TABLE attempts ADD COLUMN ladder TEXT NOT NULL DEFAULT '35';
-- Until then the Worker writes the old row shape and notes the ladder in the console.

CREATE INDEX IF NOT EXISTS idx_attempts_level  ON attempts (level);
CREATE INDEX IF NOT EXISTS idx_attempts_player ON attempts (player);
CREATE INDEX IF NOT EXISTS idx_attempts_verdict ON attempts (verdict);
