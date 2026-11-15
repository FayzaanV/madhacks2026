import "server-only";
import { requestScope } from "./background";
import { Pool, type PoolClient } from "pg";
import { config, dbx } from "./databricks";

/**
 * Lakebase (managed Postgres) connection pool. The password is a short-lived Lakebase credential
 * generated for whoever the app runs as (the app's service principal on Databricks Apps, you locally).
 */
type Endpoint = { status: { hosts: { host: string } } };
type Me = { userName: string; id: string };

/**
 * Open stake = cost basis still at risk in unresolved markets. Uses basis_change (not clout_spent) so a sell
 * removes its average cost and profit already taken sits in the balance. Pass the SQL for the user id column.
 */
export const openStakeSql = (userIdCol: string) =>
  `coalesce((SELECT sum(t.basis_change) FROM trades t JOIN markets m USING (market_id)
             WHERE t.user_id = ${userIdCol} AND m.status NOT IN ('resolved', 'final', 'voided')), 0)::float`;

let pool: Pool | null = null;
let poolExpires = 0;

async function lakebaseCredential(): Promise<{ token: string; expires: number }> {
  const r = await dbx<{ token: string; expire_time: string }>("/api/2.0/postgres/credentials", {
    method: "POST",
    body: JSON.stringify({ endpoint: config.lakebaseEndpoint }),
  });
  return { token: r.token, expires: Date.parse(r.expire_time) };
}

let pending: Promise<Pool> | null = null;

/** Concurrent callers share one in-flight build, so a cold start creates one pool instead of one per request. */
function getPool(): Promise<Pool> {
  if (pool && poolExpires > Date.now() + 120_000) return Promise.resolve(pool);
  pending ??= buildPool().finally(() => {
    pending = null;
  });
  return pending;
}

async function buildPool(): Promise<Pool> {
  const old = pool;
  const [ep, me, cred] = await Promise.all([
    dbx<Endpoint>(`/api/2.0/postgres/${config.lakebaseEndpoint}`),
    // On Databricks Apps PGUSER is the service principal's client id; locally use our username.
    process.env.PGUSER ? Promise.resolve(null) : dbx<Me>("/api/2.0/preview/scim/v2/Me"),
    lakebaseCredential(),
  ]);
  pool = new Pool({
    host: process.env.PGHOST ?? ep.status.hosts.host,
    database: process.env.PGDATABASE ?? "databricks_postgres",
    user: process.env.PGUSER ?? me!.userName,
    password: cred.token,
    port: Number(process.env.PGPORT ?? 5432),
    ssl: { rejectUnauthorized: true },
    max: 5,
  });
  poolExpires = cred.expires;
  if (old) void old.end().catch(() => {});
  return pool;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await requestScope();
  const p = await getPool();
  const r = await p.query(sql, params);
  return r.rows as T[];
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await requestScope();
  const c = await (await getPool()).connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
