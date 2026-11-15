-- Lakeflow Declarative Pipeline: silver -> gold. The app reads these through the SQL warehouse.
-- Formulas mirror databricks/lib/clout.py (payout, Brier, calibration, Smart Money).

-- Trades are signed (sells: negative shares, clout_spent = -proceeds, basis_change = -avg cost removed).
--   resolved market:  realized = won * shares - clout_spent   (payout on shares still held minus net cash put in)
--   open market:      realized = basis_change - clout_spent    (profit already taken by selling), at risk = basis_change
--   voided market:    nothing (every net cash flow was reversed)
CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_clout
COMMENT 'Clout = 100 + realized profit (resolved payouts + profit taken by selling). open_stake = cost basis still held in open markets. available = Clout - open_stake = the ledger balance.'
AS WITH t AS (
  SELECT user_id, trade_id, market_id,
         CASE WHEN is_resolved THEN won * shares - clout_spent
              WHEN market_status <> 'voided' THEN basis_change - clout_spent ELSE 0 END AS realized,
         CASE WHEN NOT is_resolved AND market_status <> 'voided' THEN basis_change ELSE 0 END AS at_risk
  FROM the_curve.silver.trades_enriched
), agg AS (
  SELECT u.user_id, u.handle, u.school_id, u.major, u.dorm, u.club, u.archetype, u.is_simulated,
         COALESCE(SUM(t.realized), 0) AS realized_profit,
         COALESCE(SUM(t.at_risk), 0) AS open_stake,
         COUNT(t.trade_id) AS n_trades,
         COUNT(DISTINCT t.market_id) AS n_markets
  FROM the_curve.silver.users u
  LEFT JOIN t USING (user_id)
  GROUP BY ALL
)
SELECT user_id, handle, school_id, major, dorm, club, archetype, is_simulated,
       100 + realized_profit AS clout, realized_profit, open_stake, 100 + realized_profit - open_stake AS available,
       n_trades, n_markets
FROM agg;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_clout_history
COMMENT 'True Clout over time per user (portfolio chart): steps at each sell (profit taken) and each resolution (payout - basis held)'
AS WITH ev AS (
  SELECT user_id, created_at AS at, basis_change - clout_spent AS delta
  FROM the_curve.silver.trades_enriched WHERE side = 'sell' AND market_status <> 'voided'
  UNION ALL
  SELECT user_id, resolved_at AS at, SUM(won * shares - basis_change) AS delta
  FROM the_curve.silver.trades_enriched WHERE is_resolved
  GROUP BY user_id, market_id, resolved_at
)
SELECT user_id, at, delta, 100 + SUM(delta) OVER (PARTITION BY user_id ORDER BY at ROWS UNBOUNDED PRECEDING) AS clout
FROM ev;

-- Brier is scored per (user, market), not per trade: inside a market each buy's (f - o)^2 is weighted by its stake,
-- then every market counts once. Sells aren't forecasts. Otherwise ten 1-Clout bets outweigh one 100-Clout bet and flair can be farmed.
CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_market_brier
COMMENT 'Stake-weighted Brier per user and resolved market'
AS SELECT user_id, market_id, course,
          SUM(CASE WHEN side = 'buy' THEN clout_spent * POW(forecast - won, 2) END)
            / NULLIF(SUM(CASE WHEN side = 'buy' THEN clout_spent END), 0) AS brier,
          SUM(won * shares - clout_spent) AS clout
