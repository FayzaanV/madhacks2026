-- Lakeflow Declarative Pipeline: silver -> gold. The app reads these through the SQL warehouse.
-- Formulas mirror databricks/lib/clout.py (payout, Brier, calibration, Smart Money).

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_clout
COMMENT 'Clout = 100 + realized profit (resolved winning shares - resolved spend). available = Clout - open stakes.'
AS SELECT u.user_id, u.handle, u.major, u.dorm, u.club, u.archetype, u.is_simulated,
          100 + COALESCE(SUM(CASE WHEN t.is_resolved THEN t.won * t.shares - t.clout_spent END), 0) AS clout,
          COALESCE(SUM(CASE WHEN t.is_resolved THEN t.won * t.shares - t.clout_spent END), 0) AS realized_profit,
          COALESCE(SUM(CASE WHEN NOT t.is_resolved THEN t.clout_spent END), 0) AS open_stake,
          100 + COALESCE(SUM(CASE WHEN t.is_resolved THEN t.won * t.shares - t.clout_spent END), 0)
              - COALESCE(SUM(CASE WHEN NOT t.is_resolved THEN t.clout_spent END), 0) AS available,
          COUNT(t.trade_id) AS n_trades,
          COUNT(DISTINCT t.market_id) AS n_markets
FROM the_curve.silver.users u
LEFT JOIN the_curve.silver.trades_enriched t USING (user_id)
GROUP BY ALL;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_brier
COMMENT 'Mean Brier score (f - o)^2 over resolved forecasts; lower is better'
AS SELECT user_id, AVG(POW(forecast - won, 2)) AS brier, COUNT(*) AS n_forecasts
FROM the_curve.silver.trades_enriched WHERE is_resolved
GROUP BY user_id;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_calibration
COMMENT '10% forecast buckets: mean forecast vs hit rate, per user and overall (user_id = __all__)'
AS WITH f AS (
  SELECT user_id, LEAST(9, GREATEST(0, FLOOR(forecast * 10))) AS bucket, forecast, won
  FROM the_curve.silver.trades_enriched WHERE is_resolved
)
SELECT user_id, CAST(bucket AS INT) AS bucket, COUNT(*) AS n, AVG(forecast) AS mean_forecast, AVG(won) AS hit_rate
FROM f GROUP BY user_id, bucket
UNION ALL
SELECT '__all__', CAST(bucket AS INT), COUNT(*), AVG(forecast), AVG(won) FROM f GROUP BY bucket;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.user_course_clout
COMMENT 'Clout earned per course (resolved markets only)'
AS SELECT user_id, course, SUM(won * shares - clout_spent) AS clout, AVG(POW(forecast - won, 2)) AS brier,
          COUNT(*) AS n_forecasts
FROM the_curve.silver.trades_enriched WHERE is_resolved
GROUP BY user_id, course;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.leaderboard
COMMENT 'Ranks by scope (overall/major/dorm/club/course). rank_from_bottom powers the Hall of Shame.'
AS WITH base AS (
  SELECT c.user_id, c.handle, c.clout, b.brier, c.n_trades, c.major, c.dorm, c.club
  FROM the_curve.gold.user_clout c LEFT JOIN the_curve.gold.user_brier b USING (user_id)
  WHERE c.n_trades > 0
), scoped AS (
  SELECT 'overall' AS scope, 'all' AS scope_value, user_id, handle, clout, brier, n_trades FROM base
  UNION ALL SELECT 'major', major, user_id, handle, clout, brier, n_trades FROM base
  UNION ALL SELECT 'dorm', dorm, user_id, handle, clout, brier, n_trades FROM base
  UNION ALL SELECT 'club', club, user_id, handle, clout, brier, n_trades FROM base WHERE club <> 'none'
  UNION ALL SELECT 'course', cc.course, cc.user_id, b.handle, cc.clout, cc.brier, cc.n_forecasts
            FROM the_curve.gold.user_course_clout cc JOIN base b USING (user_id)
)
SELECT *,
  RANK() OVER (PARTITION BY scope, scope_value ORDER BY clout DESC) AS rank,
  RANK() OVER (PARTITION BY scope, scope_value ORDER BY clout ASC) AS rank_from_bottom
FROM scoped;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.market_smart_money
COMMENT 'Smart Money: stakes weighted by realized profit, profitable users only, vs crowd price'
AS WITH stake AS (
  SELECT t.market_id, t.outcome_index, SUM(c.realized_profit * t.clout_spent) AS w
  FROM the_curve.silver.trades_enriched t JOIN the_curve.gold.user_clout c USING (user_id)
  WHERE c.realized_profit > 0
  GROUP BY t.market_id, t.outcome_index
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
  SELECT t.trade_id, t.market_id, t.created_at, t.outcome_index AS bought, t.clout_spent, t.prices_after,
         GREATEST(c.realized_profit, 0) AS w
  FROM the_curve.silver.trades_enriched t JOIN the_curve.gold.user_clout c USING (user_id)
), x AS (
  SELECT t.trade_id, t.market_id, t.created_at, o.outcome_index, o.label,
         t.prices_after[o.outcome_index] AS crowd_price,
         SUM(CASE WHEN t.bought = o.outcome_index THEN t.w * t.clout_spent ELSE 0 END)
           OVER (PARTITION BY t.market_id, o.outcome_index ORDER BY t.created_at, t.trade_id) AS cum_w
  FROM t JOIN the_curve.silver.outcomes o USING (market_id)
)
SELECT trade_id, market_id, created_at, outcome_index, label, crowd_price,
       cum_w / NULLIF(SUM(cum_w) OVER (PARTITION BY trade_id), 0) AS smart_price
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
