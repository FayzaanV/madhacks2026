-- Lakeflow Declarative Pipeline: Union markets (separate from the main medallion pipeline on purpose).
-- It reads core silver/gold tables (markets, outcomes, trades_enriched, market_smart_money) but nothing in the main
-- pipeline reads these, so a Union problem (e.g. Union tables not in the ledger yet) can never stop leaderboards.
-- Runs as the last task of yomi-refresh with run_if ALL_DONE.

-- Union markets: venues, live venue readings and settlement rules (see databricks/lib/union.py).
CREATE OR REFRESH MATERIALIZED VIEW the_curve.silver.venues
COMMENT 'Wisconsin Union venues (latest row per venue)'
AS SELECT venue_id, name, building, capacity, sensor, external_id, is_simulated
FROM the_curve.bronze.venues_raw
QUALIFY ROW_NUMBER() OVER (PARTITION BY venue_id ORDER BY ingested_at DESC) = 1;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.silver.venue_metrics
COMMENT 'Venue readings: sensor (occuspace), partner point of sale (partner) or simulated feed (sim); local_ts in Madison time'
AS SELECT venue_id, metric, CAST(value AS DOUBLE) AS value, observed_at,
          from_utc_timestamp(observed_at, 'America/Chicago') AS local_ts, source, is_simulated
FROM the_curve.bronze.venue_metrics_raw
QUALIFY ROW_NUMBER() OVER (PARTITION BY venue_id, metric, source, observed_at ORDER BY ingested_at DESC) = 1;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.silver.market_rules
COMMENT 'How each Union market settles: aggregate the metric over the window and compare with the threshold'
AS SELECT market_id, venue_id, metric, op, threshold, window_start, window_end, agg
FROM the_curve.bronze.market_rules_raw
QUALIFY ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY ingested_at DESC) = 1;

-- ------------------------------------------------------------------ Union markets
CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.venue_baselines
COMMENT 'Typical venue levels by weekday and local hour over the last 28 days (p25, p50, p75), for fair thresholds'
AS SELECT venue_id, metric, dayofweek(local_ts) AS dow, hour(local_ts) AS hour,
          percentile_approx(value, 0.25) AS p25, percentile_approx(value, 0.5) AS p50, percentile_approx(value, 0.75) AS p75,
          COUNT(*) AS n, MAX(CAST(is_simulated AS INT)) = 1 AS any_simulated
FROM the_curve.silver.venue_metrics
WHERE observed_at > current_timestamp() - INTERVAL 28 DAYS
GROUP BY ALL;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.union_forecasts
COMMENT 'Each Union market with its rule, the crowd and Smart Money chance of Yes, and the outcome once settled'
AS SELECT m.market_id, m.question, m.status, m.closes_at, m.is_simulated, r.venue_id, v.name AS venue, r.metric, r.op,
          r.threshold, r.window_start, r.window_end, r.agg, o.crowd_price AS crowd_yes, sm.smart_price AS smart_yes,
          m.winning_outcome_index
FROM the_curve.silver.markets m
JOIN the_curve.silver.market_rules r USING (market_id)
JOIN the_curve.silver.venues v USING (venue_id)
LEFT JOIN the_curve.silver.outcomes o ON o.market_id = m.market_id AND o.outcome_index = 0
LEFT JOIN the_curve.gold.market_smart_money sm ON sm.market_id = m.market_id AND sm.outcome_index = 0;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.union_market_scores
COMMENT 'Per settled Union market: crowd chance of Yes at close vs the venue history hit rate (same window 1 to 4 weeks earlier), with Brier scores'
AS WITH m AS (
  SELECT *, CAST(winning_outcome_index = 0 AS INT) AS yes FROM the_curve.gold.union_forecasts
  WHERE winning_outcome_index IS NOT NULL
), crowd AS (
  SELECT m.market_id, COALESCE(MAX_BY(t.prices_after[0], t.created_at), 0.5) AS p
  FROM m LEFT JOIN the_curve.silver.trades_enriched t ON t.market_id = m.market_id AND t.created_at < m.closes_at
  GROUP BY m.market_id
), past AS (
  SELECT m.market_id, w.k,
         CASE WHEN m.agg = 'max' THEN MAX(vm.value) WHEN m.agg = 'last' THEN MAX_BY(vm.value, vm.observed_at)
              ELSE AVG(vm.value) END AS v
  FROM m CROSS JOIN (SELECT explode(sequence(7, 28, 7)) AS k) w
  JOIN the_curve.silver.venue_metrics vm
    ON vm.venue_id = m.venue_id AND vm.metric = m.metric
   AND vm.observed_at >= m.window_start - make_interval(0, 0, 0, w.k) AND vm.observed_at < m.window_end - make_interval(0, 0, 0, w.k)
  GROUP BY m.market_id, w.k, m.agg
), base AS (
  SELECT p.market_id,
         AVG(CASE WHEN (m.op = '>=' AND p.v >= m.threshold) OR (m.op = '<' AND p.v < m.threshold) THEN 1.0 ELSE 0.0 END) AS p
  FROM past p JOIN m USING (market_id) GROUP BY p.market_id
)
SELECT m.market_id, m.venue_id, m.venue, m.metric, m.question, m.window_start, m.is_simulated, m.yes,
       c.p AS crowd_p, COALESCE(b.p, 0.5) AS history_p,
       POW(c.p - m.yes, 2) AS crowd_brier, POW(COALESCE(b.p, 0.5) - m.yes, 2) AS history_brier
FROM m JOIN crowd c USING (market_id) LEFT JOIN base b USING (market_id);

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.union_accuracy
COMMENT 'Partner scorecard: is the crowd better than venue history? Mean Brier per venue (lower is better); venue_id __all__ = every venue'
AS SELECT venue_id, venue, COUNT(*) AS n_markets, AVG(crowd_brier) AS crowd_brier, AVG(history_brier) AS history_brier,
          AVG(history_brier) - AVG(crowd_brier) AS crowd_edge
FROM the_curve.gold.union_market_scores GROUP BY venue_id, venue
UNION ALL
SELECT '__all__', 'All venues', COUNT(*), AVG(crowd_brier), AVG(history_brier), AVG(history_brier) - AVG(crowd_brier)
FROM the_curve.gold.union_market_scores;
