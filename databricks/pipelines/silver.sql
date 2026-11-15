-- Lakeflow Declarative Pipeline: bronze -> silver.
-- Bronze tables are written by 01_simulate_data and 10_sync_bronze.
-- Formulas here mirror databricks/lib/clout.py; keep them in sync.

CREATE OR REFRESH MATERIALIZED VIEW the_curve.silver.users
COMMENT 'One row per student'
AS SELECT user_id, school_id, handle, major, dorm, club, class_year, archetype, is_instructor,
          clout AS ledger_clout, created_at, is_simulated
FROM the_curve.bronze.users_raw
QUALIFY ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ingested_at DESC) = 1;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.silver.resolutions
COMMENT 'Latest resolution per market'
AS SELECT market_id, winning_outcome_index, resolved_by, rationale, resolved_at, dispute_deadline, final_at,
          status AS resolution_status
FROM the_curve.bronze.resolutions_raw
QUALIFY ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY resolved_at DESC) = 1;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.silver.outcomes
COMMENT 'Outcomes with current LMSR crowd price: exp(q/b - max) / sum (log-sum-exp)'
AS WITH o AS (
  SELECT o.market_id, o.outcome_index, o.label, o.q_shares, m.liquidity_b AS b
  FROM the_curve.bronze.outcomes_raw o JOIN the_curve.bronze.markets_raw m USING (market_id)
), e AS (
  SELECT *, EXP(q_shares / b - MAX(q_shares / b) OVER (PARTITION BY market_id)) AS ex FROM o
)
SELECT market_id, outcome_index, label, q_shares, ex / SUM(ex) OVER (PARTITION BY market_id) AS crowd_price
FROM e;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.silver.markets
COMMENT 'Markets with resolution and outcome count'
AS SELECT m.market_id, m.school_id, m.course, m.question, m.market_type, m.status, m.liquidity_b,
          m.creator_id, m.resolution_source, m.created_at, m.opens_at, m.closes_at, m.is_simulated,
          r.winning_outcome_index, r.resolved_at, r.resolved_by,
          r.winning_outcome_index IS NOT NULL AND m.status IN ('resolved', 'final') AS is_resolved,
          o.n_outcomes
FROM the_curve.bronze.markets_raw m
LEFT JOIN the_curve.silver.resolutions r USING (market_id)
LEFT JOIN (SELECT market_id, COUNT(*) AS n_outcomes FROM the_curve.bronze.outcomes_raw GROUP BY market_id) o
  USING (market_id);

CREATE OR REFRESH MATERIALIZED VIEW the_curve.silver.trades_enriched
COMMENT 'Trade + market + user. Signed: sells have negative shares/clout_spent/basis_change. forecast = post-trade price (buys only count as forecasts).'
AS SELECT t.trade_id, t.market_id, t.user_id, t.outcome_index, t.side, t.clout_spent, t.shares, t.basis_change,
          t.price_before, t.post_price AS forecast, t.prices_after, t.created_at, t.is_simulated,
          m.course, m.question, m.market_type, m.status AS market_status, m.is_resolved,
          m.winning_outcome_index, m.resolved_at,
          CASE WHEN m.is_resolved THEN CAST(t.outcome_index = m.winning_outcome_index AS INT) END AS won,
          u.handle, u.major, u.dorm, u.club, u.archetype
FROM the_curve.bronze.trades_raw t
JOIN the_curve.silver.markets m USING (market_id)
LEFT JOIN the_curve.silver.users u USING (user_id);

CREATE OR REFRESH MATERIALIZED VIEW the_curve.silver.schools
COMMENT 'Universities (listed + discovered from .edu sign-ups)'
AS SELECT school_id, name, short_name, domain, color, is_listed
FROM the_curve.bronze.schools_raw
QUALIFY ROW_NUMBER() OVER (PARTITION BY school_id ORDER BY ingested_at DESC) = 1;