FROM the_curve.silver.trades_enriched WHERE is_resolved
GROUP BY user_id, market_id, course;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_brier
COMMENT 'Mean Brier score over resolved markets (each market once, stake-weighted inside); lower is better. n_forecasts = markets'
AS SELECT user_id, AVG(brier) AS brier, COUNT(*) AS n_forecasts
FROM the_curve.gold.user_market_brier
GROUP BY user_id;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_calibration
COMMENT '10% forecast buckets: mean forecast vs hit rate, per user and overall (user_id = __all__)'
AS WITH f AS (
  SELECT user_id, LEAST(9, GREATEST(0, FLOOR(forecast * 10))) AS bucket, forecast, won
  FROM the_curve.silver.trades_enriched WHERE is_resolved AND side = 'buy'
)
SELECT user_id, CAST(bucket AS INT) AS bucket, COUNT(*) AS n, AVG(forecast) AS mean_forecast, AVG(won) AS hit_rate
FROM f GROUP BY user_id, bucket
UNION ALL
SELECT '__all__', CAST(bucket AS INT), COUNT(*), AVG(forecast), AVG(won) FROM f GROUP BY bucket;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_course_clout
COMMENT 'Clout earned per course (resolved markets only). brier/n_forecasts are per market, like user_brier'
AS SELECT user_id, course, SUM(clout) AS clout, AVG(brier) AS brier, COUNT(*) AS n_forecasts
FROM the_curve.gold.user_market_brier
GROUP BY user_id, course;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.leaderboard
COMMENT 'Ranks by scope (overall/school/major/dorm/club/course). rank_from_bottom powers the Hall of Shame.'
AS WITH base AS (
  SELECT c.user_id, c.handle, c.school_id, c.clout, b.brier, c.n_trades, c.major, c.dorm, c.club
  FROM the_curve.gold.user_clout c LEFT JOIN the_curve.gold.user_brier b USING (user_id)
  WHERE c.n_trades > 0
), scoped AS (
  SELECT 'overall' AS scope, 'all' AS scope_value, user_id, handle, school_id, clout, brier, n_trades FROM base
  UNION ALL SELECT 'school', school_id, user_id, handle, school_id, clout, brier, n_trades FROM base
  UNION ALL SELECT 'major', major, user_id, handle, school_id, clout, brier, n_trades FROM base
  UNION ALL SELECT 'dorm', dorm, user_id, handle, school_id, clout, brier, n_trades FROM base WHERE dorm <> 'Off campus'
  UNION ALL SELECT 'club', club, user_id, handle, school_id, clout, brier, n_trades FROM base WHERE club <> 'none'
  UNION ALL SELECT 'course', cc.course, cc.user_id, b.handle, b.school_id, cc.clout, cc.brier, cc.n_forecasts
            FROM the_curve.gold.user_course_clout cc JOIN base b USING (user_id)
)
SELECT *,
  RANK() OVER (PARTITION BY scope, scope_value ORDER BY clout DESC) AS rank,
  RANK() OVER (PARTITION BY scope, scope_value ORDER BY clout ASC) AS rank_from_bottom
FROM scoped;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.market_smart_money
COMMENT 'Smart Money: cost basis still held per outcome by profitable users, weighted by realized profit, vs crowd price'
AS WITH pos AS (
  SELECT market_id, outcome_index, user_id, GREATEST(SUM(basis_change), 0) AS stake
  FROM the_curve.silver.trades_enriched GROUP BY ALL
), stake AS (
  SELECT p.market_id, p.outcome_index, SUM(c.realized_profit * p.stake) AS w
  FROM pos p JOIN the_curve.gold.user_clout c USING (user_id)
  WHERE c.realized_profit > 0
  GROUP BY p.market_id, p.outcome_index
)
SELECT o.market_id, o.outcome_index, o.label, o.crowd_price,
       COALESCE(s.w, 0) / NULLIF(SUM(COALESCE(s.w, 0)) OVER (PARTITION BY o.market_id), 0) AS smart_price
FROM the_curve.silver.outcomes o
LEFT JOIN stake s USING (market_id, outcome_index);

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.market_mispricing
COMMENT 'Largest crowd vs Smart Money gap per market (ties -> lowest outcome_index, i.e. Yes)'
AS SELECT m.market_id, m.course, m.question, m.status, m.closes_at,
          MAX_BY(sm.label, ABS(sm.smart_price - sm.crowd_price) - sm.outcome_index * 1e-9) AS outcome_label,
          MAX(ABS(sm.smart_price - sm.crowd_price)) AS gap,
          MAX_BY(sm.crowd_price, ABS(sm.smart_price - sm.crowd_price) - sm.outcome_index * 1e-9) AS crowd_price,
          MAX_BY(sm.smart_price, ABS(sm.smart_price - sm.crowd_price) - sm.outcome_index * 1e-9) AS smart_price
