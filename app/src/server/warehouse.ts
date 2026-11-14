import "server-only";
import { connection } from "next/server";
import { config, dbx } from "./databricks";

type StatementResponse = {
  statement_id: string;
  status: { state: string; error?: { message?: string } };
  manifest?: { schema: { columns: { name: string; type_name: string }[] } };
  result?: { data_array?: (string | null)[][] };
};

const NUMERIC = new Set(["INT", "LONG", "BIGINT", "SHORT", "BYTE", "DOUBLE", "FLOAT", "DECIMAL"]);

/**
 * Gold tables only change when the refresh job runs (every 15 min, or after a resolution), so identical
 * queries within CACHE_MS share one warehouse round trip. Concurrent identical queries share one in-flight call.
 */
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; rows: Promise<unknown[]> }>();

/** Drop cached gold reads, e.g. after a resolution kicks off a refresh. */
export const clearWarehouseCache = () => cache.clear();

/**
 * Query gold tables on the Databricks SQL warehouse (Statement Execution API).
 * `{catalog}` in the SQL is replaced with the configured catalog. Use :name params for values.
 * Results are cached for 30 s; pass { fresh: true } to skip the cache.
 */
export async function querySql<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, string | number> = {},
  { fresh = false }: { fresh?: boolean } = {},
): Promise<T[]> {
  await connection();
  const key = JSON.stringify([sql, params]);
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.rows as Promise<T[]>;
  const rows = runSql<T>(sql, params);
  cache.set(key, { at: Date.now(), rows });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  rows.catch(() => cache.delete(key)); // never cache failures
  return rows;
}

async function runSql<T>(sql: string, params: Record<string, string | number>): Promise<T[]> {
  let res = await dbx<StatementResponse>("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({
      warehouse_id: config.warehouseId,
      statement: sql.replaceAll("{catalog}", config.catalog),
      parameters: Object.entries(params).map(([name, value]) => ({ name, value: String(value) })),
      wait_timeout: "30s",
      on_wait_timeout: "CONTINUE",
    }),
  });
  while (res.status.state === "PENDING" || res.status.state === "RUNNING") {
    await new Promise((r) => setTimeout(r, 1000));
    res = await dbx<StatementResponse>(`/api/2.0/sql/statements/${res.statement_id}`);
  }
  if (res.status.state !== "SUCCEEDED") throw new Error(res.status.error?.message ?? res.status.state);
  const cols = res.manifest?.schema.columns ?? [];
  return (res.result?.data_array ?? []).map((row) =>
    Object.fromEntries(
      cols.map((c, i) => {
        const v = row[i];
        if (v === null) return [c.name, null];
        if (NUMERIC.has(c.type_name)) return [c.name, Number(v)];
        if (c.type_name === "BOOLEAN") return [c.name, v === "true"];
        return [c.name, v];
      }),
    ),
  ) as T[];
}
