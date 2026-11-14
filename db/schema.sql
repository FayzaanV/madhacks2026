-- The Curve trade ledger (Lakebase Postgres, database databricks_postgres, schema public).
-- Columns mirror the_curve.bronze.*_raw so 10_sync_bronze can copy them 1:1.
-- Apply: databricks/notebooks/02_seed_lakebase.py runs this file before seeding.

CREATE TABLE IF NOT EXISTS users (
  user_id       text PRIMARY KEY,
  school_id     text NOT NULL DEFAULT 'uw-madison',
  handle        text NOT NULL,
  email         text UNIQUE NOT NULL,
  major         text,
  dorm          text,
  club          text,
  class_year    int,
  archetype     text,                      -- simulation only; null for real users
  is_instructor boolean NOT NULL DEFAULT false,
  clout         double precision NOT NULL DEFAULT 0,   -- true Clout, no floor
  is_simulated  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS markets (
  market_id         text PRIMARY KEY,
  school_id         text NOT NULL DEFAULT 'uw-madison',
  course            text NOT NULL,
  question          text NOT NULL,
  market_type       text NOT NULL CHECK (market_type IN ('binary', 'multiple_choice', 'numeric_range')),
  status            text NOT NULL CHECK (status IN ('proposed', 'live', 'closed', 'resolved', 'disputed', 'final', 'voided')),
  liquidity_b       double precision NOT NULL DEFAULT 500,
  creator_id        text REFERENCES users(user_id),
  resolution_source text,
  is_simulated      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  opens_at          timestamptz,
  closes_at         timestamptz
);

CREATE TABLE IF NOT EXISTS outcomes (
  market_id     text NOT NULL REFERENCES markets(market_id) ON DELETE CASCADE,
  outcome_index int  NOT NULL,
  label         text NOT NULL,
  q_shares      double precision NOT NULL DEFAULT 0,  -- LMSR outstanding shares
  is_simulated  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (market_id, outcome_index)
);

CREATE TABLE IF NOT EXISTS trades (
  trade_id            text PRIMARY KEY,
  market_id           text NOT NULL REFERENCES markets(market_id),
  user_id             text NOT NULL REFERENCES users(user_id),
  outcome_index       int  NOT NULL,
  clout_spent         double precision NOT NULL CHECK (clout_spent > 0),
  shares              double precision NOT NULL,
  price_before        double precision NOT NULL,
  post_price          double precision NOT NULL,       -- the trade's forecast for Brier
  prices_after        double precision[] NOT NULL,
  user_clout_at_trade double precision NOT NULL,
  is_simulated        boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trades_market_idx ON trades (market_id, created_at);
CREATE INDEX IF NOT EXISTS trades_user_market_idx ON trades (user_id, market_id);

CREATE TABLE IF NOT EXISTS resolutions (
  market_id             text PRIMARY KEY REFERENCES markets(market_id),
  winning_outcome_index int,
  resolved_by           text REFERENCES users(user_id),
  rationale             text,
  resolved_at           timestamptz NOT NULL DEFAULT now(),
  dispute_deadline      timestamptz,
  final_at              timestamptz,
  status                text NOT NULL,
  is_simulated          boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS comments (
  comment_id   text PRIMARY KEY,
  market_id    text NOT NULL REFERENCES markets(market_id),
  user_id      text NOT NULL REFERENCES users(user_id),
  body         text NOT NULL,
  is_simulated boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_market_idx ON comments (market_id, created_at);

CREATE TABLE IF NOT EXISTS disputes (
  dispute_id   text PRIMARY KEY,
  market_id    text NOT NULL REFERENCES markets(market_id),
  user_id      text NOT NULL REFERENCES users(user_id),
  reason       text,
  is_simulated boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- AI market analyst: every "Ask the AI" question and answer (flows to bronze for analytics)
CREATE TABLE IF NOT EXISTS ai_questions (
  question_id  text PRIMARY KEY,
  market_id    text NOT NULL REFERENCES markets(market_id),
  user_id      text REFERENCES users(user_id),
  question     text NOT NULL,
  answer       text,
  model        text,
  latency_ms   int,
  created_at   timestamptz NOT NULL DEFAULT now()
);