FROM the_curve.silver.markets m JOIN the_curve.gold.market_smart_money sm USING (market_id)
GROUP BY ALL;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.market_price_history
COMMENT 'Per trade and outcome: crowd price after the trade and the running Smart Money price'
AS WITH t AS (
  SELECT t.trade_id, t.market_id, t.created_at, t.outcome_index AS bought, t.basis_change, t.prices_after,
         GREATEST(c.realized_profit, 0) AS w
  FROM the_curve.silver.trades_enriched t JOIN the_curve.gold.user_clout c USING (user_id)
), x AS (
  SELECT t.trade_id, t.market_id, t.created_at, o.outcome_index, o.label,
         t.prices_after[o.outcome_index] AS crowd_price,
         SUM(CASE WHEN t.bought = o.outcome_index THEN t.w * t.basis_change ELSE 0 END)
           OVER (PARTITION BY t.market_id, o.outcome_index ORDER BY t.created_at, t.trade_id) AS cum_w
  FROM t JOIN the_curve.silver.outcomes o USING (market_id)
)
SELECT trade_id, market_id, created_at, outcome_index, label, crowd_price,
       GREATEST(cum_w, 0) / NULLIF(SUM(GREATEST(cum_w, 0)) OVER (PARTITION BY trade_id), 0) AS smart_price
FROM x;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_flair
COMMENT 'Flair: Oracle / Inverse Oracle per course (min 3 resolved forecasts) and campus-wide'
AS WITH ranked AS (
  SELECT user_id, course, brier,
         ROW_NUMBER() OVER (PARTITION BY course ORDER BY brier ASC) AS best,
         ROW_NUMBER() OVER (PARTITION BY course ORDER BY brier DESC) AS worst
  FROM the_curve.gold.user_course_clout WHERE n_forecasts >= 3 AND course <> 'campus'
), overall AS (
  SELECT user_id,
         ROW_NUMBER() OVER (ORDER BY clout DESC) AS top,
         ROW_NUMBER() OVER (ORDER BY clout ASC) AS bottom
  FROM the_curve.gold.user_clout WHERE n_trades > 0
)
SELECT user_id, CONCAT('Oracle of ', course) AS flair, 'oracle' AS kind FROM ranked WHERE best = 1
UNION ALL SELECT user_id, CONCAT('Inverse Oracle of ', course), 'inverse' FROM ranked WHERE worst = 1
UNION ALL SELECT user_id, 'Campus Oracle', 'oracle' FROM overall WHERE top = 1
UNION ALL SELECT user_id, 'Inverse Oracle', 'inverse' FROM overall WHERE bottom = 1;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.school_rankings
COMMENT 'Inter-campus league: schools ranked by average Clout of their forecasters (min 1 trade)'
AS WITH per AS (
  SELECT c.school_id, COUNT(*) AS forecasters, AVG(c.clout) AS avg_clout, SUM(c.realized_profit) AS total_profit,
         AVG(b.brier) AS avg_brier, MAX(c.clout) AS top_clout, SUM(c.n_trades) AS trades
  FROM the_curve.gold.user_clout c LEFT JOIN the_curve.gold.user_brier b USING (user_id)
  WHERE c.n_trades > 0
  GROUP BY c.school_id
)
SELECT p.*, s.name, s.short_name, s.domain, s.color,
       RANK() OVER (ORDER BY p.avg_clout DESC) AS rank
FROM per p LEFT JOIN the_curve.silver.schools s USING (school_id);

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.clout_drift
COMMENT 'Ledger balance (users.clout in Lakebase) vs the balance gold recomputes from trades. Should be empty; rows mean a payout bug'
AS SELECT u.user_id, u.handle, u.is_simulated, u.ledger_clout, c.available AS gold_available,
          u.ledger_clout - c.available AS drift
FROM the_curve.silver.users u JOIN the_curve.gold.user_clout c USING (user_id)
WHERE ABS(u.ledger_clout - c.available) > 0.01;
