-- Campus markets: UW Rec Well crowding (see app/src/server/campus-data.ts). Lives in the isolated yomi-union-pipeline
-- (not the main medallion), so a missing rec table can never stop leaderboards. Nothing in the main pipeline reads it.

CREATE OR REFRESH MATERIALIZED VIEW the_curve.silver.facility_counts
COMMENT 'UW Rec Well count updates in Madison local time (open spaces only), saved by the laptop relay every 5 minutes'
AS SELECT location_id, location_name, facility_name, last_count, capacity,
          CASE WHEN capacity > 0 THEN 100.0 * last_count / capacity END AS pct_full,
          source_updated_at,
          from_utc_timestamp(source_updated_at, 'America/Chicago') AS local_time
FROM the_curve.bronze.facility_counts_raw
WHERE NOT is_closed;

CREATE OR REFRESH MATERIALIZED VIEW the_curve.gold.facility_busyness
COMMENT 'Typical crowd per rec space by weekday (1 = Sunday) and hour, Madison time. Shown on rec-center markets as the base rate.'
AS SELECT location_id, location_name, facility_name,
          dayofweek(local_time) AS day_of_week, hour(local_time) AS hour,
          AVG(last_count) AS avg_count, AVG(pct_full) AS avg_pct, MAX(last_count) AS max_count,
          COUNT(*) AS n_readings
FROM the_curve.silver.facility_counts
GROUP BY ALL;
