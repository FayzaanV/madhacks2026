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
 * Query gold tables on the Databricks SQL warehouse (Statement Execution API).
 * `{catalog}` in the SQL is replaced with the configured catalog. Use :name params for values.
 */
export async function querySql<T = Record<string, unknown>>(
  sql: string,
  params: Record<string, string | number> = {},
): Promise<T[]> {
  await connection();
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
