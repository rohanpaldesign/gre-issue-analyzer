-- GRE Issue Analyzer schema.
--
-- Content tables hold the ETS pool and the authored reasoning. They are
-- populated by scripts/seed.mjs and never committed to git.
-- User tables hold essays and scores, keyed by a sync code rather than an
-- auth provider.

CREATE TABLE IF NOT EXISTS topics (
  id                INTEGER PRIMARY KEY,
  statement         TEXT    NOT NULL,
  task_instruction  TEXT    NOT NULL,
  task_type         TEXT    NOT NULL,
  claim             TEXT,
  reason            TEXT,
  themes            TEXT    NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_topics_task_type ON topics (task_type);

-- Reusable real-world examples. The point of the bank is that one example
-- serves many prompts, which is how the essay is actually meant to be studied.
CREATE TABLE IF NOT EXISTS examples (
  slug      TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  domain    TEXT NOT NULL,
  summary   TEXT NOT NULL,
  key_facts TEXT NOT NULL DEFAULT '[]',
  moves     TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS topic_reasons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id     INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  side         TEXT    NOT NULL CHECK (side IN ('support', 'oppose')),
  ord          INTEGER NOT NULL,
  claim        TEXT    NOT NULL,
  mechanism    TEXT    NOT NULL,
  example_slug TEXT    REFERENCES examples (slug) ON DELETE SET NULL,
  UNIQUE (topic_id, side, ord)
);

CREATE INDEX IF NOT EXISTS idx_topic_reasons_topic ON topic_reasons (topic_id);

CREATE TABLE IF NOT EXISTS topic_concessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id    INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  side        TEXT    NOT NULL CHECK (side IN ('support', 'oppose')),
  concession  TEXT    NOT NULL,
  rebuttal    TEXT    NOT NULL,
  UNIQUE (topic_id, side)
);

CREATE TABLE IF NOT EXISTS topic_examples (
  topic_id     INTEGER NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  example_slug TEXT    NOT NULL REFERENCES examples (slug) ON DELETE CASCADE,
  relevance    TEXT    NOT NULL,
  PRIMARY KEY (topic_id, example_slug)
);

-- ETS-scored essays used to anchor the heuristic scorer to ETS's actual scale.
CREATE TABLE IF NOT EXISTS calibration_essays (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source           TEXT    NOT NULL,
  official_score   REAL    NOT NULL,
  body             TEXT    NOT NULL,
  rater_commentary TEXT    NOT NULL DEFAULT '',
  word_count       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source, official_score)
);

-- Identity is a sync code, not an account. The server stores only its hash.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  sync_code_hash TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS essays (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  topic_id     INTEGER NOT NULL REFERENCES topics (id),
  stance       TEXT,
  body         TEXT    NOT NULL,
  word_count   INTEGER NOT NULL DEFAULT 0,
  seconds_used INTEGER NOT NULL DEFAULT 0,
  timed        INTEGER NOT NULL DEFAULT 1,
  -- Set when the writer opened the guidance before submitting. Assisted
  -- attempts are excluded from the score trend so the trend stays honest.
  assisted     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_essays_user_created ON essays (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_essays_user_topic   ON essays (user_id, topic_id);

CREATE TABLE IF NOT EXISTS essay_scores (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  essay_id     TEXT NOT NULL REFERENCES essays (id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('heuristic', 'ai')),
  holistic     REAL NOT NULL,
  position     REAL NOT NULL,
  development  REAL NOT NULL,
  organization REAL NOT NULL,
  language     REAL NOT NULL,
  conventions  REAL NOT NULL,
  payload      TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (essay_id, source)
);

CREATE INDEX IF NOT EXISTS idx_essay_scores_essay ON essay_scores (essay_id);

-- Added with the interface redesign: a display name and test date for the
-- dashboard, and a flag for essays the writer chose to keep.
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN test_date TEXT;
ALTER TABLE essays ADD COLUMN saved INTEGER NOT NULL DEFAULT 0;
