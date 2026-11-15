-- Yomi trade ledger (Lakebase Postgres, database databricks_postgres, schema public).
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
  clout         double precision NOT NULL DEFAULT 100, -- AVAILABLE balance: bets spend it, payouts credit it.
                                                       -- True Clout = clout + open stakes = 100 + realized profit.
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

-- ------------------------------------------------------------------ accounts + login (wisc.edu magic links)
-- Idempotent migrations for databases created before these columns existed.
ALTER TABLE users ALTER COLUMN clout SET DEFAULT 100;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- One-time sign-in links. Only the SHA-256 of the token is stored; tokens never leave Lakebase.
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  text PRIMARY KEY,
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS login_tokens_email_idx ON login_tokens (email, created_at);

-- Browser sessions (httpOnly cookie holds the raw id; only its SHA-256 is stored).
CREATE TABLE IF NOT EXISTS sessions (
  session_hash text PRIMARY KEY,
  session_id   text UNIQUE NOT NULL DEFAULT ('s-' || gen_random_uuid()),  -- non-secret id for analytics
  user_id      text NOT NULL REFERENCES users(user_id),
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- ------------------------------------------------------------------ universities
-- Listed schools come from app/src/core/universities.json (seeded by 02_seed_lakebase); schools from
-- "my school isn't listed" sign-ups are inserted on first verified login.
CREATE TABLE IF NOT EXISTS schools (
  school_id    text PRIMARY KEY,
  name         text NOT NULL,
  short_name   text NOT NULL,
  domain       text UNIQUE NOT NULL,
  color        text,
  is_listed    boolean NOT NULL DEFAULT true,
  is_simulated boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE login_tokens ADD COLUMN IF NOT EXISTS school_id text;

-- ------------------------------------------------------------------ usernames
-- Real users pick their own username (handle) after their first sign-in; until then they get a random one.
-- Handles are unique case-insensitively among real users (simulated handles are checked in app code).
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle_chosen_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_real_uidx ON users (lower(handle)) WHERE NOT is_simulated;

-- ------------------------------------------------------------------ sign-in abuse limits
-- SHA-256 of the requester IP, for per-IP rate limits (raw IPs are never stored).
ALTER TABLE login_tokens ADD COLUMN IF NOT EXISTS ip_hash text;
CREATE INDEX IF NOT EXISTS login_tokens_ip_idx ON login_tokens (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS login_tokens_created_idx ON login_tokens (created_at);

-- ------------------------------------------------------------------ course staff (no trading on your own course)
-- Instructors and TAs per course. placeTrade rejects trades on markets whose course you staff.
CREATE TABLE IF NOT EXISTS course_staff (
  user_id    text NOT NULL REFERENCES users(user_id),
  course     text NOT NULL,
  role       text NOT NULL DEFAULT 'instructor' CHECK (role IN ('instructor', 'ta')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course)
);

-- ------------------------------------------------------------------ trade + AI rate limits
CREATE INDEX IF NOT EXISTS trades_user_time_idx ON trades (user_id, created_at);
CREATE INDEX IF NOT EXISTS ai_questions_user_time_idx ON ai_questions (user_id, created_at);

-- ------------------------------------------------------------------ selling (signed trades + average-cost basis)
-- buy:  shares +n, clout_spent +amount (cash out),   basis_change +amount
-- sell: shares -k, clout_spent -proceeds (cash in),  basis_change -(avg cost * k)
-- position = sum(shares); open cost basis = sum(basis_change); realized on a sell = proceeds - avg cost * k.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS side text NOT NULL DEFAULT 'buy';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS basis_change double precision;
UPDATE trades SET basis_change = clout_spent WHERE basis_change IS NULL;
ALTER TABLE trades ALTER COLUMN basis_change SET NOT NULL;
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_clout_spent_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_side_check') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_side_check CHECK (side IN ('buy', 'sell'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_clout_nonzero') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_clout_nonzero CHECK (clout_spent <> 0);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS trades_market_user_idx ON trades (market_id, user_id, outcome_index);

-- ------------------------------------------------------------------ profile: avatar + chosen title
-- Avatar: a 128px image resized in the browser (<= 64 KB), served by /api/users/:id/avatar. Never synced to bronze.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar bytea;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_type text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS title text;  -- chosen from earned titles (app/src/core/titles.ts)
-- Shop cosmetics: JSON of equipped item ids per slot, e.g. {"hat":"hat-wizard"}. Ownership is NOT stored; it's computed
-- from true Clout (app/src/core/cosmetics.ts), so items disappear below their threshold and come back above it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cosmetics text;

-- ------------------------------------------------------------------ Union markets (live venue data)
-- Venues: Wisconsin Union spaces. Edit rows here for a real deployment (external_id = the Occuspace space id).
CREATE TABLE IF NOT EXISTS venues (
  venue_id     text PRIMARY KEY,
  name         text NOT NULL,
  building     text NOT NULL,
  capacity     int  NOT NULL,
  sensor       text NOT NULL DEFAULT 'none' CHECK (sensor IN ('occuspace', 'none')),
  external_id  text,
  is_simulated boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO venues (venue_id, name, building, capacity, sensor) VALUES
  ('terrace', 'Memorial Union Terrace', 'Memorial Union', 1200, 'occuspace'),
  ('rathskeller', 'Rathskeller', 'Memorial Union', 400, 'occuspace'),
  ('sett', 'The Sett', 'Union South', 600, 'occuspace'),
  ('strada', 'Strada', 'Wisconsin Union', 80, 'none')
ON CONFLICT (venue_id) DO NOTHING;

-- Append-only readings: sensors (occuspace), the partner API (partner, e.g. point-of-sale sales and waits),
-- or the simulated feed (sim, is_simulated = true) until a partner plugs in.
CREATE TABLE IF NOT EXISTS venue_metrics (
  venue_id     text NOT NULL REFERENCES venues(venue_id),
  metric       text NOT NULL CHECK (metric IN ('people', 'occupancy_pct', 'wait_min', 'line_len', 'sales')),
  value        double precision NOT NULL,
  observed_at  timestamptz NOT NULL,
  source       text NOT NULL CHECK (source IN ('occuspace', 'partner', 'sim')),
  is_simulated boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, metric, source, observed_at)
);
CREATE INDEX IF NOT EXISTS venue_metrics_time_idx ON venue_metrics (venue_id, metric, observed_at);

-- Student check-ins (fallback when no sensor or partner covers a market's window).
CREATE TABLE IF NOT EXISTS venue_reports (
  report_id  text PRIMARY KEY,
  venue_id   text NOT NULL REFERENCES venues(venue_id),
  user_id    text NOT NULL REFERENCES users(user_id),
  metric     text NOT NULL CHECK (metric IN ('wait_min', 'line_len')),
  value      double precision NOT NULL CHECK (value >= 0 AND value <= 240),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venue_reports_idx ON venue_reports (venue_id, metric, created_at);
CREATE INDEX IF NOT EXISTS venue_reports_user_idx ON venue_reports (user_id, venue_id, created_at);

-- How a Union market settles (databricks/lib/union.py evaluate): aggregate the metric over the window, compare.
CREATE TABLE IF NOT EXISTS market_rules (
  market_id    text PRIMARY KEY REFERENCES markets(market_id) ON DELETE CASCADE,
  venue_id     text NOT NULL REFERENCES venues(venue_id),
  metric       text NOT NULL,
  op           text NOT NULL CHECK (op IN ('>=', '<')),
  threshold    double precision NOT NULL,
  window_start timestamptz NOT NULL,
  window_end   timestamptz NOT NULL,
  agg          text NOT NULL CHECK (agg IN ('avg', 'max', 'last'))
);

-- Enterprise partners (e.g. the Wisconsin Union) pushing data through /api/partner/metrics.
-- Only the SHA-256 of each API key is stored; never synced to bronze.
CREATE TABLE IF NOT EXISTS partners (
  partner_id   text PRIMARY KEY,
  name         text NOT NULL,
  api_key_hash text UNIQUE NOT NULL,
  venue_ids    text[] NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  last_used_at timestamptz
);

-- System account that creates and settles Union markets (not a person, not simulated).
INSERT INTO users (user_id, handle, email, handle_chosen_at)
VALUES ('u-yomi-union', 'yomi_union', 'union-bot@yomi.invalid', now())
ON CONFLICT (user_id) DO NOTHING;

-- ------------------------------------------------------------------ sports + intramurals (auto-resolving markets)
-- Market metadata so pollers can find and settle their own markets. category: academic | sports | intramural | union.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'academic';
ALTER TABLE markets ADD COLUMN IF NOT EXISTS sport text;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_ref text;      -- ESPN event id, or 'im:<game_id>'
ALTER TABLE markets ADD COLUMN IF NOT EXISTS market_kind text;    -- winner | total | margin | overtime
ALTER TABLE markets ADD COLUMN IF NOT EXISTS line double precision; -- over/under line for 'total'
ALTER TABLE markets ADD COLUMN IF NOT EXISTS auto_resolve boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS markets_event_kind_uidx ON markets (event_ref, market_kind) WHERE event_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS markets_category_idx ON markets (category, status);

-- Varsity games from ESPN's public scoreboard (Big Ten schools), refreshed by the app's sports poller.
CREATE TABLE IF NOT EXISTS sports_games (
  event_id        text PRIMARY KEY,                 -- ESPN event id
  sport           text NOT NULL,                    -- key from app/src/core/sports.ts SPORTS
  starts_at       timestamptz NOT NULL,
  state           text NOT NULL,                    -- pre | in | post
  status_name     text,                             -- ESPN status.type.name (STATUS_FINAL, STATUS_POSTPONED, ...)
  completed       boolean NOT NULL DEFAULT false,
  period          int,
  clock           text,
  detail          text,                             -- e.g. "Final/OT", "2nd 4:31"
  home_name       text NOT NULL,
  away_name       text NOT NULL,
  home_abbr       text,
  away_abbr       text,
  home_espn_id    text,
  away_espn_id    text,
  home_school_id  text,                             -- our school_id when the team is a listed school
  away_school_id  text,
  home_score      double precision,
  away_score      double precision,
  winner_side     text,                             -- home | away | null
  overtime        boolean,
  ou_line         double precision,                 -- ESPN odds over/under when provided
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sports_games_state_idx ON sports_games (state, starts_at);

-- Intramurals: FusionPlay has no public data, so admins import schedules and captains report results.
CREATE TABLE IF NOT EXISTS im_leagues (
  league_id  text PRIMARY KEY,
  school_id  text NOT NULL DEFAULT 'uw-madison',
  sport      text NOT NULL,
  season     text NOT NULL,
  division   text,
  created_by text REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS im_teams (
  team_id         text PRIMARY KEY,
  league_id       text NOT NULL REFERENCES im_leagues(league_id) ON DELETE CASCADE,
  name            text NOT NULL,
  captain_user_id text REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, name)
);
CREATE TABLE IF NOT EXISTS im_games (
  game_id       text PRIMARY KEY,
  league_id     text NOT NULL REFERENCES im_leagues(league_id) ON DELETE CASCADE,
  home_team_id  text NOT NULL REFERENCES im_teams(team_id),
  away_team_id  text NOT NULL REFERENCES im_teams(team_id),
  starts_at     timestamptz NOT NULL,
  location      text,
  status        text NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled', 'reported', 'disputed', 'final', 'forfeit', 'canceled')),
  home_score    int,
  away_score    int,
  reported_by   text REFERENCES users(user_id),
  reported_at   timestamptz,
  confirmed_by  text REFERENCES users(user_id),
  confirmed_at  timestamptz,
  disputed_by   text REFERENCES users(user_id),
  disputed_at   timestamptz,
  dispute_note  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS im_games_status_idx ON im_games (status, starts_at);

-- System accounts that create and settle sports / intramural markets (not people, not simulated).
INSERT INTO users (user_id, handle, email, handle_chosen_at)
VALUES ('u-yomi-sports', 'yomi_sports', 'sports-bot@yomi.invalid', now()),
       ('u-yomi-im', 'yomi_intramurals', 'im-bot@yomi.invalid', now())
ON CONFLICT (user_id) DO NOTHING;

-- Leases so only one app instance (deployed or a teammate's local dev server) runs a background poller at a time.
CREATE TABLE IF NOT EXISTS poller_leases (
  name        text PRIMARY KEY,
  holder      text NOT NULL,
  expires_at  timestamptz NOT NULL
);

-- ------------------------------------------------------------------ campus markets: weather + rec-center crowding
-- Admin-created Yes/No markets that settle themselves from data (category 'campus', market_kind weather | facility,
-- auto_resolve true). auto_rule: JSON text (app/src/core/auto-rules.ts); text, not jsonb, so the bronze sync reads a string.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS auto_rule text;

-- System account that settles campus markets (not a person, not simulated).
INSERT INTO users (user_id, handle, email, handle_chosen_at)
VALUES ('u-yomi-campus', 'yomi_campus', 'campus-bot@yomi.invalid', now())
ON CONFLICT (user_id) DO NOTHING;

-- UW Rec Well live counts. The feed only shows current counts, so this table is the history: one row per count update.
-- Written by an app instance that can reach the feed (Free Edition Databricks can't; a laptop relay does it).
CREATE TABLE IF NOT EXISTS facility_counts (
  location_id       int         NOT NULL,
  location_name     text        NOT NULL,
  facility_name     text        NOT NULL,
  last_count        int         NOT NULL,
  capacity          int         NOT NULL,
  is_closed         boolean     NOT NULL,
  source_updated_at timestamptz NOT NULL,   -- when the rec center updated the count
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, source_updated_at)
);

-- Open-Meteo daily values for Madison. Written by the yomi-refresh task campus_weather (Databricks can reach
-- Open-Meteo) or by an app instance that can; read by the app to settle weather markets.
CREATE TABLE IF NOT EXISTS weather_observations (
  obs_date   date             NOT NULL,
  metric     text             NOT NULL,     -- temp_max_f | temp_min_f | precip_in | snow_in
  value      double precision NOT NULL,
  source     text             NOT NULL DEFAULT 'open-meteo',
  fetched_at timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (obs_date, metric)
);

-- Where a sports market's opening price came from (e.g. "Opened at 84% from ESPN's matchup predictor").
ALTER TABLE markets ADD COLUMN IF NOT EXISTS opening_note text;

-- ------------------------------------------------------------------ friends, groups, group markets, challenges
-- Friendships: one row per pair (user_a < user_b). Pending until the other person accepts; deleted on decline/unfriend.
CREATE TABLE IF NOT EXISTS friendships (
  user_a       text NOT NULL REFERENCES users(user_id),
  user_b       text NOT NULL REFERENCES users(user_id),
  status       text NOT NULL CHECK (status IN ('pending', 'accepted')),
  requested_by text NOT NULL REFERENCES users(user_id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS friendships_b_idx ON friendships (user_b);

-- Private groups: members make their own markets (real Clout, no public leaderboard credit).
CREATE TABLE IF NOT EXISTS groups (
  group_id    text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  owner_id    text NOT NULL REFERENCES users(user_id),
  invite_code text UNIQUE NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id  text NOT NULL REFERENCES groups(group_id),
  user_id   text NOT NULL REFERENCES users(user_id),
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);

-- NULL = public market. Group markets are visible to members only.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS group_id text REFERENCES groups(group_id);
CREATE INDEX IF NOT EXISTS markets_group_idx ON markets (group_id, status);

-- Who a group market is about (members of that group only). A tagged member can veto it (market voids).
CREATE TABLE IF NOT EXISTS market_tags (
  market_id text NOT NULL REFERENCES markets(market_id) ON DELETE CASCADE,
  user_id   text NOT NULL REFERENCES users(user_id),
  vetoed_at timestamptz,
  PRIMARY KEY (market_id, user_id)
);

-- Disputed group markets: members who didn't trade vote (outcome index as text, or 'void').
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS closes_at timestamptz;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
CREATE TABLE IF NOT EXISTS dispute_votes (
  market_id  text NOT NULL REFERENCES markets(market_id),
  user_id    text NOT NULL REFERENCES users(user_id),
  vote       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_id, user_id)
);

-- Head-to-head challenges between friends. Stakes leave both balances on accept; the winner gets 2x stake.
CREATE TABLE IF NOT EXISTS challenges (
  challenge_id       text PRIMARY KEY,
  market_id          text NOT NULL REFERENCES markets(market_id),
  challenger_id      text NOT NULL REFERENCES users(user_id),
  opponent_id        text NOT NULL REFERENCES users(user_id),
  challenger_outcome int  NOT NULL,
  opponent_outcome   int,               -- NULL = "anything else"
  stake              int  NOT NULL CHECK (stake >= 1),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'settled', 'void')),
  winner_id          text REFERENCES users(user_id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  accepted_at        timestamptz,
  settled_at         timestamptz
);
CREATE INDEX IF NOT EXISTS challenges_market_idx ON challenges (market_id, status);
CREATE INDEX IF NOT EXISTS challenges_users_idx ON challenges (challenger_id, opponent_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(user_id),
  kind       text NOT NULL,
  ref_id     text,
  actor_id   text REFERENCES users(user_id),
  body       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read_at, created_at);
