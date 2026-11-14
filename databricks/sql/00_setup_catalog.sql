-- One-time setup for Yomi's Unity Catalog namespace.
-- Run: python3 scripts/dbsql.py -f databricks/sql/00_setup_catalog.sql
CREATE CATALOG IF NOT EXISTS the_curve COMMENT 'Yomi: campus prediction market (MadHacks 2026)';
CREATE SCHEMA IF NOT EXISTS the_curve.bronze COMMENT 'Raw data: simulated rows and syncs from the Lakebase ledger';
CREATE SCHEMA IF NOT EXISTS the_curve.silver COMMENT 'Cleaned trades joined with markets and users';
CREATE SCHEMA IF NOT EXISTS the_curve.gold COMMENT 'Clout, calibration, leaderboards, Smart Money, AI insights (read by the app)';
CREATE SCHEMA IF NOT EXISTS the_curve.ml COMMENT 'Feature tables and registered models';
CREATE SCHEMA IF NOT EXISTS the_curve.ai COMMENT 'AI analyst questions, syllabus uploads, generated markets';
-- `the-curve-team` is a workspace-local group, which Unity Catalog cannot grant to.
-- On Free Edition the account contains only this workspace's users (our team), so grant to `account users`.
GRANT ALL PRIVILEGES ON CATALOG the_curve TO `account users`;

-- The Lakebase ledger, registered in Unity Catalog so Spark/SQL can read it directly:
--   databricks postgres create-project the-curve-ledger --json '{"spec":{"display_name":"Yomi ledger"}}'
--   databricks postgres create-catalog the_curve_ledger --json '{"spec":{"branch":"projects/the-curve-ledger/branches/production","postgres_database":"databricks_postgres"}}'
GRANT ALL PRIVILEGES ON CATALOG the_curve_ledger TO `account users`;
