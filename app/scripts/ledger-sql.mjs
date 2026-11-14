#!/usr/bin/env node
// Run SQL against the Lakebase ledger as yourself (Databricks CLI DEFAULT profile).
//   node app/scripts/ledger-sql.mjs "SELECT count(*) FROM trades"
//   node app/scripts/ledger-sql.mjs grant-app <service-principal-client-id>
import { execFileSync } from "node:child_process";
import pg from "pg";

const ENDPOINT = process.env.LAKEBASE_ENDPOINT ?? "projects/the-curve-ledger/branches/production/endpoints/primary";
const cli = (...args) => JSON.parse(execFileSync("databricks", [...args, "-o", "json"], { encoding: "utf8" }));

const ep = cli("postgres", "get-endpoint", ENDPOINT);
const cred = cli("postgres", "generate-database-credential", ENDPOINT);
const me = cli("current-user", "me").userName;
const client = new pg.Client({
  host: ep.status.hosts.host, database: "databricks_postgres", user: me, password: cred.token, ssl: true,
});
await client.connect();

let sql = process.argv.slice(2).join(" ");
if (process.argv[2] === "grant-app") {
  const sp = process.argv[3];
  if (!sp) throw new Error("usage: grant-app <service-principal-client-id>");
  sql = `GRANT USAGE ON SCHEMA public TO "${sp}";
         GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${sp}";
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${sp}";`;
}
const res = await client.query(sql);
for (const r of [res].flat()) if (r.rows?.length) console.table(r.rows);
console.log("ok");
await client.end();
